# Night pass on the team test roadmap — 27 October 2026

Operator: the coding agent, unattended, from about 01:00 to 06:30. No run was blind: the operator knew the app and answered every form with its proposed defaults. All three runs used Codex with the app's default model, an Italian UI and a 1440 × 900 browser viewport. Their sources were the three TEST-01 documents (the tender rules, a report draft with demonstration text and the ANF drawings).

The night had two aims: close the roadmap items that need no decision from the developer, and take one project through the whole flow, from a new project to a PDF, recording every place where the app was slow, unclear or wrong. Each fix is a separate local commit on `codex/project-workspace`, not pushed. Every behaviour change has a test that failed before the fix.

## Roadmap items closed

| Item | Commits | Evidence |
| --- | --- | --- |
| R1, Codex found on Windows | `cd0cfefa` | With no `CODEX_BIN` and no Codex folder on PATH, the daemon found the app's CLI, the connection test passed and a real run executed a command. |
| R2, setup check | `3af3d354`, `259b9bee`, `43a78941` | `MelilloDesign.cmd doctor` prints one Italian line per missing piece and the projects folder. Since `43a78941` it also fails when the disk has less than 5 GB free, and start prints the same warning. |
| R3, update command | `070b47fc`, `b046bb51` | `update` refuses edited files, local commits, a missing remote, a failed fetch and an active agent run. `install` sets up a fresh checkout. The `team` branch and its first tag do not exist yet. |
| R4, build in Settings | `243b6963` | About shows the round tag, the commit and whether the checkout has local edits. |
| R6, backups | `cfc6462b` | The [team guide](../melillodesign-team-guide.md) covers install, start, update, backup and reporting. |
| D1, pane under the composer | `a03c8796`, `c0b2813a` | The pane measures 800 px instead of 5,552 px. The first turn of a new document project stays in view when the gallery card appears above it. |
| D2, raw English errors | `6e3b2d8b`, `98926a7d`, `71d8c99a`, `7f66b477` | Partly done. The errors met on the path tonight are in Italian and say what to do; no complete sweep was made. |
| D3, footer card after a Blockout save | `b0c0b401` | Derived files are rewritten only when their bytes change. |
| D4, footer unreadable at «Adatta» | `a3fec102` | «100% stampa» shows the page at print size; the approval wording matches what can be judged there. |
| D5, slow choice and apply | `92ab88fe`, `d055625a` | An unchanged history rescan of a 146-file project went from 6.8 s to 0.3 s. In run 2 a choice saved in 2.1–2.5 s and applying the shared header and footer to both documents took about 2 s. |
| D6, letters instead of names | `d99b26ee` | Run 2's agent named the six structures exactly as the screen does. |
| E1, PDF of a designed document | `fcd16802`, `b07d6bb8`, `a30254d4`, `351e66bf` | The Export button and `od export --format pdf` produce a vector PDF with each page at its own paper size: 4 A3 landscape plates and 8 A4 portrait pages, fonts embedded, 1.5–3 s. A person still has to inspect it page by page at 100%. |

## Speed

The launcher now serves the production web build (`7a8c90da`). Measured on the developer's PC, a project page needed 25.6 s and 34.9 MB of JavaScript before the composer could be used with the development server, against 4.2 s and 4.9 MB with the production build. The build is made automatically on the first start after an install or update and takes about a minute; a failed build falls back to the development server and says so in the window.

## Flow run 1, 01:17–03:20

Run 1 reached two designed documents and their PDFs. Its findings drove most of the fixes in the table above, plus these:

- Windows commands appeared in the execution record as the PowerShell path instead of what they did (`71d8c99a`).
- The agent's narration talked about the machinery ("uso la skill…") instead of the document (`2dd07f53`).
- The region contents of a header or footer took a turn of their own after the yes/no questions (`a0f9af34`).
- The footer's last page said «Pagina 7 di 8» when the cover was outside the numbering (`6aa477aa`).
- A character the PDF extraction left in the tender text sent every OD Next run to the fallback, 91 times (`b6977ba5`).
- A settings save failed on a Windows sharing violation (`5b3bdfda`). The 29 temporary files it left in the data root date from 24–26 October; none appeared after the fix.
- During one document's design run the other document's proposals could not be chosen for about 14 minutes (`d055625a`).
- Approving a structure took four actions in a question form; it now takes one button (`46c35173`).
- Every `od` command exited 127 on Windows after a large output (`a30254d4`), and the Export and Share menus opened off-screen with reduced motion (`351e66bf`).

## Flow run 2, 04:34–05:35

Run 2 repeated the flow on the production build to check the fixes and time each step. From a new project to both PDFs took an hour, about 45 minutes of it agent time.

