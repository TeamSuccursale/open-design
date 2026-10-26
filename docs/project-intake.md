# Project PDF intake

The project gallery turns local PDFs into reusable figures. It shares one intake
API between the browser and `od intake`, so a folder-based Codex workflow and
documents added in the gallery populate the same collection.

## Use the gallery

Chat is the default workspace. Recognized assets appear in the right-hand file
explorer; click a thumbnail once to open its image preview. The gallery opens
only when requested, from **Gallery** in the composer or explorer.

Open **Project gallery** from the chat composer. Add PDFs there,
or choose **Scan project folder** to process PDFs already in the project. Intake
runs in the background. Pages appear while analysis is running, followed by the
extracted figures and their descriptions.

Search matches titles, descriptions, tags and source filenames. Select several
items, write a separate optional note for each, and choose **Add to chat**.
The images, their titles and the user's notes are staged in the draft for review; this
action does not send a message. Search and drawer position changes preserve the
current selection and notes. The drawer can open from the top or bottom.

For a ready graph, table, drawing or recognized key map, the selected item's
notes panel includes **Redesign as SVG** (**Ridisegna in SVG**). It stages the
original image, a short visual-redesign request and the item's note in the chat
draft. Source provenance and technical instructions travel privately to the
agent. Other selections stay available. The aim is a more attractive graphic
for a report, using native SVG geometry and editable text while preserving
readable information and flagging ambiguity.
It neither sends a message nor generates a vector file until the user sends
the draft. The original extraction remains intact.

The source's meaning determines the design freedom. Key maps, surveys,
dimensioned machine plans and construction drawings require native geometry or
precise tracing: shapes, positions, orientation, dimensions, scale, topology and
internal technical labels remain exact. Colours, contrast, line hierarchy and
external typography or legends can improve the presentation. Representative
process diagrams and conceptual explanations can change composition and shapes
while keeping steps, directions, dependencies, quantities and meaning extremely
consistent. An explanation of how a steam engine works can be recomposed; its
fabrication plan retains its geometry. When classification is uncertain, the
instructions preserve geometry and explain the uncertainty. An explicit request
for a faithful reproduction is honored.

Source paths, physical PDF pages, crop coordinates, tags and extraction
descriptions are agent-only context. They are not inserted into the editor or
persisted as user-authored chat text. Ordinary runtime prompts obtain this
context from the catalog; OD Next request and production runs freeze it as an
internal reference input. The verified frozen reference is also included in the
agent's private prompt, alongside the host's SVG requirements, so it does not
depend on discovering and opening a second text attachment. Project-relative
PNG/JPEG/GIF/WebP attachments are passed to native image input as well as the
immutable file references. The visible attachment selection remains unchanged.

The same draft action is available to external agents without starting a run:

```text
od intake propose-svg --project <project-id> --asset <asset-id> --note "Keep the legend" --language en --json
od intake propose-svg --project <project-id> --asset <asset-id> --prompt-file <notes-file-or-dash> --json
```

Both entry points call the asset's `vector-proposal` API and use the shared
prompt builder in `packages/contracts/src/prompts/intake-vector-proposal.ts`.
The response includes the asset, visible prompt, private agentContext and
suggested SVG path.
The proposed SVG is a reworking to verify against the source, not an assertion
that an automatic trace has recovered exact data or surveyed geometry.

## SVG versions and the user's preference

New reworkings are saved as separate files in the project-relative
`designs/vector/<asset-id>/vN.svg` folder. The private instructions require a new
filename for every version and preserve the extracted original. Saving a valid
native SVG there automatically makes it a linked version of that source asset
in the gallery and `od intake list`; no completion message or manual tagging is
needed. A half-written file, embedded raster or script-bearing SVG is not listed.
The earlier `designs/vector/<asset-id>.svg` location is also recognized.

Select the original in the gallery, then use **SVG versions** to view each saved
version, open its preview, or add that SVG to the chat draft. Choose a version,
explain why you prefer it, and choose **Save as preferred**. This records a user
choice without sending a message or starting generation. The choice is local
to that source asset; the agent does not choose a preferred version itself.

