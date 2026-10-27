# Design iteration after the Blockout — 27 October 2026

Operator: the coding agent, on the developer's request, from about 08:30 to 09:40, local time. The night pass had taken three projects up to an approved Blockout and a first design. This session asked what happens after that, when an engineer starts iterating on the design in chat: a watermark drawn from the project's own drawings, vector diagrams, a chart built from the tender's numbers, real images in place of placeholders. Codex with the app's default model, Italian UI, production web build, 1280 × 800 browser viewport.

The project was flow run 3 from the [night pass](melillodesign-night-pass-2026-10-27.md#flow-run-3-0548-0620): the tender extract (pages 37–38 of the Disciplinare), the ANF walkway drawings with 12 reusable images, and placeholder text for criterion B. The work concentrated on the «Fascicolo grafico B», four A3 landscape plates whose Blockout structure was «Figura e dettagli»: two photographs, a process diagram, a comparison of two images, a chart with its table.

## First design, 08:40–08:53

The design run took 13 min 05 s and returned the four plates with the approved structure, the applied header and footer and «Pagina N di 4» printed as one phrase. Every content area was a placeholder: the brief said the contents were still to come, so this was correct, but the 12 gallery images went unused and the engineer gets nothing they could show yet.

## Iteration 1: a watermark from the ANF drawings, 08:56–09:17

Request, as an engineer would write it: a watermark on all four plates, the walkway's profile taken from the ANF drawings, redrawn as vectors, very light grey, large and behind the contents, clear of header and footer.

The agent worked like a draughtsman. It found that the ANF sheet has no side elevation and said so, chose the axonometric view instead, noticed the view is embedded in the PDF as a raster image, extracted it, traced it into a 940 × 548 SVG with a script, rendered the tracing beside the source to compare them, and only then placed it. The tracing keeps the deck grid, the three branches, the column and the plinth; a few secondary lines are simplified. The watermark sits at the same place on every plate, between the title and the footer, inside the margins; headings, captions and «Pagina N di 4» stay readable. It shows through the placeholder frames, which are semi-transparent, a choice for the designer rather than a defect. The design was registered with `od blockout design-record`, which accepted all four pages.

Elapsed time: 20 min 07 s. The run ended as «Esecuzione fallita» although its work was complete; see the second-daemon finding below.

## Iteration 2: images, an SVG diagram and a chart, 09:20–09:33

Request: replace the placeholders with real material. Plate 1, the two best ANF walkway images from the gallery, with captions saying what they show. Plate 2, an SVG process diagram (survey → investigations → model → assessment → design) with arrows and a short note per phase. Plate 4, a bar chart of the maximum pages for each element of table 9 of the Disciplinare (pages 37–38), beside a table of the same values and its source. Plate 3 unchanged, watermark kept.

The run took 12 min 53 s, until 09:33, and succeeded; the design version it registered is the one now applied. Before drawing, the agent read table 9 back in chat: A, 4 A4 and 3 A3; B, 8 A4 and 4 A3; C, 1 A4 and 1 A3. It added that chapter D has no page limit and would not be drawn as zero. Those are the figures on page 37 of the extract.

Plate 4 is the strongest result. Six horizontal bars carry the values, A4 solid and A3 hatched, with a legend and a scale from 0 to 8. Beside them a table repeats the same values by chapter with the totals of the source (13 A4, 8 A3), and a source line cites the Disciplinare, table 9, pages 37–38, and the declared maximum of 21 pages. A note explains what the limits include and why D is missing. Chart, table and source agree with the tender.

Plate 2 holds a real SVG: five numbered boxes in the requested order, each with a two-line note, joined by arrows. It reads at a glance. The arrows are small, the note «Geometria, quote» touches its box's right edge, and the diagram fills only the middle band of a large frame.

On plate 1 the agent chose two construction details from the gallery rather than overall views: the floor frame (Particolare 4) and the beam connection (Particolare 1). The captions say what each drawing shows, and a note gives the source sheet. The images are the gallery crops unchanged, in full frame. A request for «the two best images of the walkways» could also have been read as the axonometric view and the aerial photograph, both in the gallery; the axonometric view already serves as the watermark. The floor-frame detail has a large solid black square where the slab is drawn in plan. The same square is in the gallery crop and in the intake's render of the sheet; no independent renderer was available to show whether the original drawing has it. At A3 the drawings' own annotations are very small.

Plate 3 is unchanged and the watermark is kept on all four plates. Nothing runs past the margins, and header, footer and «Pagina N di 4» are clear. The watermark that works behind photographs and placeholders competes with the data on plate 4: its lines cross the chart grid and the table rows. A designer would probably fade it further there or leave it out of that plate.

Iteration 1's design version is recorded as failed, a side effect of the second daemon described below. The watermark therefore became part of an applied version only with iteration 2.

## What the two iterations show

After the Blockout the agent iterates well on content an engineer would ask for. It traced a vector drawing from a raster view inside a PDF and checked the tracing against the source before using it. It drew a process diagram as SVG, and it built a chart and a table from tender figures it had read correctly and cited. Each change kept the approved structure, the margins, the header and footer, and the plates it was told to leave alone. Its choices are reasonable but not always the ones an engineer would make: which images count as «the best», and whether a watermark belongs behind a chart. These are the things an engineer corrects with a further message. The cost is time. The first design took 13 minutes and each iteration 13 to 20, so a morning allows only a handful of rounds on one booklet.

## Fixed in this session

| Finding | Commit | Evidence |
| --- | --- | --- |
| On a 1280 px window the viewer is 630 px wide, and the «Modifica composizione di questa pagina» button pushed five tools past the toolbar edge: mark, edit, comments, the zoom menu and «Altro». Zoom is what an engineer needs to see a whole A3 plate in that panel. The toolbar's width breakpoints were set before the Blockout button existed; at 1600 px the toolbar still needed 934 px in a 790 px viewer. | `ca820475` | Below a 960 px viewer the button keeps its icon and names itself through the shared tooltip; above it the full label stays. A test that failed first checks the tooltip and the label. Not verified live: restarting the production web also restarts and rebuilds the daemon, and the daemon source then held another session's uncommitted work. |

## Checked and not a product defect

- **The preview turned white after a run.** The in-app test browser blocks sandboxed subframe loads with `net::ERR_BLOCKED_BY_CLIENT`. The same sandboxed iframe, with the same URL and bridges, renders in headless Edge. Earlier reports of a white preview from this test browser should be read in that light.

## Open findings

| Finding | Proposal | Size |
| --- | --- | --- |
| A second daemon started on the same data root silently fails the first daemon's live runs. At 09:07 a development daemon from a parallel session started on the production data root; its restart recovery scanned 251 runs, took the running watermark run for one interrupted by a restart, marked it failed and closed its task. The agent kept working for ten more minutes while the production daemon still reported the run as running, and at the end the settlement was refused («Only the current running task can settle an assistant reply.», `OD_NEXT_CONTINUATION_FAILED`). The parallel session had passed an isolated `OD_DATA_DIR`, as the data contract asks; the repository's `.env.local` also sets `OD_DATA_DIR`, and that value won over the explicit one. | Two guards. An explicit `OD_DATA_DIR` given to a launch must win over `.env.local`, or `tools-dev` must refuse to start when the two differ. Restart recovery should leave alone a run whose owning daemon is still alive, or a daemon should refuse to start on a data root another live daemon holds. Engineers run one app per PC, so this mainly threatens development and parallel agent sessions. | M |
| The header and footer apply and the Blockout acceptance each kept the screen disabled for about 15 s in the night runs. On a copy of run 3 the writes themselves are short: a Blockout save took 0.2–1.2 s with project history on (0.03–0.17 s with it off) and the structural comparison 0.04–0.4 s. The first history snapshot of a project took 5.6 s, and every request to that project waits for it; writes also queue behind the history captures of a running agent. | Measure the wait on the live daemon with per-step timings before changing anything; show what the app is waiting for instead of a bare «Salvataggio…». | M |
| The A3 plate does not fit the 630 px preview; the design scrolls sideways inside its own frame. | With the zoom menu back on the toolbar (`ca820475`), check whether «Adatta» fits an A3 design and make it the default for designed documents. | S |
| The plan pill went from «Passaggio 2 di 3» back to «1 di 3» in the first design run when the agent rewrote its plan. It reflects the latest plan correctly, but reads as going backwards. | Leave as is unless testers report it. | — |
| While the project page is open, `/api/projects/:id/media/tasks?includeDone=1` is requested about 1.3 times per second. | Check whether this polling is needed when no media task exists. | S |
| A gallery crop of the ANF sheet shows the slab in plan as a solid black square, and the agent placed it on plate 1 unchanged. Whether the source drawing has that fill was not checked with an independent renderer. | Render the sheet with a second PDF renderer; if the fill comes from extraction, fix the gallery crop. | S |
| The same watermark sits behind photographs, a diagram, a chart and a table. Behind the chart and table its lines compete with the data. | Leave it to the engineer, but the design guidance could tell the agent to fade or omit a watermark behind charts and tables. | S |

## Checks

- `BlockoutCompositionAction.test.tsx`: the new tooltip test failed before `ca820475` and passed after it, with the file's other seven tests.
- The plates were judged in headless Edge. The page was screenshotted whole at 1660 px, and plates 1, 2 and 4 were cropped at full scale through a host page. The app's preview in the test browser cannot show sandboxed frames.
- The chart's figures were compared with the text of page 37, extracted from the Disciplinare PDF.
- The save timings come from a script that ran the daemon's built modules on a copy of run 3, with project history on and off. The copy was deleted afterwards.
- The second-daemon cause comes from that daemon's startup log and the task record, read without writing. The parallel session confirmed the `.env.local` precedence.
- `pnpm guard` and `pnpm typecheck` pass on the working tree at 09:37.
