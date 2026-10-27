/**
 * Printing a designed document page by page.
 *
 * Every page of a MelilloDesign document carries `data-melillodesign-document-page` with its paper size in
 * `data-width-mm` and `data-height-mm`. The script below runs inside the document before it prints: it gives each
 * page its own paper size (named pages when the sizes differ), hides the screen-only chrome around the pages and
 * keeps one page per sheet with no margin. The browser export and the daemon's export inject the same script, so
 * the two paths cannot drift apart.
 *
 * Chromium evaluates print media queries against its default paper (about 800 CSS px wide), not against the
 * `@page` size, so a design's `max-width: 900px` phone layout used to take over an A3 plate in print. The script
 * therefore settles every size-dependent media query at the document's own paper size before printing. It works
 * out width, height, aspect-ratio and orientation itself, because a helper frame would be cross-origin inside the
 * sandboxed print frame, and leaves a query it cannot read (`or`, `not`, unknown units) to the browser. It can
 * only read stylesheets of its own origin; a caller printing from a sandboxed frame inlines the linked ones first.
 */

export const DOCUMENT_PAGE_ATTRIBUTE = 'data-melillodesign-document-page';

/** A document whose pages declare their paper size; anything else keeps the generic export. */
export function isPagedDocumentHtml(html: string): boolean {
  return /\sdata-melillodesign-document-page[\s=>]/.test(html) && /\sdata-width-mm\s*=/.test(html) && /\sdata-height-mm\s*=/.test(html);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  agrave: 'à', egrave: 'è', eacute: 'é', igrave: 'ì', ograve: 'ò', ugrave: 'ù', Egrave: 'È', Agrave: 'À',
};

/**
 * The document's own title, which names its PDF as the browser print would. Exports are otherwise named after the
 * file's path in the project, so a designed document came out as `documents_fascicolo-grafico-b_….pdf`.
 */
export function pagedDocumentTitle(html: string): string | undefined {
  const raw = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const title = raw
    ?.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity: string, name: string) => {
      if (name[0] !== '#') return NAMED_ENTITIES[name] ?? entity;
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return title ? title : undefined;
}

/**
 * Plain ES5 so it runs in any document; it prepares at `load`, once, and leaves a document without sized pages
 * alone. Marks: data-md-print-size (a page and its size key), data-md-print-last, data-md-print-path (an
 * ancestor of a page, flattened for print), data-md-print-hide (screen chrome beside the pages),
 * data-md-print-ready on the root when done and data-md-print-unread-css with the count of stylesheets it
 * could not settle.
 */