Links to SVGs elsewhere in the project can be added through **Link an existing
SVG**. The metadata index at `intake-assets/vector-links.json` records these
links and user preferences by original asset ID. It complements the original
extraction catalog instead of rewriting its source data. API catalog responses
enrich each source with `vectorVersions` and `vectorPreference`, including the
version path, content fingerprint, explanation and choice timestamp. Standard
folder links are reconstructed from the saved files across daemon restarts.

A preference identifies the exact file content. If the file changes or is
removed, the gallery marks that choice unavailable and asks the user to review
it again; the previous explanation remains available until cleared or replaced.
Source or SVG attachments carry linked versions and the preference privately to
the agent. Multi-step agent inputs also freeze the available preferred SVG.
Technical metadata stays out of the visible composer and user message.

SVG results have an in-chat image card as well as the main file preview.
The card displays the immutable version from that message; opening it shows
the workspace file, and exporting downloads the captured version. SVG snapshot
downloads retain their attachment headers. The card decodes those bytes only
as an image; a fetch or decoding failure shows an openable filename instead of
a broken-image rectangle.

The same operations use the same HTTP endpoints from the CLI:

```text
od intake vectors --project <project-id> --asset <asset-id> --json
od intake register-svg --project <project-id> --asset <asset-id> --path designs/custom.svg --label "Version A" --json
od intake prefer-svg --project <project-id> --asset <asset-id> --variant <version-id> --note "The labels are clearer" --json
od intake prefer-svg --project <project-id> --asset <asset-id> --variant <version-id> --prompt-file <notes-file-or-dash> --json
od intake prefer-svg --project <project-id> --asset <asset-id> --variant none --json
```

`GET /api/projects/:id/intake` exposes versions. `POST` to the asset's `vectors`
endpoint links an existing SVG; `PUT` to its `vector-preference` endpoint saves
or clears the user's choice. Both writes require project file-write access.

## Folder and agent workflow

The CLI uses the same project endpoints as the gallery:

```text
od intake scan --project <project-id> --json
od intake scan --project <project-id> --path <project-relative.pdf> --pages 3,5 --json
od intake list --project <project-id> --json
od intake search --project <project-id> --query "masonry restoration" --json
od intake search --project <project-id> --prompt-file <path-or-dash> --json
```

Use `--daemon-url <url>` when choosing a particular local development runtime.
Repeated `--path` flags select several PDFs. Without them, scanning discovers
PDFs under the project folder and registered extra source folders, excluding
hidden folders, generated intake assets and `node_modules`. An absolute PDF path
is accepted only inside the project or a registered source folder.

## Project folders and the shared format

Open **Gallery → Folders**. A project has one working folder, which can be linked
through the existing project-folder action. Linking switches the working folder;
it does not move the old files. The UI reloads to use the new workspace.

Register up to 20 extra source folders, one per line. Saving does not start a
scan. **Scan project folder** recursively scans the project and those folders;
PDFs added in the UI are uploaded to the project's `sources` folder and queued
immediately. Source PDFs in extra folders remain read-only and retain their
absolute source references in the catalog. Active projects now also use the custodian source watcher described below.

The project-root `intake.config.json` is the discoverable configuration for both
Codex and the UI:

```json
{
  "version": 1,
  "sourceDirs": [],
  "outputDir": "intake-assets"
}
```

`sourceDirs` accepts absolute folders or project-relative folders; saving through
the UI or CLI canonicalizes them. `outputDir` must stay inside the project.
Changing it affects newly generated images. Existing image paths stay valid,
including attachments already used in chat. The catalog always remains at the
project-relative `intake-assets/catalog.json`, with format version 1, `documents`
and `assets`. PNG files and each asset's source PDF, physical page, normalized
crop, title, description, tags and processing state form the shared intake format.
The Folders screen displays the resolved configuration, catalog, image and
upload paths. It does not require the user or agent to guess where files live.

```text
od intake folders --project <project-id> --json
od intake configure --project <project-id> --source-dir <folder> --source-dir <another-folder> --output-dir library/figures --json
od intake configure --project <project-id> --clear-sources --json
od intake configure --project <project-id> --prompt-file <config-json-or-dash> --json
od intake configure --project <project-id> --project-folder <absolute-folder> --json
```

