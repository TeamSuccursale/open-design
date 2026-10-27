# Setup and document reading speed — 27 October 2026

Operator: the coding agent, on the developer's request, from about 09:40 to 10:10, local time. The developer found Codex slow and asked for a faster path built around Anthropic models with an API key, measured on the setup of flow run 3 from the [night pass](melillodesign-night-pass-2026-10-27.md#flow-run-3-0548-0620). Production build, Codex with the app's default `gpt-6.1-sol` at `xhigh`, Italian UI.

## Where the time went

Run 3's setup took 15 min 47 s over four chat turns: reading (5:58), choices (3:49), header and footer (4:11) and brief confirmation (1:49). Little of it was tool work. The second turn spent no measurable time in tools, and its commands were separated by gaps of about two minutes, spent thinking at extra-high effort.

The project's document reader (the custodian that answers the agent's questions about the sources) ran Codex at `xhigh` whatever the main agent was set to. In run 3 it answered nine questions, each in 40 s to 1 min 50 s. Document intake already ran Codex at `low`.

## Reading the same questions at lower effort

Run 3's saved reader receipts hold the exact question, evidence and images of each answer. Five of them were replayed through `codex exec` at three efforts, five at a time: three from the setup turns and two from the design turns, including the full reading of table 9 for the chart.

| Question | xhigh | medium | low |
| --- | ---: | ---: | ---: |
| Setup: the three documents and the criterion B row | 166 s | 52 s | 48 s |
| Setup: the end of the placeholder text | 62 s | 15 s | 15 s |
| Setup: the table cells, from the page images | 62 s | 18 s | 18 s |
| Design: table 9 in full | 110 s | 43 s | 27 s |
| Design: table 9 checked on the page images | 88 s | 28 s | 24 s |
| Total | 488 s | 156 s | 132 s |

Every answer at every effort gave the same figures: 8 A4 pages in Arial 11 at 1.5 spacing and 4 A3 pages for criterion B, separate A4 and A3 cells, A 4 and 3, C 1 and 1, D without a page limit rather than zero, totals of 13 A4 and 8 A3. Medium and low also kept the caution of the extra-high answers, saying when a cell's merge could not be checked from text alone. Low saved another 24 s over five questions; medium was chosen to keep a margin for harder counting questions.

## What changed

| Commit | Change |
| --- | --- |
| `475700b8` | The Codex reader runs at `medium`. When an Anthropic API key is saved for Claude Code in Settings, or set in the daemon's environment, the reader asks Claude Opus 5.5 first, through the official SDK with structured output and server-side refusal fallbacks. If that call fails, or the answer cites evidence it was not offered, Codex answers instead. The key is read on every question, so pasting it needs no restart. Each receipt names the reader, model and effort that answered, and any fallback. |
| `3778baa0` | Until the document setup is confirmed, chat turns run at `medium` at most. A lower setting, design and Blockout turns, confirmed setups and fast projects keep the effort the engineer chose. |

## The same setup on the new build

A new folder with the same three sources, a new project through the app, the same first message and the same answers; every form came prefilled with run 3's values. The gallery prepared the same 12 images during the first turn, as it did in run 3. The run's start event recorded `medium` while the engineer's setting still said `xhigh`.

| Turn | Run 3 | New build |
| --- | ---: | ---: |
| Reading | 5:58 | 1:35 |
| Choices | 3:49 | 1:08 |
| Header and footer | 4:11 | 1:42 |
| Brief confirmation | 1:49 | 1:22 |
| Setup | 15:47 | 5:47 |

The reader was asked once, during the first turn, and answered in 28 s; run 3's first answer had taken 1 min 37 s.

The content held. The first turn read table 9 correctly (8 A4 pages in Arial 11 at 1.5 spacing, 4 A3 pages with no typography set), said covers and contents pages are excluded from the count (page 38), kept the demonstration's portrait A4 and landscape A3, and flagged the gap in the placeholder text after B.3. The header and footer proposal read «Criterio B · Relazione tecnica» and «Pagina 1 di 8» as one phrase, and applied to both documents. The brief summary matched every choice, and the confirmation form showed the layout question once the brief was confirmed, as in run 3. The run stopped there, before the Blockout, which this change does not touch.

## Claude through the subscription

The developer then asked to try Claude through the signed-in Claude Code subscription instead of the API key. The app has no reader of this kind: its Claude reader calls the API. The five receipts were therefore replayed outside the app through the Claude Code CLI (2.1.296) on the subscription, with the app's prompt and output schema, Opus 5.5, no tools, no settings files and no MCP servers. Each question went alone. Codex medium was timed again the same way, because the earlier table had run the five questions at once.

