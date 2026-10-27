# MelilloDesign development diary

This diary explains what changed, why it changed, and what evidence supports it. It accompanies real Git commits; it does not replace them or invent a finer history than the repository contains. Start with the [current checkpoint](checkpoints/2026-10-26.md) for the overall state and the [UI/UX roadmap](../specs/current/melillodesign-ui-ux-testing-roadmap.md) for the next work.

## Actual commit ledger

| Commit | Recorded date | Contents |
| --- | --- | --- |
| `e03d5c2` | 22 October 2026, upstream commit date | Visible upstream OpenDesign baseline; this is not a MelilloDesign feature commit. The local checkout is shallow, so this ledger does not purport to list upstream history. |
| `3777d1e2a00127840fbafa2d8e7a7654cab6703b` | 23 October 2026 | `docs: record project document workspace requirements`. Early requirements checkpoint. |
| `71e48b9454db58219ee4eff279ef3c0f9c217090` | 26 October 2026 | `feat: checkpoint MelilloDesign document and composition workspace`. Accumulated app, contracts, UI/CLI, tests and existing reports captured together: 664 files. |
| Documentation commit following `71e48b9` | 26 October 2026 | `docs: add development diary and UI UX testing roadmap`. Includes this diary, the state checkpoint, the testing roadmap and updated product pointers. The annotated tag `melillodesign-checkpoint-2026-10-26` resolves to this complete checkpoint; use `git rev-parse melillodesign-checkpoint-2026-10-26^{commit}` for its exact commit. |

There were no separate feature commits for each of the sessions below before `71e48b9`. The dates describe recorded development and verification activity, not backdated commits. Future entries should cite their actual implementation commit and preserve failures as well as successful reruns.

## Initial foundation — captured in `71e48b9`

The fork became MelilloDesign, with a Codex-first connection path and architectural onboarding imagery. Local PDF processing and a gallery were added so an engineer could reuse photographs, figures, charts and tables from project documents. Folder/CLI intake and UI uploads share the catalog and provenance. Raster pages use page analysis followed by crop analysis; SVG derivatives retain links to their originals.

The scope then expanded into named projects and documents, preparation in chat, structural page proposals and a persistent composition editor. Several early iterations mixed setup forms, raw files, comparison, editing and approval. The later direction separates those steps: a Blockout expresses page structure through functional blocks; the engineer selects a proposal, edits it, and explicitly proceeds to design. Actual project images are optional references at this stage.

The [product record](../PRODUCT.md), [document workflow](../specs/current/melillodesign-document-workflow.md), [Blockout guide](blockout-mode.md), [Fast guide](fast-project.md) and [intake guide](project-intake.md) describe this foundation. Their feature work was accumulated before the code checkpoint; exact per-feature commit dates are unavailable.

## 24 October — recurring graphics, project history and usability failures

Header/footer work added grouped editorial questions, logo files/ZIPs and online acquisition, a dedicated structural editor, actual graphic approval, project-level reuse and linked updates. Recorded live examples included an eight-page portrait A4 report and a four-page landscape A3 graphic booklet sharing recurring graphics. Independent copies and shared-version restoration were exercised. See the [header/footer report](verification/melillodesign-header-footer-2026-10-24.md).

Private project history added recoverable saves, meaningful commits after 45 active minutes or once after ten idle minutes, comparison and guarded restoration. A separate two-hour active / 30-minute idle schedule produces read-only organization reviews. It does not modify an existing project Git repository. Controlled-clock, filesystem, HTTP/CLI and panel checks are recorded in the [history specification](../specs/current/melillodesign-project-history.md).

Blind reviews exposed real uncertainty and failures: document identity, logos versus upload receipts, waiting states, the difference between choosing and approving, variant behavior and Fast parent/child delivery validation. Some journeys failed before later diagnostic continuations. The [evidence audit](verification/melillodesign-blind-evidence-audit-2026-10-24.md) and [strict blind report](verification/melillodesign-repairs-and-strict-blind-2026-10-24.md) retain those distinctions. An agent successfully producing a review was never sufficient evidence that the product passed its task.

## 25 October — repair loading, exact ownership and action feedback

