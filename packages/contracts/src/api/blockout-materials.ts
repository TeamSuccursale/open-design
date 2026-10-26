import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const role = z.enum(['content', 'rules', 'reference']);
const common = { id: z.string().min(1).max(120), label: z.string().max(500), sourcePath: z.string().min(1).max(2000),
  sourcePage: z.number().int().positive(), sourceHash: hash, sourceRole: role };
const imagePath = z.string().min(1).max(2000).refine((value) => !/^(?:[a-z]+:|[\\/])/i.test(value)
  && !value.replaceAll('\\', '/').split('/').includes('..'), 'Expected a project-relative image path');
const visual = { imagePath, width: z.number().positive(), height: z.number().positive(), assetId: z.string().max(160).optional() };
export const BlockoutMaterialItemSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('text'), text: z.string().min(1).max(2_000_000), offsetStart: z.number().int().nonnegative(), offsetEnd: z.number().int().positive() }),
  z.object({ ...common, kind: z.literal('image'), ...visual }),
  z.object({ ...common, kind: z.literal('table'), ...visual }),
  z.object({ ...common, kind: z.literal('drawing'), ...visual }),
]).superRefine((item, ctx) => {
  if (item.kind === 'text' && item.offsetEnd - item.offsetStart !== item.text.length) {
    ctx.addIssue({ code: 'custom', path: ['offsetEnd'], message: 'Offsets must describe the exact UTF-16 text span' });
  }
});
export type BlockoutMaterialItem = z.infer<typeof BlockoutMaterialItemSchema>;
/** Exact adjacent source spans concatenate; distinct source spans receive one explicit paragraph separator. */
export function blockoutMaterialText(items: readonly BlockoutMaterialItem[]): string {
  const text = items.filter((item): item is Extract<BlockoutMaterialItem, { kind: 'text' }> => item.kind === 'text');
  return text.map((item, index) => {
    const previous = text[index - 1];
    const adjacent = previous && previous.sourcePath === item.sourcePath && previous.sourceHash === item.sourceHash
      && previous.sourcePage === item.sourcePage && previous.offsetEnd === item.offsetStart;
    return `${index && !adjacent ? '\n\n' : ''}${item.text}`;
  }).join('');
}
export const BlockoutMaterialSourceSchema = z.object({ id: z.string().min(1).max(120), path: z.string().max(2000), hash: hash.optional(), role,
  status: z.enum(['preparing', 'waiting', 'ready', 'partial', 'failed']), pagesProcessed: z.number().int().nonnegative(), pagesTotal: z.number().int().nonnegative(), gaps: z.array(z.string().max(2000)).max(100),
  coverage: z.object({ text: z.enum(['complete', 'partial', 'not-applicable']), images: z.enum(['not-requested', 'complete', 'partial', 'not-applicable']) }).optional() });
export type BlockoutMaterialSource = z.infer<typeof BlockoutMaterialSourceSchema>;
export const BlockoutMaterialInventorySchema = z.object({ version: z.literal(1), projectId: z.string().max(120), revision: hash,
  status: z.enum(['preparing', 'waiting', 'ready', 'needs-input', 'failed']),
  sources: z.object({ processed: z.number().int().nonnegative(), total: z.number().int().nonnegative(), entries: z.array(BlockoutMaterialSourceSchema).max(1000) }),
  items: z.array(BlockoutMaterialItemSchema).max(20_000), gaps: z.array(z.string().max(2000)).max(200), createdAt: z.string(), updatedAt: z.string() });
export type BlockoutMaterialInventory = z.infer<typeof BlockoutMaterialInventorySchema>;
export const BlockoutInventoryResponseSchema = z.object({ inventory: BlockoutMaterialInventorySchema });
export type BlockoutInventoryResponse = z.infer<typeof BlockoutInventoryResponseSchema>;
