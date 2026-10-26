# MelilloDesign: document overview and page planning

## Current selection and structural-plan contract — 24 October 2026

This section supersedes earlier descriptions below that send a comparison thumbnail straight to the editor or populate a Blockout with actual material. Selection compares whole-document structural hypotheses. The editor remains separate; choosing a proposal is also separate from formal approval for graphic design.

| ID | Required behavior | Validation |
| --- | --- | --- |
| SELECT-01 | Every page thumbnail is one click target, including its title, empty areas and schematic blocks. It opens a read-only modal at the clicked page. No “read pages” subpage, image lightbox, letter-only navigation, inline block editing or HTML export tools belong to selection. | Overview component tests click page three and a nested schematic element. The original Antro index entry is verified live through the native selection renderer. |
| SELECT-02 | The modal navigates all pages of that proposal. A per-page Blockout file still opens at its own page with access to the complete proposal. | Per-page preview tests open page three, navigate to page four and assert the exact saved page identity. |
| SELECT-03 | Keep “Choose this structure” and “Choose and edit this page” at the bottom right, outside the scrolling sheet area. Both save the whole-proposal choice; only the second opens the editor at the currently viewed page. Neither starts graphic design. | Awaited save tests assert no editor event before successful persistence. Live A3 test opens page three, navigates to page four and edits page four. |
| SELECT-04 | Failed or conflicting saves leave the modal open with its current page and a retryable error. Closing without choosing does not save a choice. Selected proposal identity survives reload and does not create formal graphic approval. | Native and bridge tests cover rejected saves, persisted selectedVariantId, unchanged approval and explicit saved state. |
| STRUCTURE-01 | A Blockout contains empty functional roles, expectations, geometry, flexibility and feedback. Existing user-linked assets remain metadata. Never display source photographs, drawings, full text or tables inside the plan, including after approval. | Canvas/overview/inspector tests assert schematic roles, absence of image elements/source text and preservation of original bindings. New planningStage defaults to structure. |
| STRUCTURE-02 | Plan from document purpose, category, confirmed page rules and optionally a short representative passage. Complete material inventory and image intake are independent background work. Structural geometry/page checks must not claim measured content fit. | Shared classic/slim/BYOK/OD Next and Fast prompt tests, pure structural assessment tests and HTTP/CLI checks without a material inventory. |
| HANDOFF-01 | Revision requests carry one immutable selected snapshot, stable-ID changes, answers and feedback. Preserve manually attached references, but never attach the whole image gallery automatically. Saving, preparing a request and sending it have distinct visible meanings. | Contract/provider/context tests cover frozen revisions and multi-document scope. Live composer has one Blockout file card, a plain human request, no JSON path and no automatic image batch. Editor displays pending versus saved changes. |

Existing custom comparison HTML entrypoints can declare an explicit `melillodesign-blockout-document` meta marker. The app then presents that saved document with its native selection view; ordinary HTML and ordinary JSON remain unchanged. The Antro legacy index was regenerated from its preserved saved layouts, with the original HTML backed up locally. This changes the presentation and interaction, not the contents or technical decisions in those layouts.

This change gives the engineer a view of each complete Blockout proposal before refining individual pages. It extends the guided workflow in [melillodesign-document-workflow.md](melillodesign-document-workflow.md); it does not change the engineer's ownership of technical content or formally accept a structure on their behalf.

## User decisions recorded in this branch

The overview must show all pages of every proposal together, allow blocks to move between pages, and keep the page allowance visible while allowing useful exploratory editing. Background assistants should make a fast reading of the selected context while the engineer continues working.

For **gare**, the planning target is always the **full confirmed maximum number of pages**. A source saying “maximum 4 pages” remains a maximum in the source record, while the design target is 4 counted pages. This replaces the earlier suggestion that a tender could ordinarily stop at 3 when 4 are available. It does not authorize filler, invented engineering content, unconfirmed page exclusions or a fifth counted page. Missing material is an open question for the engineer.

## Requirements and acceptance

