/** Explicit owner policy for Codex processes launched by this local app. */
export const CODEX_SANDBOX_MODE = 'danger-full-access' as const;

export function codexPermissionArgs(): string[] {
  return ['-c', 'approval_policy="never"', '-c', 'approvals_reviewer="user"'];
}

export function codexWorkerPermissionArgs(): string[] {
  return ['--sandbox', CODEX_SANDBOX_MODE, ...codexPermissionArgs()];
}