| Step | Time | Notes |
| --- | --- | --- |
| New project | instant | The disk was full when the run started: the daemon died writing project history and the dialog showed an English check error. That error now says the app is not responding and how to restart it (`98926a7d`); the disk check in `doctor` and at start is `43a78941`. |
| Turn 1, reading | 3 min 32 s | Correct reading of the tender table, page caps and typography. The form asked only the scope, which cost a turn compared with run 1. While it ran, the turn slid under the composer (`c0b2813a`). |
| Turns 2–4, choices | 2 min 07 s, 1 min 19 s, 1 min 23 s | The report's choices, the A3 booklet's choices and the region contents came as three forms. The prompt now asks every document's choices in one form (`58241a19`). |
| Turn 5, header and footer | 3 min 32 s | Proposal saved and validated for both documents; the editor opened by itself; applied in about 2 s; the agent resumed by itself. |
| Brief confirmation | 1 min 44 s | Summary table and the host's own confirmation form. |
| Blockout | 7 min 04 s | Three complete structures for each document, against about 10 min 41 s in run 1. |
| Choice and approval | about 2 s each | Two buttons, then the design request prefilled in the chat. |
| Report design | 11 min 52 s | Planning 2 min 41 s, building 9 min 02 s; run 1 took 14 min. The page opened by itself and the queued A3 request started at once. The design kept the draft's 48 paragraphs, placed 3 figures and declared 5 placeholders. |
| A3 design | 9 min 30 s | Planning 59 s, building 8 min 18 s. Four A3 plates with six crops from the project's own drawings and declared placeholders. |
| Report PDF | 2.4 s | 6.3 MB, 8 pages at 210 × 297 mm, header and footer on every page with «Pagina N di 8», Arial and Arial Bold embedded, smallest text 11 pt. Page 3 checked by eye: clean. |
| A3 PDF | 15.7 s | Exported while another run was working: 7.0 MB, 4 pages at 420 × 297 mm, «Pagina N di 4», Arial and Bahnschrift embedded. The tender sets no typography for the A3 booklet, so the font was the agent's choice. Plate 1 checked by eye: the «Fotografia 2» placeholder runs about 10 mm past the right margin. |

Also found and fixed in run 2:

- The grouped form's send button showed the tooltip «Avanti» as if another step followed (`89eb8205`).
- A turn that stopped with one open step read «restano ancora 1 elementi» (`57391369`).
- An NPS survey card opened over the Blockout studio. Its answers go through analytics, and this install has no analytics key, so they would have been dropped. It now appears only when answers are actually recorded (`70bcb7c9`).
- The button on a queued message stops the agent's run in progress and sends the message at once, but in Italian it read «Guida questo turno». It now reads «Interrompi e invia» (`2cee3bcb`).
- The page language switched to English after the sketch engine warmed up, so a screen reader would read the Italian UI with an English voice (`8402e1be`).
- During the report's design the chat showed a card to open and export `.melillodesign/design-work/compose_report.py`, a helper script the agent wrote for itself (`48d9b536`).
- Both designed documents showed their closing summary twice, with a working line in between, until the page was reloaded. The stored production Run was folded onto the live row that had already streamed it (`b5337355`).
- `od export --help` said a PDF needs the desktop runtime. A document whose pages declare their paper size is printed by the PC's Edge or Chrome (`f781c744`).

## Flow run 3, 05:48–06:20

A shorter run on the production build after the last restart, to check live the fixes that change the first turns. Same three sources, a new folder and a new project; it stopped at the two Blockout comparisons.

| Step | Time | Notes |
| --- | --- | --- |
| New project | under 10 s | The chat was usable while the setup card was still reading the texts. |
| Turn 1, reading | 5 min 58 s | The gallery prepared 12 images at the same time, which explains most of the difference from run 2. The turn stayed in view under the gallery card (`c0b2813a`). The form again asked only the scope; its send button has no tooltip (`89eb8205`); the booklet's name disappears when only the report is chosen and comes back with its value. |
| Turn 2, choices | 3 min 49 s | One form for both documents (`58241a19`): 15 questions, including the header and footer texts and the logos, all prefilled. Run 2 asked the same things in three forms. |
| Turn 3, header and footer | 4 min 11 s | Proposal saved for both documents and the editor opened by itself; the turn card reads «Passi ancora da completare in questa attività: 1.» (`57391369`). From the scope answer to the proposal the agent worked 8 min 00 s, against 8 min 21 s in run 2: the single form saves the engineer two forms and the waits between them, not agent time. |
| Apply | under 7 s | «Revisione 1 già applicata» appeared within 7 s of the click, the browser tool's own delay included. The editor closed and the agent resumed by itself. |
| Brief confirmation | 1 min 49 s | Summary table and the host's confirmation form. |
| Blockout request | about 20 s | The request appeared in the chat about 20 s after «Invia risposte», where run 2 showed it at once; the form's own waiting text was not observed. Measured once; the confirmation code has no obvious slow step and the cause was not found. |
| Blockout | 8 min 50 s | Three complete structures for each document, named as on screen, both comparisons ready and the A3 one opened by itself. Run 2 took 7 min 04 s and run 1 about 10 min 41 s, so the time varies by a couple of minutes from run to run. |

