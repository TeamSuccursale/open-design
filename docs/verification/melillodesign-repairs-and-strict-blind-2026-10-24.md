# Document loading and blockout editing: repairs and strict blind retest

Status: this round is closed at the user's request. Testing and implementation have stopped. The two prepared follow-up patches remain unapplied and untested; there is no overall green result.

## Closeout and remaining uncertainties

The latest two entirely fresh Sol low readers produced 102 observations: 40 Fast and 62 Normal. Every retained prompt contains the whole screen transcription; both sessions used zero tools and exited successfully. All ten recorded frozen source/build hashes remained unchanged. Reader execution is evidence of the method, not proof that the product passed.

Fast completed creation, cold logo review, choosing a structure, a direct page-3 edit, save/close/reopen and inspection of exactly one additional three-page arrangement. The edited original remains selected, all three originals are deeply unchanged, and the registry contains one document. Normal completed creation, cold logo review, band application and a direct edit that survived reopening. Its additional-generation run was stopped through the visible **Ferma** control at the user's request after 1m54s. One additional arrangement had already been saved, but the reader did not inspect its completed result. Normal therefore has no complete journey pass.

Two implementation issues remain open:

| Issue | Evidence and limit | Remaining work |
| --- | --- | --- |
| Run status contradicts the working comparison | The fresh Fast body runs and the Normal initial body run report `succeeded` but `deliverableValid=false / entry_missing`; their comparisons open in the UI | Reconcile result validation with registered document ownership. A Fast child-alias patch is prepared but unapplied; Normal also needs investigation, so that prepared patch must not be assumed to cover it. No new native confirmation ran |
| Targeted question forms lose the distinct submitting state | Code inspection found header/footer and blockout branches still merge `submitting` into generic disabled state; the header/footer dock signature also omits it | A small patch and focused regression tests are prepared but unapplied/unrun. This is a confirmed forwarding gap, not a fresh blind reproduction of a crash |

The readers' actual UX uncertainties are retained below. Later clarification is recorded rather than treating every first-click doubt as a permanent failure.

| Where | What the reader could not predict | Resolution in this round |
| --- | --- | --- |
| Choosing Fast at Home | Whether a source folder could be added next, rather than only files | Fast accepts uploads; the distinction from Normal's folder setup was not predictable at the initial choice |
| Normal's initial creation form | When the document itself would be named, after naming the overall project | The document was named later in the flow; that timing was not clear at the first step |
| Received files, gallery and logo preparation | Whether the ZIP was received, whether gallery intake was required for its logos, and why the gallery showed only PDF extracts | The dedicated logo source picker later found and imported both logos. The earlier handoff between received sources, gallery extraction and logo assets remained confusing |
| Confirming header/footer composition | Whether confirmation applies the bands immediately or creates another reviewable preview | The next step showed a draft graphic preview and a separate approval/apply action. The first confirmation's consequence was initially unclear |
| Automatic request shown under “Tu” | Why a long technical message appeared after a simple confirmation | The Fast reader expected a simpler confirmation. No presentation change was made during this freeze |
| Waiting for native work | What remained before a response or completed structures would appear | The app advanced, but the remaining wait was unclear. Normal's body generation took 6m33s; its earlier header/footer graphic generation took 3m56s. This was processing time, not a reproduced loading deadlock |
| “Chiedi un’alternativa a Codex” | Whether the saved original and edits would be preserved | Resolved in the following dialog, which explicitly preserved the original and defaulted to one additional arrangement. Fast's final authoritative state proves preservation; Normal was stopped before the new arrangement's final reader review |

Actual logo pixels were checked separately by the facilitators; text readers explicitly said they could not judge the graphic appearance. Some screenshots captured a transition one screen behind their corresponding transcription. Original captures were preserved and separately named settled screenshots establish the actual previews; this limitation must not be mistaken for a product failure or a blind visual judgment.

The Normal test run was canceled, the unsubmitted extra verification form was closed, and no further native test was started. Existing projects and the running app were preserved. Scratch patches, first failures, lane reports and the complete audit remain under `.tmp/verification/blind-confirm-2026-10-24`.

The acceptance test is the actual product journey: create a Fast or Normal project, name its document, prepare its context and optional shared header/footer, inspect and choose a blockout, open the clicked page in the visual editor, change a block, save, close and reopen, then obtain an additional arrangement while preserving the edited original. Sending a chat message to rescue loading, open a broken editor or perform the edit does not satisfy the test.