`configure --source-dir` replaces the saved extra-folder list. Omit it to retain
the current list. Configure a project-folder link separately from its intake
settings. Folder changes are blocked while intake is running. This extra-folder
configuration currently targets the local browser runtime; packaged Desktop
requires a trusted folder-grant integration before external source folders can
be registered there.

Document hashes prevent repeated work. Successfully indexed pages survive a
retry. `--pages` deliberately processes a sample rather than the entire PDF;
`indexedPages` records which physical PDF pages were completed. A later scan can
process the remaining pages. Use `--retry` for failed or interrupted documents.

## Processing

Python renders the complete page for the first analysis pass. Codex identifies
photographs, drawings, charts and tables, including raster scans and vector
figures. The worker then renders each crop directly from the source PDF at a
higher resolution. A separate Codex pass describes and tags the crop.

The current implementation uses the authenticated Codex CLI with `gpt-6-luna`
and low reasoning effort. At most two documents and two model calls run at once.
Titles and descriptions are Italian; search tags include Italian and English.
The original document, physical PDF page, crop coordinates, image path and
analysis state are retained in the catalog.

Install the PDF worker's dependencies into the Python environment used by the
daemon:

```text
python -m pip install -r apps/daemon/pdf-intake/requirements.txt
```

`MELILLO_PYTHON` selects another Python executable. On this Windows development
setup, the worker can also discover the Codex bundled Python runtime. Codex
executable discovery uses the existing agent resolver, including `CODEX_BIN`.
There is no separate API-key configuration for these CLI jobs.