| Question | Codex medium | Claude medium | Claude low |
| --- | ---: | ---: | ---: |
| Setup: the three documents and the criterion B row | 62 s | 60 s | 44 s |
| Setup: the end of the placeholder text | 13 s | 24 s | 17 s |
| Setup: the table cells, from the page images | 16 s | 36 s | 29 s |
| Design: table 9 in full | 25 s | 32 s | 21 s |
| Design: table 9 checked on the page images | 29 s | 34 s | 34 s |
| Total | 146 s | 186 s | 146 s |

Totals are summed before rounding.

At medium, Claude was slower than Codex on four of the five questions and 40 s slower overall; at low it matched Codex medium. Claude wrote far more. At medium each answer took 2,700 to 6,300 output tokens, thinking included, and at low 1,600 to 4,400. Codex took 400 to 2,000 and kept its reasoning under 140 tokens per answer. Starting the CLI cost 1 to 3 s per question, and the rest was the model's own time.

All three readings gave the figures listed under the earlier table, and on the two design questions every reading also gave the 21-page total and the exclusion of covers and contents pages. Claude's answers were longer, cited more evidence and named more gaps, such as the rule on how an A3 page counts against A4, which pages 37 and 38 do not give. Codex said less and got no figure wrong.

On this task, then, Claude through the subscription is not faster than Codex at medium. An API call would skip the CLI start-up; whether the API itself generates faster than the subscription was not measured.

## Claude Code as the main agent

The developer then asked for the whole setup with Claude Code as the main agent, on the subscription. The engineer's settings already named Claude Code, with Opus 5.5 at `medium`, so the setup ran at the same effort as the Codex setup above; the run state recorded `medium`. A new folder held the same three sources, and the project was created in the app the same way, with the same first message and the same answers.

The first attempt never reached the model. After 12 s the run stopped with «The installed Claude Code CLI does not advertise --effort», although the installed CLI (2.1.296) lists `--effort` in its help and had accepted it throughout the replay above. When the daemon failed to read `claude -p --help`, it cached the failure as "no flags" and kept that answer until restart. Why the read failed is not known; the new project's intake was starting at the time. `305d8251` stops caching a failed read: the next run probes again, and agent detection keeps the flags an earlier probe read. After a rebuild and a daemon restart, the setup was repeated in a second new folder.

| Step | Codex | Claude Code |
| --- | ---: | ---: |
| Reading and first questions | 1:35 | 1:05 |
| Second questions | 1:08 | none |
| Choices saved, header and footer proposed | 1:42 | 1:32 |
| Brief confirmation | 1:22 | 0:16 |
| Setup | 5:47 | 2:53 |

The times are the agent's turns only, without the time spent filling in the forms. Claude asked every choice in its first form, so the setup took three turns instead of four and one form fewer. It also made fewer tool calls: 9 in all, against 23 for Codex. (The run record lists each Codex call two or three times, once per progress update, so a raw count of its events gives 55.) Both agents saved the choices and the header and footer through the `od` command line, and both had one header-and-footer save rejected and retried it. Codex spent its extra calls on five updates to its task list. It also read a writing-skill file twice and a repository guide once, read the saved brief back five times against Claude's once, and ran two validation checks on the header and footer. Codex asked the document reader once, for 28 s. Claude never used the reader: it read the project's extracted texts and the placeholder file with three shell commands, the last of which also read the saved brief. Its last turn needed no tool at all.

The content held. The first turn gave the same reading of table 9: 8 A4 pages in Arial 11 at 1.5 spacing, and 4 A3 pages with no typography set. Covers and contents pages fall outside the count (page 38), and the totals of 13 A4 and 8 A3 cover the whole offer. Claude proposed the demonstration's portrait A4 and landscape A3. It found no gap after B.3, because it read the placeholder text whole; the Codex run's gap came from a truncated excerpt handed to the reader. Its form held 27 questions, some shown only after an earlier answer, and was prefilled with proposals. Five of them differed from run 3's answers and were changed back. Four were header and footer texts that named the tender and the competitor, and one was a cover for the report. The header and footer were one design shared by both documents: «Criterio B · *document name*» at the top, and at the foot the document name on the left and «Pagina X di Y» on the right. It was applied to both documents. The brief summary matched every choice, and the confirmation form showed the layout question once the brief was confirmed. The run stopped there, before the Blockout.

