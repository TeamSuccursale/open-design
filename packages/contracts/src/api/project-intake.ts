/** Project-local PDF and image extraction shared by the UI and the od intake CLI. */
import type { ChatAttachment } from './chat.js';

export const INTAKE_IMAGE_SOURCE = /\.(png|jpe?g|webp)$/i;
/** A raster image enters the gallery whole, as one asset, instead of being split into pages and figures. */
export function isIntakeImageSource(path: string): boolean { return INTAKE_IMAGE_SOURCE.test(path); }
/** Where an asset came from, for labels: a whole image has no page to name, a PDF figure does. */
export function intakeSourceLabel(asset: { sourceName: string; sourcePath: string; page: number }, paged: (name: string, page: number) => string): string {
  return isIntakeImageSource(asset.sourcePath) ? asset.sourceName : paged(asset.sourceName, asset.page);
}
// The mark-up overlay names its captures this way; one without a note's source
// is a screenshot of a page, not material the engineer brought.
const MARKED_CAPTURE = /(^|\/)drawing-[^/]*\.png$/i;
/**
 * The images an engineer attached to chat messages, as the gallery should take
 * them in: a marked copy stands for the image its marks were drawn on, while
 * page screenshots, gallery assets and non-raster files stay out.
 */
export function intakeImagesFromAttachments(attachments: readonly ChatAttachment[], outputDir = 'intake-assets'): string[] {
  const paths = new Set<string>();
  for (const attachment of attachments) {
    const path = attachment.annotation?.sourcePath ?? attachment.path;
    if (!isIntakeImageSource(path) || path.startsWith(`${outputDir}/`)) continue;
    if (!attachment.annotation?.sourcePath && MARKED_CAPTURE.test(path)) continue;
    paths.add(path);
  }
  return [...paths];
}
export type IntakeAssetKind = 'image' | 'drawing' | 'chart' | 'table' | 'page';
export type IntakeState = 'queued' | 'processing' | 'ready' | 'failed';
export interface IntakeTableData {
  headers: string[][];
  rows: Array<Array<string | null>>;
  notes: string[];
  unreadableCells: string[];
  complete: boolean;
}
export interface IntakeAsset {
  id: string;
  documentId: string;
  sourcePath: string;
  sourceName: string;
  page: number;
  /** Coordinates in the rendered page, normalized to [0, 1000]. */
  box: [number, number, number, number];
  imagePath: string;
  width: number;
  height: number;
  kind: IntakeAssetKind;
  title: string;
  description: string;
  tags: string[];
  status: IntakeState;
  error?: string;
  /** A crop is analyzed only after its parent full-page inspection succeeds. */
  analysis?: { stage: 'page' | 'crop'; parentPageId?: string; sourceSha256: string;
    model: string; effort: string; analyzedAt: string; parentAnalyzedAt?: string; cropRepairAttempts?: number };
  tableData?: IntakeTableData;
  tableDataPath?: string;
  /** Existing SVG files linked to this source. Recomputed from the project folder. */
  vectorVersions?: IntakeVectorVersion[];
  vectorPreference?: IntakeVectorPreference;
}
export interface IntakeVectorVersion { id: string; path: string; label: string; sha256: string; updatedAt: string }
export interface IntakeVectorPreference {
  versionId: string; path: string; sha256: string; reason: string; updatedAt: string;
  /** False when the selected file was removed or edited since the choice. */
  available: boolean;
}
export interface RegisterIntakeVectorRequest { path: string; label?: string }
export interface SetIntakeVectorPreferenceRequest { versionId: string | null; reason?: string }
export interface IntakeDocument {
  id: string;
  sha256?: string;
  sourcePath: string;
  name: string;
  status: IntakeState;
  pageCount: number;
  completedPages: number;
  /** Successfully indexed PDF pages; preserves progress across retries. */
  indexedPages: number[];
  updatedAt: string;
  /** When the source file arrived in the project, for ordering the gallery. */
  addedAt?: string;
  error?: string;
}
export interface ProjectIntakeCatalog {
  version: 1;
  documents: IntakeDocument[];
  assets: IntakeAsset[];
}
export interface StartProjectIntakeRequest {
  /** Existing project-relative PDF or image paths. Omit to discover PDFs in the folder and the images attached in the chats. */
  paths?: string[];
  /** Take in only the images attached in the project's chats that the gallery does not have yet. */
  attached?: boolean;
  /** Optional 1-based page selection, useful for a deliberate sample intake. */
  pages?: number[];
  retry?: boolean;
}
export interface IntakeSelection {
  asset: IntakeAsset;
  note: string;
  /** A complete quick-action draft; ordinary selections use the standard source context. */
  draftText?: string;
  /** Explicitly chosen vector version; otherwise attach the source extraction. */
  attachmentPath?: string;
}
export interface IntakeVectorProposalRequest { note?: string; language?: 'it' | 'en' }
export interface IntakeVectorProposal { asset: IntakeAsset; prompt: string; agentContext: string; suggestedPath: string }
export function intakeVectorDirectory(assetId: string): string {
  return `designs/vector/${assetId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128)}`;
}
export function nextIntakeVectorPath(asset: IntakeAsset): string {
  const directory = intakeVectorDirectory(asset.id);
  const used = new Set((asset.vectorVersions ?? []).map((version) => version.path));
  let number = 1;
  while (used.has(`${directory}/v${number}.svg`)) number += 1;
  return `${directory}/v${number}.svg`;
}
export function canProposeIntakeVector(asset: IntakeAsset): boolean {
  if (asset.status !== 'ready') return false;
  if (['chart', 'table', 'drawing'].includes(asset.kind)) return true;
  return asset.kind === 'image' && /\b(key\s?map|key\s?plan|map|mappa|planimetria|organigramma|diagram|diagramma)\b/i.test([asset.title, ...asset.tags].join(' '));
}
/** Saved as intake.config.json in the project folder. Originals are read-only. */
export interface ProjectIntakeConfig {
  version: 1;
  /** Absolute folders or paths relative to the project. The project itself is always included. */
  sourceDirs: string[];
  /** Project-relative destination for newly extracted images. Existing image references remain valid. */
  outputDir: string;
}
export interface ProjectIntakeSettings extends ProjectIntakeConfig {
  projectDir: string;
  configPath: string;
  catalogPath: string;
  outputPath: string;
  uploadPath: string;
}
