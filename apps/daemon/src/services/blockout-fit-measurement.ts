import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { BlockoutImageMeasurement, BlockoutTextMeasurement } from '@open-design/contracts';

export interface BlockoutTextMeasureRequest { text: string; fontFamily: string; fontSizePt: number; lineHeight: number; widthMm: number }
export type BlockoutTextMeasurer = (request: BlockoutTextMeasureRequest) => Promise<BlockoutTextMeasurement>;
export type BlockoutImageMeasurer = (absolutePath: string) => Promise<BlockoutImageMeasurement>;

// Exact source text travels over stdin, never shell arguments. No font substitution.
const MEASURE = String.raw`
import sys,json,os,re,struct,hashlib,unicodedata
from PIL import ImageFont,Image,features
payload=json.load(sys.stdin)
DPI=720.0
PXMM=25.4/DPI
font_names={'arial':'arial.ttf','arial bold':'arialbd.ttf','arial italic':'ariali.ttf','arial bold italic':'arialbi.ttf','calibri':'calibri.ttf','calibri bold':'calibrib.ttf','cambria':'cambria.ttc','times new roman':'times.ttf','georgia':'georgia.ttf','verdana':'verdana.ttf','tahoma':'tahoma.ttf','segoe ui':'segoeui.ttf','courier new':'cour.ttf'}
font_cache={}
def glyph_checker(data):
  # sfnt cmap formats 4/12, with the same first TTC face Pillow loads.
  base=struct.unpack_from('>I',data,12)[0] if data[:4]==b'ttcf' else 0
  count=struct.unpack_from('>H',data,base+4)[0]
  cmap=None
  for i in range(count):
    at=base+12+16*i
    if data[at:at+4]==b'cmap': cmap=struct.unpack_from('>I',data,at+8)[0]; break
  if cmap is None: raise ValueError('Font has no verifiable Unicode character map')
  tables=[]
  for i in range(struct.unpack_from('>H',data,cmap+2)[0]):
    platform,encoding,offset=struct.unpack_from('>HHI',data,cmap+4+8*i)
    at=cmap+offset; fmt=struct.unpack_from('>H',data,at)[0]
    if platform==0 or (platform==3 and encoding in (1,10)):
      if fmt in (4,12): tables.append((fmt,at))
  if not tables: raise ValueError('Unsupported Unicode character map')
  def has(cp):
    for fmt,at in tables:
      if fmt==12:
        for i in range(struct.unpack_from('>I',data,at+12)[0]):
          start,end,glyph=struct.unpack_from('>III',data,at+16+12*i)
          if start<=cp<=end and glyph+cp-start: return True
      elif cp<=65535:
        n=struct.unpack_from('>H',data,at+6)[0]//2
        ends=at+14; starts=ends+2*n+2; deltas=starts+2*n; ranges=deltas+2*n
        for i in range(n):
          end=struct.unpack_from('>H',data,ends+2*i)[0]; start=struct.unpack_from('>H',data,starts+2*i)[0]
          if start<=cp<=end:
            delta=struct.unpack_from('>h',data,deltas+2*i)[0]; offset=struct.unpack_from('>H',data,ranges+2*i)[0]
            glyph=(cp+delta)&65535 if offset==0 else struct.unpack_from('>H',data,ranges+2*i+offset+2*(cp-start))[0]
            if glyph: return True
    return False
  return has
def load_font(family,size):
  key=(family.casefold(),size)
  if key in font_cache: return font_cache[key]
  name=font_names.get(family.casefold().strip())
  if not name: raise ValueError('Requested font is not supported by the installed physical measurement resolver: '+family)
  candidates=[os.path.join(os.environ.get('WINDIR','C:/Windows'),'Fonts',name),'/Library/Fonts/'+name,'/usr/share/fonts/truetype/msttcorefonts/'+name]
  target=next((p for p in candidates if os.path.isfile(p)),None)
  if not target: raise ValueError('Requested font is not installed: '+family)
  with open(target,'rb') as source: data=source.read()
  font=ImageFont.truetype(target,size*DPI/72.0)
  value=(font,glyph_checker(data),hashlib.sha256(data).hexdigest())
  font_cache[key]=value; return value
def measure(request):
  result={'status':'unavailable','fontFamily':request['fontFamily'],'fontSizePt':request['fontSizePt'],'lineHeight':request['lineHeight'],'engine':'Pillow FreeType at 720 dpi','limitations':[],'lines':[],'lineHeightMm':0,'heightMm':0,'maxWidthMm':0}
  try:
    if request['widthMm']<=0 or request['fontSizePt']<=0 or request['lineHeight']<=0: raise ValueError('A positive physical width, font size and line height are required')
    text=request['text'].replace('\r\n','\n').replace('\r','\n')
    if '\t' in text: raise ValueError('Tab-stop width is unspecified; preserve the source and specify tab stops or use a source raster')
    if not text.strip(): raise ValueError('No source text is available to measure')
    if len(text)>250000: raise ValueError('Text block exceeds the bounded measurement size')
    if not features.check('raqm') and any(unicodedata.bidirectional(c) in ('R','AL','AN') or 0x900<=ord(c)<=0x109f or c=='\u200d' for c in text): raise ValueError('Complex-script shaping is unavailable in this Pillow build')
    font,has_glyph,font_hash=load_font(request['fontFamily'],request['fontSizePt'])
    missing=sorted({ord(c) for c in text if not c.isspace() and not has_glyph(ord(c))})
    if missing: raise ValueError('Font lacks source glyphs: '+','.join('U+%04X'%cp for cp in missing[:20]))
    limit=request['widthMm']/PXMM
    lines=[]
    # Preserve explicit source line breaks and spaces. A word that cannot fit
    # is wrapped at character boundaries, matching overflow-wrap:anywhere.
    for paragraph in text.split('\n'):
      current=''
      for token in re.findall(r'[^\S\n]+|\S+',paragraph):
        if font.getlength(current+token)<=limit: current+=token; continue
        if current: lines.append(current); current=''
        if font.getlength(token)<=limit: current=token; continue
        for c in token:
          if current and font.getlength(current+c)>limit: lines.append(current); current=''
          current+=c
      lines.append(current)
    measured=[]
    for line in lines:
      box=font.getbbox(line)
      measured.append({'text':line,'widthMm':font.getlength(line)*PXMM,'inkHeightMm':(box[3]-box[1])*PXMM})
    height=request['fontSizePt']*request['lineHeight']*25.4/72.0
    result.update(status='measured',resolvedFont=' '.join(font.getname()),fontHash=font_hash,lines=measured,lineHeightMm=height,heightMm=len(lines)*height,maxWidthMm=max((line['widthMm'] for line in measured),default=0))
  except Exception as error: result['limitations']=[str(error)]
  return result
texts=[measure(r) for r in payload.get('texts',[])]
images=[]
for filename in payload.get('images',[]):
  try:
    with Image.open(filename) as image:
      image.verify()
    with Image.open(filename) as image:
      width,height=image.size
    images.append({'status':'measured','width':width,'height':height,'limitations':[]})
  except Exception as error: images.append({'status':'unavailable','width':0,'height':0,'limitations':[str(error)]})
json.dump({'texts':texts,'images':images},sys.stdout,ensure_ascii=False)
`;

