// @vitest-environment jsdom
import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { IframeKeepAliveProvider, PooledIframe } from '../../src/components/IframeKeepAlivePool';

afterEach(cleanup);

function Harness() {
  const [visible, setVisible] = useState(false);
  return (
    <IframeKeepAliveProvider>
      <button onClick={() => setVisible(!visible)}>Toggle preview</button>
      {visible && <StrictMode><PooledIframe
        cacheKey={'project\0index.html'}
        src="/api/projects/project/raw/index.html"
        title="Document preview"
        sandbox="allow-scripts"
        data-od-active="true"
      /></StrictMode>}
    </IframeKeepAliveProvider>
  );
}

describe('preview frame mount replay', () => {
  it('keeps the browsing context connected during a synchronous release and reattachment', async () => {
    const removed: Node[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) removed.push(...record.removedNodes);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      render(<Harness />);
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Toggle preview' })); });
      const frame = screen.getByTitle('Document preview');
      expect(frame.isConnected).toBe(true);
      expect(removed).not.toContain(frame);
    } finally { observer.disconnect(); }
  });

  it('parks an actually unmounted preview after the commit and reuses it on return', async () => {
    render(<Harness />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Toggle preview' })); });
    const frame = screen.getByTitle('Document preview');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Toggle preview' })); });
    expect(frame.isConnected).toBe(true);
    expect(frame.getAttribute('data-od-active')).toBe('false');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Toggle preview' })); });
    expect(screen.getByTitle('Document preview')).toBe(frame);
    expect(frame.getAttribute('data-od-active')).toBe('true');
  });
});
