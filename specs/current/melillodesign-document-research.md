# Document research specialists

Status: default custodians, versioned diaries, active-project source checks, full-page/crop visual intake, native role registration, selected-document text research jobs, shared HTTP/CLI and a compact UI status component are implemented. The live wire contract is `packages/contracts/src/api/document-research.ts`; the finer modality/region/checkpoint types below remain a future integration proposal. Image/OCR background analysis is not implemented by this text service.

## Agreed ownership

The main chat, `Initialize a Git repository`, owns setup coordination, setup APIs/contracts, ProjectView and ChatPane, folder selection, chat questions, persisted image consent, references and progress placement. The image-intake chat owns the research catalogue, service, new HTTP/CLI modules and status component. The main owner released the exact server/runtime/CLI and prompt hooks for integration. The status belongs above the chat log, outside the composer; the main owner mounts it. Existing image-production specialists remain separate.

The confirmed product sequence is a quick overview followed by full analysis in the background. Deep text and image research can also be requested by the main agent for a focused question. Project files are searched first; web sources fill identified gaps when needed. These are documentary reading and retrieval roles. They do not draft tender responses, make engineering decisions or compose pages.

## Prepared roles

| Role | Work | Proposed runtime settings |
|---|---|---|
| `melillo_document_sources` | Source identity, versions, originals/copies and referenced-document gaps | `gpt-6.1-sol`, `low` |
| `melillo_document_facts` | Text facts, conditions, constraints and locators | `gpt-6.1-sol`, `low` |
| `melillo_document_visuals` | Full-page inspection followed by region reading; visual inventory and tags | `gpt-6.1-sol`, `low`; image consent required |
| `melillo_research_text` | Focused cross-document questions and conflicting evidence | `gpt-6.1-sol`, `xhigh` |
| `melillo_research_images` | Relevant visual evidence and source-aware selection | `gpt-6.1-sol`, `xhigh`; image consent required |

Low effort for initial readers is the user's requirement. XHigh is the configured default for deep native research roles. The initial background service uses three concurrent Sol/Low CLI workers with frozen text inputs, shell/subagent/web operations disabled, schema validation and source-page citation checks. Native role loading and actual Sol/Low child settings were verified from a real session. Deep text/image research quality has not been benchmarked. SVG production continues to use the existing separate quality policy.

## Implemented text job and test

`DocumentResearchService` reads the currently declared text-intake selection, verifies authorized roots, freezes original bytes and hashes, then extracts bounded native text. It saves a quick overview before continuing full reading batches, preserving source/page coverage and partial states. It records all pages supplied to successful full batches, not just pages mentioned by a finding. Blank, oversized, missing or failed pages remain pending. Retry reuses successful batches only for the same source fingerprint. State writes are serialized and atomic; interrupted jobs retain saved evidence and become partial after restart. Research records and role profiles derive from the resolved daemon data root.

Both `GET/POST /api/projects/:id/document-research` and `od document-research show|start|retry --project <id> --json` use the same service. CLI start/retry accept JSON through `--prompt-file <path|->`. The UI is an explicit-start control with active polling, provisional and full findings, physical page references, coverage and retry. An older daemon's initial 404 hides the control quietly. Known internal IDs, hashes and host paths are filtered from visible findings while remaining in the private records.

The isolated Antro test selected the complete 34-page DIP, 42-page capitolato and 2-page sopralluogo form. On 23 October 2026, its first quick result arrived in 11.7 seconds, the quick pass finished in 69.7 seconds, and all 78 selected native-text pages finished in 364.7 seconds through 19 workers with no failed batches. It saved 45 provisional findings and 162 full findings. These are observations for this sample, not a general speed guarantee. The test did not run OCR or visual intake and does not certify the remainder of the Antro folder.

Instructions adapt the source/coverage discipline of `gare-lettura`, `gare-02-estrazione` and `gare-ricerca`, including their focused references on visual transcription and completing sources. They are self-contained; the installed app must not depend on this computer's personal skill paths. Graphic composition skills do not gain tender research instructions.

## Reading sequence

1. The coordinator freezes the current source manifest and revisions and reuses hash-matched caches. It schedules small, non-overlapping text/source batches. A proposed initial concurrency cap is three workers, subject to the existing runtime limit; this is a scheduling setting, not a guarantee of lower latency.
2. The first useful verified findings become a provisional overview. Its coverage must show which sources and pages have been inspected and which remain. It does not wait for all documents, nor does it imply full analysis is complete.
3. Full reading continues through remaining ranges and relevant cross-references. The current setup cache bounds (12 documents, 120 PDF pages per document, 240 pages total) remain extraction bounds. Reaching any bound leaves pending ranges; it cannot transition the entire project to complete. Continuing beyond them needs a paginated/cache-aware scheduler, not a misleading completion label or an unbounded extraction call.
4. Text reading starts independently of image intake. Only persisted image consent enables rendering, image extraction, OCR or visual specialists. Declined images leave explicit visual gaps while text work can finish. Existing native text alone does not establish that a scanned page or raster table was read.
5. Raster-page handling has two separately recorded steps: whole-page reading and identified-region/crop reading. Save original page dimensions, coordinate space and region. Only a successful crop operation creates an asset ID; a suggested bounding box is not an extracted or analyzed asset.
6. The coordinator uses deep readers for a focused gap, contradiction or subsequent user question. Full-analysis scheduling still continues; on-demand research does not replace the user's requested complete background analysis. Each worker returns a checkpoint rather than recursively spawning more workers.

## Future unified modality/region contract

Do not add these names to the live setup DTO until they have been reconciled with its new text-cache coverage fields. Prefer adapting existing source and asset references over creating another manifest.

