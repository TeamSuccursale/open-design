export const OPEN_PROJECT_HISTORY_EVENT = 'melillodesign:project-history-open';
export interface OpenProjectHistoryDetail { projectId: string }
export function openProjectHistory(detail: OpenProjectHistoryDetail) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<OpenProjectHistoryDetail>(OPEN_PROJECT_HISTORY_EVENT, { detail }));
}