Also found and fixed in run 3:

- While the texts were read, the setup card said images are processed only if chosen below, and then showed the option already ticked; the gallery started from that default (`0c9caf9e`).
- The Blockout summary linked each comparison as `[**Relazione tecnica**](…)` and the chat printed the asterisks, because link text was inserted as plain text (`9ed0e1aa`, checked on the rebuilt page). The link itself opened the comparison inside the app.

A «?» showed for a moment under a running turn. It matches the loading frame of a question form still being written, and the finished message was clean.

## Morning follow-up

The developer approved six of the open findings in the morning. Each is a local commit with a test that failed before it.

| Finding | Commit | What changed |
| --- | --- | --- |
| «Pagina 3 di 8» printed with wide gaps | `b3e2265f` | A text block carries fields inline, so «Pagina {pageNumber} di {totalPages}» is one block. The printed graphics, the fit check, the structural preview, the CLI help and the agent's instructions all use it. The fit check measures page counts not yet known as 999. |
| The A3 «Fotografia 2» box ran 10.6 mm past the right margin | `08d9365f` | The design registration had that measured box and accepted it. It now refuses a content block more than 1 mm past the safe area and names the block, page, side and millimetres, so the agent corrects the page in the same turn. A block the approved Blockout already placed outside stays the engineer's choice. |
| Upstream links in the rail, the panel tips and the error card | `f712fcbe`, `181f120e` | The rail and tips links are gone. «Contattaci» on a run error now opens one row, the team developer on the fork's issues, with «Apri segnalazione». |
| Project creation was two numbered screens | `abcd78ee` | One screen with name, first document and folders, and one button that opens once they are set. |
| A 4–6 minute turn showed only «In corso» and a timer | `783c527d` | The collapsed header keeps «In corso» and adds, on the same line, the first sentence of the agent's latest narration or the plan step under way (D54 in `specs/current/chat-panel-next.md`). |
| The Blockout request took about 20 s in run 3 | `4e363234` | Every history save started one Git process per new file and folder, about 75 ms each on Windows. It now starts four whatever it saves. On a copy of the run 3 project the Blockout seed went from 2.6 s to 0.7 s and a first snapshot from 8.5 s to 2.8 s. About 5 s of run 3's gap is still unexplained and needs a timed run on the production build. |

Checked live on the production build after these commits. The rail and the home page carry no upstream links. The new-project dialog is one screen whose button stays disabled until the fields are set. In run 3's project the operator asked, without naming any syntax, for the booklet's four numbering boxes to become one self-updating «Pagina 3 di 8». During the 3 min 06 s turn the collapsed header read «In corso» followed by the agent's latest sentence, which changed as it worked. The agent made an independent copy for the booklet, because the existing design is shared with the report, and wrote one `Pagina {pageNumber} di {totalPages}` block. The editor's preview printed «Pagina 1 di 4» as one phrase. The draft was left unapproved. The support dialog and the margin refusal were not triggered live; their tests cover them.

## Open findings and proposals

These are not fixed, because each needs a product decision or touches several tested paths at once.

- The first form asks only which documents to prepare, which costs one turn before the editorial choices. With two documents in the sources it is a real question; with one it could be skipped.
- The two-document choices form is about four screens tall in the chat pane. Sections per document that fold away would shorten it.
- The single form is a prompt rule. The model followed it in run 3, but nothing enforces it.
- When the header and footer hand-off ends a turn, the turn card says «Attività non ancora completata» and offers «Continua le attività rimanenti». It is accurate, since the review in the editor is still to do, but it reads like a failure.
- The 29 temporary settings files from 24–26 October are still in the data root; nothing removes them.

Still open from the roadmap: R5, the rehearsal on a clean PC, which the developer runs; a person's page-by-page check of both PDFs at 100%; the `team` branch and its first tag.

## Checks

Every behaviour change has a focused test that failed before it, and its neighbouring tests pass. Repository guard and typecheck passed after the last code change (`9ed0e1aa`), and the affected package typechecks passed after each change. Full daemon and web suites were not run on purpose. One accidental run of the whole web suite happened while looking for a baseline; its output was cut off and is not used as evidence.

These failures exist on the code as it was before the night and were left alone: the brand-string tests that expect «Open Design», three locale-parity tests, two `files upload` CLI tests, seven execution-record tests in `AssistantMessage` and `assistant-message-tool-status`, and four `ProjectView.question-task-reattach-fold` tests. The morning changes were compared the same way: the chat component and runtime suites had 100 failures before them and gained none, and the system-prompt matrix snapshot was already about 11,000 characters off before the agent instructions changed by one sentence each.