## Repairs

| Failure | Cause | Repair and focused validation |
| --- | --- | --- |
| Fast comparison buttons failed to open an editor | Original child entry paths were resolved against the parent’s empty legacy catalog; pending guided preparation also unmounted the explicit open listener | Resolve the registered document by exact entry path, route writes to the owning child and retain revision checks. An integrated component test uses the real comparison, composer and workspace: click page 3, edit a block, save to its child and reopen, without sending chat |
| Loading had no recovery and document retries could duplicate work | Transcript loading lacked a real Retry; the document registry lock covered slow bootstrap; retried requests minted new identities | Retry the same conversation; keep document creation request identities and pending reservations, run bootstrap outside the registry lock, and resume the same creation. Focused service, route, provider and UI tests cover concurrent retries, failed bootstrap and intentional separate creation |
| Supplied logos were not available to the band editor | The logo library did not expose files already in selected folders or quick uploads | Add explicit source discovery/import in UI, HTTP and CLI, including ZIP import. Distinguish found files from imported assets; retain originals |
| Band previews used an arbitrary sample page | Fast page targets and the owning document context were not consistently resolved | Resolve actual page counts and settings from the owning document; show applied revision and shared update settings in review |
| Saved bands were reported as no result | Durable header/footer library models were absent from project-file artifact counts | Emit a strict daemon receipt after a durable native-run save. Consume it in the web classifier and run deliverable validation, only for a succeeded run and its own collection. Do not invent files or inflate artifact counts |
| Parallel project creation stalled again in the first fresh wave | Idle Home memory streams exhausted local HTTP/1.1 connection slots; folder preflight had no deadline | Home and native activity retain zero memory streams. Observe extraction only in a bounded completion handoff. Reconcile-capable project streams yield their sockets every 10 seconds and re-read authoritative state on reconnect. Folder reads have a deadline and visible retry |
| Managed storage falsely appeared unavailable | The UI treated an unresolved location request as a missing location | Separate loading, available and failed states, with a reload action. Slow creation continues observing the same promise instead of submitting another mutation |
| Logo approval was available while actual logos were blank | Inline SVG image requests did not establish whether the referenced images had loaded and decoded | Decode the original asset URLs at high priority with at most two workers and a finite deadline. Gate approval and Apply on the exact current preview key; show the failed logo and a real retry. Check enabled regions across all applied formats |
| A sent question form claimed required fields were missing | The form collapsed the real submitting state into a generic disabled flag | Preserve the occurrence lock and expose localized submitting copy, a polite status and aria-busy. Keep incomplete-input feedback distinct |
| Fast body output was reported missing by the run API | A Fast working chat owns several document comparisons, while validation expected one inferred project entry | Validate only exact saved blockout comparison paths also touched by that run. Check every delivered comparison, preserve explicit entries and reject realpath escapes; do not mint a root entry |

The first resumed strict wave is retained under `.tmp/verification/blind-repaired-2026-10-24`. Three readers stopped at disabled creation forms; the fourth reached saved header/footer drafts before the wave was paused. The late completion after releasing test tabs is diagnostic evidence, not a blind pass.

## Validation before the final wave

The final batch passed 166 focused web integration tests across 13 files, 28 project-event lease/visibility tests, the additional folder/create checks, 16 memory handoff checks and 33 daemon receipt/route checks. Both app typechecks, including daemon test types, passed; the daemon build passed. Earlier affected document registry and header/footer tests also passed. These are focused checks, not full app suites.

## Blind protocol

Four fresh native `gpt-6.1-sol` sessions use low reasoning effort and separate empty working directories. Every observation receives the entire accessibility tree, DOM snapshot, rendered screen text and viewport/control/block geometry. Screenshots are retained for facilitator verification. Readers receive an ordinary task and factual clicks/typing; they receive no source, previous reports, repair descriptions or coaching. The harness audits that they use no tools. A facilitator’s pixel-only header/footer review, where required, is recorded separately from the text reader’s judgment.

The final wave lives under `.tmp/verification/blind-final-2026-10-24`; `freeze.json` records the validation and runtime restart before its first reader. Source, configuration and lifecycle stay frozen while readers work. Each lane retains its first failure. Visible product retry is allowed; hidden state changes and chat rescue cannot turn a failure into a pass.

