disposition: fix

## Disposition

Fix one persistence fence and one mobile interaction before shipping. The desktop extension preserves the existing editor and meets the requested visual direction; it does not need a redesign or new artwork.

## Scope and evidence

Reviewed the autosave/gallery direction contract, PRODUCT.md, the craft floor, primary workspace/gallery/canvas/history code, shared image schema and proportion-aware tiling, comparison rendering, and focused integration-test source. Opened all required captures: `desktop.png` (1440 × 900), `mobile.png` (390 × 844), and `user-1920.png` (1920 × 944) under `.impeccable/review/blockout-autosave-gallery-2026-10-26/`. All three are valid and show the intended editor. The supplied detector file contains `[]`.

The packet reports 48 web integration, 21 contracts, and 14 comparison tests passing, successful web typecheck/contracts and daemon builds, and native Chrome verification of first/second drops, Add, undo/redo persistence, reopening, and staged chat handoff. These are supplied execution results, not independent reruns.

## Requirement assessment

| Requirement | Assessment |
| --- | --- |
| Remove Save; autosave with visible persistence and recovery | Present. Serialized revision-checked writes, retry, recovery draft, and close-time flush are implemented. |
| Undo/redo and a long history menu beside them | Present. Multiple-step rollback and revision-bound browser history are implemented. |
| Footer Edita in chat / Passa al design | Present. Chat stages one saved Blockout handoff; design opens explicit approval. |
| Gallery browsing, search, multiselect and dragging | Present. Search/source filtering, pagination, retained selections and a button alternative to dragging are implemented. |
| First references faint; subsequent references Add/Replace | Present on desktop. The mobile button path has the finding below. |
| Natural proportions and contained rough groupings | Present. Shared row/column scoring uses natural ratios; both UI and comparison contain images at faint opacity. |
| Type / material / ground | Match the incumbent Operate direction: existing compact studio typography, functional vector geometry and real reference thumbnails, warm paper with muted green controls. No physical material imitation or comp-led asset obligation. |
| Responsive extension | Desktop hierarchy is intact. Mobile controls wrap and the gallery follows the canvas in the scrolling editor body, as declared. |

## Material findings

1. **P2 — Fence late save responses before changing the active revision.** In `BlockoutWorkspace.tsx`, `persist` assigns `baseRaw.current = await saveBlockout(...)` before checking whether its load generation is still current. A document switch outside `chooseDocument`'s flush path, such as a new `question.target.documentId`, can load a different document while the older background save is pending. Its late response then replaces the new document's base revision and causes a false conflict on the next write. Await into a local `savedRaw`, reject a stale generation, and only then assign `baseRaw.current`. Verify with a deferred save response that resolves after the next document loads; the next document must save against its own revision.

2. **P2 — Reveal the mobile Add/Replace choice.** With an already populated block selected, scroll down into the mobile gallery, select another image, and press **Usa le immagini selezionate**. `BlockoutWorkspace.tsx:450` opens the pending choice through `dropImages`, but `BlockoutCanvas.tsx:94` renders it at the top of the canvas column. The mobile layout places that column above the gallery (`BlockoutWorkspace.module.css:440`), and this path neither moves focus nor scrolls the choice into view. The gallery button therefore appears to do nothing until the user scrolls back up. Add a ref/effect for a newly pending choice that focuses its first action and scrolls the choice into the editor viewport, or render the choice inline in the mobile gallery footer. Confirm the already-populated-block path at 390 px and verify that selecting Add/Replace remains keyboard reachable.

## Retained limitations

This is a read-only screenshot/code review of this extension. No browser session, test rerun, new Codex generation, or design approval was performed. The red Next development icon is outside editor ownership. No approved comp, QUALITY BAR card, or shipping raster artwork applies to this narrow extension. Keep the warm studio editor, visible autosave, reversible operations, contained faint references, and explicit design approval while fixing the mobile choice.

## Verdict pass — 26 October 2026

This pass scores only the two original P2 findings. Reopened all three required recaptures; each remains valid.

| Finding | Verdict | Evidence |
| --- | --- | --- |
| Fence late save responses | **Resolved** | `persist` now awaits a local `savedRaw`, checks the load generation, and only then assigns `baseRaw.current`. The regression defers an old-project save until the next project has loaded and verifies that its subsequent write uses `other-project-base`. The supplied final test JSON records all 49 focused web tests passing. |
| Reveal mobile Add/Replace | **Resolved** | The 390 × 844 recapture visibly shows Sostituisci and Aggiungi in the editor viewport. The pending-choice effect focuses the first enabled action and scrolls the choice into view; the focused Replace assertion passes in the supplied results. Escape cancels the choice and focus restoration is implemented. |

Remaining: clear for these two findings. No regression introduced by this fix batch is visible in the recaptures or scoped code. This verdict approves the scored fixes; it is not a new whole-surface audit. No second detector, browser execution, or independent test rerun was performed in this reviewer pass.

Final disposition: ship
