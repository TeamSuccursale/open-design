# MelilloDesign: header and footer workflow

Status: implemented with recorded live acceptance, 24 October 2026. Normal and
Fast real Codex CLI journeys exercised logo collection, structural proposals,
targeted feedback, graphic approval and application. The normal project reused
the design across eight portrait A4 report pages and four landscape A3 booklet
pages, published shared updates, preserved an independent copy and restored a
published version as a new shared revision. Both normal documents and the Fast
two-page report have inspected editable structural body Blockouts. The Fast
parent-chat link was exercised through page preview, page editing and feedback
saved in its registered child workspace without a parent duplicate. Its authored
structural HTML includes the approved owned recurring regions; final body graphic
design and PDF delivery are later stages and are not claimed complete. The
[verification report](../../docs/verification/melillodesign-header-footer-2026-10-24.md)
separates live proof, focused tests and remaining limits.

The engineer should settle the recurring header and footer before planning the
document's pages. They collect logos and required information with the agent,
choose or create a reusable project design, and approve its actual appearance.
The page Blockout then works with the space those elements really occupy.
The design remains editable throughout the document's life.

This extends [the document workflow](melillodesign-document-workflow.md) and uses
[project history](melillodesign-project-history.md) for recovery. It replaces the
current promise that header/footer content will only be designed during the
later page graphic-design phase.

## Entry and sequence

Normal and Fast technical documents use the same choices. Fast keeps its direct
chat preparation; it does not gain the guided project wizard or mandatory full
intake. The regular wizard stays limited to project/document identity, document
type and folders. All editorial and asset questions belong in chat.

After the quick file read, the agent groups related questions: document name,
header, footer, cover and numbering. Answers already given are reused. Header
and footer are independent; selecting neither skips their design stage.
Whether a cover shows them is an explicit related choice. Cover numbering,
whether the cover advances the sequence, and inclusion in the page allowance
remain separate document settings.

For each enabled header/footer, the agent offers **create a new design** or,
when available, **choose an existing project design**. The user can also change
the decision to use neither. The chat names the current document and never
silently applies one output's choice to another output.

The sequence is:

1. Quick file read and related editorial choices in chat.
2. Choose an existing header/footer design, or collect logos and guidance for
   a new one. An existing compatible design can be previewed and reused without
   repeating its original asset interview.
3. For a new design, propose its structural arrangement, let the user choose and
   edit it, then develop and approve the **actual header/footer graphics**.
4. Publish/apply that design and its measured page reservations.
5. Prepare the document's page Blockout, or continue to page graphic design if
   the user explicitly skipped Blockout.

The agent explains the current step and starts the work it announces. Text and
optional image preparation may continue in the background. The user can write
while assets are being collected; the next dependent design step waits for
the needed assets or an explicit decision to omit/use a placeholder for one.

The header/footer stage is an intentional exception to the page Blockout's
fidelity: its recurring graphics are finished first. Page-body Blockouts still
contain empty functional blocks and expectations, not the project's actual
photographs, drawings, full text or tables. Their preview may display the
approved recurring header/footer around that schematic body.

## Logo collection and guidance

The agent asks what must appear in the enabled regions: logos and their order
or relative importance, project/document titles, names or roles, identifiers,
dates/revision fields, numbering and any supplied branding instructions. It
uses relevant findings from the quick read, states their provenance, and asks
only about unresolved choices. It does not invent organisations or engineering
content. Related questions share one native chat form.

A visible **Aggiungi loghi e indicazioni** action opens a dedicated modal. It
accepts individual logo files and ZIP packages, supports removing a pending
item, shows upload progress/errors, and lists what has actually been received.
It also accepts a list of organisations/logos to find online and the user's
instructions. Ordinary chat attachments and replies feed the same persisted
asset brief. Uploads and online requests can be mixed in one design.

Each item has an identity and a visible state: supplied, searching, candidate
to resolve, ready or failed. Closing the modal preserves saved material and
returns to the same chat. Background searches continue; cancellation of a
search is a distinct action. Reopening resumes the collection, not a new copy.
The modal shows a small preview of the page and its recurring regions while
guidance is entered; on a narrower viewport it offers a visible preview tab.

ZIP entries are unpacked through the owned upload boundary, with path, entry
count, compressed/expanded size and supported-file checks. Nested ZIPs are not
recursively expanded. Originals remain recoverable. Unsupported or failed
entries are reported individually instead of claiming that the package was
fully imported. A logo upload is not a request to run full image intake over
the project's unrelated files.

