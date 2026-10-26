# Four fresh blind journeys — 24 October 2026

Four fresh readers completed 130 observations of the running product. Two journeys completed the whole assigned task. One completed choosing, editing, saving and reopening but failed when requesting an additional arrangement. One stopped at a repeated header/footer loading failure. This is not an all-clear for Fast and Normal mode.

The wave began after the earlier recovery journeys. The original failures remain part of the result; repairs and subsequent facilitator checks are recorded separately below.

## Who actually runs these tests

The blind readers are four separate native Codex CLI sessions, each using `gpt-6.1-sol` at low reasoning effort. They receive complete screen transcriptions, say what they think the interface does and choose their next action. They do not click, inspect source or execute tools.

The root agent and three helper agents act as browser operators: each follows a reader's chosen action, captures the next complete screen and records what happened. The Codex agent inside MelilloDesign performs the real preparation and generation. Separate code tests check the implementation after repairs. No human testers participated, and a helper's source diagnosis is never passed off as the blind reader's observation.

## Method

Four separate native `gpt-6.1-sol` sessions use low reasoning effort, an empty working directory and ignored user configuration. Each receives an ordinary task, the entire screen transcription and factual UI operations. Readers receive no source, backend state, expected answers, previous reviewer reports or other readers' responses. The facilitator follows each reader's chosen controls. Every call is audited for tool use. The harness rejects duplicate observations and limits transition records to UI operations.

The application source and lifecycle remained frozen during the cold observation, ending with N1 round52 at 17:47 UTC. Each journey started at Home, named its own project and document, and used a small independent fixture folder. All tasks requested three portrait A4 pages and empty functional body blocks. The fixture distinguishes these requirements from the historical tender PDF's requirements. No final body graphic design was requested.

The four readers produced 18, 16, 52 and 44 reviewed observations respectively. All 130 CLI calls exited successfully and their audits contain zero tool calls. These numbers describe the reader harness; they do not mean that all product actions succeeded.

Header/footer graphic approval, where required, needs a separate facilitator visual inspection: text transcription alone cannot establish graphic quality. Such approval is recorded separately and is never counted as blind visual acceptance.

## Journeys

| Reader | Mode and ordinary task | Cold result |
| --- | --- | --- |
| F1 | Fast; numbered footer, no header or logos | Completed choice, block rename, save/reopen and one additional arrangement. Original variants and selection preserved. |
| F2 | Fast; supplied ZIP logos, header, footer and numbering | Blocked. After graphic draft generation, the library timed out twice. No header/footer application or body layout completed. |
| N1 | Normal; supplied ZIP logos, header, footer and numbering | Chose, renamed a block, saved and reopened the exact edit. The subsequent request for one additional arrangement failed with a native Codex writer conflict; no new arrangement was generated. |
| N2 | Normal; no header, footer, numbering or logos | Completed choice, block rename, save/reopen and one additional arrangement. Original variants and selection preserved. |

## What each reader encountered

The F1 reader understood choosing, editing, unsaved changes, saving and reopening. It initially wondered whether an additional arrangement would replace the saved one; the request dialog resolved that doubt. Applying the footer required roughly two minutes in an uninformative busy state before proceeding naturally. Its 18 rounds ended with a real 3→4 append: every original variant, the saved block rename and the selected original remained unchanged. The initial footer preview exposed only sample page1; the later document comparison showed numbering1–3. Its repeated Fast-mode doubt partly reflects the task's English word “Fast” versus the visible Italian “Progetto rapido”; it does not justify adding a badge solely for this test.

F2 is a functional blocker, not a successful flow with unclear wording. After creating the project, selecting a composition with the supplied logos and generating its real graphic draft, opening the library reached a 15-second loading timeout twice, including the visible retry. The reader stopped without applying the header/footer or generating body layouts. A separate investigation found a valid stored graphic draft and direct API responses in 6–71 ms. Browser connection queueing is plausible; the evidence does not prove the individual request's queue duration. The generated technical request appearing under “Tu” also felt odd to the reader, and multiple reload controls were unclear.

N1 understood the settings, existing ZIP logos and creation of a shared model. A generated chat message referred to a “Design” mode that the reader could not find. It eventually used the actual header/footer launcher. During a three-minute preparation wait, it could not tell what was happening; expanding execution revealed technical commands and a recovered error whose significance was unclear. The reader correctly declined to approve graphic appearance from text alone. A separate facilitator inspection checked both logos, the title and the footer on page3 before applying the model; this is explicitly recorded as visual intervention.

The N1 body generation lasted approximately 13 minutes. The reader could inspect proposals while generation was finishing, but a live file refresh unexpectedly closed its page2 modal. After completion, it chose “A · Lettura continua,” renamed “Scopo e percorso” to “Obiettivi della prova,” saved and reopened the exact edit. It understood the unsaved/saved distinction. Its request for one additional two-column arrangement reached the chat with a typed Blockout request, then failed in 3.9 seconds. The final screen gave a generic failure and no useful cause. Read-only persistence checks confirmed that all three original proposals, the selection, rename and applied shared header/footer survived; zero new proposals were added.

N2's project creation stayed disabled for over a minute before the project existed on the server. The later native processing is a separate wait. The reader understood the grouped questions and requested three empty structures, but still did not know what the word “Blockout” meant in the progress display. Once proposals appeared, it understood their empty-role purpose, navigated pages1–3, chose and edited page3, saved and reopened the exact rename. Its 44 rounds ended with one real added arrangement: all originals, the rename and selectedA remained unchanged. Final confidence was high with no remaining doubt on that screen; earlier low-confidence waits remain failures in the experience.

