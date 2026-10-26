/** One save boundary for app-owned writes. The daemon installs its recorder at startup. */
export interface ProjectHistoryMutation { root: string; projectId?: string; paths: string[] }
export type ProjectHistoryMutationObserver = <T>(mutation: ProjectHistoryMutation, write: () => Promise<T>) => Promise<T>;
let observer: ProjectHistoryMutationObserver | null = null;
export function installProjectHistoryObserver(next: ProjectHistoryMutationObserver): () => void {
  observer = next;
  return () => { if (observer === next) observer = null; };
}
export function withProjectHistoryMutation<T>(mutation: ProjectHistoryMutation, write: () => Promise<T>): Promise<T> {
  return observer ? observer(mutation, write) : write();
}
