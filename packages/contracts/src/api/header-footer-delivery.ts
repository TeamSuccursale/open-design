/** A durable library save attributable to one active native run. Not a page-file artifact. */
export interface HeaderFooterDraftDeliveryShape {
  projectId: string;
  setId: string;
  draftVersion: number;
  stage: 'structural' | 'graphic';
}

export interface HeaderFooterDraftDeliveryReceipt {
  name: 'header_footer_draft_saved';
  source: 'daemon-header-footer';
  shape: HeaderFooterDraftDeliveryShape;
}

export function isHeaderFooterDraftDeliveryReceipt(value: unknown): value is HeaderFooterDraftDeliveryReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Record<string, unknown>;
  const shape = receipt.shape as Partial<HeaderFooterDraftDeliveryShape> | undefined;
  return receipt.name === 'header_footer_draft_saved' && receipt.source === 'daemon-header-footer'
    && !!shape && typeof shape === 'object'
    && typeof shape.projectId === 'string' && !!shape.projectId
    && typeof shape.setId === 'string' && !!shape.setId
    && Number.isInteger(shape.draftVersion) && Number(shape.draftVersion) > 0
    && (shape.stage === 'structural' || shape.stage === 'graphic');
}
