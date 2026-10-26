# Header and footer acceptance — 24 October 2026

This report records what was exercised in MelilloDesign with the real Codex CLI, what the blind reviewers misunderstood, and the remaining limits. It accompanies the [header/footer specification](../../specs/current/melillodesign-header-footer.md). Normal and Fast creation, header/footer application, project reuse, shared publication, an independent copy and shared history restore were exercised live. Saved structural body Blockouts were inspected separately. This is not acceptance of finished document bodies or PDF delivery.

## Test projects and evidence

The normal project is **TEST — Header e footer condivisi**, ID `34c180fe-b8a6-45f2-8b4b-b38ee3bc3fc2`, with preparation chat `02c3bcd1-323d-4212-9ff4-ad69d9ae51da`. It contains an eight-page portrait A4 **Relazione tecnica**, including its cover, and a four-page landscape A3 **Fascicolo grafico**, without a cover. The report's cover has no recurring graphics or printed number and does not advance numbering; the following pages number 1–7. The booklet numbers 1–4. The working fixture is `C:\Users\Utente\Documents\MelilloDesign-Test-HeaderFooter-2026-10-24`.

The Fast project is **TEST — Studio Demo Fast**, ID `99e1818a-ddd7-40ff-864d-8e2166464181`, with chat `267cda2b-7862-495e-b096-bcc0add07b1c`. Its **Relazione tecnica demo** is two portrait A4 pages, without a cover, numbered 1 and 2. Its registered document is `7a63a92c-1ef2-4d68-beac-9fc4a204a3d7`, in child workspace `e1eade00-2fa3-4be0-8d19-657dda142367`; inspecting the parent's default document would inspect the wrong output.

Local evidence is retained under `.tmp/verification/header-footer-2026-10-24/`. That directory is ignored runtime evidence, not a portable committed fixture. Numbered text files preserve complete screen accessibility transcripts, including the later shared editor, history and body comparison screens; screenshots include `normal-targeted-modal-styled.png` and `fast-graphic-preview.png`. JSON and read-only inspection reports identify the saved documents, bindings and assets. The evidence directory can contain observations from before a correction as well as after it.

## What the real journeys established

The normal journey started from project creation, named the project and selected its type and working folder. The quick source read found both deliverables. Native chat questions gathered their separate names, format, page allowance, cover and numbering choices, then the shared header/footer guidance. An actual logo ZIP was selected through the chat file chooser and its relevant files were adopted into the header/footer library.

Codex saved distinct structural draft sets with portrait A4 and landscape A3 adaptations. A native question targeted a saved logo block: the host opened the dedicated editor, highlighted the block and docked the question beside the page. The user's edited guidance was saved before the answer reached the agent. Codex then developed the graphic draft using that answer and the saved note. The live test exposed a geometry/application failure and an inaccessible corrected draft; the recovery fixes now expose the pending error, let the user open the corrected draft, and require graphic approval before republishing.

`normal-linked-evidence.json` records the initial two-document application at shared revision **2**. Reusing the published design in the second document used the visual picker and a separate application action. A later publication produced revision **3** in both followed documents. The report was then frozen through the actual picker with future updates disabled; publication from the booklet produced revision **4** only there, while the report retained revision **3**. After rejoining the report to revision 4, history compared revisions 2 and 4 and restored revision 2 as a new shared revision **5** in both documents. The immutable older revision was preserved. Evidence: `shared-revision-3.json`, `independent-after-4.json` and `shared-restored-5.json`.

`normal-body-report.txt` and `normal-body-evidence.json` establish three saved structural alternatives for each normal document: 8/8/8 portrait A4 pages with 31/39/40 blocks for the report, and 4/4/4 landscape A3 pages with 23/36/28 blocks for the booklet. The checks passed for page geometry, empty functional body blocks, document-local numbering, current shared revision 5 and measured reservations. The shared restore's format variants and design matched revision 2 apart from publication metadata. Global active native runs were zero at that capture; the canceled run remains recorded as canceled rather than being counted as a successful run.

