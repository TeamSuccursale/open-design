import { useMemo } from 'react';
import type { BlockoutDesignUnderlay as Underlay, WorkspaceCollabContext } from '@open-design/contracts';
import { projectRawUrl } from '../../providers/registry';
import styles from './BlockoutWorkspace.module.css';

/** An inert, page-only guide. It never turns the design into clipping containers. */
export function isolateDesignedPage(html: string, pageId: string, baseUrl: string): string | null {
  const source = new DOMParser().parseFromString(html, 'text/html');
  const target = [...source.querySelectorAll<HTMLElement>('[data-blockout-page-id]')].find((node) => node.dataset.blockoutPageId === pageId);
  if (!target) return null;
  let child: HTMLElement = target;
  while (child.parentElement && child.parentElement !== source.documentElement) {
    const parent = child.parentElement;
    for (const sibling of [...parent.children]) if (sibling !== child) sibling.remove();
    for (const key of ['margin', 'padding', 'gap', 'transform', 'min-height', 'height', 'width', 'position', 'inset', 'overflow', 'display']) parent.style.removeProperty(key);
    parent.style.setProperty('margin', '0', 'important'); parent.style.setProperty('padding', '0', 'important');
    parent.style.setProperty('display', 'block', 'important'); parent.style.setProperty('transform', 'none', 'important');
    child = parent;
  }
  target.dataset.blockoutUnderlayRoot = '';
  source.querySelectorAll('script,base,iframe,object,embed,meta[http-equiv]').forEach((node) => node.remove());
  source.querySelectorAll('*').forEach((node) => { for (const attribute of [...node.attributes]) if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name); });
  const base = source.createElement('base'); base.href = baseUrl; source.head.prepend(base);
  const reset = source.createElement('style'); reset.textContent = 'html,body{margin:0!important;padding:0!important;overflow:hidden!important}[data-blockout-underlay-root]{margin:0!important;transform:none!important;box-shadow:none!important}'; source.head.append(reset);
  return '<!doctype html>\n' + source.documentElement.outerHTML;
}
export function BlockoutDesignUnderlay({ value, projectId, width, workspaceContext }: { value: Underlay; projectId: string; width: number; workspaceContext?: WorkspaceCollabContext | null }) {
  const source = useMemo(() => isolateDesignedPage(value.html, value.pageId, new URL(projectRawUrl(projectId, value.filePath, workspaceContext), window.location.href).href), [value, projectId, workspaceContext]);
  if (!source) return null;
  return <iframe aria-hidden="true" tabIndex={-1} title="Design reference" sandbox="allow-same-origin" className={styles.designUnderlay} srcDoc={source}
    style={{ width: value.widthPx, height: value.heightPx, transform: `scale(${width / value.widthPx})` }} />;
}