Both Normal readers questioned why files were already present after selecting a working folder. Automatic reading of that folder needs a clear acknowledgement at the folder choice, rather than leaving the user to infer how the files arrived.

An N1 gallery click apparently opened history, and a semantic close action initially had no effect. A direct accessibility action closed it. This remains an unresolved automation/routing anomaly; correct source wiring alone does not establish that the observed click worked, and the observation alone does not establish an application routing defect. A generated Markdown comparison link also contained a repeated folder segment; the reader used the working comparison card instead, so the malformed link's navigation was not exercised. A facilitator screenshot showed that “Adatta pagina” could still require vertical scrolling in the editor; that is a visual finding, not a blind-reader claim.

## Repairs applied after the cold wave

Three narrow repairs followed the frozen observation. They do not rewrite any reader's result.

| Change | Purpose | Validation |
| --- | --- | --- |
| Release hidden memory-notification streams after the existing visibility grace period and reconcile state on return | Reclaim optional browser connections without cancelling native jobs or losing current notifications | 12 focused connection-budget tests passed, including visibility races and failed reconciliation |
| Preserve the current comparison, proposal and modal page during a same-owner content refresh | Prevent the page2 preview from closing while generation or another view saves a revision; reset on actual workspace/document/authority/restore changes | 31 focused preview tests passed, including stale-response, failure and navigation cases |
| Give preparation turns the actual header/footer handoff | Direct the agent to “Intestazione e piè di pagina”; the host sets the execution phase, so it should not invent a visible Design-mode switch | 24 focused document-setup tests passed; daemon TypeScript build passed |

Web typechecking also passed. The 67 focused tests above are implementation checks, not 67 blind users. Full application suites were not run. The daemon was restarted through `tools-dev` only after confirming there were no active native runs; the web received the UI changes through development refresh.

Post-repair browser checks were performed by the facilitator, without reusing a blind reader:

- The previously blocked F2 library and saved graphic draft opened in a new tab in the same Chrome test profile. Both logos and the explicit approval gate were present. Nothing was approved or applied. A restart, a fresh tab and lower concurrent load also changed, so this does not isolate the notification fix as the cause of recovery.
- With N1's comparison open on proposalA/page2, a temporary second view changed and saved a block label. The original modal remained on page2 and the comparison retained all proposals. The exact original label was then restored through the editor, saved and closed; the original preview still navigated to page3. No native jobs were started by this check.

The new preparation instruction is covered by focused tests and is active in the rebuilt daemon. It has not yet had a completely fresh native blind journey, so improved agent wording is not claimed as observed end-to-end.

## Remaining failures and doubts

The N1 alternative failure is a live Codex client-ownership conflict. Read-only Windows resource-owner inspection identified another ChatGPT app-server holding the exact native conversation writer. The previous MelilloDesign child had already exited. No lock was deleted, no outside process was killed, no conversation was silently replaced, and no alternative retry was represented as successful. A supported close/unload in the owning client is required before that same conversation can resume. The product still needs an actionable conflict message and safe recovery of the original request; a generic “Riprova” does not explain this condition.

Long waits remain a product issue even when generation eventually succeeds. N2's initial creation took over 100 seconds before a server-side project existed, which is separate from model processing. Header/footer application could leave controls disabled for roughly two minutes. Preparation and body generation then introduced further minute-scale waits. The current evidence does not establish a single cause for all those delays.

The small Fast pre-body header/footer preview has only a sample page because the requested page count is not yet durably available there. Both Fast tasks asked for three pages, but the editor could not preview pages2–3 until body structures existed. This remains incomplete. Terminology, optional intake acknowledgement, technical request messages appearing as the user's own prose, and the limited useful progress during long jobs also remain open UX concerns. These require behavior and hierarchy changes; adding more explanatory copy alone is not a pass criterion.

The cold wave therefore ends with two complete journeys, one core journey followed by a native failure, and one loading blocker. The successful warm checks are evidence of the specific repairs, not substitutes for a new cold evaluation.

## Evidence and independent diagnosis

Raw complete screens, original prompts, responses, operation records and tool audits are retained in `.tmp/verification/blind-cold-four-2026-10-24-1840/`, one directory per reader. Backend facts and source diagnosis are separate from those prompts. The detailed reports retain the readers' original responses:

- [F1 — Fast, footer only](../../.tmp/verification/blind-cold-four-2026-10-24-1840/fast-footer/lane-report.md)
- [F2 — Fast, supplied logos](../../.tmp/verification/blind-cold-four-2026-10-24-1840/fast-logos/lane-report.md)
- [N1 — Normal, supplied logos](../../.tmp/verification/blind-cold-four-2026-10-24-1840/normal-logos/lane-report.md)
- [N2 — Normal, no recurring regions](../../.tmp/verification/blind-cold-four-2026-10-24-1840/normal-plain/lane-report.md)
- [Native writer diagnosis](../../.tmp/verification/blind-cold-four-2026-10-24-1840/native-writer-diagnosis.md)
- [Creation and stream diagnosis](../../.tmp/verification/blind-cold-four-2026-10-24-1840/creation-and-stream-diagnosis.md)
- [Post-repair live modal check](../../.tmp/verification/blind-cold-four-2026-10-24-1840/post-fix/preview-refresh-live.json)
- [Post-repair library recovery check](../../.tmp/verification/blind-cold-four-2026-10-24-1840/post-fix/fast-logos-reopened.json)

No source change, restart, data repair or backend result was supplied to a cold reader as if it were a user action. Later checks are labelled as such, and no final body graphics were approved or generated.