export const DOCUMENT_PRINT_PREPARE_SCRIPT = `(function(){
var SIZED=/(width|height|aspect-ratio|orientation)/i,UNIT={px:1,em:16,rem:16,mm:96/25.4,cm:96/2.54,'in':96,pt:96/72,pc:16,q:96/101.6};
function length(text){var m=/^(-?[\\d.]+)\\s*([a-z]*)$/i.exec(text);if(!m)return NaN;var unit=(m[2]||'px').toLowerCase();return UNIT.hasOwnProperty(unit)?Number(m[1])*UNIT[unit]:NaN;}
function ratio(text){var m=/^([\\d.]+)\\s*(?:\\/\\s*([\\d.]+))?$/.exec(text);return m?Number(m[1])/Number(m[2]||1):NaN;}
function measure(name,w,h){return name==='width'?w:name==='height'?h:name==='aspect-ratio'?w/h:NaN;}
function compare(a,op,b){if(isNaN(a)||isNaN(b))return null;return op==='<'?a<b:op==='<='?a<=b+0.01:op==='>'?a>b:op==='>='?a>=b-0.01:Math.abs(a-b)<0.01;}
function value(text,name){return name==='aspect-ratio'?ratio(text):length(text);}
function feature(text,w,h){var m=/^(min-|max-)?(width|height|aspect-ratio|orientation)\\s*:\\s*(.+)$/.exec(text);
if(m){if(m[2]==='orientation')return m[3]===(h>=w?'portrait':'landscape');
return compare(measure(m[2],w,h),m[1]==='min-'?'>=':m[1]==='max-'?'<=':'=',value(m[3],m[2]));}
var parts=text.split(/\\s*(<=|>=|<|>|=)\\s*/),names=/^(width|height|aspect-ratio)$/;
if(parts.length===3)return names.test(parts[0])?compare(measure(parts[0],w,h),parts[1],value(parts[2],parts[0])):names.test(parts[2])?compare(value(parts[0],parts[2]),parts[1],measure(parts[2],w,h)):null;
if(parts.length===5&&names.test(parts[2])){var low=compare(value(parts[0],parts[2]),parts[1],measure(parts[2],w,h)),high=compare(measure(parts[2],w,h),parts[3],value(parts[4],parts[2]));return low===null||high===null?null:low&&high;}
return null;}
function settle(query,w,h){var text=query.toLowerCase().replace(/\\s+/g,' ').replace(/^ | $/g,'').replace(/^only /,''),type='all',rest=text;
if(/^not |\\bor\\b|\\(\\s*not\\b|\\(\\s*\\(/.test(text))return null;
var typed=/^(all|screen|print)\\b(?: and )?/.exec(text);if(typed){type=typed[1];rest=text.slice(typed[0].length);}else if(/^[a-z]/.test(text))return null;
if(type==='screen')return false;
var features=rest.match(/\\([^()]*\\)/g)||[];if(rest.replace(/\\([^()]*\\)/g,'').replace(/\\band\\b/g,'').replace(/\\s/g,''))return null;
var others=[];for(var i=0;i<features.length;i++){var result=feature(features[i].slice(1,-1).replace(/^\\s+|\\s+$/g,''),w,h);if(result===null)others.push(features[i]);else if(!result)return false;}
if(!others.length)return true;return typeof window.matchMedia==='function'?window.matchMedia(others.join(' and ')).matches:null;}
function fitList(list,w,h){if(!list||!list.length)return;var items=[],changed=false;
for(var i=0;i<list.length;i++){var query=list.item(i),result=SIZED.test(query)?settle(query,w,h):null;
if(result===null)items.push(query);else{items.push(result?'all':'not all');changed=true;}}
if(changed)list.mediaText=items.join(', ');}
function walk(rules,w,h){for(var i=0;i<rules.length;i++){var rule=rules[i];if(rule.media)fitList(rule.media,w,h);
if(rule.styleSheet){try{walk(rule.styleSheet.cssRules,w,h);}catch(e){}}else if(rule.cssRules)walk(rule.cssRules,w,h);}}
function fitMedia(w,h){var unread=0;
[].slice.call(document.styleSheets).forEach(function(sheet){var owner=sheet.ownerNode;if(owner&&owner.hasAttribute&&owner.hasAttribute('data-md-print'))return;
try{fitList(sheet.media,w,h);walk(sheet.cssRules,w,h);}catch(e){unread++;}});
if(unread)document.documentElement.setAttribute('data-md-print-unread-css',String(unread));}
function prepare(){
var root=document.documentElement;if(root.hasAttribute('data-md-print-ready'))return;
var pages=[].slice.call(document.querySelectorAll('[${DOCUMENT_PAGE_ATTRIBUTE}][data-width-mm][data-height-mm]'));
var sizes={},counts={},keys=[],path=[];
pages=pages.filter(function(page){var w=Number(page.getAttribute('data-width-mm')),h=Number(page.getAttribute('data-height-mm'));if(!(w>0&&h>0&&w<5000&&h<5000))return false;
var key=(String(Math.round(w*100)/100)+'x'+String(Math.round(h*100)/100)).replace(/\\./g,'_');
if(!sizes[key]){sizes[key]=[w,h];counts[key]=0;keys.push(key);}counts[key]++;page.setAttribute('data-md-print-size',key);
for(var el=page.parentElement;el&&el!==document.body&&el!==root;el=el.parentElement)if(path.indexOf(el)<0)path.push(el);return true;});
if(!pages.length)return;
pages[pages.length-1].setAttribute('data-md-print-last','');
path.forEach(function(el){el.setAttribute('data-md-print-path','');});
[document.body].concat(path).forEach(function(parent){[].slice.call(parent.children).forEach(function(child){
if(path.indexOf(child)>=0||child.hasAttribute('data-md-print-size')||/^(SCRIPT|STYLE|LINK|TEMPLATE|NOSCRIPT)$/.test(child.tagName))return;child.setAttribute('data-md-print-hide','');});});
var css='';
if(keys.length===1)css+='@page{size:'+sizes[keys[0]][0]+'mm '+sizes[keys[0]][1]+'mm;margin:0}';
else keys.forEach(function(key){css+='@page md-'+key+'{size:'+sizes[key][0]+'mm '+sizes[key][1]+'mm;margin:0}[data-md-print-size="'+key+'"]{page:md-'+key+'}';});
css+='@media print{html,body{margin:0!important;padding:0!important;background:#fff!important;width:auto!important;height:auto!important;overflow:visible!important}'
+'[data-md-print-hide]{display:none!important}'
+'[data-md-print-path]{display:block!important;position:static!important;margin:0!important;padding:0!important;border:0!important;gap:0!important;overflow:visible!important;transform:none!important;box-shadow:none!important;background:none!important;width:auto!important;height:auto!important;max-width:none!important;max-height:none!important;min-height:0!important}'
+'[data-md-print-size]{margin:0!important;box-shadow:none!important;transform:none!important;zoom:1!important;overflow:hidden!important;break-inside:avoid;break-after:page}'
+'[data-md-print-last]{break-after:auto}'
+'*{-webkit-print-color-adjust:exact;print-color-adjust:exact}';
keys.forEach(function(key){css+='[data-md-print-size="'+key+'"]{width:'+sizes[key][0]+'mm!important;height:'+sizes[key][1]+'mm!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important}';});
css+='}';
var dominant=keys[0];keys.forEach(function(key){if(counts[key]>counts[dominant])dominant=key;});
fitMedia(sizes[dominant][0]*96/25.4,sizes[dominant][1]*96/25.4);
var style=document.createElement('style');style.setAttribute('data-md-print','');style.textContent=css;(document.head||root).appendChild(style);
root.setAttribute('data-md-print-ready','');
}
if(document.readyState==='complete')prepare();else addEventListener('load',prepare);
})();`;

