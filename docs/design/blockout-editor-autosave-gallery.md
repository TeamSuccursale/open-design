# Blockout editor: autosave, reversible edits and gallery references

The engineer can manipulate rough blocks without managing Save or accidentally asking for graphic work. Autosave writes through the existing revision-checked document endpoint; undo and redo remain available after a successful write. The history menu sits beside those arrows and supports rolling back several operations. Consecutive typing in one field is grouped. Browser history is bounded and restores only against the same saved document revision; project history remains the durable version store.

## Direction contract

THESIS: direct manipulation with visible persistence and reversible operations. Preserve the existing three-column page editor and its warm canvas; remove the competing Save workflow.

OWN-WORLD: retain studio paper, muted green controls, existing typography and component primitives. The drawing and its selection outline lead; status and history recede into the toolbar and footer.

STORY: select a block, describe or arrange it, optionally browse Galleria beside the canvas, and drop visual references. Repeated drops ask Sostituisci or Aggiungi. Two footer actions hand the saved structure to chat or explicitly approve moving to design.

FIRST VIEWPORT: page list left, canvas centre, inspector or gallery drawer right. Undo, redo and history share one toolbar group. No Save button. Autosave status remains visible. The gallery never covers the page.

FORM: extend the incumbent Operate surface. Faint image tiles use contained natural proportions and suggest a grouping without fixing a final crop. Existing material bindings stay hidden unless the user explicitly requests a reference preview.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Validation

Focused coverage must include overlapping autosaves, a failed write and retry, close-time flush, undo/redo after a save and after reopening, stale revision rejection, chat handoff with current edits and references, explicit design approval, drag/drop and keyboard image selection, add versus replace, search/pagination and mixed-ratio contained previews. Both the UI and existing CLI document writes use the shared schema and endpoints. Only linked asset metadata enters the Blockout handoff; no gallery-wide image attachment is added.

## Incumbent system check

Compared the workspace, gallery drawer and material preview with `apps/web/src/styles/tokens.css`, `base.css`, and the surrounding Blockout page navigation, readiness and artifact-card components. The extension preserves the warm studio canvas and paper, muted green selection, inherited Albert Sans typography, shared `@open-design/components` controls and existing icon vocabulary. History uses the same paper surface; autosave remains subordinate to the drawing. Reference previews retain natural proportions at 25% opacity and load the existing project images, so this change introduces no new raster artwork.

The saved light-theme captures in `.impeccable/review/blockout-autosave-gallery-2026-10-26/` (`desktop.png`, `user-1920.png`, `mobile.png`) show the gallery beside the desktop canvas and below it on mobile. The mobile capture shows Add/Replace above the visible selected block. This check covers those editor views and the inspected implementation; it does not establish a dark-theme or wider onboarding audit.

No design-system change was necessary. Existing tokens and system files remain intact. One pre-existing documentation mismatch remains: the direction contract's finish sentence calls for `DESIGN.md`, while root `DESIGN.md` and `.impeccable/design.json` are absent. Their absence does not justify reconstructing the established identity during this scoped extension; it is recorded here without repair.
