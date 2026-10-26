# MelilloDesign UI/UX testing roadmap

Baseline: [26 October checkpoint](../../docs/checkpoints/2026-10-26.md), implementation `71e48b9454db58219ee4eff279ef3c0f9c217090`. This is the testing backlog, not a record that the scenarios below have passed. Existing checks are linked so the next run can target missing evidence rather than repeat every test indiscriminately.

The immediate goal is a coherent journey from project creation to a selected, edited Blockout and a designed document that can be recomposed later. A functional pass requires correct saved state; a usability pass also requires the user to understand what will happen without an implementation explanation. Both are needed.

## Order of work

| Order | Work | Exit condition |
| --- | --- | --- |
| 1 · P0 | Repair/retest canonical preview continuity and initial loading: UX-01, UX-02 | Both modes complete through their intended UI without repair, a duplicate document or a misleading completion. |
| 2 · P0 | Exercise proposal selection, editing, handoff and the two-document case: UX-03 through UX-06 | Exact-page navigation and saved state are correct; originals and independent document settings survive. |
| 3 · P1 | Test recurring graphics, related documents, history, intake and constrained viewports: UX-07 through UX-14 | Each scenario has functional evidence and an explicit disposition for remaining uncertainty. |
| 4 | Run fresh blind journeys on the resulting frozen build | New readers complete both modes without chat rescue; first failures and uncertainty are retained. |
| 5 · P1/P2 | Broaden Claude production, export and scale coverage: UX-15 through UX-17 | Record provider/product limits before making broader readiness claims. |

Changes should address the interaction itself: state, navigation, hierarchy, reversible actions and feedback. Adding paragraphs that explain an awkward interaction is not a substitute for repairing it.

## P0: complete the central journey

### UX-01 — a design update returns to the right document

**Current evidence:** the [latest live Normal flow](../../docs/verification/composition-closeout-2026-10-26.md) refreshed automatically. Fast produced the correct canonical result but opened an incidental companion file.

Start a fresh small Normal document, then a fresh Fast document. Choose a structure, approve design, reopen page composition, alter one block on the last page and submit the update. Observe the completion without selecting a different file, reloading the browser or inspecting hidden state. Include a returned companion HTML in a focused regression fixture.

**Pass:** the canonical document's preview refreshes to the registered current revision; reopening composition shows the resulting guide and correct page. Unchanged content/pages remain unchanged, the document count is stable, and the update is not presented as an unrelated new document. Registration pending, failure and supersession have accurate states. A correct file discovered manually is evidence of file correctness, not a preview-continuity pass.

### UX-02 — creation and waiting do not produce duplicates or strand the user

**Current evidence:** [25 October](../../docs/verification/melillodesign-focused-fixes-2026-10-25.md) includes diagnostic Retry and service-interruption limitations. Later small live flows worked, but a new uninterrupted blind pass is missing.

Create a named project and first document in each mode. Follow default preparation and wait for real proposals. Check slow first output, a recoverable intake error, an interrupted connection and deliberate Retry in separate diagnostic runs. Exercise double-clicking Continue, reopening an existing document and reopening the panel during loading.

**Pass:** one intended document exists per submission; its identity and progress remain visible. The normal successful path needs no restart, hidden repair, repeated setup or chat command. Failures have bounded, truthful retry/cancel states, and retry does not restart unrelated intake or duplicate the document. Closing/reopening the side panel never crashes the page. Recovery runs are reported separately from uninterrupted runs.

### UX-03 — comparison is a selection experience

Open proposals from chat while keeping the chat visible beside the comparison. Click an entire page thumbnail, including whitespace, labels and blocks; start with page three when available. Navigate using visible previous/next arrows and keyboard arrows; close and reopen. Check the optional full-screen modal.

**Pass:** the modal starts on the clicked page of the intended proposal, announces page position and offers clear navigation. Its sticky bottom-right actions distinguish choosing from choosing-and-editing. The comparison itself does not expose accidental inline editing or open raw JSON. Selecting a proposal neither approves graphic design nor changes another document. The chat remains available on closing, with its draft preserved. An image inside a block is not the only clickable target.

### UX-04 — edits are saved, reversible and clearly separate from sending

Choose a proposal, enter its editor, rename a block, move/resize it, add/remove/reorder a page, toggle snapping and intentionally cross the safe margin. Use undo, redo and the action-history menu. Close/reopen during an outstanding save; switch documents while a save is pending; test a failed save and retry.

**Pass:** autosave status reflects persisted state; recovery preserves the latest edit and rejects stale completions. There is no redundant manual Save action. Undo/redo/history have observable scope. Page navigation has clear position and scrolling, deletion is recoverable, and safe-area warnings permit intentional bleed. The editor can always close and cannot be entered prematurely before a proposal is selected.