export async function measureBlockoutMaterials(texts: readonly BlockoutTextMeasureRequest[], images: readonly string[] = []): Promise<{ texts: BlockoutTextMeasurement[]; images: BlockoutImageMeasurement[] }> {
  const bundled = path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  const executable = process.env.MELILLO_PYTHON || (existsSync(bundled) ? bundled : 'python');
  try {
    if (texts.length > 1500 || texts.reduce((sum, request) => sum + request.text.length, 0) > 4_000_000 || images.length > 2000) throw new Error('Physical measurement exceeds its bounded batch size');
    return await new Promise((resolve, reject) => {
      const child = spawn(executable, ['-X', 'utf8', '-c', MEASURE], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('Physical measurement timed out')); }, 60_000);
      child.stdout.on('data', (data) => { stdout += String(data); if (stdout.length > 16_000_000) { child.kill(); reject(new Error('Physical measurement result exceeds its size limit')); } });
      child.stderr.on('data', (data) => { stderr = (stderr + String(data)).slice(-3000); });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (code) => { clearTimeout(timer); if (code !== 0) reject(new Error(stderr || `Physical measurement exited ${code}`)); else { try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Invalid physical measurement response')); } } });
      child.stdin.on('error', () => undefined);
      child.stdin.end(JSON.stringify({ texts, images }));
    });
  } catch (error) {
    const limitation = error instanceof Error ? error.message : String(error);
    return { texts: texts.map((request) => ({ ...request, status: 'unavailable', engine: 'unavailable', limitations: [limitation], lines: [], lineHeightMm: 0, heightMm: 0, maxWidthMm: 0 })), images: images.map(() => ({ status: 'unavailable', width: 0, height: 0, limitations: [limitation] })) };
  }
}
