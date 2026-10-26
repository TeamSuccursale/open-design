# Agent-guided header/footer and the live two-document run — 26 October 2026

## Why this changed

The checkpoint's header/footer editor was a numbered wizard (1 Scelta del modello, 2 Composizione delle fasce, 3 Anteprima e applicazione) that also invited the engineer to leave it for the chat or for side panels. The engineer's review: a numbered progression that sends you elsewhere is not a progression, and the step should work like the page Blockout — the chat collects the inputs, the agent proposes, the engineer reviews and approves.

The recorded baseline for the old flow (run `2a84e9a8`, 4 min 19 s) produced only a structural draft for one document, left its A3 variant empty and ended with "Puoi esaminarla nell'editor dedicato". A graphic round, an approval and a second document were still to come.

## What changed

- **Prompt contract** (`packages/contracts/src/prompts/header-footer.ts`, preparation rule in `apps/daemon/src/services/document-setup.ts`, start prompt in `packages/contracts/src/api/document-setup.ts`). The agent asks what the enabled regions contain and the logo decision in one grouped form, then composes the actual graphics in the same turn: one design with a populated variant for every waiting document, validated for each, and stops. It never sends the engineer to the editor to supply inputs. Alternatives are separate named designs only when their hierarchy really differs. Changes requested in chat are welcome at any point in the project, including after the page Blockout, and are not an approval.
- **Editor** (`apps/web/src/components/header-footer/`). No numbered stepper. It lands on a single saved proposal ("Rivedi la proposta"), shows the scope it will apply to, and one approval publishes and applies the design to every waiting document whose format it provides. **Chiedi una modifica in chat** saves the draft and returns to the composer.
- **Auto-open at turn end** (`ProjectView.tsx`, `review-target.ts`). When an agent turn saves a graphic proposal awaiting review, the editor opens on it. With several new alternatives it opens the library. When an applied design was edited, it opens the bound document.
- **Entry copy** (`HeaderFooterDocumentEntry.tsx`). The entry tells the engineer to write in chat; its action reviews the proposal.

## Defects found by the live run and fixed

Each has a focused regression test that failed before its fix, except where noted.

| Defect | Evidence | Fix |
| --- | --- | --- |
| Validating a shared design for the A3 booklet checked the booklet's name against the **A4** strip it never uses ("non entra nella fascia A4 verticale"). | Live run `49b112ee`; the agent recovered by widening both versions. | `header-footer-runtime.ts` checks a document's local fields only in the variants its own formats use. Runtime test red → green. |
| The review said "cambia formato per vedere gli altri documenti", but a format switch keeps the first document's name and page count. The document picker is what switches, and it brings the format along. | Live: A3 preview labelled "Relazione B … di 8". | Copy names the document picker when the scope has more than one document. Test added (not run red first). |
| The "Piè di pagina" strip tag sat on the page number under review. | Measured overlap: tag 883–974 px, "Pagina 1 di 8" 886–936 px. | Tag moved just outside its strip. Visually verified; CSS not unit-tested. |
| Separator blocks were announced as raw "rule". | Screen transcript. | Named "Separatore". Test added. |
| The automatic preparation resume appeared as a long instruction paragraph in the engineer's own bubble ("Non farmi rispondere di nuovo…"). | Live after Apply. | Compact title "Riprendi la preparazione di «…» dalle scelte già salvate" with "Dettagli inviati all'agente", like the other host requests. Tests red → green for the no-name form. |
| A blind reader read the absent header as an incomplete proposal. The review never said the header was off. | Blind J1, step 3. | Scope line now reads "Applica il piè di pagina a … · senza intestazione". Test added after the failure. |
| After the brief confirmation, a banner "Il contesto è salvato, ma la generazione non è partita. Riprova" stayed up while the Blockout run worked. | Live, 17:11. | The setup panel's three sends pass `acceptDurableQueue`: a request parked behind a run that is still settling counts as sent and is recorded once. ProjectView test red → green. |
| Applying the shared footer to the booklet's new Blockout pages failed with Windows `EPERM` on the atomic rename of `blockouts/.documents.json`. The binding stayed pending, and the next Blockout save was refused: "L'applicazione di intestazione e piè di pagina richiede attenzione. Riprova prima di modificare le pagine." | Production run `4c129528`, 17:27. The agent recovered with `header-footer retry`. | The Blockout workspace writer retries a transiently locked destination, as the intake writers already did. Shared `replaceFileAtomically` helper; test red → green. |
| The date field printed the revision day as `2026-10-26` (ISO, the UTC day) on every page. The block's accessible name said "26/10/2026" (today's local date). | Blind J2, step 18: "io vorrei 26/10/2026. Non trovo un'opzione per sceglierlo." | One helper, `headerFooterDateText` (contracts), prints the revision's local day as dd/mm/yyyy. The page renderer and the editor label both use it. Contracts and web tests red → green. |
| Switching document in the editor dropped back to the library. The draft seemed lost, although the review help says to use the picker to see the other document's version. | Blind J2, step 14 (confidence fell to "bassa"). | When the other document shares the draft, the picker keeps the same draft open in the editor. Test red → green; checked live. |
| The apply action said "Applica intestazione e piè di pagina" with the header off, the confusion behind J1's failure. | Blind J2 screens. | It names only the enabled regions ("Applica il piè di pagina"). Test red → green. |
| After applying, "Il Blockout delle pagine può usare gli spazi aggiornati" suggested that pages already laid out needed a separate update. They are re-rendered with the footer. | Blind J2, step 20. | "Applicato a 2 documenti, comprese le pagine già impostate." Test red → green. |

