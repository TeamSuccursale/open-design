// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentSetupIntent } from '@open-design/contracts';
import { ProjectSearchModal } from '../../src/components/ProjectSearchModal';
import { I18nProvider } from '../../src/i18n';
import type { Project } from '../../src/types';

afterEach(cleanup);
function project(id: string, metadata: Project['metadata']): Project {
  return { id, name: id, skillId: null, designSystemId: null, createdAt: 1, updatedAt: 1, metadata };
}
function setup(projects: Project[], language: 'en' | 'it' = 'en') {
  render(<I18nProvider initial={language}><ProjectSearchModal projects={projects} onOpenProject={vi.fn()} onClose={vi.fn()} /></I18nProvider>);
}

describe('existing document project labels', () => {
  it.each([
    ['report', 'Report', 'Relazione'],
    ['tender-offer', 'Tender offer', 'Offerta di gara'],
    ['tender-form', 'Tender form', 'Modulo di gara'],
    ['free', 'Free document', 'Documento libero'],
    ['other', 'Document', 'Documento'],
  ] as const)('shows the selected %s category instead of Prototype', (kind, label, _italianLabel) => {
    const intent: DocumentSetupIntent = { kind, subtype: kind === 'free' ? '' : 'Specialized document', purpose: 'Present supplied project material', contextRoots: [], imageIntakeConsent: false };
    setup([project('document', { kind: 'other', intent: 'document', documentSetupIntent: intent })]);
    const row = within(screen.getByTestId('project-search-item-document'));
    expect(row.getByText(label)).toBeTruthy(); expect(row.queryByText('Prototype')).toBeNull();
  });

  it('labels an older document intent as Document and leaves actual prototypes unchanged', () => {
    setup([project('older-document', { kind: 'other', intent: 'document' }), project('prototype', { kind: 'prototype' })]);
    expect(within(screen.getByTestId('project-search-item-older-document')).getByText('Document')).toBeTruthy();
    expect(within(screen.getByTestId('project-search-item-prototype')).getByText('Prototype')).toBeTruthy();
  });

  it('uses the Italian document categories shown in the guided creation flow', () => {
    setup((['report', 'tender-offer', 'tender-form', 'free', 'other'] as const).map((kind) => project(kind, { kind: 'other', intent: 'document', documentSetupIntent: { kind, subtype: 'Tipo specifico', purpose: 'Presentare i materiali del progetto', contextRoots: [], imageIntakeConsent: false } })), 'it');
    for (const [id, label] of [['report', 'Relazione'], ['tender-offer', 'Offerta di gara'], ['tender-form', 'Modulo di gara'], ['free', 'Documento libero'], ['other', 'Documento']]) {
      expect(within(screen.getByTestId(`project-search-item-${id}`)).getByText(label!)).toBeTruthy();
    }
  });
});
