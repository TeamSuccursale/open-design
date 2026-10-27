# MelilloDesign team test roadmap

Baseline: `0a8ff89e` on `codex/project-workspace`, 27 October 2026. This roadmap orders the work needed before a small group of engineers uses MelilloDesign on real documents. The acceptance scenarios and the blind-testing protocol stay in the [UI/UX testing roadmap](melillodesign-ui-ux-testing-roadmap.md); this file decides what has to be true before the hand-over and in what order.

The goal of the first round is that each engineer takes one real document from a new project to a PDF they would be willing to send, on their own PC, without the developer stepping in.

## Settled for this round

- The developer installs each engineer's PC the first time.
- Engineers have Git access to the fork and receive updates by pulling.
- Engineers decide which project documents go to the model. Sending them through Codex is accepted.

## Order of work

| Phase | Goal | Exit condition |
| --- | --- | --- |
| 1 | A PC can be set up from the guide and kept up to date | A machine that has never run the app reaches its first project from the guide alone, and an update is one command |
| 2 | The defects that cost testers' trust are gone | Each fix has a test that went red first, and the affected step was rerun in the browser |
| 3 | The engineer gets a PDF they could send | A two-document project exports A4 and A3 PDFs that pass a page-by-page inspection at 100% |
| 4 | The engineer's own text survives, including late changes | A real Word draft reaches the PDF unchanged, and a later text edit updates only the pages it touches |
| 5 | A frozen build passes acceptance | Blind Normal and Fast runs and the developer's own real-document run pass on the tagged build |
| 6 | First round with engineers | Every engineer produces one real PDF, and their reports name the build they used |

Phases 2, 3 and 4 can overlap. Phase 5 starts only when they are done, because the blind runs need a build that no longer changes.

Sizes are rough estimates of combined agent and developer time: **S** up to half a day, **M** one to two days, **L** three days or more.

## Phase 1 — Install and update