Before activating “Edita in chat” or “Passa al design,” ask the reader to predict the effect. **Pass:** the first stages exactly one saved handoff in the chat draft; it does not claim to have run the agent. The second visibly asks for the required design approval. Unsaved or failed edits cannot silently be omitted from either action.

### UX-05 — two different documents in one project

Use one small private context sample and clearly labelled demonstration text. Create **Relazione B** with eight portrait A4 pages and **Fascicolo grafico B** with four landscape A3 pages in the same named project. Use confirmed format rules, keeping source findings distinct from the user's overrides. Do not commit the private input files to this source repository.

**Pass:** both documents have separate names, page budgets, header/footer/cover choices, proposals, selections and editable structures. Three alternatives differ meaningfully in hierarchy and reading rhythm rather than just shuffling the same oversized pictures. The report remains text-oriented; the graphics document can emphasize figures and diagrams. Page-body previews remain schematic blocks, with optional user references rather than automatically filled project imagery. Switching documents, reopening and retrying preserve each state without duplicates or a raw-JSON detour. Approving one does not approve the other.

This rerun is required after the latest changes. The earlier header/footer 8 A4 / 4 A3 evidence and later two-page composition tests cover useful parts but do not jointly constitute this new whole journey.

### UX-06 — the agent receives the user's actual composition request

Change one page and one block; add a short note and one optional gallery reference. Stage and send the request through the UI. Separately request a variant in ordinary chat. Have the agent ask a targeted page/block question and answer it in its native form.

**Pass:** the request contains the saved structural revision, stable page/block identity, old/new structure or diff, scope, feedback and flexibility. It does not attach the entire gallery. Targeted questions highlight the correct outline. A new variant preserves the original, appears in the proposal selector and can be used downstream. Any action that immediately starts a model is distinguishable from an action that only prepares a draft. After design, the same process adapts composition while preserving content, with the finished-guide toggle and page-wide background freedom intact.

## P1: confidence in supporting workflows

| ID | Scenario to exercise | Observable pass and evidence to retain |
| --- | --- | --- |
| UX-07 | Normal and Fast header/footer creation: neither, header only, footer only, both; cover and numbering; supplied logo, ZIP and missing logo | Related choices appear in chat in both modes. Upload receipt is distinct from usable logo selection. Actual logo pixels load before graphic approval; failures can be omitted/retried deliberately. Structural approval, actual graphic approval and Apply are distinguishable. Capture each state and the resulting page reservations. |
| UX-08 | Reuse a project header/footer, link future updates, leave another document independent, change the shared design from either document | The picker previews and marks the chosen design. The user can predict which named documents will change. Linked documents update; independent copies remain unchanged. The editor stays reachable for the document's life, and cover/numbering options remain per document. Capture bindings and before/after previews. |
| UX-09 | Name/reopen a project and its documents; discover `@`; reference a sibling document and another project; open and deselect a file target | A cold reader distinguishes project, document, source folder and reference. The complete composer makes mentions discoverable without a hint. Reference scope is clear and cannot silently edit the referenced document. A removable target chip prevents previewing from permanently selecting “edit this.” Retain the full-screen transcript and saved reference scope. |
| UX-10 | History panel: compare, restore one path, restore a full version, recover the pre-restore version; external save and daemon restart | Differences and restore scope are understandable; stale/active-run restores fail safely. Safety versions recover the replaced state. A disposable folder with dirty/staged Git remains unchanged in HEAD/index/config by private history operations. Check real idle/restart behavior in addition to existing fake-clock tests; no timer silently reorganizes files. |
| UX-11 | Small-height desktop, chat/preview split, expanded modal, 125–200% zoom, keyboard-only, and narrow viewport | Chat remains readable; statuses collapse to a compact row, composer grows when needed, pages fit or scroll with visible affordances. Focus stays in the modal and returns on close; Escape, arrows and keyboard alternatives to dragging work. Add/Replace stays visible. Inspect contrast and screen-reader names separately from screenshots. |
| UX-12 | Intake from folder/CLI and UI upload, default start, opt out of images, cancel/error/retry, new files while working | Text and image preparation have distinct truthful states; Continue starts the chosen background work. Existing originals remain untouched. A first-result card makes extraction understandable without requiring every image to be shown. Source/page/crop provenance agrees with inspected originals; retry does not create duplicate assets. |
| UX-13 | Gallery drawer: search, pagination, retained selections/notes, first drop, second drop Add/Replace, undo and reopen | A reference is visibly faint and labelled as an intention. Multiple images retain natural proportions and stay contained. Add/Replace is reachable by mouse and keyboard, including narrow/scrolled layouts. The sent handoff includes only relevant references. Distinguish a reference from a final content assignment and feedback-only imagery. |
| UX-14 | Long chat + both documents + repeated editor/modal opens; larger gallery/intake; cleanup after leaving views | Record browser process/heap and daemon memory separately over time, with workload and build mode. Look for retained previews/listeners and monotonic growth. Treat the user's roughly 8 GB browser allowance as an investigation trigger, not a measured pass or a target to consume. Profile earlier if responsiveness degrades. No current measurement proves scale readiness. |

