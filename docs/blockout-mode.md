# Blockout mode

Blockout lets an engineer compare page structures before investing in graphic design. It reuses the app's existing tools and design skills with one shared set of task notes. It does not introduce a new skill family or a tender-writing workflow.

New document projects use a short document/folder wizard, then a real Codex conversation. Continue starts selected background preparation and Codex groups related choices into a short native form in chat. The engineer confirms the resolved brief in chat before Blockout generation. The composer’s **Proposte** action opens comparison in the right panel while chat remains visible. Choosing a proposal reveals its page editor actions; closing comparison restores the previous preview. There is no generic editor action before selection. Explicitly choosing manual Blockout during the conversation is the separate path for drawing the initial structure.

The persistent editor remains accessible from the chosen proposal during graphic design. Add documents, navigate pages and name each document and page for its purpose, describe its content, and link gallery images or references. Opening a page or staging a request does not start a run.

The modal reserves separate columns for page navigation, the canvas and the inspector. **Galleria** replaces the inspector with a searchable, paginated drawer while leaving the page visible. Smaller windows stack it below the canvas. Users can move blocks, resize them with eight handles, rotate them, enter exact coordinates, lock or change proportions, duplicate or delete blocks and pages, and undo or redo edits. Page formats include A4, A3 and custom dimensions. Arrow keys move a focused block; Shift increases the movement step and constrains pointer transforms. Blockout is a functional structural plan: roles, proportions, hierarchy and intent, with text rhythm and figure placeholders. The agent does not fill it with source text or images.

The engineer can drag one or several gallery images onto a block, or select them and use the drawer’s keyboard-accessible action. An occupied block asks **Sostituisci** or **Aggiungi** before changing. Explicitly linked images set `referencePreview:true`; the canvas and saved comparison show them at 25% opacity in contained tiles arranged using natural aspect ratios. They indicate a rough grouping without cropping images or altering block geometry. Existing asset links without this flag remain hidden. Removing references, adding and replacing them all participate in autosave and undo.

**Auto snap** can be enabled or disabled, and its preference is remembered for the project in the browser. Dragged blocks align with page edges, safe margins, page centres and other blocks; axis-aligned resize handles also snap. Rotated moves use their physical bounds; rotated resizing remains free so the opposite edge stays stable. Hold Alt to suspend snapping for a gesture. Dashed alignment guides appear while snapping. Each page has an adjustable safe margin in millimetres, initially 10 mm. Dashed safe-area guides remain visible; crossing blocks receive a warning badge and an inspector notice, including crossings caused by rotation. Warnings permit intentional bleed and do not move the user's blocks. The page's safeMarginMm is saved with the layout and resolved brief; older pages load with the 10 mm default.

Page and block flexibility is explicit: fixed preserves geometry, guided allows improvements within the user's intent, and free permits recomposition while retaining required content. Content images and feedback images are stored separately, with gallery identity, image path, source document/page and description. Multiple feedback images are supported.

**Autosave** writes one user-facing `blockouts/<documentId>/<pageId>.blockout.json` file per page, containing that page's alternatives, through the existing revision-checked save endpoint. The catalog `blockouts/.documents.json` groups documents. Internal workspaces remain in `blockout/layout.json` for the first document and `blockouts/<documentId>/.workspace.json` for later documents. Recognized Blockout files receive visual preview and editing controls; unrelated JSON remains ordinary JSON. Internal brief/context and worker proposal files are hidden from the file list. Historical worker artifact cards open the visual Blockout view. Closing an edited workspace flushes pending edits; failed saves keep the editor open. A local recovery draft survives interruption, and a source comparison detects external changes before saving. This is a read-before-write conflict check, not an atomic lock against simultaneous writes. Reload the saved layout after an agent changes it.

There is no Save button. Changes debounce for 700 ms and writes run sequentially against the last returned source revision; further edits remain available during background writes. A visible footer distinguishes pending, saving, saved and failed states, with retry on failure. If saving fails, closing retains the editor and offers **Close, keep draft** after retaining a recovery draft in browser storage; the notice states that the project has not been updated. Navigation alone does not create a document edit. Saving never starts an agent.

The history menu beside Undo and Redo lists up to 200 reversible steps and supports jumping back or forward several operations. Consecutive typing in one field is grouped. Undo and Redo autosave their result. The bounded browser record restores after reopening only against the same saved revision; an external newer revision rejects it. This local action history is separate from durable project version history and Git.