## Live run (operator-driven, real Codex CLI)

Project `824bc1bb-3416-487d-9423-159fe59ee52a`, conversation `eadb3071-af4b-48c8-b511-ff82ec5b0b65`: "Relazione B" (8 A4 portrait pages) and "Fascicolo grafico B" (4 A3 landscape plates), footer only, no cover, no logos.

1. The engineer asked in chat for the graphics for both documents. Run `49b112ee` took 5 min 7 s. It made one shared design graphic, added a populated A3 variant, validated both documents (and hit the A4 defect above), and closed in two sentences without pointing at a button.
2. The editor opened by itself on the proposal: "Rivedi la proposta", "Applica a Relazione B, Fascicolo grafico B". The document picker showed the booklet's own A3 version with "Fascicolo grafico B … Pagina 1 di 4".
3. One approval and **Applica** bound both documents to revision 1 with shared updates on.
4. Preparation resumed by itself (run `eb78556f`, 1 min 58 s) with one grouped form: confirm the brief, and choose three structures or draw the blocks.
5. Confirming started the Blockout request automatically (OD Next planning run `71dc3cf7`, then production run `4c129528`). The comparison for Relazione B opened while generation continued, with "L'agente sta ancora preparando questo documento".

6. The production run finished at 17:29:15. It produced three complete structures per document: 8 A4 pages each for the report ("Lettura continua", "Testo e colonna di rimandi", "Coppie tematiche") and 4 A3 plates each for the booklet. The applied footer appeared on every page ("Pagina 3 di 8"). The booklet comparison opened in a second tab by itself.

### Blockout time

From the brief confirmation to both comparisons being ready took 20 min 35 s:

| Turn | Duration | Visible result |
| --- | --- | --- |
| Answer to the confirmation form (`d4246730`) | 3 min 9 s | Records the confirmation only |
| OD Next planning (`71dc3cf7`) | 2 min 12 s | One message describing what it will do |
| Production (`4c129528`) | 15 min 12 s | Six complete proposals; the report's comparison saved after 8 min 19 s |

Inside production:

- **About 5 minutes reading.** The task profile twice, the writing skill, the brief, the footer state, and two PowerShell quoting errors.
- **About 3½ minutes composing** the six proposals.
- **About 6½ minutes repairing.** The geometry check found captions entering the footer reserve, so the agent re-laid out both documents. It also hit the `EPERM` failure above and retried the footer application.