```ts
type DocumentResearchPhase = 'quick' | 'full' | 'focused';
type DocumentResearchTaskState =
  | 'queued' | 'running' | 'completed' | 'blocked' | 'failed' | 'cancelled';
type DocumentResearchCoverageState =
  | 'pending' | 'inspected' | 'truncated' | 'unreadable' | 'failed' | 'blocked';

interface DocumentResearchLocator {
  sourceId: string;
  sourceRevision: string; // manifest revision; hash only if actually verified
  physicalPage?: number; // one-based; non-PDF sources can use section instead
  printedPage?: string;
  section?: string;
  region?: {
    coordinateSpace: 'page-pixels' | 'normalized';
    pageWidth: number;
    pageHeight: number;
    x: number; y: number; width: number; height: number;
  };
}

interface DocumentResearchFinding {
  id: string;
  kind: 'observed' | 'inferred' | 'conflict' | 'question';
  text: string;
  locators: DocumentResearchLocator[];
  supportingFindingIds?: string[];
  relatedAssetIds?: string[];
}

interface DocumentResearchCoverage {
  locator: DocumentResearchLocator;
  modality: 'native-text' | 'ocr' | 'page-image' | 'region-image';
  state: DocumentResearchCoverageState;
  inspectedSpan?: { start: number; end: number; unit: 'text-offset' };
  reason?: string;
}

interface DocumentResearchCheckpoint {
  taskId: string;
  manifestRevision: string;
  phase: DocumentResearchPhase;
  state: DocumentResearchTaskState;
  findings: DocumentResearchFinding[];
  coverage: DocumentResearchCoverage[];
  nextLocators: DocumentResearchLocator[];
  execution: {
    requestedModel: string;
    requestedEffort: string;
    effectiveModel?: string; // host evidence only
    effectiveEffort?: string; // host evidence only
  };
}
```

The backend must validate returned source/revision IDs, page ranges, coordinate bounds and finding links. Observed/inferred/conflict findings require evidence locators; unresolved questions can explicitly lack a source. Workers cannot set project completion. Task `completed` means its assigned batch is finished; project coverage is computed from the manifest, required modalities and actual inspected ranges. Overlapping inspected ranges count once. A successful text read plus an uninspected page image remains visually incomplete. OCR input availability and OCR text inspection are separate events.

External citations need a distinct validated reference carrying URL, publisher, acquisition/read state and actual access timestamp. They must not be represented as fake local paths. Where an external document becomes a project source, the acquisition owner assigns its source ID and revision before a worker cites it. Research retrieval does not bypass project-root authorization or change image consent.

## Backend and surface handoff

The main owner chooses whether the job records extend the current setup/context-reading service or use a separate purpose-scoped research service. Either way, retain one source-manifest/coverage truth and current setup consent. Use stable task keys derived from source revision, assigned range, role, phase and question; changing a source invalidates only dependent findings. Commit checkpoints atomically, reject stale results, keep explicit retry/cancellation state, and preserve completed work across restart. Repeated start requests must not launch duplicate batches.

Daemon-owned records and native role configuration derive from the resolved data root under the root `AGENTS.md` daemon data directory contract. Runtime integration reuses the image-specialist registration argument path without changing image profiles or global Codex configuration. Both legacy composers and OD Next receive the canonical research catalogue; internal planning keeps its no-start/no-spawn restriction.

If a new user-facing research operation is introduced, its HTTP endpoint, shared DTO, web entry point and `od` subcommand must land together. Both surfaces call the same API, with CLI JSON and prompt-file input. An internal background reader need not introduce a separate public command, but UI/CLI project status must expose the same persisted progress and gaps. The main agent's tool registration must enforce source scope, image consent and execution budgets in code; prompt instructions alone are insufficient.

## Validation before enabling

Use a small local fixture set covering native text, a scanned page, a table continued onto the next page, a revised source and an unreadable region. Keep expected findings out of reader prompts. Verify actual native role loading and effective Sol/Low settings, provisional overview arriving before full work finishes, evidence locators, full-page then crop inspection, and preservation of unresolved gaps. Compare total latency and correction effort before claiming a speed improvement.

Focused checks cover default/declined visual profile gating, concurrent role materialization, quick-before-full state, pending blank/oversized pages, out-of-batch citations, idempotent starts, source changes during reading, retry reuse, API authorization/CLI parity and UI privacy/stale-scope/404 behavior. Remaining validation includes a scanned/crop-reading job, complete deep web research provenance, real process-interruption recovery and cancellation. The background text job currently has no public cancellation operation; closing the status component does not cancel it. The future unified region contract remains a proposal. Actual visual intake now uses the existing project-intake asset contract; its selected 78-page Antro test and current limitations are recorded in `docs/project-intake.md`.


## Default custodian ownership and update history

The default original-source routing and active-project indexing are implemented
in the canonical research directive, `ProjectCustodianService`,
`ProjectCustodianJournal`, `ProjectCustodianWatch` and the shared coordinator.
The main agent requests facts or assets through `od custodian ask`; host-validated
asset descriptors include real paths, source page, table sidecar and valid vector
preferences. Each query and indexing change is journaled. Immutable snapshots
preserve index revisions without writing a nested Git repository.

A visible project renews its activity lease. Source checks use authorized roots,
content hashes and bounded scanning; changed sources trigger incremental text
reading and consent-gated page/crop analysis. Partial scans never establish
source deletion. Pending, failed and partial work stays visible. The current
12-source reader limit and unsupported standalone image/DOCX visual intake are
explicit gaps rather than project-complete claims.

The status component is mounted by the existing document-research status wrapper
above chat, outside the composer. Its disclosure contains coverage, diary and
text/image consultation. Matching HTTP and CLI capabilities are registered.
See `docs/project-intake.md` for the live Antro and new-file test observations.