For each distinct logo the user asks to find online, the coordinator starts
one bounded native worker/session using **gpt-6.1-sol, low effort**. Different
targets can run in parallel under the runtime concurrency limit; retries stay
associated with their target. Each worker receives the organisation identity,
any known site, intended use and its own output destination. This is a focused
asset-acquisition exception to Fast's prohibition on automatic document
research; it does not start custodians or a general research pipeline.

Workers use the available search/download tools and, when useful and actually
available, the user's Chrome/ChatGPT extension session. The extension is one
supported acquisition route, not a dependency that makes uploads unusable.
They prefer the organisation's own site or supplied brand kit, save an actual
local asset, and return its source URL, identity, format, dimensions and any
uncertainty. A search result, screenshot of a site, or remote hotlink alone is
not a delivered logo. Existing SVG/vector assets retain their geometry; a
missing logo is not silently regenerated. Multiple plausible organisations or
marks are returned as candidates for the user to resolve. Failures remain
visible and retryable; no worker may report a download it did not complete.

The coordinator integrates the returned files, shows the received logos with
their labels, and uses them with the saved guidance. It sends only relevant
assets to these workers and the header/footer designer, not the project's
entire gallery. Acquisition availability and any model fallback must be stated
honestly; the feature cannot silently substitute a heavier worker or bypass
the platform's response controls.

## Choosing and editing a project design

Existing designs appear in a dedicated modal as named preview cards showing
header, footer, compatible page formats and usage in this project. Selecting
a card puts a visible check on it. A separate **Usa questo modello** action
applies the selection. Cancel preserves the prior binding. This picker only
chooses a design; it does not expose page-block editing or open source JSON.

The dedicated editor works on header and footer regions with a complete page
preview for context. It supports logo, text, dynamic field and rule/separator
blocks; alignment, order, movement, resizing, proportions, snap and safe-area
warnings; and the saved guidance for the selected region/block. Questions from
the agent highlight the relevant region/block and retain the page preview.
The user can upload/replace a logo or change the guidance without restarting.

Structural proposals explain their hierarchy and space requirements. There is
no mandatory A/B/C count: present useful alternatives when the brief benefits
from a choice, without inventing differences. Clicking a preview opens its
modal at that page/format. Selection, editing and final approval are distinct.
The actual graphic preview follows the structural choice and is approved
before publication. Internal files remain accessible for tooling but are not
the user's primary view.

Draft saves are recoverable and visibly marked **Bozza salvata — non applicata
ai documenti**. The primary action is **Applica intestazione e piè di pagina**;
when shared, its adjacent scope names the affected documents. On success it
shows the applied revision and **Applicato a N documenti**. Unsaved edits,
saved drafts and applied revisions are distinguishable. Closing or Escape
returns to the previous view and preserves the draft; it never traps the user
in the editor or applies a draft implicitly.

Every document with either region enabled has a persistent **Intestazione e
piè di pagina** entry, available during Blockout and graphic design and after
outputs have been produced. It opens the applied design and any newer draft.
The same entry offers changing the project design, making an independent copy
or disabling a region. Page-level Blockout editing remains separate.

## Shared designs and the update checkbox

A project owns a library of named header/footer sets. A set can contain either
or both regions, reusable assets, design blocks and format variants. The first
approved set and every later published set appear in the project's picker.
Archived sets remain recoverable and cannot silently vanish from documents
already using them. Nothing is shared with unrelated projects automatically.

At selection/creation, show the exact checkbox:

> **Aggiorna se viene modificato in futuro**
>
> Se questa intestazione o questo piè di pagina viene modificato nell'editor
> o dall'agente, anche da un altro documento, le modifiche si applicano a tutti
> i documenti di questo progetto che usano lo stesso modello con questa opzione
> attiva. Se la disattivi, questo documento conserva una copia indipendente.

Working assumption pending any later product correction: the checkbox starts
checked for a newly chosen shared set, with this explanation visible before
application. The user's choice is persisted per document and set; opening an
existing document never changes it. First application publishes the new set
and records whether its originating document also follows future updates.

With the option enabled, the document references a shared set and follows its
published revisions. With it disabled, applying copies the current revision
into an independent document design, including its required assets. Editing
that independent copy does not change the source set. Turning linking off
later freezes the currently applied version. Turning it on offers a preview
of the latest shared version before the explicit apply action.

