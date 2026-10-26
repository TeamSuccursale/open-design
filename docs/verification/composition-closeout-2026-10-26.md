# Composition closeout and CLI selection — 26 October 2026

## Changes

The compact agent menu again offers Codex CLI and Claude Code. Codex is preferred when a returning user has no saved selection; explicit selections and each provider's model preferences are retained. CLI installation and sign-in remain in Execution settings. Preparation copy now refers to the selected agent instead of promising Codex regardless of the selection.

Finished HTML previews now track whether each URL revision actually loaded. A successfully painted older revision no longer prevents recovery of a later stalled navigation. After five seconds without that revision's load event, the viewer uses its already fetched fresh HTML through the existing inline transport. Powered previews retain their URL runtime.

The composition action rechecks the applied design when a run finishes, even if the file identity has not changed. It follows a pending registration until terminal validation settles. Clicking it opens the page currently visible in the finished document, with the optional faint design guide.

Fast documents can register a design produced by their parent conversation only when the daemon froze that document's exact attached handoff and digest into the run. The receipt retains the originating run project across restarts. Finalization now stores delivery validity for every successful physical run, including Fast runs outside the strategy workflow. Delivery checks use the same run's verified designed HTML, exact current-run writes and unchanged registered files. Receipt polling resolves terminal evidence itself; it no longer waits for an unrelated run-status request. A previously cached `entry_missing` can recover through these checks; a failed run or unrelated file cannot.

## Focused checks

- 47 tests passed across AvatarMenu, menu opening, onboarding selection and document preparation.
- 45 focused preview tests passed, including a regression that fails before the fix for both watcher updates and Reload after an earlier successful paint.
- 68 tests passed across the header/footer workspace, blockout preview and background-read components after neutralizing provider-specific labels.
- 108 focused link and in-project routing tests passed. The apparently duplicated relative link in the browser accessibility tree routes correctly through the existing Markdown click handler; an exact nested-route regression covers it. No routing source change was needed.
- 23 focused toolbar-action, post-design and provider tests passed, including completion without an HTML identity change and pending receipt polling.
- 23 focused backend registration/context/scope tests passed, including the parent-conversation to child-document HTTP round trip.
- 85 focused delivery/finalization/receipt tests passed for terminal validation and exact registration attribution.
- Web typecheck, contracts build, daemon build and daemon test typecheck passed.
- No full daemon or web suite was run.

## Provider boundary

At the first check Claude Code 2.1.296 was installed but signed out. After the user signed in through the CLI, the follow-up connection check below passed. This does not extend the Normal/Fast design-flow claims above to Claude.

Anthropic's current [legal and compliance guidance](https://code.claude.com/docs/en/legal-and-compliance#can-customers-offer-claude-code-in-their-products) permits a user to authenticate the unmodified CLI with their own account under the stated commercial conditions. It prohibits third-party applications from collecting or intermediating Claude.ai credentials or session tokens. This change reuses the existing official CLI adapter and does not introduce an app-owned Claude login or credential handling.

## Fresh live flows

These are real UI-created projects using a small, explicitly demonstrative text file. They are separate from the older synthetic post-design fixture.

| Mode | Project | Conversation | Target |
| --- | --- | --- | --- |
| Normal | `be2a8c6d-6aac-4ece-ae9f-706f74bd72f8` | `6450f850-6917-4987-801f-1b311bd7071b` | Two portrait A4 pages, no cover or header, numbered footer. |
| Fast | `49cab9a7-6598-48c8-9d01-8bfe8e1f1adf` | `d284321e-2513-488b-ab86-38d1f8804278` | The same target, with the brief and text supplied through quick creation. |

Each project was created once through the UI. The target is deliberately small: a complete creation-to-design test, not a repeat of the separate 8 A4 / 4 A3 tender-material scenario. These are operator-driven live tests with the real Codex CLI, not new blind-agent evaluations.

### Normal — passed

The flow collected document format and recurring-parts choices through native grouped questions. The new numbered footer passed through its dedicated structure, graphic preview, review and application controls. Codex then produced three complete two-page empty-block proposals. Clicking page two opened that page in the proposal modal. Choosing its composition opened the editor; the text block was resized and autosaved before the formal design approval question and native chat submission.

