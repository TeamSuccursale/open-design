# Full Fast journey: fresh blind reader, 24 October 2026

The Fast path was exercised from the home page to a saved, edited Blockout, then through two real Codex alternative requests. Both requests appended one selectable alternative and preserved every existing proposal. The journey exposed real failures and required repairs, so this is a completed recovery-and-regression journey, **not an uninterrupted first-use acceptance pass**.

## Reader and evidence

The reader was a new native `gpt-6.1-sol` session at low effort, launched in an empty temporary directory with user configuration ignored. It received only the ordinary task, its own previous screens, and complete screen transcriptions: accessibility tree, DOM snapshot, rendered text, visible control rectangles and Blockout geometry. It had no source, tools, product history or earlier reviewers' findings.

There were **43 reviewed full-screen observations**, numbered 01–44; screen12 was retained as pre-reload evidence without a reader call. Raw prompts, JSONL, responses, screenshots, the combined reader transcript and intervention log are under `.tmp/verification/blind-full-fast-2026-10-24-1502/`. Source updates and facilitator probes are explicitly recorded separately.

The fixture contained only instructions, a two-page historical PDF and a logo ZIP. The task requested one named, three-page portrait A4 technical report, no cover, numbering1–3, and empty functional blocks before graphic design. The reader chose no logos and a numbered footer.

## Actual completed flow

1. Created `TEST — Fast viaggio completo` and `Relazione tecnica di prova` through the Fast modal with the three real fixture files.
2. Answered the actual native header question, reviewed the generated footer, approved its graphical preview and applied it as an independent copy. Application automatically resumed body preparation.
3. Received two real three-page structural proposals. Chose `Lettura continua`, edited page2's figure block name to `Spazio per uno schema tecnico`, and saved the intention `Empty space for a technical diagram to be added later.` Save, close, reopen and the read-only stored model all confirmed persistence.
4. Used the alternative-request UI, chose the default count1 and requested a different page2 text/diagram arrangement. The native turn completed in **3m26s** and appended `Schema a sinistra e testo a destra`. Both prior variants were byte-identical; the existing choice remained selected until the reader explicitly chose the new result. The preview opened on the clicked page2.
5. Used ordinary chat, without manually adding a handoff or attachment, to request a further diagram-above-text arrangement while preserving the current choice. The native turn completed in **4m38s** and appended `Schema sopra il testo`. All three prior variants were byte-identical, with the selected side-by-side proposal unchanged. The reader inspected page2 and deliberately kept its previous choice.
6. Followed the final approval entry. The reader understood that `Rivedi e approva la struttura` opens a review and that graphic generation starts only after sending the subsequent chat request. Its final response was high confidence with no uncertainty. The facilitator stopped without accepting or generating graphics.

The original body-preparation turn took **10m0s**. This report does not validate final graphic composition, PDF export, mobile behavior, or natural discovery of @ and project history.

## Doubts found and repairs checked

| Actual observation | Repair and evidence |
| --- | --- |
| Runtime502 prevented the privacy/home flow. | Parent restored the stopped existing daemon. Recorded as infrastructure recovery, not a product success. |
| The intake card's `Documenti:1` conflicted with three attachments. | The final screen uses `Fonti visive:1`, separating visual-source count from generated documents. Not independently re-tested as fresh discovery in this journey. |
| Registered document existed, but the chat lacked its header/footer launcher and @ control. Native help referred to absent controls. | One visible facilitator reload exposed stale parent registry state; the shared registry refresh repair followed. Footer application then completed through the actual UI. |
| Raw File di design comparison appeared while generation was active. A choice remained pending, then had to be made again in the canonical view. | Building preview routed to the canonical comparison; choices/editing were gated until genuine native settlement, while inspection remained possible. Interrupted, unchanged-editor recovery is logged. |
| Clicking a named block in the overview opened page properties instead of that block's inspector. | The exact selected block now opens its inspector. The saved name and intention were still present after the repair. |
| Revision action silently prescribed three alternatives and left preparation-versus-send unclear. | A dedicated dialog defaults to1, accepts intent, states preservation, and has an explicit send control. Rounds30–31 were high confidence; the actual native result matched the request. |
| Sent UI request did not expose the user's detailed feedback; its persisted attachment regressed to a UUID JSON filename. | Feedback visibility and persisted typed-attachment rendering were repaired. The old attachment now shows `Pagina di blockout`; a separate functional click opened visual proposals rather than JSON. The old pre-fix message itself was not rewritten. |
| Chosen overview directed the user to confirm without a visible approval entry. The old `Impagina` label left it unclear whether generation would start immediately. | Overview now exposes `Modifica o approva la struttura`; editor exposes `Rivedi e approva la struttura`. Rounds43–44 correctly understood review, all-page scope and the later explicit chat send, with no uncertainty. |

Round35's desire to move to Lorem ipsum graphics was preserved in the transcript. Before the required ordinary-chat alternative branch, the facilitator gave only this task reminder: “Before final graphic design, try requesting one further structural arrangement through ordinary chat while keeping your chosen one.” It supplied no control, path or expected interpretation.

## Separate functional probes

These were facilitator tests, not spontaneous blind-reader choices:

- Clicking the old persisted typed Blockout attachment opened the visual proposal panel, without exposing JSON.
- `Duplica per modificare` created and selected a clearly named working copy. Save/close/reopen retained it in the proposal menu with no unsaved changes. All four pre-existing variants remained identical. Browsing another proposal in the editor did not formally select it; the facilitator restored the reader's chosen proposal through the comparison's actual `Scegli` control.

Final read-only state: five variants including the retained manual copy; selected `alternative-0b2ebd6dd72fcd9e-1` (`Schema a sinistra e testo a destra`); header/footer status `applied`, no error. The document is left saved and unapproved for final graphic design.

## Verification files

The exact preservation checks are `ui-alternative-preservation.json` (2→3 variants), `chat-alternative-preservation.json` (3→4), and `manual-copy-preservation.json` (4→5). The original and final complete models, final state summary, old-attachment routing evidence, manual-copy reopening screenshot and `fast-final-overview.png` are retained with the raw screen records. No direct API creation, layout injection or hidden browser-state mutation advanced the journey.
