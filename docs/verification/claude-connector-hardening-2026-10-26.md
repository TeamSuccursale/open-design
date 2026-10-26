# Claude connector hardening — 26 October 2026

Scope: resolve the locally applicable failures identified in the upstream connector review, then verify the real first-party Claude Code connection. This follows the initial connection check in `composition-closeout-2026-10-26.md`; that earlier smoke test did not cover recovery.

## Changes and acceptance evidence

| Failure or ambiguity | Resulting behavior | Validation |
| --- | --- | --- |
| Stale model hints and missing effort forwarding ([#6180](https://github.com/nexu-io/open-design/issues/6180), [PR #6046](https://github.com/nexu-io/open-design/pull/6046), [PR #8636](https://github.com/nexu-io/open-design/pull/8636)) | Updated verified model hints; each model exposes its supported effort levels. Explicit unsupported CLI/model effort fails before launch instead of silently reverting. UI and `od run start/redesign --reasoning` use the same settings. | Runtime argument/model tests, CLI HTTP payload tests, model-picker tests; real native init reports `claude-opus-5-5`, with Medium in the stored request. |
| Silent live-stdin startup ([#3146](https://github.com/nexu-io/open-design/issues/3146)) | Claude now actually arms its first-output deadline before writing its opening frame. Default: 120 seconds. Only a completely silent first attempt, with no parsed event, tool or artifact, can retry once using complete file-backed text stdin. No prompt is placed in argv or truncated. | HTTP/native Windows child fixture stalls before reading the opening stream; the retry receives over 250 KB including the final Unicode request marker. Exactly two launches, one changed input transport. |
| A native terminal result is followed by a stuck exit hook | Allow 15 seconds for normal exit after the session result, then terminate that captured process generation. A message-level `end_turn` is insufficient; `tool_use` never arms the terminal shutdown. | Native child fixture produces a successful result and never exits. The run completes successfully after bounded shutdown. Recorded-stream parent/child and terminal-boundary regressions remain required. |
| Endless thinking/raw keepalives ([#5036](https://github.com/nexu-io/open-design/issues/5036), [PR #8698](https://github.com/nexu-io/open-design/pull/8698)) | Claude's useful-progress watchdog counts decoded nonempty text, tools, artifacts and terminal results. Thinking, whitespace, raw stdout/stderr and init/status chatter cannot extend it indefinitely. Real thinking still satisfies initial-output detection, so the shorter startup timer does not cut off valid extended reasoning. | Windows-native HTTP fixture continuously emits all four non-progress signals and is stopped. Conversational text-only control succeeds with zero artifacts. |
| Production returns an acknowledgement but creates nothing | An explicitly host-owned production stage must write/update an artifact; an acknowledgement alone fails visibly. Conversational, planning and pending-question turns remain valid without files. | Completion-policy tests cover production, cancellation, current-run writes, normal chat and pending forms. Production guard resolves disk changes before deciding. |
| Native session context overflow ([#4729](https://github.com/nexu-io/open-design/issues/4729)) | For a validated resumed session and structured terminal context error, compact once using Claude itself, then replay only the latest turn once. Shared retry/continuation budgets prevent another recovery loop. Current-turn output/tools/edits, invalid sessions and other failures refuse automatic replay. | Four HTTP/native Windows regressions cover success, rejected compaction, repeated overflow and Stop. Same UUID, latest request only, no intermediate error, one compact/one retry. |
| Compaction subprocess ownership and credentials | Stop owns the compact subprocess. Compact has no tools or external MCP, has a finite timeout, preserves native rejection hooks, and must emit a matching manual compact boundary. The failed run's tool grant is revoked; replay receives a fresh grant. | HTTP fixture confirms actual descendant termination, old grant rejected during compact, fresh grant accepted on retry, zero active grants afterward. Real installed CLI verifies the native compact protocol. |
| Windows `.cmd` drops a separate empty `--tools` argument | Use the single `--tools=` argument, preserving an empty native-tool list through command wrappers. | Actual Windows `.cmd` argv regression, then real `.exe` compact/resume repeated with this argument. |
| Windows `od run --follow` crashes while finishing | Cancel/release terminal SSE streams and drain the command's owned dispatcher; run commands exit naturally instead of forcing process exit through closing libuv handles. | CLI success/error/follow tests, including a server that leaves its SSE connection open after the terminal event. |
| Cloud gateway compatibility errors mislabelled as login failures ([#9072](https://github.com/nexu-io/open-design/issues/9072)) | Surface classifier HTTP 400 and missing `count_tokens` HTTP 404 as compatibility failures, without login advice or converting rejection into approval. | Diagnostic fixtures distinguish these errors from a genuine HTTP 401 authentication failure. |

The Cloud gateway backend itself is external to this fork. These changes improve local diagnosis; they do not claim to repair that remote service. The live checks use the user's existing first-party Claude Code sign-in.

## Real CLI and browser checks

Disposable verification project: `774d474a-99cf-42a5-aa61-a830cee3c83d`, conversation `e8cea293-9603-43c5-80b6-c78315e3b892`.

1. Selected Claude Code in the native app picker. Saved provider preference was restored as Opus 5.5 / Medium.
2. Chat requested one test file. Native `Write` and `Read` completed; file contained `RECOVERY_MAPLE_1`.
3. A resumed turn rendered a real question form with two suffix choices. The file remained unchanged while awaiting the answer.
4. Selected `MAPLE_3` and submitted the form. The continuation used native `Write`; the actual file contains `RECOVERY_MAPLE_3`.
5. Started a harmless wait command and pressed Stop in the UI. The run is `canceled`, with exactly one terminal event, rather than a misleading execution failure or later success.
6. Restored Codex GPT-6.1-Sol / XHigh as the active default. Claude's saved Opus 5.5 / Medium preference remains available.

All four live runs report the concrete native model `claude-opus-5-5`. The first three succeed with exit 0; the last is canceled. Each has one terminal event.

After the final daemon restart, the actual `od run start --agent claude --model claude-opus-5-5 --reasoning medium --follow --json` command also completed: `CLAUDE_FOLLOW_OK`, exit 0, no stderr, 6.35 seconds. This verifies the Windows CLI completion fix against the real Claude connection, in addition to mocked HTTP command tests.

Separate disposable native session proof: seed → resume → manual compact → resume. With the final `--tools=` argument, compact reduced 4,339 tokens to 950; afterward Claude retained `RECOVERY_MAPLE` and both document specifications: eight portrait A4 report pages and four landscape A3 graphic pages. No user document/session was compacted for this test.

## Verification records

Local generated evidence, excluded from Git:

- `.tmp/verification/claude-connector-hardening-2026-10-26/live-project.json`
- `.tmp/verification/claude-connector-hardening-2026-10-26/live-results.json`
- `.tmp/verification/claude-connector-hardening-2026-10-26/live-cli-result.png`
- `.tmp/verification/claude-connector-hardening-2026-10-26/final-restarted-app.png`
- `.tmp/verification/claude-connector-hardening-2026-10-26/od-follow-result.json`
- `.tmp/verification/claude-context-recovery-2026-10-26/result.json`

Focused test groups cover settings/CLI forwarding, model-picker behavior, actionable progress, completion, transport recovery, native context compaction, retry/session guards and recorded native streams. No full daemon or web suite was requested or run.

The daemon source build, daemon source/test TypeScript check and repository guard pass.

Final focused results:

| Group | Result |
| --- | --- |
| Settings, model metadata, CLI flags and CLI completion | 117 tests passed across 6 files |
| Model-picker UI | 20 tests passed |
| Progress, diagnostics, inactivity and artifact shutdown | 117 tests passed across 5 files, including 2 Windows-native HTTP tests |
| Startup transport and terminal exit grace | 5 tests passed across 2 files, including 2 Windows-native HTTP tests |
| Context recovery helper and HTTP/native child integration | 34 tests passed across 2 files, including 4 HTTP tests |
| Native-session, retry, argv, recorded-stream and stdin guards | 186 tests passed across 8 files |
| Parent/child terminal truth | 2 native Windows tests passed after repairing their test launchers |

Some groups overlap; these figures must not be added as a unique total. Earlier failures in the startup regression exposed the unarmed Claude deadline and insufficient fixture timing. The final test retains a bounded client deadline and checks actual full-prompt delivery. The parent/child fixtures previously used POSIX launchers on Windows; both now assert the fake CLI's concrete model so an accidental fallback to the installed real Claude cannot pass unnoticed. Original crash/recovery assertions remain intact, with no Windows skips.

After reconnecting the browser, the restarted app loaded the saved file and all five run outcomes, including the actual CLI follow result. The composer showed Codex GPT-6.1-Sol as the active agent. The verification page is left open for inspection.
