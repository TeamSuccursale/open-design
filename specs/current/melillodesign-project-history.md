# MelilloDesign project history

The project owns a private recovery history independently of any Git repository in its working folder. Existing source files, Git metadata, staged changes, branches, configuration and hooks are integration inputs, never the history engine's repository. Private history storage derives from the daemon's resolved data root; see the root AGENTS.md **Daemon data directory contract**.

## Required behavior and validation

| ID | Behavior | Validation |
| --- | --- | --- |
| HISTORY-01 | App-owned file writes, renames, deletions and Blockout saves preserve the prior and new saved state. A successful app save waits for recovery persistence. Unchanged bytes produce no duplicate version. | Write two versions rapidly through the app boundary, reopen the store and recover both. Exercise Blockout metadata, text and binary uploads. Inject a recovery failure and verify it is not reported as a fully protected save. |
| HISTORY-02 | A private watcher continues capturing stable external/CLI file changes after the UI closes. Previously registered projects resume watching on daemon restart. Unsaved editor buffers are not disk saves. | External save/rename/delete, close the tab, restart the service, and restore captured data. Ignore internal history and temporary write files to avoid recursive snapshots. |
| HISTORY-03 | Accumulate active work from real user interaction, saved changes and active agent execution. Commit changed work after 45 minutes, or once after ten minutes idle. No empty commits; new work rearms idle behavior. Persist timers without counting daemon downtime as active work. | Fake-clock tests cover threshold boundaries, long running agents, idle commit once, resume and restart. A passive visible tab sends no periodic activity heartbeat. |
| HISTORY-04 | Preserve each save while presenting longer commits as meaningful work summaries. Use recorded agent results and changed-file facts; snapshotting never depends on another model call. | Observe save versus commit entries; verify agent completion contributes a bounded summary and unavailable summaries fall back to an honest description. |
| HISTORY-05 | History can list versions, inspect their files, compare saved versions or compare against current files, and restore selected paths or a full state. Show binary metadata and bounded text comparisons. | HTTP/CLI and UI tests cover version selection, comparison, exact restore paths and binary handling. No image batch is loaded for history browsing. |
| HISTORY-06 | A restore checks the current revision, refuses while an agent is active, preserves a safety version first, and records its result as a recoverable change. Current-only files restored to absence are explicitly disclosed. | Test stale revision, external changes since preview, active agent, partial restore, full restore and recovery of the pre-restore state. Reject traversal and symlinks escaping the workspace. |
| HISTORY-07 | Existing Git repositories remain independent, including dirty and staged work. No repository discovery or project Git index/config/hooks is used. | Compare original HEAD, index, config and Git directory contents before and after capture, commit and restore. A folder without Git gets the same history behavior. |
| ORGANIZE-01 | A separate organization review becomes due after two hours of active work or once after 30 minutes idle, when work has changed since the prior review. A ten-minute idle commit does not cancel this review. | Fake-clock tests distinguish the two schedules, repeated idle ticks and rearming. |
| ORGANIZE-02 | Reviews inventory file families, protect originals/current inputs and inspect dependencies. Potential supersession is a question, not a conclusion drawn from age. No timer moves, deletes or rewrites files. | Review fixtures include original PDFs, user annotations, linked assets and possible generated variants. Verify files and links stay unchanged, and review limitations are visible. |
| SURFACE-01 | Both UI and `od history` use the same authorized HTTP endpoints. Mutations enforce project write authority and local request protections. | Focused route/CLI tests cover authorization, JSON input, prompt-file input, invalid paths and active-agent restore rejection. |

## Organization rationale

The user explicitly requested reading `gare-riordino-cartella` as inspiration. This feature borrows protected originals, decisions based on the current work, and dependency checks. An explicit archive plan and recovery trail remain requirements for any future relocation. It does not activate tender authoring or import the skill's project-specific stages, register ceremonies, Git commands or folder conventions. Its instruction not to reorder in the middle of a stage simply for tidiness becomes a timed **read-only review** here. Actual relocation requires a separately reviewed concrete plan; this implementation does not silently classify user material as disposable.

## Practical boundaries

Recovery covers persisted file bytes while the local daemon is observing the project. Filesystem notifications can coalesce rapid external writes: these yield stable saved states, whereas app-owned writes use an awaited save boundary. A process that rewrites the same file repeatedly before the operating system reports a stable save cannot be made to expose every intermediate buffer by a watcher. A closed daemon cannot observe transient external versions; reopening reconciles the current disk state. Dependency/cache/VCS exclusions remain visible in history status. History is local version recovery; it does not replace an off-device backup.

## Validation evidence · 24 October 2026

- 28 focused daemon tests pass: real private Git objects, unchanged dirty project repositories, binary/rename/delete recovery, partial-write recovery, stale revisions, interrupted restores, cache invalidation, background guards, watcher/restart behavior, HTTP/CLI and pagination.
- Timer thresholds use controlled clocks: 45 minutes of work, one 10-minute idle commit, independent two-hour/30-minute organization review, rearming and downtime behavior.
- 25 focused history UI/provider tests pass. Additional focused Blockout tests cover restoring metadata with an unchanged HTML timestamp, refreshing the catalogue, preserving unsaved editor drafts and matching project scope.
- `pnpm guard`, repository `pnpm typecheck`, and daemon build pass with Node 24 and pnpm 10.33.2.
- Live disposable project `df10613b-53d6-459c-bd0d-cbf8e5cd49fd`: save two text versions, compare via CLI and panel, restore only the test file, then recover its second version. Both restores preserve safety snapshots. A four-byte binary upload is recoverable immediately when upload returns; its subsequent deletion is recorded. A manual organization review protects 52 paths and leaves the file snapshot unchanged.
- Existing Windows regression failures remain outside the new history suite: three legacy symlink fixtures require privileges unavailable on this PC; the legacy `.file-versions` rename-to-existing-directory case returns `EPERM`. The latter was reproduced independently. These are not counted as passing history validation.

The daemon is running the built implementation. History uses no extra model calls; commit descriptions use recorded agent results and changed-file facts. Organization reviews remain read-only.