On this setup, Claude Code on the subscription took half the agent time of Codex at the same effort. Part of the gain comes from a different shape of conversation, one form instead of two, and not only from faster turns.

## One starting form for every agent

The developer then asked to give every agent the conversation that made Claude Code faster, and to remove what else had slowed Codex down. `ad3911e2` changes the preparation rules, which the classic prompt and OD Next read from the same source. The setup now asks every choice in one starting form. For each deliverable the form has a switch to include it, and its name, page count, orientation, header and footer with their text, cover and numbering appear only while that switch is on. One logo decision closes the form. Every field starts from the sourced proposal, and later forms are kept for new points and the final confirmation. The rules also tell the agent what Codex had spent calls finding out. The saved setup in the prompt is current and needs no read-back, dependent command-line steps go in one shell command, and preparation needs no task list. A complete `document-setup set` example and the `header-footer create` payload are given, and creation now accepts the logo decision, which it used to reject. Saved texts that are complete, untruncated and at most 64 KB are listed for the agent to read directly during preparation. The document reader still answers for longer or truncated sources, for images and in every turn after the setup is confirmed; the developer chose this split.

With the developer's agreement the agent was switched to Codex for one run and back to Claude Code afterwards. A new folder held the same three sources, and the project had the same first message and the same answers, at `medium` as before.

| Step | Codex before | Codex, one form | Claude Code |
| --- | ---: | ---: | ---: |
| Reading and first questions | 1:35 | 0:57 | 1:05 |
| Second questions | 1:08 | none | none |
| Choices saved, header and footer proposed | 1:42 | 1:45 | 1:32 |
| Brief confirmation | 1:22 | 0:40 | 0:16 |
| Setup | 5:47 | 3:22 | 2:53 |
| Tool calls | 23 | 13 | 9 |

Codex asked every choice in its first form, so the setup took three turns, as with Claude Code. The first turn read both saved texts with three shell commands and never asked the document reader. The form held a switch for each deliverable and was prefilled with 8 portrait A4 pages and 4 landscape A3 pages, header and footer, no cover, numbering from 1 and no logo. Its four header and footer texts differed from run 3's answers and were changed back. The last turn needed one command.

The middle turn did not get shorter. It saved the choices and created the header and footer design, and creation accepted the logo decision. Codex still looked up the help of `header-footer` and of `document-setup set`, listed the designs twice and validated each document with a separate call. One save failed and was retried: the typographic apostrophe in «dall’ingegnere» closed a quoted PowerShell string. In the first turn, each of the three read commands also read the engineer's writing skill again.

The content held. Table 9 gave 8 A4 pages in Arial 11 at 1.5 spacing and 4 A3 pages, covers fall outside the count (page 38), the orientations came from the demonstration file, and the tender's single-file delivery was noted. The header and footer were the same design as in the Claude Code run, applied to both documents. The brief summary matched every choice, and the confirmation form showed the layout question once the brief was confirmed. The run stopped there, before the Blockout.

Codex went from 5 min 47 s to 3 min 22 s and is now 29 s behind Claude Code. The gain comes from asking once, which removed a turn, and from shorter first and last turns. What remains is in the middle turn: help lookups, a second listing, one validation per document and the quoting failure.

### The header and footer without lookups

The developer asked to remove those too. `d9b7ec5e` gives the preparation rules a complete header-and-footer draft, one the store saves and validates. It also explains that validation without a document checks only documents already linked to the design, and a design created during setup has none. So each target document is validated by name, in the same shell command as the create and the draft. JSON payload files are written from single-quoted PowerShell here-strings, where a typographic apostrophe or quote no longer ends the string.

The first attempt ran on Claude Code instead of Codex and was cancelled after 50 s. The web app keeps the agent choice in the browser and sends it with each run, so switching the daemon's setting alone does not change the agent. The run below was started with Codex selected in the app, in a new folder with the same three sources, the same first message and the same answers.

| Turn | Codex, one form | Codex, no lookups |
| --- | ---: | ---: |
| Reading and the starting form | 0:57 | 1:25 |
| Choices saved, header and footer proposed | 1:45 | 3:36 |
| Brief confirmation | 0:40 | 0:40 |
| Setup | 3:22 | 5:41 |
| Until Codex's last output in each turn | 3:09 | 4:03 |
| Tool calls | 13 | 7 |