The Fast journey started through the direct creation dialog, with its own project name and the logo ZIP already attached. It kept editorial questions in chat instead of introducing the normal preparation wizard. After structural choice and graphic development, the dedicated editor applied revision **1**. The first application now resumes the saved native request without repeating intake or the interview. It only continues body work if that work was requested; a header/footer-only request ends after the recurring graphics.

`fast-body-report.txt` and `fast-body-evidence.json` record a subsequent structural Blockout with two portrait A4 pages and nine functional blocks: four on the first page and five on the second. All nine have empty image, reference and material-content links. Both pages reserve **34 mm** for the header and **20 mm** for the footer and use local visible numbers 1 and 2. The comparison's four logo references resolve to the approved local copies. The native run also produced `relazione-tecnica-demo.html`: its two authored structural pages have the owned recurring regions, matching content hashes, names, numbering and totals, four existing local logo links, and an A4 portrait print stylesheet. This is an editable schematic body with real recurring graphics, not final body graphic design or a completed technical report.

The final Fast walkthrough opened the document link from the parent chat, inspected the two-page comparison, opened page 2 in its modal, entered the page editor and saved feedback. The exact note, “Prova di salvataggio dal collegamento nella chat: mantenere i blocchi vuoti e modificabili.”, was verified in page 2 of the registered child document. No duplicate document appeared in the parent; the body remained empty and header/footer revision 1 remained active. This exposed and fixed a provider-routing bug: artifact links shown by the parent chat must resolve through the registered child workspace. Evidence: `fast-parent-artifact-edit-evidence.json`, `45-fast-body-editor-saved-feedback.txt` and `fast-body-editor-final.png`.

## Logo acquisition and upload

A separate disposable project, `27983010-b256-4f32-b9f8-d6334d4bac98`, ran two real native **gpt-6.1-sol / low** workers, one per requested logo. Mozilla used session `01a16cd8-7711-7152-ad7d-433723da8628`; Blender used `01a16cd8-7711-7ce1-a6cf-39730a0e93a7`. Both finished on attempt 1 in approximately 23 seconds.

The workers acquired a Mozilla organisation SVG from Mozilla's own site and the Blender PNG from Blender's official branding directory. Served files were checked against the saved originals by MIME, byte count and SHA256. The Mozilla SVG was 1,244 bytes with viewBox dimensions 983.6 × 235.2; the Blender PNG was 50,528 bytes and 2049 × 550 pixels. Both workers reported `browserUsed=false`: this proves the native search/download route, not Chrome-extension acquisition.

The first live preview requests returned HTML 404s because the file-serving boundary rejected the hidden runtime root. After the authorized asset route was corrected, both returned HTTP 200 with matching hashes. A ZIP upload probe also accepted the two logos and a 4,244,832-byte image, reported an unsupported executable entry individually, and preserved the original ZIP. It did not start unrelated gallery intake. See `logo-acquisition-report.txt`, `logo-live-evidence.json` and `logo-upload-live-evidence.json` for exact requests and results.

## Blind review findings and repairs

Sol low reviewers received complete screen text and navigation descriptions, rather than selected excerpts or screenshots, and reported their immediate interpretation and next click. The normal and Fast journeys were reviewed separately. Root-side screenshots were used for visual checks, not as privileged context for the blind reviewers.

