import { describe, expect, it } from 'vitest';
import { buildFastHeaderFooterContinuationPrompt, headerFooterContinuationKey } from '../../src/runtime/header-footer-continuation';
import type { HeaderFooterWorkspaceResponse } from '@open-design/contracts';

describe('header/footer first-application continuation', () => {
  it('continues the saved Fast request without inventing body work or restarting its interview', () => {
    const prompt = buildFastHeaderFooterContinuationPrompt('Relazione demo');
    expect(prompt).toContain('«Relazione demo»'); expect(prompt).toContain('richiesta di documento già confermata'); expect(prompt).toContain('contesto salvato');
    expect(prompt).toContain('Non ripetere l’intervista'); expect(prompt).toContain('Se la richiesta comprendeva il Blockout'); expect(prompt).toContain('Se era stata richiesta soltanto intestazione e piè di pagina'); expect(prompt).toContain('senza creare pagine o altri elaborati');
  });
  it('does not create a dispatch identity for an unpublished or pending draft', () => {
    expect(headerFooterContinuationKey('project', 'report', undefined)).toBeNull();
    const workspace = { bindings: [{ documentId: 'report', status: 'pending', snapshot: {}, setId: 'studio', appliedRevision: 1 }] } as unknown as HeaderFooterWorkspaceResponse;
    expect(headerFooterContinuationKey('project', 'report', workspace)).toBeNull();
  });
  it('uses the applied revision and document identity to make repeated callbacks idempotent', () => {
    const workspace = { bindings: [{ documentId: 'report', status: 'applied', snapshot: {}, setId: 'studio', appliedRevision: 2 }] } as unknown as HeaderFooterWorkspaceResponse;
    expect(headerFooterContinuationKey('project', 'report', workspace)).toBe('project:report:studio:2');
    expect(headerFooterContinuationKey('project', 'booklet', workspace)).toBeNull();
    workspace.bindings[0]!.appliedRevision = 3; expect(headerFooterContinuationKey('project', 'report', workspace)).toBe('project:report:studio:3');
  });
});