The [autosave/gallery](../../docs/verification/melillodesign-autosave-gallery-2026-10-26.md), [header/footer](../../docs/verification/melillodesign-header-footer-2026-10-24.md) and [history](melillodesign-project-history.md) records supply focused evidence. Repeat only the affected boundaries after a change, then run the fresh complete journeys once the build is stable.

## Broader coverage

| ID | Priority | Missing coverage and pass condition |
| --- | --- | --- |
| UX-15 | P1 | Full native Claude creation → questions → proposal selection → editing → approved design → post-design update. Use the configured Opus 5.5 / medium setting and confirm the actual runtime model. No provider fallback, chat rescue, stuck completion or duplicate document may be hidden. Existing connector smoke/recovery tests are not this acceptance test. |
| UX-16 | P2 | Final A4/A3 preview, print/PDF and editable deliverables. Establish the supported export contract first; then inspect every page for clipping, numbering, fonts, logos, linked assets and header/footer consistency. A successful HTML preview does not establish export correctness. |
| UX-17 | P2 | Broader document families: technical report, offer-related graphic document, form and free document; longer/scanned/vector PDFs; large gallery. Test relevance, density, source quality and failure handling with representative private samples. Do not reintroduce technical authorship or require content-filled Blockouts to make a test look complete. |

## Fresh blind testing protocol

Use a new GPT-6.1-Sol reader at low effort for each independent journey. The reader must not have seen the app, previous reports, implementation, desired interpretations or another reader's conclusions. Normal and Fast need separate fresh sessions. A later rerun after repairs also needs fresh readers; coaching an existing one does not establish discoverability.

Give each reader a simple outcome task, such as creating a named report with a supplied folder, choosing a structure, editing page three and requesting design. For every step provide a literal transcription of the **entire visible screen**: navigation, headings, text, controls, disabled/loading/error states, composer, side panels, modal, visible page counters and existing selections. Neutral descriptions of placement, color and an opened modal are allowed. Do not crop the transcript to the intended button, append instructions about its meaning, or reveal hidden state.

Before clicking, collect the reader's immediate interpretation, intended next click, expected result, uncertainty and confidence. Ask for basic first impressions without extended deliberation. The facilitator performs only that visible action and reports the next full screen. If a reader can operate the UI directly in a separate visual lane, label that evidence separately from text-only reading. Neither type alone establishes visual quality or replaces the engineer's own trial.

Freeze source commit, built runtime and relevant configuration for the journey. Record mode, provider/model/effort, viewport, locale, project/document IDs, sample description and every facilitator action. Do not edit product state, rebuild, warm an asset URL manually or supply chat commands to rescue a strict pass. A visible retry is allowed as a recovery test, but its first failure remains in the record. Synthetic/seeded layouts can test a component, not initial generation.

The complete journeys must cover creation and naming, natural chat preparation, applicable recurring graphics, waiting for real proposals, discovering the comparison, opening the intended page, selecting/editing, closing/reopening, understanding autosave, and the final handoff/design transition. Observe whether `@` is discovered from the full composer without prompting. Add the two-document scenario and post-design update as explicit tasks; do not infer them from a one-document test.

## Reporting and completion rules

For each scenario record the exact checkpoint, task, mode, steps, first failure, expected/actual state, confidence/uncertainty, functional result, usability result and evidence paths. Use `not run`, `pass`, `fail` or `blocked`; use `diagnostic continuation` for work after a strict failure. Assign a concrete next action and link the eventual repair commit and fresh verification.

Retain full transcripts, screenshots, run IDs and focused test output under ignored local verification storage, with a readable summary in `docs/verification/`. Do not commit private project inputs, gallery images, credentials or runtime databases. Reports must say when evidence is only available on the original machine. Add a short diary entry with each meaningful repair commit.

P0 can close only when UX-01 through UX-06 have direct product evidence in both relevant modes, the 8 A4 / 4 A3 case works in one project, and fresh readers complete the intended actions without a workaround. A prompt adjustment or an extra explanation is not a pass until the resulting UI behavior and the reader's expectation agree. P1/P2 items remain individually open until exercised; never convert “reviewer finished” or a limited `ship` verdict into a claim that the whole product is clear.