The next repair pass tightened current-run artifact validation, registered document ownership and path normalization; improved waiting and submission feedback; distinguished uploaded logo material from an applied logo design; and made additional variants preserve the original and use a direct request. Comparison views gained a terminal-run refresh even when the HTML revision had not changed.

Native Normal and Fast journeys exercised page-three modal opening, editing, persistence and new alternatives. Their limitations remain material: Fast used a diagnostic Retry; a Normal service interruption needed the visible resume action. Neither was an uninterrupted latest-build cold pass. See [focused fixes and recorded runs](verification/melillodesign-focused-fixes-2026-10-25.md).

## 26 October — autosave and references in the Blockout editor

Manual Save was removed in favor of serialized autosave, recoverable failed writes, close-time flushing, undo/redo and a longer action-history menu. The gallery drawer gained rough image references with faint previews, Add/Replace behavior and natural-ratio grouping. “Edita in chat” stages the saved structural handoff; “Passa al design” uses the explicit design-approval path.

A finish review found a late-save race across document switches and a mobile Add/Replace choice outside the user's view. Both received focused repairs. The final review accepted its scored fixes; it did not certify every editor or onboarding interaction. See the [implementation evidence](verification/melillodesign-autosave-gallery-2026-10-26.md) and [finish review](verification/blockout-autosave-gallery-finish-review-2026-10-26.md).

## 26 October — composition editing after design

The editor gained the finished page as an optional faint guide and a durable before/after handoff for composition changes. Page-wide backgrounds and watermarks stay independent of the content-block geometry. A real Codex update moved and narrowed a text block while preserving its text and the other pages. Earlier synthetic fixtures remain identified as synthetic in the [post-design report](verification/blockout-post-design-2026-10-26.md).

Later live Normal and Fast creation-to-design journeys repaired preview refresh, child-document handoff ownership and terminal delivery registration. The Normal preview updated automatically after the composition change. Fast's canonical result was correct, but an incidental `-v2.html` companion opened automatically and the operator selected the canonical tab. That remaining continuity risk is retained in the [composition closeout](verification/composition-closeout-2026-10-26.md), rather than counted as a seamless Fast pass.

## 26 October — native Claude connector hardening

Codex remained the default. Claude regained a native CLI choice with model-scoped effort, explicit unsupported-model errors, a startup deadline armed before stdin delivery, one bounded transport retry for a silent no-effect attempt, terminal exit grace, actionable-progress monitoring and bounded context-compaction recovery. Windows argument handling and `od run start --follow` completion were repaired.

Real native tests covered file writes, a question and answer, stopping a running request, a naturally exiting CLI follow, and retained context after compaction. These establish connector behavior, not a complete Claude document-production pass. The optional upstream Cloud gateway report concerns a separate route and is not evidence that the local subscription path failed. See the [connector hardening report](verification/claude-connector-hardening-2026-10-26.md).

## 26 October — source checkpoint and next testing work

`71e48b9` captures the accumulated implementation in one coherent baseline. Repository guard, repository typecheck and the staged whitespace check passed. Six whitespace-only defects in newly staged files were cleaned up. No full daemon/web suite or new live usability journey was run for this checkpoint. Runtime projects, credentials, tender PDFs and generated test/browser proof remain outside source Git.

The follow-up documentation commit records the [state](checkpoints/2026-10-26.md) and [test queue](../specs/current/melillodesign-ui-ux-testing-roadmap.md). The next pass should first close automatic-preview and loading/duplicate risks, then rerun the two-document case and use genuinely fresh blind readers in Normal and Fast modes. More explanatory copy alone does not count as resolving an interaction problem.

## 26 October — agent-guided header/footer and the two-document run (uncommitted)

Header and footer no longer use a numbered wizard. The chat collects the inputs. The agent composes one design with a variant for every waiting document, and the editor opens on that proposal; one approval applies it to every document in scope. The operator-driven live run then went through the page Blockout and two agent edits. It took 20 min 35 s from confirming the brief to both comparisons, 15 min of it in production; Blockout speed is the next problem.

Defects found live and fixed with red-first tests:

- A3 validation was checked against the A4 strip.
- A queued Blockout request was reported as not sent.
- A Windows `EPERM` on the Blockout catalogue rename, now retried.

Defects found by fresh blind readers and fixed:

