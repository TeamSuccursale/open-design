import { useEffect, useRef, useState } from 'react';
import type { BlockoutDesignRevision, WorkspaceCollabContext } from '@open-design/contracts';
import { loadBlockoutDesign } from '../../providers/blockout-design';
import { openBlockoutEditor } from './events';
import { useT } from '../../i18n';
import { Icon } from '../Icon';

export function visibleDesignedPage(frame: HTMLIFrameElement | null, pages: string[]): string | undefined {
  try {
    const nodes = frame?.contentDocument?.querySelectorAll<HTMLElement>('[data-blockout-page-id]');
    const height = frame?.contentWindow?.innerHeight ?? 0, width = frame?.contentWindow?.innerWidth ?? 0;
    let best: string | undefined, area = 0;
    nodes?.forEach((node) => {
      const id = node.dataset.blockoutPageId!; if (!pages.includes(id)) return;
      const box = node.getBoundingClientRect();
      const visible = Math.max(0, Math.min(height, box.bottom) - Math.max(0, box.top)) * Math.max(0, Math.min(width, box.right) - Math.max(0, box.left));
      if (visible > area) { area = visible; best = id; }
    }); return best;
  } catch { return undefined; }
}
export function BlockoutCompositionAction({ projectId, filePath, html, workspaceContext, getFrame, generating = false }: {
  projectId: string; filePath: string; html: string; workspaceContext?: WorkspaceCollabContext | null; getFrame: () => HTMLIFrameElement | null; generating?: boolean;
}) {
  const t = useT();
  const documentId = /\bdata-blockout-document-id\s*=\s*["']([\w.-]+)["']/.exec(html)?.[1];
  const [binding, setBinding] = useState<{ key: string; revision: BlockoutDesignRevision } | null>(null);
  const [opening, setOpening] = useState(false), cancelRequest = useRef<(() => void) | null>(null);
  const identity = `${projectId}\0${filePath}\0${documentId ?? ''}`;
  useEffect(() => { setOpening(false); return () => cancelRequest.current?.(); }, [identity]);
  useEffect(() => {
    setBinding(null); if (!documentId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const { state, projectId: owner } = await loadBlockoutDesign(projectId, documentId, workspaceContext, controller.signal);
        if (controller.signal.aborted) return;
        const applied = state.applied;
        const files = applied ? [applied.entryFile, ...applied.pages.map((page) => page.filePath)] : [];
        if (applied && files.some((file) => file === filePath || (owner !== projectId && `documents/${documentId}/${file}` === filePath))) setBinding({ key: identity, revision: applied });
        // The completed run can leave validation briefly pending after its
        // final HTML write. Re-read that explicit state until it settles.
        if (!generating && state.pending.some((revision) => revision.status === 'pending')) timer = setTimeout(() => { void read(); }, 10_000);
      } catch { /* An unregistered or unavailable design has no editor action. */ }
    };
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [identity, html, workspaceContext, generating]);
  if (!binding || binding.key !== identity || !documentId) return null;
  return <button type="button" aria-busy={opening} disabled={opening} onClick={() => {
    const pages = binding.revision.pages.map((page) => page.pageId);
    const open = (pageId?: string) => openBlockoutEditor({ projectId, documentId, variantId: binding.revision.snapshot.variant.id, pageId: pageId ?? pages[0] });
    const frame = getFrame(), direct = visibleDesignedPage(frame, pages);
    if (direct || !frame?.contentWindow) { open(direct); return; }
    setOpening(true);
    const requestId = crypto.randomUUID();
    const finish = (pageId?: string) => { cancel(); setOpening(false); open(pageId); };
    const message = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.type !== 'od:blockout-visible-page' || event.data?.requestId !== requestId || event.data?.documentId !== documentId) return;
      if (pages.includes(event.data.pageId)) finish(event.data.pageId);
    };
    const timer = setTimeout(() => finish(), 600);
    const cancel = () => { clearTimeout(timer); window.removeEventListener('message', message); cancelRequest.current = null; };
    cancelRequest.current = cancel; window.addEventListener('message', message);
    frame.contentWindow.postMessage({ type: 'od:blockout-visible-page-request', requestId }, '*');
  }}><Icon name="blocks" size={15} />{t('blockout.editComposition')}</button>;
}