The initial design run `9b40eb20-e5b5-46e4-bbd3-883bd0d67683` succeeded with a valid deliverable. Its applied revision was `b9040911-8349-4d9d-988a-147334fd006a`.

From the finished HTML, scrolling to page two and choosing **Modifica composizione di questa pagina** opened page two with the design guide. Hiding and showing the guide worked. The method text block was changed to 55% page width; separate page feedback requested a faint diagonal **PROVA** watermark behind all blocks. **Aggiorna il design** prepared one versioned Blockout packet in the chat, without attaching the gallery. Native Send launched run `cb6de608-21d4-4ff3-be99-958812a13aa0`, which succeeded in 1m 1s with a valid delivery and applied revision `f9d26801-f8c8-4f2d-84ab-1c48e6b8f93b`.

The open preview refreshed without a reload. The realized text width is 55.0004%; its height adapted to preserve the text. The watermark is a page-wide pseudo-element rather than an extra block. Both pages remain present, all paragraphs are unchanged, and the first page is byte-identical. The registry still contains one document. No chat workaround was used for the composition update.

### Fast — passed after two fixes

Quick creation uploaded the same demonstrative text and supplied the two-page brief once. The numbered footer was reviewed and applied through the dedicated editor. Three empty-block alternatives were created; page two opened correctly in the modal and editor. A first native design submission exposed a parent/child registration boundary and was not counted as a pass. After the scoped handoff fix, native approval and submission produced successful run `549971af-eb88-448c-aa4b-c83788f59acc` and registration `db0d961a-4104-4b4b-ba8b-1ceedfe9fe1e`.

This revealed a second issue: non-strategy finalization had not persisted delivery validity, and a later status request judged the old comparison entry instead of the newly registered design HTML. After the terminal-validation fix and a safe idle daemon restart, the existing receipt passed the production verifier and became applied. No receipt file was manually changed and no extra model call was needed for that recovery.

The finished preview now exposes the composition action. It opened the visible second page; guide toggling, resizing the method block from 72% to 55%, page-wide **PROVA RAPIDA** feedback and autosave worked. **Aggiorna il design** prepared packet `7bf96a6e-bffc-4f99-877c-30617ec465c9`, with the applied design as its base and only the page background and method block changed. No gallery images were attached. Native Send launched real update run `8d20836c-1daa-4d16-8257-1cb0208c8969`, which succeeded in 1m 43s with `deliverableValid: true`. Applied revision `45d13121-a6c3-4685-aba8-39ce9ee9a54d` retains canonical entry `relazione-finale-rapida.html`; `sourceChanged` and `pendingChanges` are false.

The method width is exactly 115.5 mm on a 210 mm page, or 55%. Its height grew to accommodate all words. The diagonal watermark is a separate page-wide SVG behind the blocks, without an extra composition block. The saved HTML comparison confirms two pages, byte-identical first-page markup, and identical paragraph text after normalizing span line breaks. Numbering and the synthesis section remain unchanged. Reopening from the canonical preview again selected page two, showed the new design as its guide, and exposed the realized 55% width and 16.4983% height. The editor closed normally. Both project registries still contain exactly one document.

The agent also wrote a `-v2.html` companion during this test, and the existing artifact-opening behavior selected that file at completion. The canonical document was then selected through its existing tab and verified. Consequently the uninterrupted automatic-refresh proof is the Normal run above; the Fast run proves native editing, scoped delivery registration, the canonical result and continued editing, without claiming that the incidental tab selection stayed fixed. No extra document was created by the update.

### Evidence

Screenshots, saved request packets, before/after HTML and applied-state/content comparisons are in `.tmp/verification/composition-closeout-2026-10-26/`. Both content checks record two pages before and after, unchanged paragraph text and first page, the requested width and page-wide watermark. This runtime evidence remains outside git. The temporary Low reasoning setting used for these checks was returned to the original Codex GPT-6.1-Sol XHigh setting.

## Known development-only noise

The Next.js development badge showed cancelled fetch warnings while changing views. Inspection did not find the generic logger in application source. Focused cancellation checks retained real failures and observed abandoned requests correctly; no blanket error suppression was added. This observation is distinct from the repaired HTML refresh defect.

