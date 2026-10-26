# Blockout autosave and gallery references — 26 October 2026

This delivery replaces manual saving in the Blockout editor with autosave and a reversible action history. It adds the requested gallery drawer and faint, proportion-aware visual references. The existing studio layout and explicit approval before design remain in place.

## Delivered behavior

- Edits autosave after 700 ms. Writes are serialized, newer edits remain available during a background save, closing flushes the latest edit, and failed writes retain the recovery draft with a retry action.
- Undo, Redo and the history menu share one toolbar group. Up to 200 operations are reversible; consecutive field typing is grouped. A bounded browser record can survive reopening against the same saved revision. Durable project history remains separate.
- **Edita in chat** saves current edits and opens a draft with one versioned Blockout update, including geometry, intentions, feedback and linked reference metadata. It does not attach all gallery images or start a model run.
- **Passa al design** opens explicit approval for the whole selected proposal. Acceptance saves the approved structure and prepares the design request in chat; Send still starts the run.
- **Galleria** supports search, source filtering, pagination, multiselect and drag/drop. The keyboard alternative applies selected images to the selected block. Further drops on an occupied block ask **Sostituisci** or **Aggiungi**. Unknown asset IDs are rejected; geometry is preserved.
- Explicit user-linked references appear at 25% opacity in contained tiles. Natural proportions determine efficient row or column groupings. Legacy image bindings remain hidden unless `referencePreview:true` is explicitly set. The agent is instructed to preserve these rough references without filling other Blockout placeholders with project content.
- Narrow toolbars wrap without horizontal clipping. Opening Add/Replace focuses its first action and scrolls the choice into view; Escape cancels it.

## Validation

49 focused web tests passed across workspace, autosave/gallery, overview, structural presentation and the Fast parent/editor integration. Coverage includes overlapping saves, failure/retry, close-time flushing, saved history, external revision rejection, stale completions from a prior document, add/replace/undo, current metadata in chat handoff and gallery browsing. The final report is `.tmp/verification/blockout-autosave-gallery-web-final.json`.

21 focused contract tests passed for Blockout mode, structure, handoff and proportion-aware tiles. Fourteen daemon comparison tests and two daemon prompt-composer tests passed. Web typecheck, contracts build and daemon build passed. The scoped Impeccable detector produced no findings; it ran once, before the review fix batch.

In Chrome, the existing N4 test project was opened directly in its page editor. A native drag added the first reference; a second native drag opened Add/Replace, and Add saved two references. Undo/Redo changed the references and autosaved; closing and reopening preserved both references and the history menu. Edita in chat prepared a single Blockout attachment and current request without starting a run. Passa al design displayed the explicit approval question; approval was not submitted during this live check.

The real `od blockout show --json` command read the same saved result from the daemon: three proposals of three pages each, two explicit references on the edited proposal, and no references added to the other proposals. The CLI proof is `.tmp/verification/blockout-autosave-gallery-live-cli.json`.

Desktop 1440×900, actual viewport 1920×944 and narrow 390×844 captures are stored in `.impeccable/review/blockout-autosave-gallery-2026-10-26/`. Mobile Add/Replace was verified with focus on Sostituisci and its bounds inside the viewport. A development refresh temporarily closed the modal; reopening recovered the saved changes.

## Review and scope

The fresh finish reviewer identified two P2 defects: a stale save response could change the newly loaded document’s revision, and the mobile Add/Replace choice could appear above the scrolled gallery. Both received narrow repairs and regression coverage. The reviewer scored both findings resolved and returned **ship** for that fix list. The review and its final verdict are recorded in `blockout-autosave-gallery-finish-review-2026-10-26.md`.

This is a scoped editor verification. It does not claim a new blind onboarding round, a new Codex generation, a complete application audit, or full-suite validation. The application’s existing project history remains the durable version store; browser undo is bounded and local. No Git repository or permission setting was changed.

The daemon had been built and restarted earlier with the gallery reference schema and comparison renderer, and live Chrome/CLI checks used that running service. A final daemon-only refresh after the last shared brief wording change was rejected by command policy with “blocked by policy”; no retry or permission change was made. The existing preview remained running. This last wording change is built on disk; this report does not claim the cached service module was reloaded by that rejected action.