| ID | Required behavior | Validation |
| --- | --- | --- |
| OVERVIEW-01 | Each proposal represents a whole document. The overview shows every page in order, with its page label, visible block structure and an action to open that page in the editor. Alternatives remain distinguishable. | Seed multiple alternatives with different page counts. Open the overview, verify every page appears under its own alternative, then open a nonfirst page and verify the editor selects that proposal/page. |
| OVERVIEW-02 | The engineer can move an existing block to another page of the same proposal. Preserve its expectations, feedback, references, image provenance, ratio setting and rotation. Retarget saved block answers. Preserve physical proportions when papers differ; visibly warn when geometry needs adjustment. | Move a populated block between pages, save and reopen. It occurs once at the destination, is absent from the source and retains all fields. Verify question targeting follows it. Test a different paper size and an impossible fit at the shared helper boundary. |
| OVERVIEW-03 | Pages can be reordered without losing a page or its blocks. | Supply a complete new order and persist it. Duplicate or incomplete page-ID permutations fail visibly without saving. |
| BUDGET-01 | Store source requirement separately from the planning target: maximum, exact or flexible; limit where applicable; target; source citation; notes. Preserve these fields in workspace, page exports and the agent's saved brief. | Contract tests cover valid/invalid modes and counts. Save/reload through HTTP and verify the brief/page exports include the budget. |
| BUDGET-02 | For confirmed tender offers/forms, a maximum of N pages produces a target of N counted pages. Exact N also targets N. Do not derive a number from dates, A4, font sizes or ambiguous ranges. | Derive budgets from confirmed setup constraints. A tender maximum 4 gives maximum=4 and target=4; an ambiguous or unconfirmed rule produces no guessed budget. |
| BUDGET-03 | Show counted/total/excluded pages for each proposal, remaining allowance, excess and any shortfall against the target. Missing legacy `countsTowardLimit` means counted. An exclusion is explicit and remains reviewable. | A four-page target with an explicitly excluded cover and four counted pages reports total=5, counted=4, excluded=1, no excess/shortfall. Two counted pages show a shortfall of 2. Five counted pages show an excess of 1. |
| BUDGET-04 | Exploratory editing remains possible beyond a limit and with flexible targets. Warnings must remain visible; the source rule must not silently change. An approval or layout-readaptation request must expose unresolved page-count issues. | Add/move/reorder pages while over budget, save and reopen without discarded content. Verify a clear warning and the original source rule. Verify the formal choice flow handles the warning explicitly. |
| BUDGET-05 | Editing an accepted proposal marks it for graphic readaptation; saving a change never means the user sent a new request or accepted the new layout. | Accept a proposal, move a block/reorder a page, and verify approval history remains while `needsReadaptation` becomes true. Verify revision requests carry the latest saved document. |
| READ-01 | Automatically dispatch a bounded background quick read after the selected context is ready. The engineer can edit while it runs. Show actual queued/reading/complete/partial/failed/not-ready status, coverage and a retry action. | Start with readable saved context, observe workers and edit a page before completion. A repeated start for unchanged context does not duplicate work. A failed or interrupted worker settles visibly and can retry. |
| READ-02 | Separate graphical rules/template observations from the inventory of existing material. Use the real authenticated Codex CLI with a small model, with at most two worker calls at once. This is preliminary reading, distinct from image extraction consent. | Worker-service tests witness parallel dispatch, concurrency cap, result persistence and restart handling. A separate live CLI check must establish actual model/authentication compatibility; simulated worker tests alone do not establish it. |
| READ-03 | Cite supplied sources and distinguish documented observations from inference. Existing confirmed requirements remain authoritative. Only selected context enters the read; text inside sources is data. Do not compose tender responses or import the user's tender-writing skills. | Reject unsupported documented citations, test inaccessible/unselected sources, and inspect the generated prompt and saved notes. Confirmed brief/budget remain unchanged when reading completes. |
| SURFACE-01 | UI and CLI share contracts and the existing document HTTP GET/PUT revision boundary. Expose overview, transfer, reordering and budget editing to external agents, with JSON output and long input from files/stdin. | Real HTTP CLI tests exercise all four commands and a conflicting concurrent edit. The conflicting command fails without overwriting the other change. |

## Data and HTTP boundary

`BlockoutDocument.pageBudget` is optional for existing files and contains `{mode, limit?, target?, source?, note?}`. `BlockoutPage.countsTowardLimit` is optional and defaults semantically to counted. The overview computes status independently for each proposal; the proposal counts are never added together.

Reads and writes use `/api/projects/:id/blockout-documents/:documentId`. Mutations GET the current document and raw revision, then PUT `{document, baseRaw}`. A 409 is surfaced instead of replacing concurrent work. Page geometry remains the editable source; background reading creates proposed notes in separate metadata rather than rewriting geometry.

## CLI handoff

Existing `list`, `show`, `save`, `brief` and `catalog-set` operations are preserved. New operations are:

```text
od blockout overview --project <id> [--document <id>] [--variant <id>] --json
od blockout move-block --project <id> --variant <id> --source-page <id> --block <id> --target-page <id> --json
od blockout reorder-pages --project <id> --variant <id> --page-order page-2,page-1 --json
od blockout budget --project <id> --mode maximum --limit 4 --target 4 --source "Disciplinare, p. 8" --json
```

