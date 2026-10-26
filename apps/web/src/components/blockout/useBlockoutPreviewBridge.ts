import { useEffect } from 'react';
import { blockoutPreviewOpenMessage, blockoutProposalSelectMessage, isBlockoutComparisonFile } from '@open-design/contracts';
import { openBlockoutEditor, openBlockoutProposals } from './events';
import { loadBlockout, saveBlockout } from '../../providers/blockout';
import { useProjectCollabContext } from '../../collab/collab-context';

/** The active comparison's browsing context is the trust boundary, not its message payload. */
export function useBlockoutPreviewBridge(projectId: string, filePath: string, isActiveSource: (source: MessageEventSource | null) => boolean) {
  const { workspaceContext } = useProjectCollabContext();
  useEffect(() => {
    if (!isBlockoutComparisonFile(filePath)) return;
    const receive = (event: MessageEvent) => {
      if (!isActiveSource(event.source)) return;
      const target = blockoutPreviewOpenMessage(event.data);
      // Legacy comparison thumbnails may navigate to selection, never directly to editing.
      if (target) openBlockoutProposals({ projectId, documentId: target.documentId, pageId: target.pageId });
      const choice = blockoutProposalSelectMessage(event.data);
      if (choice) void (async () => {
        const reply = (saved: boolean) => { try { (event.source as Window | null)?.postMessage({ type: 'melillodesign:blockout-proposal-result', documentId: choice.documentId, variantId: choice.variantId, saved }, '*'); } catch { /* The preview may have closed after a successful choice. */ } };
        try {
          const current = await loadBlockout(projectId, workspaceContext, undefined, choice.documentId);
          const variant = current.document?.variants.find((variant) => variant.id === choice.variantId);
          if (!current.document || !variant || (choice.editPageId && !variant.pages.some((page) => page.id === choice.editPageId))) throw new Error('Missing proposal or page');
          await saveBlockout(projectId, { ...current.document, activeVariantId: choice.variantId, selectedVariantId: choice.variantId }, current.raw, workspaceContext);
          reply(true);
          if (choice.editPageId) openBlockoutEditor({ projectId, documentId: choice.documentId, variantId: choice.variantId, pageId: choice.editPageId });
          else openBlockoutProposals({ projectId, documentId: choice.documentId, variantId: choice.variantId });
        } catch { reply(false); }
      })();
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [projectId, filePath, isActiveSource, workspaceContext]);
}