- J1: the absent header read as an incomplete proposal (failed at step 3; not retested blind).
- J2: the date was printed in ISO form; the document switch left the editor; the apply label named the header while it was off; the notice suggested a separate page update.

J3, a Blockout change through the agent, passed with one facilitator confound recorded. J2, the date in both documents' footer, passed unaided.

Checks: guard, typecheck, focused contracts, web and daemon tests. Full suites were not run. Pages applied before the date fix keep the ISO date until the footer is re-applied. See the [verification report](verification/header-footer-agent-guided-2026-10-26.md).

## 26 October — Blockout follow-ups after the rerun (uncommitted)

Accepting the brief confirmation now shows the Blockout request about 3 s after the click, down from 24 s. The confirm had been writing each Blockout file as its own project-history entry, and Git ran for every one. A save and a seed are now one entry each, and unchanged history trees are reused. While it works, the form says "Registro il brief e preparo le pagine…".

- The OD Next planning rules now give way to the confirmed-brief gate, in the same words on every path.
- Appended alternatives are fitted to the footer area like saves.
- A save without its base revision says where to get it.
- The prompt and help say a save already takes the footer reserve.
- Project history works on deep Windows data folders, and explains the case Git cannot handle.

Checks: guard, typecheck, focused contracts, web and daemon tests, all new tests red first. The remaining failures match the base. The timing was checked live in the browser, operator-driven. See "Follow-ups fixed the same evening" in the [verification report](verification/header-footer-agent-guided-2026-10-26.md).

## 27 October — night pass on the team test roadmap

The coding agent worked through the [team test roadmap](../specs/current/melillodesign-team-test-roadmap.md) unattended, one local commit per item (`cd0cfefa` to the end of the night; none pushed). Two full flow runs, operator-driven and not blind, took a two-document project from a new project to its PDFs and recorded every slow, unclear or wrong step. A third, short run checked the first turns live on the final build.

- **Install and update.** Codex is found on Windows without `CODEX_BIN`. `MelilloDesign.cmd` gained `doctor`, `install` and `update`, and About shows the build. `doctor` and the start command warn when the disk has less than 5 GB free: the disk filled up during run 2 and stopped the daemon.
- **Speed.** The launcher serves the production web build: 4.2 s to a usable project page instead of 25.6 s. The history rescan no longer starts one Git process per file: 0.3 s instead of 6.8 s. In run 2 the Blockout took 7 min 04 s against 10 min 41 s, and the report's design 11 min 52 s against 14 min.
- **PDF.** A designed document exports from the button or `od export` as a vector PDF with each page at its own paper size, using the PC's Edge or Chrome.
- **Clarity.** The changes and their commits are listed in the [night report](verification/melillodesign-night-pass-2026-10-27.md). They include errors now in Italian, labels that say what a button does, internal files kept out of the run outputs, and a survey that no longer asks for answers nothing records.
- **Prompts.** The agent asks the region contents together with the yes/no questions, talks about the document rather than the machinery, uses the structure names shown on screen, and asks every document's choices in one form. In run 3 the engineer answered one form where run 2 needed three; the agent's working time was about the same.

Checks: focused tests for each change, all new tests red first; web, daemon, contracts and tools-dev typechecks; guard. Full suites were not run. Pre-existing failures that also occur on the base: the brand-string tests that expect "Open Design", three locale-parity tests, two `files upload` CLI tests, seven execution-record tests in `AssistantMessage` and four `ProjectView` reattach-fold tests. Still open: R5, the clean-machine rehearsal, which is the developer's; a person's page-by-page check of the PDFs at 100%; and the decisions listed in the night report.

## 27 October — morning follow-up

The developer approved six findings from the night report, and each became a local commit with a test that failed first (`f712fcbe` to `08d9365f`, none pushed). The rail, the panel tips and the error card no longer point to the upstream project; «Contattaci» opens the team developer's issues. A new project is one screen with one button. While a turn runs, the collapsed header repeats the agent's latest sentence or the step under way (D54). A history save starts four Git processes whatever it saves, which took the Blockout seed from 2.6 s to 0.7 s on a copy of run 3; about 5 s of run 3's 20 s wait is still unexplained. «Pagina {pageNumber} di {totalPages}» is one text block, so the numbering prints as one phrase. A designed block more than 1 mm past the page margin is refused at registration, with the block, page, side and millimetres in the message.