| Lane | Journey | Final result |
| --- | --- | --- |
| F1 | Fast, numbered footer, no logos | Direct journey complete: 42 blind rounds, high final confidence, no chat rescue; original unchanged, one registered document |
| F2 | Fast, supplied logos, header and numbered footer | First graphic approval failed: actual logos were blank although their names appeared in text. Diagnostic continuation is separate and cannot count as a strict pass |
| N1 | Normal, supplied logos, header and numbered footer | Direct journey complete: 74 blind rounds, high final confidence, no chat rescue; original unchanged, one registered document. Busy-form feedback and long generation wait retained as observations |
| N2 | Normal, no header/footer or numbering | Direct journey complete: 36 blind rounds, high final confidence, no chat rescue; original unchanged, one registered document. Submitted-form feedback ambiguity retained for repair |

The completed F1, N1 and N2 cases each have three original arrangements and exactly one additional arrangement after the request. Deep comparison of the authoritative JSON shows that the edited original is unchanged, remains selected and remains at the structural stage. Each has one registered document and no pending creation. Their reports and before/after proofs live in their lane directories.

The F2 logo failure is a real pixel failure. Asset reads returned valid images, and the original preview later painted them after direct asset inspection. This is diagnostic recovery, not a blind pass or evidence that the initial approval was safe. Approval needs to wait for the referenced logos to load and decode, with a bounded failure and retry state.

Both Normal readers also observed a completed form become disabled with a misleading missing-fields tooltip immediately after submission. Native processing advanced, but the feedback made a successful submission look incomplete. The existing submission lock must be exposed as a distinct visible submitting state.

The four readers produced 197 observations with zero tool use and zero failed CLI exits. F2's first 17 observations belong to its failed strict journey; the later 28 are explicitly diagnostic continuation. Successful reader execution is not a product pass. F2's later direct page-3 edit, save/reopen and additional arrangement worked, but that does not erase the blank-logo approval failure.

## Consolidated repair and fresh confirmation

After all four readers finished, the source freeze ended and the remaining repairs were applied together. Focused checks passed: 59 question/submission/timing tests, 58 header/footer image/readiness/editor tests, 21 document-preparation tests, and 62 daemon delivery tests. One pre-existing linked-page symlink test is skipped on Windows; the new comparison containment test and the independent-output containment test actually ran using a portable directory junction. Both app typechecks, including daemon test types, and the daemon build passed.

A read-only probe ran the compiled repaired validator against the actual two F2 body runs and their saved files. Both comparisons validate correctly with the original project metadata unchanged. Historical run records were not rewritten. The next native Fast run must also produce a correct API result; the probe alone is not a fresh product pass.

The new source freeze and runtime restart are recorded under `.tmp/verification/blind-confirm-2026-10-24`. F3 and N3 use new project/document names, new asset URLs, fresh empty reader working directories and entirely new native Sol low sessions. Their task covers the same complete creation, logos, comparison, direct editing, save/reopen and additional-arrangement journey. The reader sees every complete screen; actual logo pixels are checked separately before any graphic approval. Direct asset warming, a blank-preview waiver, seeded layouts and chat rescue are excluded.

| Confirmation lane | Status |
| --- | --- |
| F3 · Fast with supplied logos | Direct UI journey complete, 40 rounds, high final confidence; backend run validation still fails for child aliases |
| N3 · Normal with supplied logos | Stopped at the user's request after 62 rounds; creation/logos/direct edit persistence verified, added arrangement not finally inspected; initial body API also reports entry_missing |

F3's first actual graphic preview shows both logos before approval. Its direct page-3 edit survives save, close and reopen. Exactly one additional arrangement was then added: three original variants became four, all three originals are deeply unchanged, and the edited original remains selected. The registry contains one available document and no duplicated identities. The reader inspected all three new pages and stopped before body graphic design, with high confidence and no remaining question. All 40 reader observations exited successfully with zero tool use. The lane retains its separate pixel review and before/after proofs.

F3 also exposed a remaining backend failure: its body run succeeded and the comparison opens, but the run API reports `entry_missing`. This run reports files under the registered child alias (`documents/<document-id>/…`), while the repaired validator currently scans the parent blockout catalog. This failure remains recorded; it is not converted into a full pass by the working preview. The next repair must resolve the registered owner without mutating the registry, and retain exact current-run evidence and filesystem containment.

The earlier Normal logo body generation took approximately 7m50s and the reader questioned the remaining time. These observations do not establish that the overall wait is short, that every user will understand the product, or that the app's visual design has passed an aesthetic evaluation. No final body graphic design is approved by these tests.
