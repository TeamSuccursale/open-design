# MelilloDesign: four fresh blind journeys after the preview fixes

24 October 2026. This run tests whether a first-time reader can create a project and document, understand empty blockouts, choose a proposal, edit/save/reopen a block, and request a separate additional arrangement. It also checks the larger preview arrows and, in a separately prompted follow-up, keyboard navigation. The run exposes remaining failures; it does not establish that the product is clear or reliable throughout.

## How the test was run

Four new native Codex CLI sessions used gpt-6.1-sol with low reasoning. Each started without previous test history, application source, earlier reports or other readers’ observations. The reader received a complete screen transcription at every step: full accessibility tree, full DOM snapshot, rendered text, viewport/control geometry and block geometry. It gave an immediate interpretation, next action, doubt and confidence. The facilitator operated the browser according to that action. The actual Codex agent inside MelilloDesign performed the real work.

The source and running services were held fixed during the wave. No injected layouts, mock agent responses, API writes, database changes, lock removal or native-thread repair were used. Read-only registry and before/after snapshots were retained separately and never shown to the readers. Operator locator/time-out incidents are recorded separately from application failures.

The readers saw text, not screenshot pixels. Screenshots were retained and the facilitator separately inspected/approved the requested header/footer graphic samples where that approval gate prevented further progress. Those interventions do not count as blind visual approval. This test can reveal confusion about names, controls, state and routing; it cannot establish aesthetic quality.

All four cases used new small fixtures and requested one document of three portrait A4 pages, no cover, and empty functional body blocks. They did not ask the agent to fill the body with extracted pictures or substantive technical text. Each fixture contained a small text file, a historical two-page tender extract and a supplied logo ZIP. The historical page rules were explicitly background, not the current three-page requirement. This wave does not replace the earlier requested eight-A4 report plus four-A3 graphics test.

## Results by route

| Route | Observed result | Qualification |
| --- | --- | --- |
| Fast, numbered footer only | Created, inspected pages, chose, directly renamed a block, saved/reopened, requested one alternative. The completed append separately preserved both originals and the rename. | Footer saved/applied states and the wait after previews appeared caused doubts. Graphic approval was facilitated separately. |
| Fast, supplied logos and header/footer | Reached the requested saved rename and one additional arrangement. Original proposals, selection, rename and bands were preserved. | Required visible chat recoveries. The direct graphical editor route did not expose editing fields. It is not a clean editor pass. |
| Normal, supplied logos and header/footer | Created, prepared bands, inspected and selected a proposal, directly renamed/saved/reopened a block, then saw one completed additional arrangement beside the saved original. | Initial context did not make ZIP logos visibly available; the reader uploaded them again. The facilitator performed the declared pixel approval. All three originals and the bands were unchanged after the append. |
| Normal, no header/footer | Reader abandoned before the brief and blockouts after a conversation error, a loading document list and a busy creation form. | The later save completed without intervention and registered a second same-name document. The original error was not repaired or retested. |

These are four qualitative paths, not a usability percentage. One reader’s high confidence on a final screen does not cancel failures encountered earlier.

## What was clearer

Project and document naming were understood after choosing the document type revealed its fields. Both Normal readers understood the distinction between an app-managed save location and additional source context.

The page comparison was read as a selection step. Readers opened page thumbnails and used the larger next-page arrows to inspect pages 1, 2 and 3. In the successful editor paths, clicking “Modifica composizione di questa pagina” on page 3 selected the proposal and opened that exact page. Readers identified the page regions as empty functional blocks, rather than already completed technical content.

Saving and reopening were actually exercised. F1 reopened “Quadro riepilogativo da compilare”; N1 reopened “Sintesi per il riesame”. F2 reopened “Note dell’ingegnere” after a chat-assisted rename. Read-only append checks confirmed preservation separately from these visible checks.

The additional-arrangement dialog resolved a specific doubt about whether the saved original would be overwritten. In N1 the reader first asked whether preservation was explicit, then read the dialog and said: “It clearly says my saved proposal and edits will remain, and one alternative is already selected.” It subsequently recognized the request in chat as actually processing. That is stronger evidence than button wording alone.

The separate F1 keyboard task did not provide key mappings. The reader found the preview’s visible hint, pressed Right to move 1 → 2, then Left to return 2 → 1. Focus remained on the Close button rather than the native page selector. The saved document remained exactly unchanged. Keyboard use itself was prompted, so this is not spontaneous discovery during creation.

## Problems that remain

### 1. The same document needs a reliable route from working chat to comparison and editor

F2’s first blockout showed “Impossibile caricare il blockout” even after the native run said its proposals were ready. Reopening the visible file did not clear the error. The reader independently asked chat to reopen the saved proposals, and the resulting document-workspace link worked. That workspace still displayed “Fast projects use the working chat instead of guided document setup.” The later controls for selecting a block, modifying a page and opening the editor did not expose fields. The reader used chat to rename the block instead.

Repair acceptance: the first generated comparison opens from the working chat without a loading error or a manual workspace-link rescue; clicking a page opens its editor and selected block properties; Fast document workspaces do not display an incompatible guided-setup error. Repeat the actual direct rename/save/reopen path in a new Fast project. Successful chat editing does not satisfy this direct-editor check.

### 2. Recover the document already being created before inviting another creation

N2’s first conversation showed an error telling the user to retry, but no retry button. The reader went Home, reopened the project, opened Documenti, then tried Add document when the list remained loading. It explicitly wondered whether this would create a duplicate. After the reader stopped, that request registered a second available document with the same name.