Neither repair needed the agent's judgment:

- The footer reserve is known before the first save and could be enforced when the proposal is saved.
- A locked file is a transient I/O condition.

Blockout speed is the next problem on this path. More explanatory copy won't solve it.

#### After the host-owned confirmation (rerun)

Three changes remove the two turns before production and the repair inside it:

- **The host confirms the brief.** The preparation turn saves the complete brief with `document-setup set` and ends with a host-owned form (`renderDocumentSetupConfirmationForm`, contracts) whose ids and option values are fixed. When the engineer accepts it, the web confirms exactly the saved brief (`{source: "saved-brief", blockoutApproach}`) and starts the Blockout request itself, so no answer turn runs. A declined form, or a brief the host cannot confirm (no purpose, or an output without its own constraints), still goes to the agent.
- **No planning run.** A Blockout request that carries the setup's own saved request id, after an agent-approach confirmation, gets the `od_next_confirmed_request` policy. Its request turn is the production turn: it carries the done, next-step and focus protocols instead of the production-ready marker. This is OD Next only; the legacy path has no planning turn to skip.
- **The footer reserve is enforced at save.** A run-authored `od blockout save` (the CLI sends `x-od-run-id`) pulls body blocks that cross a header/footer reserve into the free band, scales them proportionally, and reports `reserveAdjustments`. If the scale would fall below 75%, or a crossing cannot be fixed this way, it refuses with 422 `BLOCKOUT_RESERVE_OVERLAP` and names the free band. The engineer's own saves keep the existing re-adaptation warning.

The rerun used project `0f106052-9979-411f-a50e-014ba1c591ff`, conversation `2bef94ed-1049-4587-b6d6-958d1e90aabe`. It had the same two documents (8 A4 portrait pages, 4 A3 landscape plates, footer only, no cover, no logos) and the real Codex CLI with the first run's agent and model settings. From accepting the confirmation form to the end of production took **9 min 12 s**, against 20 min 35 s:

| Step | Duration | Visible result |
| --- | --- | --- |
| Host confirmation and dispatch, no agent turn | 24 s | "Invio in corso…" on the form, then the request "Brief confermato. Prepara tre proposte di struttura per ogni documento selezionato." |
| Production (`8f0afd4c`, the request turn) | 8 min 47 s | Six complete proposals, three per document. The report's comparison was saved 6 min 16 s after the click, the booklet's 7 min 12 s after it. |

Inside production:

- **About 2½ minutes reading.** The Blockout and save help, the brief and both seeded workspaces.
- **About 2½ minutes composing** the six proposals with a script.
- **About 2 minutes saving.** The first report save was refused with `Expected document and baseRaw revision`, because the agent omitted the base revision. It re-assessed and saved a minute later; the booklet followed.
- **About 2 minutes checking.** Both assessments were ready with no issues. The agent then re-applied both footer bindings, which the saves had already done, and wrote its summary.

No proposal crossed the footer reserve in this run, so no save was fitted or refused. The fit is covered by the runtime and CLI tests, not by this live run. There was no `EPERM`.

The turn closed with a short summary and three next-step suggestions. The booklet's comparison opened in a second tab by itself, with "Gara Antro · Criterio B · Fascicolo grafico B" and "Tavola 1 di 4" in the footer of every 420 × 297 mm plate.

### Changing the Blockout with the agent

1. **Opening the page.** On page 3 of «Lettura continua», **Modifica composizione di questa pagina** selected the proposal ("Salvataggio della scelta…" for about 10 s) and opened the editor on that page. A request typed in «Indicazioni per l'agente» autosaved.
2. **Edita in chat.** It staged a message with the saved structure attached. The page instruction travelled only inside the attachment, not in the message text.
3. **First revision.** Run `ea101447` took 3 min 3 s and changed only page 3 of proposal A: short introduction, table at half the page, note. Proposals B and C stayed untouched. The comparison on the right refreshed by itself.
4. **Correction from the chat.** The blind reader's own correction ("togli anche la breve introduzione…") was sent verbatim. Run `20e66b87` took 1 min 40 s and delivered exactly that: title, a table across 66% of the page height, the note, and the footer.

