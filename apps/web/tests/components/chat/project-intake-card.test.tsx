// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../src/i18n';
import { ProjectIntakeCard } from '../../../src/components/chat/ProjectIntakeCard';
import { fetchProjectIntake, OPEN_PROJECT_GALLERY_EVENT } from '../../../src/providers/project-intake';
import { intakeSnapshot } from '../../helpers/project-status-fixtures';
vi.mock('../../../src/providers/project-intake', () => ({ fetchProjectIntake: vi.fn(async () => ({ version: 1, documents: [], assets: [] })), OPEN_PROJECT_GALLERY_EVENT: 'melillodesign:open-project-gallery' }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('explains added Fast-project PDFs and starts image intake only on an explicit click', async () => {
  render(<I18nProvider initial="en"><ProjectIntakeCard projectId="fast" snapshot={null} sourceNames={['drawing.pdf']} /></I18nProvider>);
  expect(screen.getByText('Documents added')).toBeTruthy(); expect(fetchProjectIntake).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare images and tables' }));
  expect(fetchProjectIntake).toHaveBeenCalledWith('fast', undefined, {});
});
it('shows real progress while processing and opens the existing gallery when ready', () => {
  const snapshot = intakeSnapshot(); snapshot.catalog.documents[0]!.status = 'processing'; snapshot.catalog.documents[0]!.completedPages = 1;
  const view = render(<I18nProvider initial="en"><ProjectIntakeCard projectId="normal" snapshot={snapshot} sourceNames={['Survey.pdf']} /></I18nProvider>);
  expect(screen.getByText('Preparing your visual library')).toBeTruthy(); expect(screen.getByRole('progressbar')).toBeTruthy();
  snapshot.catalog.documents[0]!.status = 'ready'; snapshot.catalog.documents[0]!.completedPages = 2;
  view.rerender(<I18nProvider initial="en"><ProjectIntakeCard projectId="normal" snapshot={{ ...snapshot }} sourceNames={['Survey.pdf']} /></I18nProvider>);
  expect(screen.getByText('Your visual library is ready')).toBeTruthy(); expect(screen.queryByRole('progressbar')).toBeNull();
  const opened = vi.fn(); window.addEventListener(OPEN_PROJECT_GALLERY_EVENT, opened);
  fireEvent.click(screen.getByRole('button', { name: 'Explore the gallery' })); expect(opened).toHaveBeenCalledOnce(); window.removeEventListener(OPEN_PROJECT_GALLERY_EVENT, opened);
});
it('retains an honest attention state and can be dismissed', () => {
  const snapshot = intakeSnapshot(); snapshot.catalog.documents[0]!.status = 'failed';
  render(<I18nProvider initial="en"><ProjectIntakeCard projectId="normal" snapshot={snapshot} sourceNames={['Survey.pdf']} /></I18nProvider>);
  expect(screen.getByText('Some materials need attention')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close' })); expect(screen.queryByTestId('project-intake-card')).toBeNull();
});
