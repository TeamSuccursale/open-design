import { useEffect, useRef } from 'react';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { fetchProjectIntake } from '../providers/project-intake';

/**
 * Images the engineer attached in a project's chats go into its gallery on their
 * own: once per opened project the daemon takes in any it does not have yet,
 * including those sent before the gallery took images. It runs quietly; a
 * read-only viewer or an unreachable daemon simply leaves the gallery as it is.
 */
export function useAttachedImageIntake(projectId: string | null | undefined, workspaceContext?: WorkspaceCollabContext | null): void {
  const contextRef = useRef(workspaceContext);
  contextRef.current = workspaceContext;
  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    void fetchProjectIntake(projectId, contextRef.current, { attached: true }, controller.signal).catch(() => {});
    return () => controller.abort();
  }, [projectId]);
}