Project resolution and daemon-managed storage follow the
[daemon data directory contract](../AGENTS.md#daemon-data-directory-contract).
PDF originals are read-only inputs. Test documents and generated sample content
must remain outside the public source history.

## Current validation scope

The first live sample covers three selected PDF pages containing a cadastral
map, a site plan, a team diagram, photographs and restoration drawings. It is
not a complete tender-archive intake. Large collections, raster-only documents,
and chart/table extraction still need a broader representative validation set.

A live gallery-to-Codex SVG request has also been checked through generation,
saved-file discovery, source linkage, the chat card and the main file preview.
The generated result contains native paths and editable text without an embedded
raster. This earlier Luna map was rejected for fidelity because its geometry is
schematic; that run verifies file creation and preview.

A subsequent in-app Sol/Max run
(`8af86fb4-4e58-4b35-ad87-b6babcefe1bf`) produced a detailed native `v2.svg`
trace of 3.77 MiB, with 46 paths and 30 text elements. The source and SVG were
reviewed at full view and in six enlarged comparisons. The original and `v1`
remain intact, the catalog links `v2`, and no preferred version was set. This
verifies tracing and comparison; it does not establish that the user approved
`v2` or its graphic design. The user subsequently requested visual redesign.
The Sol/Max redesign run (`0cb0fa45-cb88-4a5c-bd40-2153f50b609b`) has now
saved `v3.svg`. An independent artifact review returned **ship** after examining
the full render and six comparisons. All 43 nonempty `v2` map path strings remain
intact (44 base elements including one empty path), with only a global translation
of the map geometry. The redesign adds muted colours and contrast hierarchy,
new zone typography, and a compact legend and title. The file contains no raster
and occupies 3,954,391 bytes, below 4 MiB; its SHA-256 is
`0807318175fd8ba238fefb28cdcfd9e5dd24c42d6fad8144dbd441f0e964067c`.
A catalog API read confirms that `v1`, `v2` and `v3` are linked to the original
source and `vectorPreference` is `null`. Source scans still limit fine detail:
`v3` styles the existing precise trace without establishing new survey accuracy.
The production run (`fd2d0ca9-870b-4778-9bc0-abb68205bf07`) completed
successfully with a terminal completed strategy outcome and the same artifact
hash. After daemon reload, the live vector-proposal API returns the revised
geometry/explanatory distinction, keeps metadata private, and suggests `v4.svg`
for the next version without starting generation. The artifact review covers
the saved output; the user has not approved its graphic design or chosen a
preferred version.

## SVG quality and delegation

### Image specialists for composition and direct requests

Codex runs receive three native role definitions, available both from the chat
workflow and through `od run`: `melillo_image_alpha`, `melillo_photo_vector` and
`melillo_image_review`. The shared prompt catalogue covers the legacy daemon,
legacy contracts and OD Next paths. The functional **Image specialists** skill
also appears in the existing skill registry; it adds no separate processing API.

The alpha worker defaults to masking original RGB pixels, with an opaque retained
interior and justified fractional edges. It saves a PNG and the exact grayscale
alpha channel, compares retained RGB with the source and checks white/dark
composites. Generative restyling is a separately requested derivative. The photo
vector worker produces native editable SVGs, retaining technical geometry or
clearly identifying interpretive illustration. The reviewer compares actual files
with the source. The coordinator reuses existing assets/preferences, gives each
worker its own output directory, waits for results and verifies them before use.

Definitions are canonical in `packages/contracts/src/prompts/image-specialists.ts`.
The daemon materializes content-addressed TOML resources under its resolved data
root and passes their paths through run-scoped Codex configuration for both
transports, including resume. It does not change global Codex configuration or
write configuration into imported projects. Data-root rules remain in the root
`AGENTS.md` **Daemon data directory contract**. The vector worker and reviewer
default to Sol/Max and retain stronger parent model/effort settings. The alpha
worker inherits the parent. Native delegation and required editing tools must
actually be available; a role cannot create a missing tool or provider. Plan,
Ask and internal OD Next planning turns cannot use this catalogue to authorize
image execution; Blockout retains its structural stopping point.

The earlier photo pilot verified a native SVG illustration and real PNG alpha,
but its generative cutout changed the photographed stone and failed documentary
fidelity. That result is the reason for the original-RGB masking default. A native
registration smoke test spawned `melillo_image_review`, confirmed its specialist
developer instructions and recorded a Sol/Max child under a Luna parent. That
proves role loading and delegation, not end-to-end validation of a new mask-only
cutout pipeline.

Codex SVG work has a per-turn execution floor of Sol with XHigh reasoning.
The default model is `gpt-6.1-sol`. Reconstructing an intake image, tracing a
map, or requesting faithful detail automatically selects Max before the run
starts. A stronger selected Sol/Astra model or reasoning level is preserved.
Short follow-up edits retain the SVG policy, including after daemon recovery.
This applies at the shared `/api/runs` and `/api/chat` boundary, so browser and
`od run` requests use the same policy. A runtime that cannot honor the decision
fails visibly instead of silently dropping the effort setting. PDF analysis
and tagging use the separate Sol/Low worker configuration.

The quality workflow requires examining reusable PDF vectors first and comparing
the rendered SVG against the source at full view and enlarged details, checking
both information preservation and visual improvement within the source's
geometric constraints. Native Codex subagents can handle independent geometry
and label checks; difficult
tracing or a failed fidelity check calls for a Sol/Max subtask. This is an
instruction to the agent, while initial model routing is enforced in code.
The parent model does not hot-switch in the middle of a turn. Installed Codex
protocol/configuration and the production orchestrator were checked for native
delegation support; native specialist loading and effective child model/effort
have also been verified from actual session records. The planning
stage intentionally disallows subagents. The chat renderer currently has no
dedicated live subagent cards.

The bundled `frontend-design` skill covers visual refinement. The local
`presentazione-disegni-vettoriali` skill covers presentation and semantic checks
of native CAD drawings. Bundled D3 and hand-drawn diagram entries are catalogue
stubs; neither supplies a faithful raster-to-SVG reconstruction workflow.

## Quick overview and full text research

The chat context controls include Document analysis (Analisi dei documenti).
Starting it saves a quick overview first, then continues analyzing every readable
native-text page in the selected intake documents. The quick findings remain
available while full batches run. The panel shows source titles, physical PDF
pages, reading coverage, pending pages and failed batches. Internal source IDs,
hashes and host paths stay in the persisted records rather than the visible notes.

The same job is available through `od document-research show|start|retry
--project <id> --json`. Start and retry accept `--prompt-file <path|->` with
`sourcePaths` (relative paths already declared in the current text intake) and an
optional focused question. Both surfaces use `/api/projects/:id/document-research`.

Initial source and facts readers use `gpt-6.1-sol` with Low effort, with at most
three worker calls running at once per daemon service. Deeper text/image native
roles use Sol/XHigh and are callable by the main Codex agent for a focused gap.
They search project evidence first and use web sources when needed. These roles
retrieve evidence; they do not draft tender responses or choose engineering
solutions. Visual role profiles are registered only after saved project image
consent. Existing image production roles and their execution policy are separate.

Completion means the selected native text was analyzed. It does not certify
the whole project, visual figures, raster tables, OCR or unreadable pages. The
initial selection still comes from bounded setup intake. Research separately
caps source/page/input/output work; any remaining pages stay pending and leave
the run partial. Retry reuses successful batches for the same source hashes.
Daemon-owned job records and native profiles follow the root `AGENTS.md`
daemon data directory contract.


## Default text and image custodians

Original project material is managed by two default custodians. The main agent
asks the text custodian for cited facts and the image custodian for relevant
assets; it uses their returned evidence and files when composing a document.
The canonical directive is shared by all three prompt composers. An explicit
user instruction can override that routing. The focused query service uses
Sol/XHigh over bounded native source pages and up to six actual images. Native
text pages are cached by verified source hash; each answer receives relevant
pages and surrounding clauses, with explicit truncation and selection gaps.
Saved summaries alone cannot establish missing requirements. This query service
does not perform a web search on every question.

Each project has an append-only diary of source changes, indexing jobs and
custodian questions, plus immutable index snapshots linked by hashes. This is
an index history, not a nested Git repository or a backup of original files.
Daemon-owned records follow the root `AGENTS.md` **Daemon data directory contract**.
The compact **Project custodians** control above chat shows current indexing,
source order, coverage, gaps and the recent diary. It also offers direct text
or image questions and a gallery button. Source paths, hashes and internal IDs
stay in machine-readable records rather than the chat composer.

A visible project renews a 90-second activity lease every 30 seconds and on
focus. While active, the daemon checks the project folder and authorized linked
intake folders for new, changed or removed sources. New work is coalesced;
unchanged successful text batches are reused by source hash. Running work may
finish after the page becomes inactive. New visual work still requires saved
project image consent. Unsupported formats, scan limits and incomplete table
transcriptions remain visible gaps. The current automatic reader selects up to
12 originals per batch; it does not certify an arbitrarily large project.

The HTTP surface is `/api/projects/:id/custodians` with `/ask`, `/history` and
`/activity`. Matching commands are `od custodian show|ask|history|activity
--project <id> --json`; ask accepts `--domain text|images --prompt-file <path|->`.
Both UI and CLI use the same endpoints.

### Antro visual and automatic-update checks, 23 October 2026

The same three sampled Antro PDFs received full-page inspection on all 78 pages,
followed by actual crop creation and crop analysis. The gallery contains 27
ready crops: 18 images, two drawings, one chart and six tables. Four table
transcriptions report complete; the two budget-table parts on DIP pages 32–33
retain an explicit continuation warning. A clipped table on capitolato page 5
was detected by the crop reader and repaired with a padded crop. Original
PDFs were not modified. This verifies the selected sample, not the complete
Antro archive or independent numerical accuracy of every cell.

A separate live folder test added a second TXT source while the project was
active. The diary recorded source change, indexing start and completion; the
new source was indexed and the original source's successful workers were
reused. The history hash chain verified. Native text and image custodian queries
also returned cited evidence and real asset files. Live browser layout inspection
was unavailable in this chat; focused component/provider checks cover controls,
activity renewal, privacy and stale-project responses.


A main-chat regression exposed a false absence claim from summary-only retrieval.
The text custodian now supplies hash-verified native pages, relevant neighbours
and explicit truncation/selection coverage. Repeating the original question on
the two-page disciplinary excerpt and one-page demonstration text correctly
recovered the page totals, counting exclusions and all four page functions.
Current authorized roots are checked again before reuse, and stale indexing
results cannot certify a newer source revision.