An edit made from **any** linked document, or requested from its agent, edits
the same project set and updates **all opted-in documents**, including the
original one when it remains linked. It is not an edit limited to the chat's
current folder. The editor and agent name this scope before applying it. A
request explicitly limited to this document creates/uses an independent copy.
Once linked behaviour has been chosen, routine authorised updates do not add
per-tool approval prompts; product design approval and CLI tool approvals
remain separate concepts.

Document-local values are evaluated at render time: document name, current
page/total pages, cover-number visibility, revision and other named fields.
Sharing a layout must not copy the report's name or numbering into a booklet.
Page counts, paper constraints and cover policy stay with each document.

## Formats, propagation and recovery

A shared set has explicit variants or layout rules for the formats it serves.
The same project can use it for an eight-page A4 portrait report and a
four-page A3 landscape booklet. Logos keep their proportions; page-edge
anchors, reserved heights, margins and typography are checked per format.
An unsupported format requires an adaptation preview, not a stretched design.
An update that cannot fit a linked document cannot be reported as fully
applied. Prescribed templates or margins found in the sources remain visible
constraints; conflicting choices are resolved with the user.

Applying creates an immutable published revision and a persisted propagation
transaction covering every linked active document. Validate all affected
formats first. Materialisations update only the owned header/footer regions
and their page reservations; body content and hand-edited blocks are preserved.
Geometry changes trigger fresh fit checks and a visible review state where a
body layout needs adaptation. The system does not silently move technical
content, alter page allowances or approve a changed page Blockout.

Use stable project/document/set/asset IDs through the project registry, even
when document working folders differ. Do not discover users by a shared path
or require a common Git repository. Storage follows the root AGENTS.md
**Daemon data directory contract**. Required assets must resolve in every
document preview and export; a successful apply cannot leave a broken link
to the originating document's folder.

Concurrent edits use an expected revision and return a recoverable conflict.
Publication/materialisation is restart-safe and idempotent. An application
failure preserves the prior coherent revision or records a visible pending
transaction that resumes; mixed old/new files must not appear as an all-green
success. Unavailable or archived documents retain a visible pending update
for their next authorised reopening rather than being silently skipped.

Every draft save, publication and affected document change participates in
internal recovery history. A shared edit records its origin, affected document
IDs, before/after revisions and asset references. Restore supports either
republishing a prior shared version to its current linked documents, or
restoring an independent copy in one document. It discloses that scope before
restore. Existing active-agent and stale-revision restore checks still apply;
the user's existing Git repository stays untouched.

## State, surfaces and implementation closure

Represent editorial intent separately from design readiness. The current
header/footer booleans must not imply that a real design has been approved.
Use persisted stages such as not required, collecting, structural draft,
graphic draft, ready, applying, applied and needs attention. A pending user
answer remains pending across reloads and is never answered by a timer.
The document stores its binding/copy identity, enabled regions, cover policy,
follow-updates choice, applied revision and outstanding propagation status.

The daemon owns the project library, assets, bindings and propagation. Add pure
shared contracts first. HTTP endpoints must support listing/reading/creating
sets, saving drafts, publishing, collecting assets and search targets, applying,
copying/detaching and observing affected documents/status. Both the UI and a
matching `od header-footer` command family must use those same endpoints;
commands support `--json` and long requests via `--prompt-file <path|->`.
This command family is proposed here and does not exist yet.

Agent edits must go through the same set/binding operations as the editor.
Generated recurring regions carry their set/revision identity. If an agent
directly changes a materialised region, detect the divergence and reconcile it
through the shared operation or show it as unresolved; editing one output file
must never be reported as a successful update of every linked document.
Provide private context containing the selected set, relevant assets, scoped
user guidance, current revision and change/feedback diff. Do not send every
image, whole-project HTML or a different document's full conversation.
Wire the stage and its Fast exception through legacy classic/slim, API/BYOK
and OD Next prompt composition, plus the native logo worker profile. Existing
execution/model restrictions stay in force.

Legacy documents with header/footer enabled remain readable and editable.
They show **Intestazione e piè di pagina non ancora applicati** until an existing region has been imported and
reviewed or a new set has been chosen; migration cannot invent approval or
live sharing. Imported existing graphics are previewed before publication.

## Acceptance and evidence