The footer offers **Edita in chat** and **Passa al design**. **Edita in chat** flushes current edits and records `blockout/starting-point.json`, a readable `blockout/brief.md` and a versioned `.blockout-update.json` handoff. It opens a concise request with that single Blockout attachment in the existing chat draft. Geometry, feedback, flexibility and linked image metadata are included; image binaries and the whole gallery are not attached. The request asks Codex to revise the selected proposal while preserving the others. The user presses **Send** to start the agent. Save failures keep the editor and edits open and do not stage a request.

The existing question-form protocol accepts a target on the opening tag:

```html
<question-form id="figure-clarification" blockout-variant="brief" blockout-page="page-1" blockout-block="block-1">
{"questions":[{"id":"caption","label":"Which caption should accompany this figure?","type":"text"}]}
</question-form>
```

Omit `blockout-block` for a page question. The equivalent JSON field is `blockoutTarget: {variantId, pageId, blockId?}`. Real saved IDs are required. The same form opens in the inspector and the target receives a highlighted outline; no second question transport is introduced. Submission saves the answers, reference images, feedback and flexibility with the starting brief, then delegates to the existing form callback. Missing targets produce a visible notice rather than highlighting an unrelated block. Blockout question forms do not auto-submit after the general form timeout.

The default output is three editable structural alternatives and a comparison in `documents/<meaningful-document-name>/blockout-comparison.html`. Final HTML pages belong in the same document folder and carry purpose-based names such as `cover.html` or `project-experience.html`. Proposals share the paper format, page budget, intended functions and fixed constraints. They differ in reading order, grouping, visual hierarchy or text/figure balance. Structural previews use indicative rhythm and placeholders; user-added faint references are the explicit exception described above. Geometry checks do not establish content fit. A4 portrait is the stated fallback when no format is supplied.

## Material assessment compatibility

The following inventory and measured composition facilities remain supported for material-bound workspaces. They are not prerequisites for structural Blockout and do not authorize filling its placeholders with project content. Structural workspaces use `planningStage:"structure"`; material assessment belongs to subsequent composition or an explicitly material-bound workspace.

Before generation, the project material inventory reads full native source pages and exact paragraphs with their offsets, hashes and provenance, plus decoded image dimensions from the intake gallery or incoming images. It distinguishes document content from formatting rules and references. It does not start AI research or silently claim OCR coverage. During preparation, chat explains that the user must wait; the comparison shows preparation progress. Incomplete, changed or unreadable sources remain visible gaps. Selected material may be explicitly illustrative, but its exact volume must be inventoried before layout. The agent cannot fill pages by appending Lorem ipsum after choosing boxes.

Each document saves the inventory's `materialRevision` and its own selected `materialIds`. Each actual content block binds `contentIds` from that selection and records physical typography (`fontFamily`, `fontSizePt`, `lineHeight`, optional `paddingMm`). The shared assessment measures exact wrapped text using installed font metrics at the usable physical width; it checks real image proportions/resolution, rotated safe-area bounds, overlaps, overflow and union-based content density. Missing fonts or unsupported text shaping remain a limitation. It verifies that every alternative accounts for the same selected material once and compares grouping, reading order and relative hierarchy rather than names or margin nudges. Page count alone is not a fit result.

The UI and `od` CLI use the same material and assessment endpoints. Material readiness requires current inventory and geometry revisions; editing or changing sources invalidates the earlier result. Existing unbound Blockouts remain viewable and editable with an unverified notice. Warnings and blocked checks are shown for correction without preventing autosave. Neither an assessment nor a save approves a structure or starts graphic design.

Saving a material-bound workspace also creates its canonical comparison in `documents/<document-title>/blockout-comparison.html`. It renders measured text lines and the real source images, not agent-authored volume estimates. The saved response includes `comparisonPath` and the assessment; a previous unmeasured comparison is retained internally before replacement. A document revision fence prevents a slower old render from overwriting a newer layout's comparison. If preview creation fails after the layout commits, the response retains the successful saved revision and reports `comparisonError`, so the user can retry without losing edits or causing a false revision conflict.

```sh
od blockout inventory --project <project-id> --refresh --wait --json
od blockout assess --project <project-id> --document <document-id> --json
od blockout assess --project <project-id> --document <document-id> --prompt-file <path|-> --json
```

Inventory waiting is bounded; a timed-out wait returns its actual saved preparation status. The agent must continue waiting or explain a missing input rather than treating the elapsed time as readiness. Assessment accepts a saved layout or a complete unsaved document and does not persist client-reported scores.