| Observed confusion or failure | Repair and evidence boundary |
| --- | --- |
| Cover was set to No while three cover-only questions still appeared and sent preset answers. | Optional `showWhen` conditions now control rendering, validation, files and serialization. Invalid references and cycles are rejected. Hidden answers stay out of submitted summaries. New descriptors are tested; old already-emitted forms are not retrospectively rewritten. |
| The pending card suggested setup or logo collection had been lost even after drafts existed. | It now says the regions are not yet applied and opens their workspace. Its copy does not claim drafts are absent. |
| Applying the first report seemed to promise that the booklet would also update immediately. | The footer names the actual current scope and explains that other enabled documents must choose the published model themselves. Existing followed bindings determine later fanout. |
| A targeted radio option looked as if it should switch the preview immediately. | The editor explains that the preview is the current saved draft and the answer reaches Codex after submission. Future composition choice belongs to visual draft cards, not block-target radio questions. |
| Native work finished but the open editor still showed its older structural draft. | Agent completion and project-scoped header/footer events refresh clean drafts. Unsaved local edits remain intact with a conflict notice. |
| An unknown Fast page count appeared as 1/1. | Unknown preview totals show “—”; actual saved page counts replace it. Materialized pages still use real counts. |
| A failed first application had no snapshot, so its corrected published model had no editing entry. | “Correggi il modello in attesa” opens the latest corrected draft and keeps the pending error visible in the library. A focused test opens draft 7 and republishes it after approval. |
| A3 reuse cards showed the first A4 variant. | Published and draft cards now prefer the target document's exact populated format. Tests assert A3 landscape geometry and the canonical SVG viewBox. |
| The no-cover booklet still offered “Mostra anche in copertina”. | Both library and editor hide that control when cover is explicitly false, without silently changing saved binding policy. |
| After application, the editor still promised that its placeholder would show the body Blockout later. | The placeholder now says it reserves page-content space and that this editor changes only the header and footer, in Italian and English. Workspace/history: 24 focused tests passed after this copy correction. |
| Opening another project document briefly showed its entry page, then restored the previous logo image. | Registered Open now activates the entry file in tab state in the same batch as the chat switch. A focused regression starts on the old image and verifies that the new chat and active preview retain the registered entry. |
| A Fast artifact link in the parent chat could load or edit in the parent instead of its registered child workspace. | Artifact resolution now follows the child registry. The live page-2 feedback note was found in the child with no parent duplicate; 20 focused provider/preview tests and web TypeScript passed. Blind screen 45 found no material confusion and distinguished saving, preparing a revision request and proceeding to graphics. |
| History offered preview pairs but gave no account of changes, and draft numbers resembled published revisions. | A compact per-format summary reports selected → current strip heights and added, removed and changed blocks. Draft rows explicitly say “Bozza vN · non applicata”. Live screen 44 shows one changed block in each A4/A3 format when comparing revision 4 with 5. Its follow-up review requested the block identity and property: the bounded summary now also names each changed block and its changed values, for example separator width 82.8% → 84.8%; six focused helper/UI tests verify those details. |
| Opening the editor also selects a whole structural proposal, which was easy to miss. | The modal footer now states that consequence beside its actions while retaining the requested “Modifica composizione di questa pagina” button copy. Graphic approval remains a later action. |
| Descriptive radio rows overlapped in the narrow dock. | The option-row CSS no longer inherits the generic fixed 36 px button height; rows grow with their copy. The actual screenshot identified the failure. A fresh visual confirmation remains necessary. |
| Native logo inspection exports opened as document assets, and a Fast run generated a parallel HTML selection screen. | Canonical instructions now keep inspection exports in runtime scratch outside user document folders and require the existing visual library/editor for composition selection. Historical generated files remain evidence of the earlier behavior. |
| Native chat requested graphic approval that did not apply anything, duplicating the editor checkbox. | Canonical instructions now direct final graphic approval to the dedicated preview/apply controls. Targeted chat forms remain for details and feedback. |

## Validation performed

Focused suites covered the header/footer store, assets, native workers, routes and CLI, format/fit checks, prompt composition paths, editor transforms, draft recovery, history, target questions, conditional forms, project navigation and Fast continuation. Counts below identify particular final runs and overlap; they must not be added into a claimed unique total.

| Check | Recorded result |
| --- | --- |
| Root `pnpm guard`, pinned Node 24 / pnpm 10.33.2 | Passed. |
| Root `pnpm typecheck`, including workspace packages and root scripts | Passed before the last focused UI recovery/card changes. |
| Latest workspace editor suite after recovery, A3 cards and cover visibility | 22 tests passed; web source and test TypeScript passed. |
| Conditional-form regression and related existing form suites | 113 distinct focused web tests passed across the expanded runs. |
| Canonical header/footer prompt matrix | 17 tests passed across API/BYOK, native/plain, OD Next, normal/Fast and read-only plan boundaries. |
| Applied renderer with unknown preview total | 6 tests passed. |
| Fast continuation helper plus then-current workspace suite | 21 tests passed; web TypeScript passed. |
| Final CSS overlap correction | 30 grouped/conditional/workspace tests passed. Geometry still needs the visual check stated above. |
| Registered-document navigation | 12 focused tests passed, including old-image carryover regression; web TypeScript passed. |
| Final history, editor and body preview batch | 43 focused tests passed; web TypeScript passed. A page-three modal regression with a hidden, uncounted cover number resolves visible page number 2. |
| Final Fast parent/child artifact routing | 20 focused provider/preview tests and web TypeScript passed. Actual parent-chat → comparison → page-2 modal → editor → saved child feedback was verified live. |