Both runs listed `header-footer/document-1/preview.html` among their outputs. The host regenerates that preview whenever a Blockout save re-applies the footer. Run outputs come from the files touched during the run (by modification time), so the chat showed a footer preview card for a change that never touched the footer. The blind reader asked whether the header and footer had been changed.

## Blind review

Fresh reader, complete screen transcripts, the facilitator performing only the chosen action.

**J1 — review and apply the header/footer for both documents: FAIL at step 3.**

- Step 1: the reader used the document picker to check the booklet before approving. This followed the corrected guidance.
- Step 2: the reader zoomed in to judge the graphics.
- Step 3: the reader withheld approval because no header was visible. The engineer's own chat message had asked for "intestazione e piè di pagina", while the brief had switched the header off, and the review never said so. The reader chose **Chiedi una modifica in chat** and correctly predicted that the draft would be kept and the chat would open.

The fix above was applied after this failure; it has not been re-tested blind. Other doubts noted:

- The footer text is about 3 px tall at "Adatta".
- "Modello condiviso · aggiornamenti futuri attivi" is not self-explanatory.
- The approval checkbox claims "Ho controllato la vera anteprima grafica" even at a zoom where nothing graphic can be judged.

**J3: change one Blockout page through the agent. PASS.**

Task: on page 3 of the report, replace the text with a large table.

- The reader opened the page from the comparison, wrote the request and sent it with **Edita in chat**.
- They read the result from the thumbnail, which refreshed by itself, then checked it at full size.
- They stopped without choosing or approving a proposal, which was outside the task.

Confound: the first live result came from the facilitator's wording rather than the reader's, so the reader's verdict of a partial execution at that step is not a product finding. From then on the agent received the reader's exact words. The reader's correction was carried out as written: run `20e66b87`, Blockout step 4 above.

Noise that cost confidence:

- the stale red idempotency error;
- footer preview cards after a Blockout-only change;
- blank chat previews, an artefact of the in-app test browser (see Known issues);
- the agent calling the structure "proposta A" while the screen says "Lettura continua".

**J2: add the date to the footer of both documents after the Blockout. PASS.**

The reader:

- opened the editor from the top bar and chose **Modifica il modello in uso**;
- added a dynamic field set to "Data" and moved it clear of the name in both A4 and A3;
- checked the other document at 200%;
- approved and applied revision 2.

The daemon re-rendered both comparisons with the date on every page: 24 report pages and 12 booklet plates across the three proposals. No explanation was given.

What it cost:

- **Format variants.** The date had to be added separately for A4 and A3, with no hint and no way to copy an element: "Avrei preferito poter copiare l'elemento dall'A4."
- **Document switch.** It left the editor, and the reader's confidence fell to "bassa" until they found the draft again. Fixed above.
- **New field placement.** A new dynamic field defaults to "Nome documento" and lands on top of the existing name. Placing it took three numeric edits per format.
- **Legibility.** Footer text is about 3 px tall at "Adatta" and about 6 px at 200%. The zoom percentages are relative to the fitted page, not to print size, which would need about 380%.
- **Date format.** The pages printed the date in ISO form while the engineer wanted 26/10/2026. Fixed above. The facilitator relayed the block's accessible name (26/10/2026) on two screens, not the drawn date, so the "inconsistency" the reader reported was partly introduced by the transcript. The drawn date and the label did disagree.

Applying took about 15 s with the whole editor greyed and no progress message.

## Known issues not fixed here

