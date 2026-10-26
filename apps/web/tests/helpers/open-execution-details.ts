import { fireEvent } from '@testing-library/react';

/** Content-boundary tests inspect execution details through the same manual action as the user. */
export function openExecutionDetails(root: HTMLElement): void {
  const details = root.querySelector<HTMLDetailsElement>('details');
  const summary = details?.querySelector('summary');
  if (details && summary && !details.open) {
    fireEvent.click(summary);
    fireEvent(details, new Event('toggle'));
  }
}