## Claude sign-in, Opus 5.5 and upstream review

After the user completed the official CLI sign-in, both its auth probe and the daemon reported authentication available. The local adapter now offers explicit `claude-opus-5-5`, exposes reasoning choices, probes `--effort` support and forwards an explicit supported effort to the official CLI. Default effort still omits the flag. The app saved Claude's preference as **Opus 5.5 / Medium**; Codex remains the primary selected provider with its previous model/effort unchanged. Claude's global settings and credentials were not modified.

The real browser-submitted connection test was run `eee63258-8609-4613-8228-61263e41ddbc`. It succeeded in 9.601 seconds and visibly returned `CLAUDE_OK`. The daemon's start event records requested model `claude-opus-5-5` and reasoning `medium`; Claude's own initializing event reports the same concrete model. It used no tools and wrote no artifacts, as requested. Its artifact validation is therefore `no_artifact`, which is expected for this text-only connection check. This is authentication/model execution evidence, not a full Claude document-design acceptance test.

The new effort-forwarding regression, existing Claude resume/thinking-display tests and agent argument suite passed: **63 tests across four files**. Daemon build passed. The result and selected model/effort are shown in `.tmp/verification/composition-closeout-2026-10-26/claude-opus55-medium-check.png`.

The original repository is `nexu-io/open-design`, confirmed by the local upstream remote. Its current `main` adapter was read through GitHub and still lacks both explicit Opus 5.5 and effort forwarding. The most relevant reports and their checked states are:

| Report | Checked upstream status | Relevance to this installation |
| --- | --- | --- |
| [#6180](https://github.com/nexu-io/open-design/issues/6180), stale catalog and resolved-model reporting | Open for remaining catalog cleanup. Comments confirm the resolved-model display portion already shipped in #6386. | The local explicit Opus 5.5 addition addresses the requested missing choice. The real check used Claude's initializing event rather than trusting a self-reported model in prose. |
| [#6046](https://github.com/nexu-io/open-design/pull/6046), reasoning passthrough; [#8636](https://github.com/nexu-io/open-design/pull/8636), newer models and model-specific effort | #6046 open/unmerged; #8636 closed/unmerged. | Same underlying effort gap as this local change. The wider proposals also handle legacy-model restrictions; this round validates Opus 5.5 / Medium specifically, not every legacy model/effort pairing or older CLI. |
| [#3146](https://github.com/nexu-io/open-design/issues/3146), stalled daemon-spawned Claude stdin transport | Open. Recent maintainer comments distinguish initial-frame/backpressure stalls from the later close-on-terminal fix. | The same stream-json/live-stdin transport is used locally. The 9.6-second check exited cleanly, so it did not reproduce the report. Large prompt, host-question round trip and cancellation remain separate stress cases. |
| [#4729](https://github.com/nexu-io/open-design/issues/4729), context-overflow compact/retry | Open; recent comments distinguish existing native resume from the still-requested compact/retry recovery. | The adapter already supports native session resume. An overfull long-running Claude design session was not tested here, and automatic compact/retry is not claimed. |
| [#5036](https://github.com/nexu-io/open-design/issues/5036) and [#8698](https://github.com/nexu-io/open-design/pull/8698), thinking-only stalls or missing tool/artifact output | Issue and PR open. | The report concerns non-Anthropic models routed through Claude Code. It does not establish a failure of native Opus 5.5; its watchdog proposal is relevant to broader reliability work. |
| [#9072](https://github.com/nexu-io/open-design/issues/9072), Cloud gateway auto-mode classifier failures | Open, reported October 26. | Separate Cloud API endpoint and auto-mode configuration. No custom Anthropic endpoint or API key was configured in the inspected local Claude user settings or shell environment; the installed CLI reports first-party subscription authentication. |

[Prompt-too-long misclassification #6979](https://github.com/nexu-io/open-design/issues/6979) is closed, and [#7044](https://github.com/nexu-io/open-design/pull/7044) documents its fix. It should not be listed as an unresolved credential problem. No upstream PR was merged or cherry-picked during this review.