- The chat pane (`overflow: hidden`) can be scrolled programmatically. Screen-reader-only spans inside `.chat-log` are positioned against `.chat-log-viewport`, because the log is `position: static`, so they escape the log's scroll clip; the pane's scrollHeight reached 2,508 px against 801. A scroll-into-view or keyboard focus inside the log can shift the whole pane. The status bar then slides above the top and the portalled composer stays where it was, covering a form's **Invia risposte**. A window resize realigns it. This area carries scroll-performance guards (`chat-log-ancestor-rounded-clip.test.ts`), so it needs its own change.
- After a daemon restart the page shows "Loading MelilloDesign…" for about 20 s while the dev server compiles on demand. This is not a hang; the earlier report of one is withdrawn.
- Before the setup-queue fix, a queued copy of the Blockout request was left above the composer. It drained when the run ended. The daemon refused it (`409 IDEMPOTENCY_CONFLICT`, the same id with a different message) without starting a run. The chat now shows the request a second time under the finished Blockout, with the raw English "clientRequestId is already associated with a different logical run request" and a **Riprova** that can only repeat the conflict. The queue fix removes the double send; a stale copy queued before it still renders this way.
- The chat's preview cards for the Blockout comparisons looked blank during this run. This is the test browser, not the product. Without the desktop renderer there is no static cover, so the card falls back to a live iframe sandboxed with `allow-scripts` only. The in-app browser pane refuses navigations from such opaque-origin frames (`net::ERR_BLOCKED_BY_CLIENT`), which blanks every HTML card there. The same card in headless Edge showed the comparison title and all three structures with their page miniatures.
- Choosing a proposal from the page-3 modal showed "Salvataggio della scelta…" for about 10 s before the editor opened.
- Other atomic writers on this path still rename without the lock retry: `blockout-comparison.ts`, `blockout-design.ts`, `header-footer-runtime.ts`, `header-footer.ts`, `document-setup.ts` and `project-documents.ts`. They should move to `replaceFileAtomically` with their own tests.
- Pages applied before the date fix keep the ISO date (`2026-10-26`) until the footer is next re-applied. That happens on the next revision or Blockout save. The editor already shows 26/10/2026.
- Elements live per format variant. Nothing tells the engineer that an element added in A4 is missing from A3, and nothing copies it across. A new dynamic field should default to a field the strip lacks and land in free space.
- Zoom percentages are relative to the fitted page. Footer text cannot be judged at print size, yet the approval checkbox says "Ho controllato la vera anteprima grafica".
- Applying a shared revision greys the editor for about 15 s with only "Applico…".
- `ProjectView.retry-gating.test.tsx` has 12 failures that also occur on HEAD's web sources.
- Two prompt goldens are stale since `71e48b9` added the header/footer directive: contracts `od-next-prompt-recipe` "versioned request golden" and the daemon `system-prompt-matrix` snapshot. They were not refreshed.
- Each project-history mutation still costs about 1–1.5 s on Windows, about 55 ms per Git spawn: a capture hashes every file it scans with its own `git hash-object`. The history watcher also captures each file a save just wrote, and those captures queue behind the save. Confirming a two-document brief now takes about 3 s on the server, down from about 14 s (see below); batching the per-file hashing would remove most of the rest.

## Follow-ups fixed the same evening

The five follow-ups the rerun left open are fixed on the working tree:

- **Confirming the brief took 24 s.** The time was on the server: one Blockout save wrote each page, the catalogue and the workspace as separate history mutations, and each mutation captured the project before and after the write with Git. Seeding the two documents made about 17 mutations, 13.6 s of the 14.7 s confirm request. The fix has three parts:
  - a save, pages included, is now one history mutation;
  - the confirm seeds every missing document in one mutation (`seedBlockoutWorkspaces`);
  - the history Git reuses a directory tree whose entries have not changed, instead of running `git mktree` for every directory on every capture.

  The confirm request, measured on a throwaway copy of the live brief, now takes 3.2–3.4 s. In the browser, accepting the form brought up the Blockout request 2.7 s after the click, against 24 s. During the wait the form now says "Registro il brief e preparo le pagine…" instead of "Invio in corso…". The host-owned form carries that label as `submittingLabel`, the same way it already carried `submitLabel`.