| ID | Required behaviour | Concrete validation |
| --- | --- | --- |
| HF-01 | Normal and Fast ask the same relevant editorial questions in chat. | Start fresh technical documents through both entries with the real Codex CLI. Verify explicit separate header/footer choices, cover and numbering, saved document identities, no extra wizard, and no repeated answered questions. An unrelated Fast prototype is not forced into this workflow. |
| HF-02 | The first enabled header/footer is finished before page Blockout. | With a quick text read complete and image intake still running, collect guidance, choose/edit a structural draft, approve its real graphic preview and apply. Verify no page proposals start before that point and measured reservations reach the page Blockout. Neither enabled skips this stage. |
| HF-03 | Existing files, ZIP and online requests share one resumable asset brief. | Upload individual SVG/PNG files and a ZIP, remove a pending item, add a search target in chat, close/reopen/reload and retry one failed upload. Verify received files/previews/provenance, preserved guidance and rejected unsafe/unsupported ZIP entries without executing contents. |
| HF-04 | Online acquisition uses one light Sol session per target. | Request two actual logos. Record two distinct bounded gpt-6.1-sol/low worker identities, saved files and source URLs; exercise one ambiguous match and one failed download. Inspect available browser/extension acquisition when needed; unavailable capabilities produce an honest recoverable state. No unrelated gallery batch is sent. |
| HF-05 | A dedicated editor and preview remain usable. | Edit logo size/position and text, toggle snap, cross a safe border and inspect the warning. Ask a region/block question and verify highlighting without covering the page. Save draft, close/Escape/reopen and distinguish draft from applied output. Verify keyboard/focus behaviour at desktop and narrow widths. |
| HF-06 | Project reuse has a real picker and visible selection. | Publish a first and second named set, open the dedicated picker from another document, inspect previews, select/check, cancel, then explicitly apply one. No source JSON, hidden page edit action or forced A/B/C labels. |
| HF-07 | Linking is per document and works across chat/folder boundaries. | Use one set in three documents with different working folders: two linked, one independent. Edit/publish from the second linked document. Both linked documents update; the independent one remains unchanged. Repeat with an agent-originated edit, then detach/relink explicitly. An unrelated project never changes. |
| HF-08 | A4/A3, numbering and cover rules remain independent. | Reuse the set for the same project's 8 A4 portrait report and 4 A3 landscape booklet. Verify local titles and page numbers, cover visibility/counting, logo proportions, safe areas and HTML/PDF output. Unsupported format, overflowing text and a taller header report actionable adaptation needs without changing body content or page budgets. |
| HF-09 | Editor access and propagation last for the document's life. | Reopen Header and footer during page Blockout, after page design and after restart. Update the set and verify every eligible page uses the published revision, including pages added later; disabled regions and excluded covers remain excluded. |
| HF-10 | Publishing is recoverable and never hides partial failures. | Inject a stale revision, unavailable destination and interrupted propagation. Verify retained drafts, coherent prior state or visible/resumable pending work, idempotent retry and no false success. Inspect history, compare, restore one independent document and republish an older shared set to linked documents; verify assets and existing Git state. |
| HF-11 | UI, CLI and all agent routes share the implementation. | Focused contract/HTTP/CLI/provider tests exercise matching requests and conflicts. Run the native flow through the actual CLI and visible UI; test prompt routing for legacy classic/slim, API/BYOK and OD Next. Do not mark a prompt-only change as an implemented editor/library. |
| HF-12 | The flow is understandable without product coaching. | Run a fresh Sol/low blind, text-guided journey with complete screen transcriptions. Ask for immediate impressions and next clicks. Check recognition of asset collection, selection versus editing, draft versus applied, linking scope, cross-document updates and the transition to page Blockout; repair and retest concrete confusion. |

## Current gap and delivery boundary

Code inspection found `DocumentPresentation` stores independent nullable
header/footer choices, cover and numbering, while `BlockoutPagePresentation`
renders schematic labels. `DocumentPresentationEditor` explicitly defers their
appearance to later graphic design. Fast's direct workflow previously lacked
the equivalent editorial-question requirement; the shared Fast directive now
includes it, using the existing document registry API/CLI for persistence.

The new library, acquisition workers/modal, dedicated editor, publication gate,
cross-document propagation and history integration still require implementation
and the evidence above. The checkbox default is the one labelled working
assumption in this spec. No live logo acquisition, full workflow run or shared
update has been claimed from this specification work.

Baseline validation for the small Fast prompt correction: 22 focused contracts
tests and four daemon prompt-routing tests passed, including API/BYOK and OD
Next as well as classic/slim routing. Contracts typecheck, contracts/daemon
builds, repository guard, specification links and whitespace checks passed.
The idle daemon was restarted through `tools-dev`; daemon and web both returned
HTTP 200 afterwards. A fresh live Fast editorial interview has not been run
for this correction. None of these checks count as completion of HF-02–HF-12.