## Approval and agent integration

**Passa al design** opens the existing question form beside the highlighted page. The question explains that approval covers the selected proposal and all its pages, including current edits. Explicit acceptance saves that variant's approval and opens a graphic-design request in the chat draft; the user still presses **Send** to begin generation. Revising keeps the document in Blockout. Selecting a different proposal closes the confirmation and does not approve that proposal. After approval, the editor remains available; edits mark the structure as needing readaptation, and the same **Passa al design** action can hand the updated structure back to Design mode after confirmation. These actions do not send messages automatically.

Native parallel agents may produce the alternatives in separate files when that runtime supports them. The coordinating agent integrates the results into new editable variants. Runtimes without that capability generate the proposals sequentially and must say so. This version uses the existing runtime's agent orchestration and does not add a dedicated concurrency scheduler. Existing HTML comparisons are not automatically reverse-engineered into editable blocks; the shared mode prompt asks agents to save the matching JSON layout alongside them.

The engineer owns the text, data, technical meaning and decisions. The mode preserves those inputs and confines its work to graphical structure. Missing material is labeled as missing, rather than filled with invented engineering content. It does not uninstall or filter the personal skill catalogue.

The existing API and CLI use the same conversation mode:

```sh
od chat new --project <project-id> --title "Page structure studies" --mode blockout --json
od run start --project <project-id> --conversation <returned-chat-id> --prompt-file <path|-> --json
```

Use the returned conversation ID for the existing run command; long prompts use its `--prompt-file <path|->` option. At the API boundary, set `sessionMode: "blockout"` when creating or patching a conversation, or for a run override. Returning to visual design uses `sessionMode: "design"` after acceptance. Existing `od files list/read/write` commands use the same project-file endpoints as the editor. Write document workspaces and per-page files, including approval and readaptation state, with `od files write <projectId> <path> --json` consuming JSON from stdin. Generation and readaptation requests use `od run start --prompt-file <path|-> --json`.

The canonical instructions live in `packages/contracts/src/prompts/blockout-mode.ts`. Both legacy composers (daemon classic/slim and API/BYOK) and the OD Next stable request context consume the same directive. Mode values also pass through persisted conversation/message metadata, forks, run creation and OD Next task-input snapshots.

The existing CLI also exposes the saved editor document and versioned handoff through the same endpoints:

```sh
od blockout show --project <project-id> --document <document-id> --json
od blockout save --project <project-id> --document <document-id> --prompt-file <path|-> --json
od blockout brief --project <project-id> --document <document-id> --prompt-file <path|-> --json
```

`save` accepts `{document,baseRaw}`. `brief` accepts `{document,baseRaw,action:"request-proposals"|"develop-design"|"update-design"}`. A block’s `images` metadata and explicit `referencePreview` flag round-trip through both surfaces. UI-only gesture history is stored in the browser; durable versions remain available through project history in both UI and CLI.

Designed documents retain a semantic composition through `od blockout design-record --project <id> --document <id> --prompt-file <path|-> --json`. The payload identifies the handoff, current `OD_RUN_ID`, entry HTML, each stable page ID, and the measured conceptual block bounds. Decorative layers need no mapping. `od blockout design` returns the applied/pending state; `od blockout design-page --page <id>` returns the saved page reference. All three commands use the same `/blockout-documents/:documentId/design` API as the editor.

Only successful, validated runs promote a registered result. Saving edits or preparing a chat draft never does. Post-design requests contain the applied composition, new target and stable-ID differences, and stay in Design mode. The editor shows an inert, faint design reference with a hide/show toggle. It hides references when source dependencies have changed. Its preview entry opens the page currently visible in the isolated iframe. Newer user edits survive a completed generation.

State and page-reference reads never rewrite the editable workspace. An open editor adopts measured bounds only while its latest local composition still matches the submitted request, then saves through the normal revision-checked queue with undo history. This protects both saved and unsaved edits made during generation. An approved composition without an applied design shows its missing, pending or unsuccessful registration state explicitly. Each mapped page must carry its stable document and page IDs together, and the entry HTML must identify the document.

`page.backgroundIntent` carries page-wide art direction. Filigrane, watermarks, backgrounds and decorative layers may cross or bleed behind several content blocks; the rectangles are semantic guidance, not clipping boundaries. Explicit fixed constraints remain constraints. Guided/free flexibility leave room to improve the graphic result. Existing designs without a registered composition are not represented as verified applied designs.