- **The OD Next prompt told every turn to plan first.** The recipe's planning section and the core and orchestration assets now carry one exception sentence, `OD_NEXT_CONFIRMED_BRIEF_EXCEPTION` (contracts): when the turn's host protocol is headed "Confirmed-brief production", the accepted form takes the place of the planning turn. The recipe imports the sentence; tests hold both assets to the same words. The core and orchestration assets are bumped to 3.2.1. The legacy path has no planning turn, so nothing changes there.
- **Appended alternatives were not fitted to the footer area.** `append-alternatives` from a run now sends the run header and is fitted like `save`. The fit runs after the result digest, so retrying the same result still replays. Only the appended pages are fitted: the probe excludes the saved proposals, so nothing the engineer placed moves. `reserveAdjustments` names the new proposals by their saved IDs.
- **The agent lost a minute on its first save.**
  - `od blockout save` without `baseRaw` now stops before any request and names the command that returns it (`od blockout show … --json`).
  - The shared Blockout prompt and the CLI help now say that a save already gives the pages the applied header/footer reserve. The `od header-footer apply` help adds that Blockout saves never need it.
- **Long Windows paths broke project history.**
  - The private history Git now runs with `core.longpaths=true`, so objects deeper than 260 characters are stored.
  - Past Git's own limit (a Git directory of about 221 characters), the error is a 503 `HISTORY_PATH_TOO_LONG` in Italian asking for a shorter data folder, instead of the raw Git message.

The browser check started one real Codex Blockout run; it was stopped after 25 s. The measurements left eleven throwaway projects named "Misura conferma …" and "Prova conferma rapida …" in the development data.

## Checks

Run on the uncommitted working tree at the end of the session:

- `pnpm guard`: exit 0.
- `pnpm typecheck`: exit 0.
- Contracts `tests/header-footer-presentation.test.ts`: 7 passed, including the new date test (red first).
- Web header/footer tests: 81 passed. Files: `HeaderFooterWorkspace`, `HeaderFooterHistory`, `HeaderFooterPageContext`, `BlockoutStructurePresentation`, `BlockoutDocumentOverview`. The four new J2 tests went red first.
- Daemon `header-footer-runtime` and `blockout-workspaces-atomic`: 14 passed. The atomic test went red first.
- Live, after a daemon restart: the drawn footer date and its label both read 26/10/2026. Switching to the booklet kept the editor open on its A3 version, "Pagina 1 di 4".

Blockout-time change (host confirmation, no planning run, reserve fit), on its working tree before commit:

- `pnpm guard`: exit 0.
- `pnpm typecheck`: exit 0.
- Contracts `tests/chat-turn-host-protocol.test.ts`: 4 passed.
- Daemon `document-setup`, `services/header-footer-runtime` and the new `services/blockout-reserve-save-cli`: 44 passed.
- Web `ProjectView.navigation-ready`: 17 passed, including the two final-confirmation tests. With the host branch disabled, both failed with no confirm call.
- Web `AssistantMessage`: 63 passed. The one failure, "shows an inline loading frame while a form is streaming", also fails on the base commit.
- New tests went red before the source change. The web comparison against the base commit showed no new failures.
- Live rerun: the timing table under "Blockout time" above.

The follow-up fixes, on the uncommitted working tree:

- `pnpm guard`: exit 0.
- `pnpm typecheck`: exit 0.
- New tests went red before each source change. They cover:
  - the reserve fit for appended alternatives;
  - the missing `baseRaw`;
  - the confirmed-brief exception in the recipe and in both assets;
  - one history mutation per save and per seed;
  - tree reuse;
  - long paths;
  - the confirmation form's progress label.
- Daemon Blockout, document-setup, project-history, header-footer-runtime, project-documents, OD Next strategy and plugin-strategy suites: the only failures are 10 that fail identically with the changes stashed (Windows symlink permissions and "ships ten loadable main Skills").
- Contracts `chat-turn-host-protocol`, `od-next-prompt-recipe`, `blockout-mode`, `header-footer-prompt`: one failure, the stale "versioned request golden" listed above.
- Web `AssistantMessage*`, `QuestionForm*` and question-form parser tests: 410 passed. The 2 failures also fail on the base.

Full daemon and web suites were not run locally, following the repository rule; they run in PR CI.