The rules did what they were written for. The middle turn made three tool calls instead of nine. It read no help page and wrote its payload files from here-strings, and the apostrophes caused no failure. One shell command saved the choices, created the design, saved the draft and validated both documents. The setup took 7 tool calls in all, fewer than Claude Code's 9.

The run was nevertheless slower. In the middle turn, Codex's last output came 2 min 5 s after the turn started, but the turn ended 91 s later; every other Codex turn timed today ended 3 to 8 s after its last output, and the event log shows no activity in that gap. Inside those 2 min 5 s, 65 s passed between Codex's first listing of the designs and the result of the long chained command. Its draft was rejected because Codex had given each text block `"fontFamily":"Arial"`, a key the block schema does not accept, and the corrected draft cost another 25 s. The example had replaced the help page, and the help page was where the block keys were listed, so `d9b7ec5e` now names them in the rule; that addition has not been timed. The first turn received the same rules for its own work as in the previous run and still went from 57 s to 85 s, which shows how much one run varies.

The content held: table 9 read the same, the choices were saved for both documents, the header and footer were the same design, applied to both, and the confirmation form showed the layout question once the brief was confirmed. The run stopped there, before the Blockout.

On this evidence, the change removed the lookups and the quoting failure but did not make the setup faster. Most of the middle turn now goes into writing the JSON payloads.

## Not measured yet

- **The Claude reader through the API.** No API key was saved during this session: the field appears only while Claude Code is the selected agent, so every question in the app went to Codex. The request shape follows the SDK's types and documentation but has not met the live API; if it is refused, Codex answers and the receipt records why. To try it, paste the key in Settings, under the Claude Code agent, as `ANTHROPIC_API_KEY`. The same key also makes Claude Code itself bill the API instead of the subscription, until it is removed.
- **Refusal fallbacks.** The Claude reader opts into Anthropic's server-side fallbacks (`fallbacks: "default"`): a declined question is re-run on Anthropic's recommended fallback model inside the same call and billed at that model's rates.
- **Blockout and design turns** still run at the engineer's effort. They took 8 min 50 s and 10 to 20 min in run 3 and the design session, and remain the largest waits. Whether a lower effort keeps the quality of three complete structures or of a designed plate is a separate measurement.
- **A subscription reader in the app.** The subscription replay ran outside the app. Inside it, the reader still uses the API key when one is saved, and Codex otherwise.
- **Blockout and design with Claude Code.** The Claude Code setup stopped before the Blockout, so neither the speed nor the quality of three complete structures or a designed plate has been measured with it.
- **Claude Code on the single-form rules.** Claude Code already asked in one form before `ad3911e2`; its setup has not been timed again with the new rules or the direct reading of short texts.
- **The block-key rule.** The list of block keys added to `d9b7ec5e` after the last Codex run has not met a run, and the running daemon had not been rebuilt with it.
- **Variance.** Each figure in the setup comparisons comes from one run, and each reader timing from one pass. Codex medium took 156 s for the five questions run together and 146 s run one at a time.

## Checks

- `custodian-readers.test.ts`, the new reader-fallback tests in `project-custodians.test.ts` and `document-setup-reasoning.test.ts` failed before their implementation and pass after it, with the existing custodian, journal, route and document-setup tests: 71 tests in 7 files.
- The daemon's source and test typechecks pass; `pnpm guard` and `pnpm typecheck` pass on the working tree at the end.
- The replayed answers were compared by hand with page 37 of the Disciplinare extract.
- For `305d8251`, the two tests in `claude-capability-probe.test.ts` failed before the fix and pass after it, using a fake `claude` whose help fails on demand. With the Claude effort, thinking-display, agent-args and detection test files, 132 tests pass. Six tests in `env-and-detection.test.ts` fail on this Windows machine with and without the fix.
- For `ad3911e2`, the four tests in `document-setup-starting-form.test.ts` failed before the change and pass after it. Together with `document-setup.test.ts`, whose prompt expectation now names the starting form, 34 tests pass. `pnpm guard` and `pnpm typecheck` pass on the working tree after the Codex run.
- In the Codex run, the saved setup and the applied header and footer were read back through the app's API and match the table above.
- For `d9b7ec5e`, the two new tests in `document-setup-starting-form.test.ts` failed before the change: one checks the rules in the live and frozen context, the other has the store save and validate the draft example. The block-key assertion failed before its line was added. With `document-setup.test.ts`, 36 tests pass; the daemon's source and test typechecks pass. The saved setup and design of the last Codex run were read back through the app's API.