const STYLESHEET_LINK = /<link\b[^>]*>/gi;
const TAG_ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function linkAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of tag.replace(/^<link\b/i, '').matchAll(TAG_ATTRIBUTE)) {
    attributes.set(match[1]!.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

/**
 * The preparation script can only settle stylesheets it can read, and a document printed from a sandboxed frame
 * or from a temporary file cannot read the stylesheets it links. This copies each linked stylesheet of `origin`
 * into the document, with its relative `url()`s resolved against the stylesheet's own address. A stylesheet that
 * cannot be fetched stays linked.
 */
export async function inlineLinkedStylesheets(
  html: string,
  options: { baseHref: string; origin: string; fetchText: (url: string) => Promise<string> },
): Promise<string> {
  const replacements = await Promise.all([...html.matchAll(STYLESHEET_LINK)].map(async (match) => {
    const attributes = linkAttributes(match[0]);
    const rel = (attributes.get('rel') ?? '').toLowerCase().split(/\s+/);
    const href = attributes.get('href');
    if (!href || !rel.includes('stylesheet') || rel.includes('alternate')) return null;
    let url: URL;
    try { url = new URL(href, options.baseHref); } catch { return null; }
    if (url.origin !== options.origin) return null;
    try {
      const css = (await options.fetchText(url.href))
        .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g, (whole, quote: string, ref: string) => {
          if (!ref || ref.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(ref)) return whole;
          try { return `url(${quote}${new URL(ref, url).href}${quote})`; } catch { return whole; }
        })
        .replace(/<\/style/gi, String.raw`<\/style`);
      const media = attributes.get('media')?.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      return { tag: match[0], index: match.index!, style: `<style data-md-print-inlined${media ? ` media="${media}"` : ''}>${css}</style>` };
    } catch {
      return null;
    }
  }));
  let out = html;
  for (const replacement of replacements.reverse()) {
    if (!replacement) continue;
    out = out.slice(0, replacement.index) + replacement.style + out.slice(replacement.index + replacement.tag.length);
  }
  return out;
}