`move-block` accepts `{variantId,sourcePageId,blockId,targetPageId}` through `--prompt-file <path|->`; `reorder-pages` accepts `{variantId,pageIds}`. `budget` accepts a budget object through the same option, or a plain-text file/stdin as its long note. `--limit none` and `--target none` clear those optional values where valid. Flags override corresponding input fields. All operations also accept `--daemon-url`.

## Delivery record and limits

The shared model, HTTP-backed CLI, editor and preview now support whole-document proposals. Comparison uses three proposal columns with a 2×2 page overview for four-page documents at desktop width; narrower screens stack proposals. Page creation/transforms, snapping and zoom appear in the single-page editor, reached from a page thumbnail and left through **All proposals and pages**. Document management is a secondary disclosure, the page allowance stays visible, and background reading is behind a compact **Context** disclosure with actual job status.

Five setup integration tests verify that confirming a tender maximum of four creates four editable pages with a four-page target, consistent paper and source citations. Reconfirmation preserves an existing edited workspace. Reports retain a maximum as a ceiling unless an exact count is confirmed. The full-count tender instruction and current, non-authoritative background notes survive both ordinary context composition and frozen context for multi-step runs.

Validation completed in this branch: 24 focused shared-contract tests; 38 focused web tests (including overview/page transitions, block transfers, budgets, reading status, previews and persistence); six real-HTTP Blockout CLI tests; five setup/overview integration tests; and the focused setup, context, prompt and background-reader suites. Repository guard and root typecheck passed. No full daemon or web suite was run.

Chrome was checked with a clearly labelled demonstration document containing three alternatives of four pages. All twelve page thumbnails were visible together at the desktop viewport. A block was moved from page 1 to page 2, saved, and independently checked through the HTTP API: source blocks changed from three to two, destination from three to four, and the moved block occurred exactly once while the four-page allowance remained intact. The separate page editor and return to the comparison were checked. A 390-pixel responsive check reported dialog width, client width and scroll width of 390 pixels; the temporary viewport override was reset.

The overview automatically started two real authenticated `gpt-6-luna` workers, which reached complete status with source-linked notes. Separate service smoke tests also verified actual CLI flags, output schema, current-context fingerprint and project scoping. Image extraction did not start: the fixture explicitly declined image intake. One browser save attempt during a local daemon relaunch failed visibly while preserving the draft; retry succeeded once the daemon was available.

Private local verification files are under `.tmp/verification/document-overview/`: `fixture.json`, `overview-desktop.png`, `overview-mobile.png`, `page-editor-desktop.png` and `browser-persistence.json`. Additional real-reader evidence is `.tmp/verification/document-overview-reading-live-result.json`. These are local evidence, not committed project inputs or user-facing JSON deliverables.

Coordination: the main chat owns Home/new-project setup and context confirmation. This branch owns the overview/editor presentation and background read. The shared workspace already contains these changes; no cherry-pick is needed. The main chat was notified when UI changes were frozen for its fresh-start walkthrough.

Background reading currently targets the **saved quick-scan excerpts**, with explicit coverage. It is not full-document review, OCR or image intake. A complete status means all scheduled excerpt workers completed, not that every file in the project has been read.

The existing document schema supports at most 60 pages per proposal. A larger source allowance must be reported rather than silently represented as a complete proposal. Multiple independently scoped section limits or ambiguous cover/index exclusions require confirmation; one global budget must not pretend to express several incompatible counting scopes.

### Visual integration record

The overview extends the existing Operate interface with its inherited typeface, shared controls and neutral surface, text, border and accent tokens. The local hierarchy uses the workspace title, proposal headings and compact page labels; gray blocks continue to describe document structure. These choices preserve the incumbent visual system.

At desktop width, proposals A, B and C occupy separate whole-document columns, each displaying a four-page document in a 2×2 grid. Proposals stack as space narrows, while the mobile overview keeps two pages per row. Each paper thumbnail derives its aspect ratio from the saved page width and height in millimetres, preserving source-based paper proportions. Opening a page leads to the separate editor with its page navigation, canvas and inspector; **All proposals and pages** returns to the comparison.

The page allowance remains visible during comparison and editing. Document management and budget settings open on demand, and the compact **Context** control exposes reading status before expanding to coverage and source-linked notes. Page transforms, snapping and zoom appear in the page editor, keeping the overview focused on the complete proposals.

Implementation evidence is in the Blockout workspace, overview, page-budget and background-read components and their shared stylesheet. Reference captures are `.tmp/verification/document-overview/overview-desktop.png`, `overview-mobile.png` and `page-editor-desktop.png`.