| ID | Work | Done when | Size |
| --- | --- | --- | --- |
| R1 | **Find Codex on Windows by itself.** The Codex app keeps its CLI in a per-version folder under `%LOCALAPPDATA%\OpenAI\Codex\bin` and does not put it on PATH. The daemon looks for the app's own CLI only on macOS (`codexAppBundleCandidates` in `apps/daemon/src/runtimes/executables.ts`), so today every Windows PC needs `CODEX_BIN` pinned by hand, and the pin breaks at the next Codex update. | Detection picks the newest working build in that folder; a red-first test covers it; a fresh PC connects without touching Settings. **Done:** `cd0cfefa`. With no `CODEX_BIN` and no Codex folder on PATH the daemon found the app's CLI, the connection test passed and a real run executed a command. The fresh-PC half belongs to R5. | S |
| R2 | **Setup check.** `MelilloDesign.cmd doctor` verifies what the launcher and the daemon assume: the Codex runtime with Node 24, pnpm and Python; the PDF packages in `apps/daemon/pdf-intake/requirements.txt`; Visual Studio Build Tools for `better-sqlite3`; Git long paths; Codex signed in; ports 17456 and 17573 free. | Each failure prints one Italian line saying what to do. The check passes on the developer's PC and on the rehearsal PC. **Done on the developer's PC:** `3af3d354`, which also prints the projects folder (`259b9bee`). Since `43a78941` it fails under 5 GB of free disk, and start prints the same warning: the disk filled up during flow run 2 and stopped the daemon. The rehearsal PC half belongs to R5. | M |
| R3 | **Team branch and update command.** The developer promotes tested commits to a `team` branch and tags each round. `MelilloDesign.cmd update` pulls fast-forward only, runs `pnpm install`, rebuilds and restarts; it refuses when the checkout has local changes. | Engineers never pull the development branch. An update from one tag to the next works on the rehearsal PC. **Done in code:** `070b47fc`. `update` refuses edited tracked files, local commits, a missing remote, a failed fetch and an active agent run, each in one Italian line; it reinstalls with a frozen lockfile only when the checkout moved. Since `7a8c90da` the launcher serves the production web build and rebuilds it after an update, so the first start after an update takes about a minute longer. The `team` branch and the first tag are not created yet; the tag-to-tag update on the rehearsal PC belongs to R5 and A2. | S |
| R4 | **The build is visible in the app.** Settings shows the commit and the round tag. | A screenshot of Settings is enough to know which build a report concerns. **Done:** `243b6963`. About shows «team-r1 · a0f9af34 · con modifiche locali», and `od version --json` returns the same. | S |
| R5 | **Clean-machine rehearsal.** The developer sets up a PC (or a fresh Windows account) that has never run the app, following only the guide, and times it. | Every manual fix met on the way became a guide line or a doctor check, and a second pass needs none. | M |
| R6 | **Backups.** Projects live in the daemon data root on each PC (see the [data directory contract](../../AGENTS.md#daemon-data-directory-contract)). Project history protects against an engineer's own mistakes, not against losing the disk. | The guide says where each PC's data root is configured and that it belongs in the PC's normal backup. **Done:** [team guide](../../docs/melillodesign-team-guide.md) (install, start, update, backup, reporting, promoting a round); `MelilloDesign.cmd doctor` prints the projects folder (`259b9bee`); `MelilloDesign.cmd install` covers the first install, which no command did (`b046bb51`). | S |

## Phase 2 — Defects that cost trust

All of these are open in the [26 October report](../../docs/verification/header-footer-agent-guided-2026-10-26.md#known-issues-not-fixed-here) or in UX-01.

| ID | Defect | Done when | Size |
| --- | --- | --- | --- |
| D1 | The chat pane can scroll under the composer, which then covers a form's **Invia risposte**. Screen-reader spans escape the log's scroll clip. | Focus and scroll-into-view inside the log never move the pane; the existing scroll-performance guards still pass. **Done:** `a03c8796`. The pane measures 800 px again, not 5,552 px. A related case surfaced in flow run 2: the first turn of a new document project slid under the composer when the gallery card appeared above it. Fixed in `c0b2813a`. | M |
| D2 | Errors on the main path come out raw and in English, for example the stale idempotency conflict with a **Riprova** that can only repeat it. | Every error a tester can meet between project creation and export is in Italian and says what to do; a retry is offered only when it can succeed. **Partly done:** the idempotency conflict (`6e3b2d8b`); the folder check when the daemon is down, met with a full disk (`98926a7d`); Windows commands shown by what they did (`71d8c99a`); the Export button in Italian (`7f66b477`). Italian wording met on the same path: «1 elementi» (`57391369`), the queued message's button that interrupts the run (`2cee3bcb`), the reading notice about images (`0c9caf9e`). No full sweep of every error yet. | S |
| D3 | A Blockout-only change shows a footer preview card, because outputs are taken from files touched during the run and the host regenerates the footer preview on save. | Host-regenerated files are not listed as run outputs. **Done:** `b0c0b401`. A derived file is rewritten only when its bytes change, so a Blockout save no longer touches the footer preview. | S |
| D4 | Footer text is about 3 px tall at "Adatta" and zoom is relative to the fitted page, while the approval checkbox says "Ho controllato la vera anteprima grafica". | A "100% stampa" zoom shows print size, and the approval wording matches what can actually be judged. **Done:** `a3fec102`. The editor still opens at «Adatta», and its help text points to «100% stampa». | M |
| D5 | Choosing a proposal shows "Salvataggio della scelta…" for about 10 s; applying a shared footer greys the editor for about 15 s with only "Applico…". Part of the cost is project history: one `git hash-object` per scanned file, about 55 ms each on Windows. | Hashing is batched; both actions finish in a few seconds or show what they are doing. **Done:** `92ab88fe`. An unchanged rescan of the 146-file project went from 6.8 s to 0.3 s. In flow run 2, applying the shared header and footer to both documents took about 2 s; choosing a proposal during another document's design run saved in 3.9 s (`d055625a`). | M |
| D6 | The agent says "proposta A" while the screen says "Lettura continua". | The agent's messages use the names on screen. **Done in the prompt:** `d99b26ee`, on the legacy, BYOK and OD Next paths. Whether the model follows it is checked in each flow run. | S |
| D7 | Fast can open a `-v2.html` companion instead of the canonical document after a design update (UX-01). | A regression fixture with a companion file keeps the canonical preview, and a live Fast update shows it without choosing a tab. | M |

## Phase 3 — The deliverable

| ID | Work | Done when | Size |
| --- | --- | --- | --- |
| E1 | **PDF of a designed document**, from the UI and from `od export --format pdf`. A generic PDF export exists (the browser path in `apps/web/src/runtime/exports.ts`, Electron `printToPDF` on desktop), but it has never been checked on a MelilloDesign document. The launcher starts the web app only, so the browser path is the one engineers will use. | Each document keeps its own paper size and orientation; the page count equals the design; footers and page numbers are right on every page; fonts are embedded; images keep print resolution; no block is clipped. Checked on the 8 A4 + 4 A3 project, page by page at 100%. **Done in code:** `fcd16802`, `b07d6bb8`, `a30254d4`, `351e66bf`. In flow run 2 the report exported in 2.4 s as 8 A4 portrait pages and the booklet as 4 A3 landscape pages, with fonts embedded, the smallest text at 11 pt and «Pagina N di 8» or «di 4» on every page. Report page 3 and plate 1 were checked by eye. Plate 1 has a placeholder 10 mm past the right margin, a design defect rather than an export one (see E2). The check at 100% by a person is still to do. | M–L |
| E2 | **Rule check before export.** The setup already extracts page limits, paper, margins and typography from the tender documents. The finished document is never checked against them. | Before export the engineer sees page count against the limit, paper and orientation, smallest font size and margins, each with the rule's source file and page. The check warns and never blocks: the engineer decides. Same check from the UI and the CLI. Flow run 2 met the case: an A3 placeholder ran 10 mm past the right margin and nothing flagged it. Since `08d9365f` the agent cannot register a designed block more than 1 mm past the safe margin unless the approved Blockout placed it there. That guard catches the agent's own overflow. **Done in code:** `7e12dfa9`, `3298fbf4`, `caead56f`, `8da82389`, `bca4c9c9`. «Esporta in PDF» on a designed document first opens «Controllo prima dell'esportazione», and `od export check <file> --project <id> [--json]` prints the same rows. Both call `POST /api/projects/:id/export/check`, which measures the pages in the Edge or Chrome that prints them. Each row (pages, paper, orientation, smallest type, margins) quotes its rule with the source file and page. Where the tender sets no margin, the row uses the Blockout's safe margin. «Esporta PDF» works while the pages are still being measured and whatever the rows say, and the CLI exits 0. On run 2 the check flagged the A3 overflow from both surfaces: plate 1, right side, 13.4 mm against 24 mm, «Dettaglio inferiore». The report passed every row: 8 of 8 pages, A4 portrait, 11 pt Arial. On run 3's booklet it first flagged the new watermark on every page, a false positive fixed in `8da82389`. Each check took 3.5–7 s, but up to two minutes while the project's background reading loaded the daemon. | M |
| E3 | **Design iteration after the Blockout.** Until 27 October no run had iterated on a design in chat: every first design leaves the content areas as placeholders, so what an engineer sees next depends on these rounds. | In chat, an engineer can ask for a watermark from the project's drawings, real images, a vector diagram and a chart from the tender's figures. Each round keeps the approved structure, margins, header and footer, and gets the numbers right. **Checked on run 3** ([report](../../docs/verification/melillodesign-design-iteration-2026-10-27.md)). The watermark was traced as SVG from a raster view inside the ANF PDF, compared with the source, and placed behind all four plates. A five-phase SVG process diagram, two ANF details with captions, and a chart, table and source from table 9 all matched page 37. Rounds took 20 and 13 minutes after a 13-minute first design. Open: the watermark competes with the chart and table; one gallery crop has a solid black square; the first round was marked failed by a second daemon on the same data root (see the report). The toolbar's zoom and tools were pushed off a 1280 px window by the composition button (`ca820475`). | M |

## Phase 4 — The engineer's own text

| ID | Work | Done when | Size |
| --- | --- | --- | --- |
| T1 | **A real Word draft as the source.** The materials inventory reads `.docx`, but every recorded run used Lorem ipsum or demonstration text. | A real `.docx` relazione goes through Blockout and design. The text extracted from the PDF matches the draft word for word, apart from hyphenation; text that does not fit is reported, never cut or reworded. | M |
| T2 | **Text that changes after design.** In a tender the text keeps changing until the deadline. What happens today when the draft changes after design is not known. | First, a recorded run that replaces two paragraphs after design and shows what the app does. Then the smallest path where the update touches only the affected pages and keeps the design. | L |

## Phase 5 — Freeze and accept

| ID | Work | Done when | Size |
| --- | --- | --- | --- |
| A1 | **Green test baseline.** About 25 tests fail on the base as well: 12 in `ProjectView.retry-gating`, 10 in the daemon, the 2 stale prompt goldens and 2 in the web suite. While they stay red, a regression cannot be told apart from noise. | Each is fixed or quarantined with a written reason. | M |
| A2 | **Freeze.** Tag `team-test-1` on the `team` branch. | The tag builds and starts on the rehearsal PC through `MelilloDesign.cmd update`. | S |
| A3 | **Blind runs on the tag**, Normal and Fast, following the [blind protocol](melillodesign-ui-ux-testing-roadmap.md#fresh-blind-testing-protocol). They include the J1 retest (absent header), UX-01, UX-02 and the two-document case, through to the PDF. | No P0 failure; anything left goes into the testers' known-issues list. | L |
| A4 | **The developer's own run** on a real current document, from a new project to the PDF, on a PC set up from the guide. | The PDF is one the developer would send. | M |

## Phase 6 — First round with engineers

| ID | Work | Done when | Size |
| --- | --- | --- | --- |
| K1 | **Tester guide**, one page in Italian: what the app is for (graphics, not writing the content or taking technical decisions), three things to try, expected waits, how to update, known issues. Current waits: about 9 minutes from confirming the brief to three proposals each for an 8-page and a 4-page document; 2 to 3 minutes for a one-page change. | A tester can start without asking the developer anything. | S |
| K2 | **Reporting.** An issue template on the fork: build, project and document, what you did, what you expected, what happened, screenshot. A "Copia diagnostica" action copies the build, project id, document and last run ids, with the matching `od` command for the CLI. | A report from the rehearsal PC can be traced to its run without asking questions. | M |
| K3 | **The round.** Two or three engineers, one week, one real document each, a check-in after two days. Blockers are fixed on the `team` branch within a day; everything else goes to the backlog. | Every engineer produced one PDF, or the report says exactly where they stopped. | — |

Measure in the round: time from new project to first PDF, how often the developer had to step in, the five most frequent frictions, and whether each engineer would use it for their next tender.

## After the first round

These matter for daily use but do not block the first round:

- **Shared work.** Projects, galleries and reuse across engineers and across tenders. Cross-project search is still an open decision in [PRODUCT.md](../../PRODUCT.md#open-decisions).
- **Speed** of Blockout and page changes.
- **Editable output**, such as Word, if the engineers ask for it.
- **Claude as a second provider**, UX-15.
- **Scale**: large intake and long sessions, UX-14 and UX-17.

## Decisions still open

- **ChatGPT plan and default model per engineer.** The current default is `gpt-6.1-sol` at `xhigh`, which is slow and spends quota. Setup turns and the document reader now run at medium, which cut run 3's setup from 15 min 47 s to 5 min 47 s with the same content (`475700b8`, `3778baa0`, [speed report](../../docs/verification/melillodesign-speed-2026-10-27.md)). Whether a lower effort for Blockout and design keeps the quality is untested. With an Anthropic API key the document reader uses Claude first; that path has not yet met the live API. Replayed through the Claude Code subscription, Claude read the same five questions no faster than Codex medium (146 s at low, 186 s at medium, against 146 s). As the main agent, though, Claude Code at medium did the same setup in 2 min 53 s and three turns, against 5 min 47 s and four turns for Codex, with the same content (`305d8251` fixed a cached probe failure that had blocked it). With every agent now asking in one starting form and reading short saved texts directly during setup (`ad3911e2`), Codex took 3 min 22 s in three turns. Giving it the header-and-footer payload as well (`d9b7ec5e`) cut its tool calls from 13 to 7 but not its time: one run took 5 min 41 s. Whether the team should default to Claude Code depends on the Blockout and design turns, which have not been run with it.
- **Editable export format**, if any, after the first round.
- **Who triages reports**, and how quickly a blocker must reach the `team` branch.

## Updating this roadmap

When an item closes, add its commit and evidence report to its row; when it is dropped, say why. Keep a failed exit condition visible next to the later fix, as the [development diary](../../docs/DEVELOPMENT-DIARY.md) does.
