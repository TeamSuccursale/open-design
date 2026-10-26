import { z } from 'zod';
import { HeaderFooterDraftSchema, headerFooterVariantForFormat } from './header-footer.js';

/** Portable applied state: assets are copied into this document, never hotlinked. */
export const AppliedHeaderFooterSchema = z.object({
  version: z.literal(1), projectId: z.string().min(1).max(240), documentId: z.string().min(1).max(120),
  setId: z.string().nullable(), revision: z.number().int().positive(), projectName: z.string().max(240),
  header: z.boolean(), footer: z.boolean(), showOnCover: z.boolean(), appliedAt: z.string(),
  design: HeaderFooterDraftSchema,
  assets: z.array(z.object({ id: z.string().min(1).max(120), path: z.string().min(1).max(2000).refine((value) => !/^(?:[a-z]+:|[\\/])/i.test(value) && !value.replaceAll('\\', '/').split('/').includes('..')), mimeType: z.string().max(160) })).max(120),
}).strict();
export type AppliedHeaderFooter = z.infer<typeof AppliedHeaderFooterSchema>;
const escape = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const round = (value: number) => Number(value.toFixed(4));
export interface HeaderFooterRenderPage {
  /** Null is reserved for an editor preview before a page count is known. Materialized pages supply their real count. */
  widthMm: number; heightMm: number; documentName: string; index: number; totalPages: number | null;
  isCover?: boolean; visibleNumber?: number | null; assetUrl?: (path: string) => string;
}
export function headerFooterReservations(applied: AppliedHeaderFooter | undefined, page: Pick<HeaderFooterRenderPage, 'widthMm' | 'heightMm' | 'isCover'>): { headerMm: number; footerMm: number } {
  if (!applied || (page.isCover && !applied.showOnCover)) return { headerMm: 0, footerMm: 0 };
  const variant = headerFooterVariantForFormat(applied.design.variants, page.widthMm, page.heightMm);
  return { headerMm: applied.header ? variant?.headerHeightMm ?? 0 : 0, footerMm: applied.footer ? variant?.footerHeightMm ?? 0 : 0 };
}
/** The date field prints the revision's local calendar day as dd/mm/yyyy: the form the editor shows and the engineer approves. */
export function headerFooterDateText(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}
/** Render actual recurring graphics around a schematic body. All strings are escaped. */
export function renderAppliedHeaderFooterSvg(applied: AppliedHeaderFooter, page: HeaderFooterRenderPage): string {
  const variant = headerFooterVariantForFormat(applied.design.variants, page.widthMm, page.heightMm);
  if (!variant || (page.isCover && !applied.showOnCover)) return '';
  const values = { projectName: applied.projectName, documentName: page.documentName,
    pageNumber: page.visibleNumber == null ? '' : String(page.visibleNumber), totalPages: page.totalPages === null ? '—' : String(page.totalPages),
    date: headerFooterDateText(applied.appliedAt), revision: String(applied.revision) };
  const content = variant.blocks.filter((block) => block.region === 'header' ? applied.header : applied.footer).map((block) => {
    const strip = block.region === 'header' ? variant.headerHeightMm : variant.footerHeightMm;
    const y0 = block.region === 'header' ? 0 : page.heightMm - strip;
    const x = block.x * page.widthMm, y = y0 + block.y * strip, w = block.width * page.widthMm, h = block.height * strip;
    const color = block.color ?? '#263d36';
    if (block.kind === 'logo') {
      const asset = applied.assets.find((entry) => entry.id === block.assetId);
      return asset ? `<image data-header-footer-block="${escape(block.id)}" x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" preserveAspectRatio="xMidYMid meet" href="${escape(page.assetUrl?.(asset.path) ?? asset.path)}"/>` : '';
    }
    if (block.kind === 'rule') return `<path data-header-footer-block="${escape(block.id)}" d="M ${round(x)} ${round(y + h / 2)} H ${round(x + w)}" fill="none" stroke="${color}" stroke-width=".25"/>`;
    const text = block.kind === 'field' ? values[block.field ?? 'documentName'] : block.text ?? '';
    const align = block.align ?? 'left', fontMm = (block.fontSize ?? 9) * 25.4 / 72;
    const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w : x;
    const lines = text.split(/\r?\n/).slice(0, 12);
    return `<svg x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" overflow="hidden"><text data-header-footer-block="${escape(block.id)}" x="${round(tx - x)}" y="${round(fontMm)}" font-family="Arial,sans-serif" font-size="${round(fontMm)}" text-anchor="${align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start'}" fill="${color}">${lines.map((line, index) => `<tspan x="${round(tx - x)}" dy="${index ? round(fontMm * 1.25) : 0}">${escape(line)}</tspan>`).join('')}</text></svg>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${page.widthMm} ${page.heightMm}" width="100%" height="100%" aria-label="Intestazione e piè di pagina" data-header-footer-set="${escape(applied.setId ?? 'independent')}" data-header-footer-revision="${applied.revision}">${content}</svg>`;
}
