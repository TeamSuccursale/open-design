# Post-design composition verification — 26 October 2026

Follow-up: [Composition closeout and CLI selection](composition-closeout-2026-10-26.md) records the repaired preview, completion action and Fast registration/validation boundaries, plus fresh UI-created Normal and Fast flows with real Codex post-design updates. The limitations below describe the earlier round and are retained as historical evidence.

This record distinguishes the implemented composition workflow, focused test results and synthetic browser proof from native model execution. The extension is ready for the three fixes covered by the finish verdict. A real post-design update subsequently passed on the synthetic three-page document; the initial native-generation attempt remains unsuccessful. The post-design test exposed a stale main preview that required a full page reload.

## Implemented workflow

“Modifica composizione di questa pagina” opens the existing Blockout editor on the visible registered design page, including through an opaque preview iframe. A faint, inert HTML guide can be hidden. Content blocks retain semantic identities and describe composition; page-wide `backgroundIntent` carries watermarks, textures and decorative intent without requiring another content rectangle. Existing page/block feedback and fixed, guided or free flexibility travel with the target.

Composition edits use canonical revision-checked autosave. Both chat actions prepare one versioned `update-design` packet in Design mode for review and sending through the normal composer. Its `designBase` contains the last successfully applied realized composition, exact file fingerprints and run identity; `snapshot` contains the edited target, and `changes` compares stable page/block IDs against that applied baseline. Preparing an unsent draft does not advance the baseline or modify finished HTML.

A registration becomes applied only after the same project's run succeeds with a valid deliverable and matching files. Registration requires document identity in the entry HTML and matching document/page attributes together on exactly one element per mapped page. Missing, pending and unsuccessful registrations have explicit UI states; changed design files produce a warning and suppress the stale guide. Receipt and page reads do not rewrite the saved composition. Registry publication uses `entryOnly`, while realized geometry joins the editor's normal autosave and undo flow against the latest local draft, preserving newer saved or unsaved edits and page selection. Handoff preparation uses the server's returned canonical `savedRaw`, including normalized metadata.

Design metadata loads independently of composition approval. If shared header/footer changes clear approval, reopening a registered design retains its guide and `update-design` route while preserving the changed presentation.

## Focused verification

These are the implementing session's reported command results. Documentation review inspected source and retained evidence without rerunning the suites.

| Check | Recorded result |
| --- | --- |
| Web editor tests | Latest selected run: 54 passed across four editor test files, including 14 post-design tests. |
| Web provider/runtime groups | Earlier focused groups passed. |
| Contracts tests | Latest selection: 10 passed. |
| Daemon design and ProjectDocumentsRuntime CLI tests | Latest selection: 17 passed; visible-files tests also passed. |
| Contracts build and typecheck | Passed. |
| Daemon build and test typecheck | Passed. |
| Web typecheck | Passed. |

Coverage includes successful, pending, failed, superseded and source-changed receipts; protection of later edits; completion while the editor is open; an edit during a completion refresh; canonical metadata normalization; Design-mode handoff; underlay isolation/toggle; page-wide decoration; CLI/HTTP parity; and a later visible page with frame, document and request guards. The final regression also reopens a registered design after shared presentation changes clear approval, retaining its guide and Design-mode update handoff while preserving that presentation. Full daemon and web suites were not run.

## Synthetic browser and packet evidence

Initial browser proof used the explicitly labelled synthetic project `69bb2ee6-a181-4c10-bc97-e684e3ce3cbe`, whose workspace is `.tmp/test-fixtures/post-design/workspace`. Its initial applied revision was `visual-fixture`, with run ID `SIMULATED-NOT-A-MODEL-RUN`. That initial baseline was fabricated for UI verification. It was subsequently used as the starting document for the real update described below.

The browser exercise covered the guide toggle, the page background field, moving page 3's `body` block from x = 9 to x = 11, saving feedback, closing and reopening the editor, and “Edita in chat” closing the modal and preparing one unsent update attachment. The retained final captures are:

