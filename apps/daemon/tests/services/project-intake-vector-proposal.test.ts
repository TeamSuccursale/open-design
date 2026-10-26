import { describe, expect, it } from 'vitest';
import { buildIntakeVectorProposal, canProposeIntakeVector, formatIntakeAttachmentContext, INTAKE_VECTOR_WORKFLOW_DIRECTIVE, type IntakeAsset } from '@open-design/contracts';
const asset: IntakeAsset = { id: 'figure', documentId: 'doc', sourcePath: 'original/source.pdf', sourceName: 'source.pdf', page: 5, box: [10, 20, 800, 900], imagePath: 'intake-assets/figure.png', width: 800, height: 600, kind: 'chart', title: 'Graph', description: 'Source data', tags: [], status: 'ready' };
describe('SVG proposal draft', () => {
  it('preserves provenance and notes while requesting editable vector output and explicit uncertainty', () => {
    const original = structuredClone(asset);
    const result = buildIntakeVectorProposal(asset, { note: 'Conserva la legenda' });
    expect(result.prompt).toContain('Conserva la legenda');
    expect(result.prompt).not.toContain('original/source.pdf');
    expect(result.prompt).not.toContain('"pdfPage"');
    expect(result.agentContext).toContain('original/source.pdf');
    expect(result.agentContext).toContain('"pdfPage": 5');
    expect(result.agentContext).toContain('testo modificabile con <text>');
    expect(result.agentContext).toContain('informazioni illeggibili o ambigue');
    expect(result.agentContext).toContain('Non incorporare il raster originale');
    expect(result.suggestedPath).toBe('designs/vector/figure/v1.svg');
    expect(asset).toEqual(original);
  });
  it('offers the action for ready graphs, tables, drawings and recognized key maps', () => {
    for (const kind of ['chart', 'table', 'drawing'] as const) expect(canProposeIntakeVector({ ...asset, kind })).toBe(true);
    expect(canProposeIntakeVector({ ...asset, kind: 'image', title: 'Keymap' })).toBe(true);
    expect(canProposeIntakeVector({ ...asset, kind: 'image', title: 'Photo of masonry' })).toBe(false);
    expect(canProposeIntakeVector({ ...asset, status: 'failed' })).toBe(false);
    expect(() => buildIntakeVectorProposal({ ...asset, kind: 'page' })).toThrow();
  });
  it('requests visual redesign in both languages while preserving meaning and an explicit faithful-reproduction choice', () => {
    const italian = buildIntakeVectorProposal(asset);
    const english = buildIntakeVectorProposal(asset, { language: 'en' });
    expect(italian.prompt).toContain('Riprogetta la grafica');
    expect(italian.prompt).toContain('Mantieni precise le geometrie di mappe e disegni tecnici');
    expect(italian.agentContext).toContain('una semplice conversione in vettoriale non basta');
    expect(italian.agentContext).toContain('riproduzione fedele');
    expect(english.prompt).toContain('Redesign');
    expect(english.prompt).toContain('Keep technical and map geometry precise');
    expect(english.agentContext).toContain('simple vector conversion is not the goal');
    expect(english.agentContext).toContain('explicit request for a faithful reproduction');
    expect(INTAKE_VECTOR_WORKFLOW_DIRECTIVE).toContain('default goal is a visual redesign');
    expect(INTAKE_VECTOR_WORKFLOW_DIRECTIVE).toContain('checking both information preservation and visual improvement');
    expect(INTAKE_VECTOR_WORKFLOW_DIRECTIVE).toContain('semantic roles for unexplained colours');
    expect(INTAKE_VECTOR_WORKFLOW_DIRECTIVE).toContain('its dimensioned fabrication plan cannot');
    expect(INTAKE_VECTOR_WORKFLOW_DIRECTIVE).toContain('If this distinction is uncertain, preserve the geometry');
    expect(italian.agentContext).toContain('mantenendo estremamente coerenti passaggi');
    expect(english.agentContext).toContain('steps, dependencies, direction and meaning remain extremely consistent');
  });
  it('includes provenance only for actual image attachments in the private agent context', () => {
    const text = formatIntakeAttachmentContext([asset, { ...asset, id: 'other', imagePath: 'unrelated.png', sourcePath: 'unrelated-secret.pdf' }], [asset.imagePath]);
    expect(text).toContain('original/source.pdf');
    expect(text).toContain('Keep raw paths, crop coordinates, tags');
    expect(text).not.toContain('unrelated-secret.pdf');
    expect(formatIntakeAttachmentContext([asset], ['not-an-intake-file.png'])).toBe('');
  });
});
