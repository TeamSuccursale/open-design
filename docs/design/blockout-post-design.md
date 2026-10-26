# Revising composition after design

Mode: Operate. Extend the existing Blockout editor and preview toolbar; preserve the current studio palette, type, controls, autosave, history and gallery.

The user opens “Modifica composizione” from a designed document. The current page opens as semantic blocks over a faint, noninteractive rendering of the applied design. A checkbox hides the rendering. Edits autosave as a pending composition, without altering finished HTML. “Edita in chat” and “Aggiorna il design” prepare a single versioned request in Design mode; the user sends it through the existing chat.

The request contains the last successful realized composition, the revised target, stable-ID changes, page/block feedback and flexibility, and the exact designed files. The baseline advances only after the registered run succeeds with a valid deliverable. Later user edits survive that run. Missing registration and externally changed design files remain visible states, not implicit proof that a design matches its blockout.

Blocks express content hierarchy, not mandatory clipping containers. Page-wide background intent covers watermarks, textures and decorative layers. Those elements need no block, may cross content boundaries, and remain subject to readability and the engineer’s explicit constraints. Guided and free flexibility give the model room to improve the composition.

Validation: contract parsing and handoff diff tests; daemon tests for successful/failed/pending/stale receipts and protected later edits; CLI parity; editor tests for Design-mode handoff, background intent and underlay toggle; preview action targets the visible page; bounded desktop/mobile browser inspection and independent finish review. Native model execution is reported separately from fixture verification.

## Incumbent system check

Compared the finished editor with `apps/web/src/styles/tokens.css`, `base.css`, the existing Blockout workspace and inspector, shared `@open-design/components` controls, and the preview composition action. The extension retains the warm studio canvas and paper, muted green selection, inherited Albert Sans typography, compact controls, page navigation, autosave and history. The applied HTML appears at 26% opacity behind the semantic blocks, with pointer interaction and keyboard focus disabled. The guide toggle and page-wide background field use the existing control vocabulary.

The final light-theme captures in `.impeccable/review/blockout-post-design-2026-10-26/` show page 3 selected at desktop and mobile sizes. Desktop retains the page list, central paper and docked inspector; mobile wraps the toolbar and presents page navigation above the paper, with persistence status and both chat actions in the footer. The Next.js development badge partially overlaps the lower-right action in the captures. `handoff-staged.png` shows the closed editor and one unsent Blockout update attachment. These captures are prominently labelled synthetic evidence. They establish the inspected UI state and staging behavior; the separate native Codex run failed before output.

No new visual identity, tokens or shipping raster artwork was introduced. The guide reuses registered project HTML; the PNG files are QA screenshots. Root `DESIGN.md` and `.impeccable/design.json` remain pre-existing omissions, recorded without reconstructing the incumbent system during this ordinary Operate extension. The verification record is `docs/verification/blockout-post-design-2026-10-26.md`.