The wait observations are bounded: the reader left the original error after about 16 seconds, saw the document list loading in captures 13 seconds apart, and stopped about 21.5 seconds after the first disabled Saving capture. A later operator capture still showed Saving after 48 seconds. The eventual ready screen was observed about 9.5 minutes after the stop; the exact finish time within that interval is unknown. This is evidence of abandonment and a duplicate, not proof of an indefinitely stuck save.

Repair acceptance: the error exposes a retry that resumes the same registered document; the document list distinguishes loading from empty and does not encourage a duplicate recovery; repeated create submissions are idempotent or show the pending document. A new blind reader must reach the original document’s chat without creating another registration.

### 3. Terminal status must agree with the saved artifact

F2’s header/footer run ended “Esecuzione fallita” and “Nessun file da visualizzare”, while the assistant claimed that the draft was saved and validation passed. The reader noticed the contradiction and dropped to low confidence. Reopening the band library found a usable saved draft, but that recovery does not make the failure display truthful.

Repair acceptance: a saved usable result is linked from the terminal status, and any genuine failed step is distinguished from the artifact’s state. Retrying must preserve the saved draft. Verify both an actual success and an actual partial failure; changing success copy alone is insufficient.

### 4. Explain progress through state and availability

F1 could inspect complete-looking proposals while selection was disabled for the still-running generation. It asked what remained to be completed. N1 expanded activity after a long wait and encountered technical commands/errors it could not interpret. Multiple separate preparation, band composition, band graphics, confirmation and body-generation turns lengthened the journey.

Repair acceptance: a pending proposal clearly communicates what is still unavailable and why; completed validation enables selection without a stale busy lock; failed or stalled work has a visible recovery action. Keep raw execution details secondary. Measure actual job durations and state transitions, not total test wall time, which also includes reviewer/operator delays.

### 5. Source-folder logos and band-library assets are disconnected in the user’s understanding

N1 repeatedly questioned whether the logo ZIP in the selected context folder had been found. The dedicated upload resolved the issue only after uploading it again. F2 similarly wondered whether ordinary image preparation was required for its logos. F1 also questioned the difference between saved, graphically approved and applied footer states, and could only inspect sample page 1 before body generation.

Repair acceptance: the logo step lists usable logos already supplied with the project, or explicitly offers to import those files into the band library; it does not imply they are received until that state is real. The chosen band’s applied/shared-update state should be inspectable and changeable in the same review context. Preview navigation should cover the document’s numbered pages before application where those pages are already known.

## Evidence and limits

Evidence root: `C:/Users/Utente/Documents/ChatGPT/Spazio_DI_Supporto/.tmp/verification/blind-cold-four-2026-10-24-2115`.

Detailed reports preserve the original reader replies and full-screen capture links:

- [F1: Fast with numbered footer](../../.tmp/verification/blind-cold-four-2026-10-24-2115/fast-footer/lane-report.md), plus the [separate keyboard follow-up](../../.tmp/verification/blind-cold-four-2026-10-24-2115/fast-footer/keyboard-followup.md).
- [F2: Fast with logos, including recoveries](../../.tmp/verification/blind-cold-four-2026-10-24-2115/fast-logos/lane-report.md).
- [N1: Normal with logos](../../.tmp/verification/blind-cold-four-2026-10-24-2115/normal-logos/lane-report.md).
- [N2: Normal without recurring bands](../../.tmp/verification/blind-cold-four-2026-10-24-2115/normal-plain/lane-report.md), plus the [separate observation of eventual duplicate creation](../../.tmp/verification/blind-cold-four-2026-10-24-2115/normal-plain/post-stop-observation.md).

No cross-document shared-band update, web logo research, cover numbering, history comparison/restore, project-reference @ discovery, large-document fit, accessibility certification or final-body graphic quality is established by this wave. No source repair was folded into a cold result.

## Final audit and preservation checks

The four independent fresh reader sessions completed 143 reviewed observations: F1 31 natural plus 5 separately prompted keyboard rounds, F2 41, N1 51 and N2 15. Every reviewed round exited 0 and recorded zero disallowed tool items. Operator-only post-stop screenshots were not counted as reader observations. The audit is saved as `reader-audit.json` under the evidence root; its session IDs establish that four different readers were used. These successful CLI exits establish valid observations, not successful product routes.

F1 appended exactly one alternative (2 → 3) while retaining both originals, its selection and rename. F2 appended exactly one (2 → 3) while retaining both originals, selection, rename and presentation. N1 appended exactly one (3 → 4) while all three original variant objects remained exactly equal, selection/active variant remained the saved original, presentation remained unchanged, and the page-3 rename persisted. The new N1 arrangement has three A4 portrait pages and no body images. All three documents remained in structure stage. N2 reached no proposals, so no append or editor preservation check applies.

The keyboard follow-up retained the entire saved F1 document exactly unchanged. Its Right/Left navigation was observed with focus on the modal Close button, separately from native select keyboard behavior.

The application remains open on the test projects. Final N1 evidence: [saved block reopened in the editor](../../.tmp/verification/blind-cold-four-2026-10-24-2115/normal-logos/round-46.png), [completed separate alternative beside the original](../../.tmp/verification/blind-cold-four-2026-10-24-2115/normal-logos/round-51.png), and [integrity proof](../../.tmp/verification/blind-cold-four-2026-10-24-2115/normal-logos/operator-integrity-proof.json).