Checks: focused tests for each change, red first; web, daemon and contracts typechecks; guard and repository typecheck at the end. The chat suites' 100 pre-existing failures and the system-prompt matrix snapshot, already about 11,000 characters off, were compared against the base and are unchanged by these commits. Details and commits are in the [night report](verification/melillodesign-night-pass-2026-10-27.md#morning-follow-up).

## 27 October — rule check before export (E2)

A designed document is now checked against the rules its setup saved before it goes to PDF (`7e12dfa9`, `3298fbf4`, `caead56f`, `8da82389`, `bca4c9c9`; none pushed). The daemon opens the document in the same Edge or Chrome that prints it, with the same print preparation. A measuring script reports each page's paper size, the type sizes in points and the content nearest each edge. The contracts then compare that with the document's rules: page count against the limit (a cover the editorial choices exclude does not count), paper, orientation, smallest type and margins. Each rule is quoted with its source file and page. Where the tender states no margin, the Blockout's safe margin applies. A rule with no measurable value shows what was measured and stays unchecked. The check only warns. «Esporta in PDF» on a designed document opens it first, and its export button works at once. `od export check <file> --project <id> [--json]` prints the same rows and exits 0.

Checked live, operator-driven, on a separate runtime with its own data folder that opened run 2's and run 3's folders. On run 2 both the dialog and the CLI flagged the A3 plate that the night pass found by eye: 13.4 mm from the right edge against 24 mm, «Dettaglio inferiore». Run 2's report passed every row. Run 3's booklet, redesigned that morning with a watermark, first showed the watermark as content 21.5 mm from the bottom of every page. Faded content marked `aria-hidden` now counts as background (`8da82389`). The same live pass changed the dialog (`bca4c9c9`). The summary now names the rows to look at. Failures are worded in Italian, without the daemon's technical text. A finding tied to no block says what it is. A measurement now gives up after 60 s: once, while the project's background reading was running, the dialog had waited the print's full 120 s.

Checks: contracts, daemon and web tests for the check, all red first; the neighbouring export tests; daemon, web and contracts typechecks; guard and repository typecheck at the end. Not done: a person exporting a PDF through the dialog. The FileViewer test clicks its button, and the export behind it is unchanged.

## 27 October — design iteration after the Blockout

Operator-driven, on run 3's «Fascicolo grafico B» (four A3 plates), with Codex on the production runtime. Two rounds of chat changes followed the first design, which had left every content area as a placeholder. In the first round the agent traced the walkway's axonometric view into SVG from a raster image inside the ANF PDF. It compared the tracing with the source and placed it as a light watermark behind all four plates, clear of header and footer (20 min). In the second round it filled three plates (13 min): two ANF details with captions, a five-phase SVG process diagram, and a bar chart with a table and source. The chart's figures match table 9 on page 37, including the decision not to draw chapter D as zero. Open points are in the [report](verification/melillodesign-design-iteration-2026-10-27.md): the watermark competes with the chart and table, and one gallery crop has a solid black square. The first round was marked failed by a test daemon from a parallel session. That daemon started on the production data root because `.env.local` overrode its explicit `OD_DATA_DIR`, and its restart recovery failed the live run.

One fix (`ca820475`): on a 1280 px window the composition button pushed zoom and four tools off the viewer toolbar. Below a 960 px viewer it is now an icon with a tooltip. The white preview seen after runs comes from the test browser blocking sandboxed frames; headless Edge renders the same frame. On a copy of run 3 a Blockout save took 0.2–1.2 s with history on, so the 15 s waits come from queuing, not from the writes.

Checks: the composition action's test, red first; headless Edge screenshots of every plate; guard and repository typecheck at the end. Not done: the toolbar fix seen live, because restarting the production web would have rebuilt the daemon from another session's uncommitted source.

## Updating this diary

For each subsequent meaningful commit, append its date and SHA, the user-visible change, the focused checks actually run, and any remaining failure or untested boundary. Link its detailed report instead of repeating raw logs. Record whether a walkthrough was operator-driven, blind, or synthetic, and identify any rescue action. Keep historical failures intact; link the later repair and fresh proof that supersede them.