| Evidence under `.impeccable/review/blockout-post-design-2026-10-26/` | Observed state |
| --- | --- |
| `user-1920.png` | Page 3 selected, faint design guide, page-wide background field, saved status and both footer actions. |
| `desktop.png` | Page 3 retained with the page list, paper, docked inspector and guide toggle. |
| `mobile.png` | Page 3 retained; wrapped controls, page strip, paper, saved status and footer actions are present. The development badge partially covers the update action. |
| `handoff-staged.png` | Editor closed; synthetic preview banner and one Blockout attachment in the unsent composer. |

Read-only inspection of `blockouts/document-1/handoffs/.latest.json` inside the fixture workspace confirmed version 1, action `update-design`, comparison basis `applied-design`, the `visual-fixture` baseline, and a stable-ID change for `page-3` / `body`. Its before/after boxes contain x = 9 and x = 11. The target and block diff retain the feedback “Dai più respiro al corpo del testo e mantieni la filigrana libera dietro i contenuti.” The packet also records normalized page metadata; the block move is not its only changed field.

## Finish review and native execution boundary

The retained `verdict.md` gives disposition `ship` for three scored fixes: P1 continuity of saved revisions and newer edits, P2 visible registration states, and P2 preview reachability through matched page markers and the guarded iframe bridge. Its final appended pass also resolves the reopened approval-clearing continuity/state edge and retains `ship`. The verdict remains limited to the scored fixes. The detector ran once and its retained `detector.json` contains `[]`; this is separate from the source and screenshot review.

The native Codex attempt was run `0c25b815-3b15-4226-8c53-6b55b26d907b` in test project `6aed5dd3-30d7-4d52-ab6f-318ae7f93a2e`. It failed before output with `regurg plugin blocked the output stream.` No retry or bypass followed. This attempt is not an end-to-end model pass, and the later synthetic browser proof does not supply one.

## Real post-design update

After the user authorized execution, the existing staged request was sent once through the web composer using GPT-6.1-Sol. Run `88c15719-5527-4286-93de-df47541c397f` finished successfully in 5m 50s, with `deliverableValid: true`. The saved starting request was handoff `d67a5239-c367-4ee2-a3df-767c368dec4a`; the model created handoff `58869c70-3402-4953-afba-0028b5fc97eb` from the same canonical workspace revision for registration.

The HTML changed through the real agent's tool call. Page 3's body moved from x = 9%, width = 82% to measured x = 10.998504%, width = 53.929865%. Its measured height became 53.311443%, accommodating the unchanged text with more leading. All three page bounds remained 794 × 1123 px. Page 3's body ended at 80.309439% and its note began at 83.001725%, leaving a visible gap. All three article inner contents remained byte-identical, including the full-page watermark elements; the first two pages retained their screen layout. No gallery images were attached.

Registration promoted to applied revision `664f80a8-b708-4731-bd43-31f92f4af548`, tied to that real run, with `sourceChanged: false` and `pendingChanges: false`. Reopening composition from the visible last page opened page 3, displayed the narrower finished guide, and adopted the measured geometry through autosave. The saved feedback and page-wide background intent remained intact.

Evidence is under `.tmp/verification/native-composition-update-2026-10-26/`: `request.json`, `before.html`, `after.html`, `run-start.json`, `run-finished.json`, `applied-state.json`, `adopted-layout.json`, `sent.png`, `before-page-3.png`, `editor-applied.png` and `after-page-3.png`. The final HTML SHA-256 is `2061983a55d8af8b3198c461011ba6021a4ff9f01dc00bbc0667eca2921bab99`.

The main preview initially continued showing the old wide column even after its reload button was used. A full browser page reload displayed the new HTML correctly; the editor's saved guide already showed the narrow composition. This automatic preview-refresh defect remains open. The original fixture banner still says no model generation, because its text was preserved; that statement describes the synthetic starting document, not this subsequent real revision. This test establishes a real post-design update, not an initial-generation pass or a fresh usability review of both onboarding modes.

## Preserved system and limits

The source and captures preserve the incumbent studio palette, Albert Sans, shared controls, navigation, gallery, autosave and history. The guide reuses saved HTML; no shipping raster assets were created. The four PNGs are QA evidence. The red Next.js badge visible over the lower-right action belongs to the development UI. Root `DESIGN.md` and `.impeccable/design.json` are pre-existing omissions and were not repaired. The light-theme inspection does not establish dark-theme coverage. Existing unregistered legacy HTML is not automatically backfilled into the design registry.