No full daemon or web test suite was run. No Git repository was reset. The Fast authored structural HTML was inspected as described above; final designed body HTML and exported PDF remain outside this acceptance.

## Live acceptance and remaining limits

These rows distinguish completed live actions from checks supported only by focused tests or still outside the exercised document stage.

| Remaining check | Status / result to fill |
| --- | --- |
| Publish an edit from one of the two linked normal documents; verify both use the new revision and preserve their own titles, numbering, cover policy and A4/A3 geometry. | Passed: shared revision 3 in both; final structural inspection confirms local policies and geometry at revision 5. |
| Make one document independent; publish another shared edit and verify the independent snapshot remains unchanged. | Passed: report remained at revision 3 with following false, while the booklet advanced to revision 4 with following true. |
| Exercise an agent-originated edit through the same shared operations and verify its propagation scope. | Native graphic draft edits and saved feedback were exercised; a separately published agent-originated multi-document change was not independently recorded as a live acceptance case. Shared service-path tests cover that boundary. |
| Compare published versions and recoverable drafts, restore a selected version, and verify the chosen shared or document-only scope. | Published shared restore passed: selected revision 2 became new applied revision 5 in both followed documents. Draft-only recovery and document-only restore are focused-test evidence, not separate completed live restores. |
| Reopen after restart and check any interrupted/pending transaction recovery. | Logo acquisition state survived daemon restart without duplicated workers; failed first publication recovery was exercised. A process kill midway through a live shared restore was not staged. |
| Confirm descriptive question rows no longer overlap at desktop and narrow widths. | CSS correction and focused regressions passed. The final desktop capture is `header-footer-final-desktop.png`. The attempted 768 × 900 viewport override left actual DOM geometry at 1280 × 720 and was reset, so no successful live narrow-width check is claimed. |
| Confirm body page-three preview numbering. | Passed after settled navigation/reload: selector 3/8, presentation sequence 2 and actual applied SVG text “Pag. 2”. No speculative index patch was made; a focused regression agrees with the live DOM. |
| Generate and verify final owned authored-page HTML/PDF, including later page additions and recurring-region materialization. | Fast authored structural HTML passed two-page geometry, owned region/hash, numbering and local-logo checks after the body was created using the applied header/footer. Final designed body output, PDF export and a separate later-page-addition exercise are not claimed complete. |

The first measured normal publications took approximately **22.7 seconds** for the first application and **36.7 seconds** for the second, with materialization and history work serialized. Those operations completed; their latency remains an improvement item rather than evidence of a deadlock. The latest source instructions prohibit the duplicate approval, parallel HTML selection and scratch-export mistakes observed in these runs. A subsequent new native turn is still needed to demonstrate that each changed instruction is followed in live behavior.

## Final verification addendum

After all source changes, root `pnpm guard` was rerun and passed with exit code 0. The registered-document navigation repair was then confirmed live: opening the booklet while the old Mozilla image was active kept the booklet's registered entry, rather than reverting to the image. The complete screen text is retained in `46-document-switch-keeps-booklet-entry.txt`.

The final history view, `47-history-final-block-property-differences.txt`, identified `header-rule` and displayed its width change from **82.8% to 84.76%** in A4 and **90.4% to 92.38%** in A3. The final blind reviewer reported high confidence and no material confusion: the changed element, old/new widths, unapplied draft status and two-document restore scope were all clear. This closes the requested blind-review clarification cycle for the exercised core workflow. The explicitly unperformed narrow-viewport and later output-stage checks above remain outside the completion claim.
