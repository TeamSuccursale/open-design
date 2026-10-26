import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, Input, Select } from '@open-design/components';
import {
  BlockoutDocumentSchema, adoptAppliedBlockoutDesign, blockoutPageForFile, constrainBlockoutBox, createBlockoutDocument, createBlockoutPage, resolveBlockoutTarget, getBlockoutPageBudgetStatus, moveBlockoutBlock, reorderBlockoutPages,
  blockoutImageFromAsset, type IntakeAsset, type BlockoutImage, type BlockoutBlock, type BlockoutDocument, type BlockoutDocumentEntry, type BlockoutPage, type BlockoutHandoffResponse, type ChatAttachment, type ChatSessionMode, type WorkspaceCollabContext,
} from '@open-design/contracts';
import { listBlockoutDocuments, loadBlockout, saveBlockout, saveBlockoutStartingPoint } from '../../providers/blockout';
import { loadBlockoutDesign, loadBlockoutDesignUnderlay } from '../../providers/blockout-design';
import type { BlockoutDesignState, BlockoutDesignUnderlay } from '@open-design/contracts';
import { PROJECT_HISTORY_UPDATED_EVENT } from '../../providers/project-history';
import { useT } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { Icon } from '../Icon';
import { QuestionFormView } from '../QuestionForm';
import { BlockoutCanvas } from './BlockoutCanvas';
import { BlockoutInspector } from './BlockoutInspector';
import { BlockoutDocumentOverview, type OverviewBlockSelection } from './BlockoutDocumentOverview';
import { BlockoutBudgetCount, BlockoutPageBudget } from './BlockoutPageBudget';
import { BlockoutReadiness } from './BlockoutReadiness';
import { useBlockoutReadiness } from './useBlockoutReadiness';
import type { BlockoutAgentRequest, BlockoutQuestionRequest } from './events';
import { BlockoutGalleryDrawer } from './BlockoutGalleryDrawer';
import { emptyHistory, historyChange, loadEditHistory, stepHistory, storeEditHistory, type EditHistory } from './blockout-edit-history';
import styles from './BlockoutWorkspace.module.css';

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
export function BlockoutWorkspace({ projectId, workspaceContext: suppliedContext, question, initialDocumentId, initialPageId, initialVariantId, initialBlockId, onClose, onUseBrief, onPhaseChange }: {
  projectId: string; workspaceContext?: WorkspaceCollabContext | null; question: BlockoutQuestionRequest | null;
  initialDocumentId?: string; initialPageId?: string; initialVariantId?: string; initialBlockId?: string;
  onClose: () => void; onUseBrief: (text: string, attachments: ChatAttachment[], mode?: ChatSessionMode) => void;
  onPhaseChange?: (mode: ChatSessionMode) => void;
  onRequestAlternatives?: (request: BlockoutAgentRequest) => Promise<boolean>;
}) {
  const contextIdentity = JSON.stringify(suppliedContext ?? null);
  // Parent renders must not reload the document when collaboration scope is unchanged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const workspaceContext = useMemo(() => suppliedContext, [contextIdentity]);
  const t = useT(), dialog = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<BlockoutDocument | null>(null), [selectedPage, setSelectedPage] = useState(''), [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [error, setError] = useState(''), [saving, setSaving] = useState(false), [saved, setSaved] = useState(false), [reload, setReload] = useState(0), [zoom, setZoom] = useState(1);
  const baseRaw = useRef<string | null>(null), draft = useRef<BlockoutDocument | null>(null), dirty = useRef(false), savingRef = useRef(false);
  const handoff = useRef<BlockoutHandoffResponse | null>(null);
  const [history, setHistory] = useState<EditHistory>(emptyHistory);
  const historyRef = useRef(history); historyRef.current = history;
  const lastEdit = useRef({ group: '', at: 0 });
  const saveQueue = useRef<Promise<boolean>>(Promise.resolve(true)), loadGeneration = useRef(0);
  const [autosaving, setAutosaving] = useState(false), [historyOpen, setHistoryOpen] = useState(false);
  const backgroundSaves = useRef(0), historyTools = useRef<HTMLDivElement>(null), historyOpenRef = useRef(false);
  historyOpenRef.current = historyOpen;
  const undoAction = useRef<(redo?: boolean) => void>(() => {});
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [design, setDesign] = useState<BlockoutDesignState | null>(null), [designOwner, setDesignOwner] = useState(projectId);
  const [showDesign, setShowDesign] = useState(true), [underlay, setUnderlay] = useState<BlockoutDesignUnderlay | null>(null), [designError, setDesignError] = useState('');
  const [underlayError, setUnderlayError] = useState('');
  const galleryAssets = useRef(new Map<string, IntakeAsset>());
  const [imageDrop, setImageDrop] = useState<{variantId: string; pageId: string; blockId: string; images: BlockoutImage[] } | null>(null);
  const [documentId, setDocumentId] = useState(initialDocumentId ?? question?.target.documentId ?? 'document-1');
  const readiness = useBlockoutReadiness(projectId, doc, workspaceContext, Boolean(doc));
  const [documents, setDocuments] = useState<BlockoutDocumentEntry[]>([{ id: 'document-1', title: '' }]);
  const [confirming, setConfirming] = useState(false);
  const [canCloseWithDraft, setCanCloseWithDraft] = useState(false);
  const [view, setView] = useState<'overview' | 'page'>('page');
  const pageList = useRef<HTMLDivElement>(null);
  const [proposalNotice, setProposalNotice] = useState('');
  const [snapEnabled, setSnapEnabled] = useState(() => { try { return localStorage.getItem(`melillodesign:blockout-snap:${projectId}`) !== 'off'; } catch { return true; } });
  const recoveredKey = `melillodesign:blockout-draft:${projectId}:${documentId}`;
  const historyKey = `melillodesign:blockout-undo:${projectId}:${documentId}`;
  const errorMessage = (failure: unknown) => {
    const message = failure instanceof Error ? failure.message : String(failure);
    return message.startsWith('blockout.') ? t(message as keyof Dict) : `${t('blockout.saveFailed')} ${message}`;
  };
  useEffect(() => {
    if (!historyOpen) return;
    const outside = (event: MouseEvent) => { if (!historyTools.current?.contains(event.target as Node)) setHistoryOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [historyOpen]);
  useEffect(() => {
    const restored = (event: Event) => {
      if ((event as CustomEvent<{ projectId?: string }>).detail?.projectId !== projectId) return;
      if (dirty.current) setError(t('blockout.conflict'));
      else setReload((value) => value + 1);
    };
    window.addEventListener(PROJECT_HISTORY_UPDATED_EVENT, restored);
    return () => window.removeEventListener(PROJECT_HISTORY_UPDATED_EVENT, restored);
  }, [projectId, t]);
  useEffect(() => {
    const controller = new AbortController();
    const generation = ++loadGeneration.current;
    setHistoryOpen(false); setImageDrop(null); setAutosaving(false); setDesign(null); setUnderlay(null); setDesignError('');
    setError(''); setDoc(null); draft.current = null; dirty.current = false; setSaved(false); setConfirming(false); setCanCloseWithDraft(false); setProposalNotice('');
    void listBlockoutDocuments(projectId, workspaceContext).then((items) => {
      if (!controller.signal.aborted) setDocuments(items);
    }).catch(() => {});
    void loadBlockout(projectId, workspaceContext, controller.signal, documentId).then(async (initial) => {
      const loaded = initial;
      let applied: BlockoutDesignState['applied'] = null;
      // Shared presentation edits can invalidate approval without erasing an applied design.
      if (initial.document) {
        try {
          const result = await loadBlockoutDesign(projectId, documentId, workspaceContext, controller.signal);
          if (controller.signal.aborted) return;
          setDesign(result.state); setDesignOwner(result.projectId);
          applied = result.state.applied;
        } catch { if (!controller.signal.aborted) setDesignError(t('blockout.designLoadFailed')); }
      }
      if (controller.signal.aborted) return;
      baseRaw.current = loaded.raw;
      let value = loaded.document ?? createBlockoutDocument();
      if (!loaded.document) value = { ...value, documentId, title: documents.find((item) => item.id === documentId)?.title ?? '' };
      if (initialVariantId && value.activeVariantId !== initialVariantId && value.variants.some((item) => item.id === initialVariantId)) {
        value = { ...value, activeVariantId: initialVariantId };
      }
      // A recovery draft only applies to the exact source revision it came from.
      try {
        const recovered = JSON.parse(localStorage.getItem(recoveredKey) ?? 'null');
        if (recovered && recovered.baseRaw === loaded.raw) {
          // Reuse the canonical parser via the already typed stored value only after validation.
          const parsed = parseRecovery(recovered.document); if (parsed) {
            // Opening another proposal is navigation, including recovery of an older selection-only draft.
            const source = BlockoutDocumentSchema.parse(value);
            dirty.current = JSON.stringify({ ...parsed, activeVariantId: source.activeVariantId }) !== JSON.stringify(source);
            value = parsed;
          }
        }
      } catch { /* storage is optional */ }
      if (applied) {
        const realized = adoptAppliedBlockoutDesign(value, applied);
        if (realized !== value) { value = realized; dirty.current = true; }
      }
      setDoc(value); draft.current = value; const pages = value.variants.find((variant) => variant.id === value.activeVariantId)!.pages;
      setSelectedPage(blockoutPageForFile(value, value.activeVariantId, initialPageId)?.id ?? pages[0]!.id);
      const initialPage = pages.find((page) => page.id === initialPageId) ?? pages[0];
      setSelectedBlock(initialBlockId && initialPage?.blocks.some((block) => block.id === initialBlockId) ? initialBlockId : null);
      setHistory(loadEditHistory(historyKey, loaded.raw, value)); lastEdit.current = { group: '', at: 0 };
      if (!initialPageId && !question && value.variants.some((item) => item.pages.length > 1)) setView('overview');
    }).catch((failure: unknown) => { if (!controller.signal.aborted) setError(errorMessage(failure)); });
    return () => { controller.abort(); if (loadGeneration.current === generation) loadGeneration.current++; };
  // The collaboration identity is stable for a mounted project workspace.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, workspaceContext, reload, documentId]);
  useEffect(() => {
    if (!doc || !(doc.approval || design?.applied || design?.pending.length)) return;
    const controller = new AbortController();
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const result = await loadBlockoutDesign(projectId, documentId, workspaceContext, controller.signal);
        if (controller.signal.aborted) return;
        setDesignError(''); setDesign(result.state); setDesignOwner(result.projectId);
        const current = draft.current;
        if (current && result.state.applied && !savingRef.current) {
          const realized = adoptAppliedBlockoutDesign(current, result.state.applied);
          if (realized !== current) {
            // Keep the same server baseRaw. This change joins the normal autosave queue;
            // page/block selection and the user's ability to undo remain intact.
            setHistory((previous) => ({ past: [...previous.past.slice(-199), current], future: [] }));
            lastEdit.current = { group: '', at: 0 };
            draft.current = realized; dirty.current = true; setSaved(false); setDoc(realized);
          }
        }
      } catch { if (!controller.signal.aborted) setDesignError(t('blockout.designLoadFailed')); }
      finally { refreshing = false; }
    };
    // Requests are read-only for the workspace; adoption checks the latest local draft after the response.
    const timer = setInterval(refresh, 10_000);
    window.addEventListener('focus', refresh);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [Boolean(doc && (doc.approval || design?.applied || design?.pending.length)), projectId, documentId, workspaceContext, t]);
  useEffect(() => {
    setUnderlay(null); setUnderlayError('');
    if (!showDesign || !design?.applied?.pages.some((page) => page.pageId === selectedPage)) return;
    const controller = new AbortController();
    void loadBlockoutDesignUnderlay(designOwner, documentId, selectedPage, workspaceContext, controller.signal).then((value) => {
      if (!controller.signal.aborted) setUnderlay(value);
    }).catch(() => { if (!controller.signal.aborted) setUnderlayError(t('blockout.underlayUnavailable')); });
    return () => controller.abort();
  }, [showDesign, design?.applied?.revisionId, designOwner, documentId, selectedPage, workspaceContext, t]);
  useEffect(() => {
    if (!doc || !dirty.current) return;
    try { localStorage.setItem(recoveredKey, JSON.stringify({ baseRaw: baseRaw.current, document: doc })); } catch { /* optional crash recovery */ }
    const timer = setTimeout(() => { if (draft.current && dirty.current && !savingRef.current) void persist(draft.current, false, true); }, 700);
    return () => clearTimeout(timer);
  // Only document changes schedule writes. Save-state updates must not cause retries.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, recoveredKey]);
  useEffect(() => {
    if (!doc) return;
    const timer = setTimeout(() => storeEditHistory(historyKey, baseRaw.current, doc, history), 250);
    return () => clearTimeout(timer);
  }, [doc, history, historyKey]);

  const commit = useCallback((value: BlockoutDocument) => {
    if (savingRef.current) return;
    const current = draft.current;
    if (!current) return;
    if (JSON.stringify(current) === JSON.stringify(value)) return;
    const change = historyChange(current, value), now = Date.now();
    const grouped = change.group && change.group === lastEdit.current.group && now - lastEdit.current.at < 900;
    setHistory((state) => ({ past: grouped ? state.past : [...state.past.slice(-199), current], future: [] }));
    lastEdit.current = { group: change.group, at: now };
    const changedStructure = JSON.stringify(current.variants) !== JSON.stringify(value.variants) || JSON.stringify(current.pageBudget) !== JSON.stringify(value.pageBudget);
    const next = current.approval && changedStructure ? { ...value, needsReadaptation: true } : value;
    draft.current = next; dirty.current = true; setSaved(false); setDoc(next);
  }, []);
  function selectProposal(id: string) {
    const current = draft.current;
    if (!current || savingRef.current || current.activeVariantId === id || !current.variants.some((item) => item.id === id)) return;
    const next = { ...current, activeVariantId: id };
    draft.current = next; setDoc(next); setProposalNotice('');
  }
  useEffect(() => { if (question?.target.documentId && question.target.documentId !== documentId) setDocumentId(question.target.documentId); }, [question?.key]);
  useEffect(() => {
    if (!doc || !question) return;
    const found = resolveBlockoutTarget(doc, question.target);
    if (!found) return;
    if (doc.activeVariantId !== found.variant.id) selectProposal(found.variant.id);
    setSelectedPage(found.page.id); setSelectedBlock(found.block?.id ?? null); setView('page');
  // Selection follows each question identity once; ordinary edits must remain selectable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(doc), question?.key]);

  async function persist(value: BlockoutDocument, startingPoint = false, background = false, action?: 'request-proposals' | 'develop-design' | 'update-design') {
    if (!background && savingRef.current) return false;
    const generation = loadGeneration.current;
    if (background) { backgroundSaves.current++; setAutosaving(true); } else { savingRef.current = true; setSaving(true); }
    const job = saveQueue.current.then(async () => {
      if (generation !== loadGeneration.current) return false;
      setError('');
      try {
        const savedRaw = await saveBlockout(projectId, value, baseRaw.current, workspaceContext);
        if (generation !== loadGeneration.current) return false;
        baseRaw.current = savedRaw;
        // The server may normalize shared header/footer metadata and document naming.
        // The handoff must describe that returned canonical revision, not the pre-save input.
        let canonical = value;
        try { canonical = parseRecovery(JSON.parse(savedRaw)) ?? value; } catch { /* providers validate real saved revisions */ }
        setDocuments((items) => [...items.filter((item) => item.id !== value.documentId), { id: value.documentId, title: value.title }]);
        if (startingPoint) handoff.current = await saveBlockoutStartingPoint(projectId, canonical, workspaceContext, baseRaw.current,
          { action: action ?? (value.approval && !value.needsReadaptation ? 'develop-design' : 'request-proposals') });
        if (draft.current === value) {
          if (JSON.stringify(canonical) !== JSON.stringify(value)) { draft.current = canonical; setDoc(canonical); }
          dirty.current = false; setSaved(true); setCanCloseWithDraft(false);
          try { localStorage.removeItem(recoveredKey); } catch { /* optional recovery */ }
        } else if (dirty.current) keepRecoveryDraft();
        if (draft.current) storeEditHistory(historyKey, baseRaw.current, draft.current, historyRef.current);
        window.dispatchEvent(new CustomEvent('melillodesign:blockout-saved', { detail: { projectId } })); return true;
      } catch (failure) { if (generation === loadGeneration.current) { setError(errorMessage(failure)); keepRecoveryDraft(); } return false; }
    });
    saveQueue.current = job;
    try { return await job; }
    finally { if (background) backgroundSaves.current--; if (generation === loadGeneration.current) {
      if (background) setAutosaving(backgroundSaves.current > 0); else { savingRef.current = false; setSaving(false); }
    } }
  }
  const close = useRef<() => void>(() => {});
  function keepRecoveryDraft() {
    try {
      if (!draft.current) return false;
      localStorage.setItem(recoveredKey, JSON.stringify({ baseRaw: baseRaw.current, document: draft.current })); return true;
    } catch { return false; }
  }
  close.current = () => {
    if (savingRef.current) return;
    if (canCloseWithDraft && keepRecoveryDraft()) { onClose(); return; }
    if (draft.current && (dirty.current || autosaving)) void persist(draft.current).then((ok) => {
      if (ok) onClose(); else setCanCloseWithDraft(keepRecoveryDraft());
    }); else onClose();
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = dialog.current;
    root?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')?.focus();
    const bodyOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    function keys(event: KeyboardEvent) {
      if (event.key === 'Escape' && historyOpenRef.current) { event.preventDefault(); setHistoryOpen(false); return; }
      if ((event.ctrlKey || event.metaKey) && !((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]'))) {
        if (event.key.toLowerCase() === 'z') { event.preventDefault(); undoAction.current(event.shiftKey); return; }
        if (event.key.toLowerCase() === 'y') { event.preventDefault(); undoAction.current(true); return; }
      }
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const elements = [...(root?.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), input, textarea, select, [tabindex="0"]') ?? [])].filter((element) => element.getClientRects().length > 0);
      const first = elements[0], last = elements.at(-1);
      if (root && !root.contains(document.activeElement)) { event.preventDefault(); first?.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', keys);
    return () => { document.removeEventListener('keydown', keys); document.body.style.overflow = bodyOverflow; previous?.focus(); };
  }, []);

  const variant = doc?.variants.find((item) => item.id === doc.activeVariantId);
  const approved = Boolean(doc?.approval && doc.approval.variantId === doc.activeVariantId);
  const phaseChange = useRef(onPhaseChange); phaseChange.current = onPhaseChange;
  useEffect(() => { if (doc) phaseChange.current?.(approved ? 'design' : 'blockout'); }, [doc?.documentId, doc?.activeVariantId, approved]);
  const page = variant?.pages.find((item) => item.id === selectedPage) ?? variant?.pages[0];
  const pageIndex = variant?.pages.findIndex((item) => item.id === page?.id) ?? 0;
  useEffect(() => {
    pageList.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [page?.id, variant?.id, view]);
  const block = page?.blocks.find((item) => item.id === selectedBlock);
  const pageBudgetStatus = doc ? getBlockoutPageBudgetStatus(doc) : null;
  const budgetNeedsAttention = Boolean(pageBudgetStatus && (pageBudgetStatus.over > 0 || pageBudgetStatus.unfilled > 0));
  const questionFound = doc && question ? resolveBlockoutTarget(doc, question.target) : null;
  const questionHere = questionFound?.variant.id === variant?.id && questionFound?.page.id === page?.id;
  function patchPage(patch: Partial<BlockoutPage>) {
    if (!doc || !page) return;
    const next = { ...page, ...patch };
    next.safeMarginMm = Math.min(next.safeMarginMm ?? 10, next.widthMm * 0.45, next.heightMm * 0.45);
    commit({ ...doc, variants: doc.variants.map((item) => item.id === variant!.id ? { ...item, pages: item.pages.map((p) => p.id === page.id ? next : p) } : item) });
  }
  function patchBlock(patch: Partial<BlockoutBlock>) { if (page && block) patchPage({ blocks: page.blocks.map((item) => item.id === block.id ? { ...item, ...patch } : item) }); }
  function addBlock() {
    if (!page) return;
    const index = page.blocks.length, id = newId('block');
    patchPage({ blocks: [...page.blocks, { id, label: `${t('blockout.block')} ${index + 1}`, kind: 'text', box: { x: 10 + index % 5 * 3, y: 12 + index % 5 * 4, width: 65, height: 20, rotation: 0 },
      lockRatio: false, images: [], references: [], expectation: '', feedback: '', flexibility: 'guided' }] });
    setSelectedBlock(id);
  }
  function changePages(pages: BlockoutPage[], nextPage: string) {
    if (!doc || !variant) return;
    commit({ ...doc, variants: doc.variants.map((item) => item.id === variant.id ? { ...item, pages } : item) });
    setSelectedPage(nextPage); setSelectedBlock(null);
  }
  function navigatePage(id: string) {
    if (savingRef.current || !variant?.pages.some((item) => item.id === id)) return;
    setSelectedPage(id); setSelectedBlock(null); setConfirming(false); setImageDrop(null);
  }
  function addPage() {
    if (!page || !variant || savingRef.current || variant.pages.length >= 60) return;
    const item = { ...createBlockoutPage(newId('page'), `${t('blockout.page')} ${variant.pages.length + 1}`), widthMm: page.widthMm, heightMm: page.heightMm, safeMarginMm: page.safeMarginMm };
    changePages([...variant.pages, item], item.id); setConfirming(false);
  }
  function deletePage() {
    if (!page || !variant || savingRef.current || variant.pages.length <= 1) return;
    const pages = variant.pages.filter((item) => item.id !== page.id);
    changePages(pages, pages[Math.min(pageIndex, pages.length - 1)]!.id); setConfirming(false);
  }
  function duplicateProposal() {
    if (!doc || !variant || !page || savingRef.current || doc.variants.length >= 12) return;
    const id = newId('variant'), original = variant.label || t('blockout.yourBrief');
    const base = t('blockout.proposalCopyName', { name: original }).slice(0, 220);
    let label = base, suffix = 2;
    while (doc.variants.some((item) => item.label === label)) label = `${base} (${suffix++})`;
    commit({ ...doc, activeVariantId: id, selectedVariantId: id, variants: [...doc.variants, { ...structuredClone(variant), id, label }] });
    setProposalNotice(t('blockout.proposalCopyCreated', { name: label })); setConfirming(false); setView('page');
  }
  function openOverviewPage(variantId: string, pageId: string, blockId?: string) {
    if (!doc || savingRef.current) return;
    if (doc.activeVariantId !== variantId) selectProposal(variantId);
    setSelectedPage(pageId); setSelectedBlock(blockId ?? null); setConfirming(false); setView('page');
  }
  function moveOverviewBlock(source: OverviewBlockSelection, targetPageId: string): boolean {
    if (!draft.current || savingRef.current) return false;
    try {
      const next = moveBlockoutBlock(draft.current, { variantId: source.variantId, sourcePageId: source.pageId, blockId: source.blockId, targetPageId });
      commit(next); return true;
    } catch { return false; }
  }
  function addTargetPages(count: number) {
    if (!page || !variant || count < 1 || variant.pages.length + count > 60) return;
    const pages = Array.from({ length: count }, (_, index) => ({ ...createBlockoutPage(newId('page'), `${t('blockout.page')} ${variant.pages.length + index + 1}`), widthMm: page.widthMm, heightMm: page.heightMm, safeMarginMm: page.safeMarginMm }));
    changePages([...variant.pages, ...pages], page.id); setView('overview');
  }
  function undo(redo = false, steps = 1) {
    if (!draft.current || savingRef.current) return;
    const result = stepHistory(historyRef.current, draft.current, redo, steps);
    if (!result) return;
    setHistory(result.history); historyRef.current = result.history; lastEdit.current = { group: '', at: 0 };
    draft.current = result.document; dirty.current = true; setDoc(result.document); setSaved(false); setSelectedBlock(null); setProposalNotice(''); setConfirming(false);
    const pages = result.document.variants.find((item) => item.id === result.document.activeVariantId)!.pages;
    if (!pages.some((item) => item.id === selectedPage)) setSelectedPage(pages[0]!.id);
    setHistoryOpen(false); setImageDrop(null);
  }
  undoAction.current = undo;
  async function useBrief() {
    const current = draft.current;
    const updatingDesign = Boolean(design?.applied);
    if (!current || designError || (!design?.applied && design?.pending.some((entry) => entry.status === 'pending')) || !await persist(current, true, false, updatingDesign ? 'update-design' : current.approval ? 'develop-design' : 'request-proposals')) return;
    publishHandoff(t(updatingDesign ? 'blockout.designEditRequest' : current.approval ? 'blockout.handoffDesign' : 'blockout.chatEditRequest', { title: current.title || t('blockout.document') }), updatingDesign || current.approval ? 'design' : 'blockout');
    onClose();
  }
  function dropImages(blockId: string, assetIds: string[]) {
    if (!variant || !page || savingRef.current) return;
    const target = page.blocks.find((item) => item.id === blockId);
    const images = [...new Set(assetIds)].map((id) => galleryAssets.current.get(id)).filter((asset): asset is IntakeAsset => Boolean(asset?.status === 'ready')).map(blockoutImageFromAsset);
    if (!target || !images.length) return;
    setSelectedBlock(blockId);
    if (target.images.length) setImageDrop({ variantId: variant.id, pageId: page.id, blockId, images });
    else applyImages({ variantId: variant.id, pageId: page.id, blockId, images }, false);
  }
  function applyImages(drop: NonNullable<typeof imageDrop>, append: boolean) {
    const current = draft.current;
    if (!current || savingRef.current) return;
    const target = resolveBlockoutTarget(current, drop);
    if (!target?.block) { setImageDrop(null); return; }
    const images = append ? [...target.block.images, ...drop.images.filter((image) => !target.block!.images.some((old) => old.assetId === image.assetId))] : drop.images;
    if (images.length > 30) { setProposalNotice(t('blockout.galleryLimit')); return; }
    commit({ ...current, variants: current.variants.map((item) => item.id !== drop.variantId ? item : { ...item, pages: item.pages.map((value) => value.id !== drop.pageId ? value : {
      ...value, blocks: value.blocks.map((block) => block.id !== drop.blockId ? block : { ...block, images, referencePreview: true }),
    }) }) });
    setImageDrop(null); setProposalNotice(t('blockout.galleryAttached', { count: images.length }));
  }
  function publishHandoff(text: string, mode: ChatSessionMode) {
    const update = handoff.current;
    if (!update) return;
    onUseBrief(text, [{ path: update.path, name: `Blockout · ${update.handoff.snapshot.title || t('blockout.document')}`, kind: 'file' }], mode);
  }
  async function chooseDocument(id: string) {
    if (savingRef.current || id === documentId) return;
    if (draft.current && dirty.current && !await persist(draft.current)) return;
    setDocumentId(id);
  }
  async function addDocument() {
    if (savingRef.current || documents.length >= 50) return;
    if (draft.current && dirty.current && !await persist(draft.current)) return;
    const id = newId('document');
    const next = { ...createBlockoutDocument(), documentId: id, title: `${t('blockout.document')} ${documents.length + 1}` };
    savingRef.current = true; setSaving(true); setError('');
    try {
      await saveBlockout(projectId, next, null, workspaceContext);
      setDocuments((items) => [...items, { id, title: next.title }]); setDocumentId(id);
      window.dispatchEvent(new CustomEvent('melillodesign:blockout-saved', { detail: { projectId } }));
    } catch (failure) { setError(errorMessage(failure)); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <><Dialog ariaLabel={t('blockout.workspace')} className={styles.workspace} backdropClassName={styles.backdrop} includeChromeClassName={false} closeOnBackdrop={false}>
    <div className={styles.workspaceInner} ref={dialog}>
      <header className={styles.header}><div><h2 title={doc?.title}>{doc?.title || t('blockout.workspace')}</h2></div>
        <div className={styles.headerActions}>
          <Button variant="ghost" aria-label={t(canCloseWithDraft ? 'blockout.closeKeepDraft' : 'blockout.closeEditor')} title={t(canCloseWithDraft ? 'blockout.closeKeepDraft' : 'blockout.closeEditor')} disabled={saving} onClick={() => close.current()}><Icon name="close" size={20} /></Button></div>
      </header>
      {error && <div className={styles.error} role="alert"><span>{error}{canCloseWithDraft && <small> {t('blockout.closeDraftHint')}</small>}</span>{canCloseWithDraft && <Button variant="secondary" onClick={() => { if (keepRecoveryDraft()) onClose(); }}>{t('blockout.closeKeepDraft')}</Button>}<Button variant="ghost" onClick={() => { dirty.current = false; setReload((n) => n + 1); }}>{t('blockout.reload')}</Button></div>}
      {!doc || !variant || !page ? <div className={styles.loading}>{error ? t('blockout.loadFailed') : t('common.loading')}</div> : <>


        <div className={styles.proposalBar} aria-label={t('blockout.proposalMenu')}>
          <Button variant="ghost" aria-pressed={view === 'overview'} onClick={() => { setView('overview'); setConfirming(false); }}><Icon name="grid" size={15} />{t('blockout.backToOverview')}</Button><label className={styles.variantPicker}>{t('blockout.proposal')}<Select disabled={saving} aria-label={t('blockout.proposal')} value={variant.id} onChange={(event) => {
          const next = doc.variants.find((item) => item.id === event.target.value)!; selectProposal(next.id); setSelectedPage(next.pages[0]!.id); setSelectedBlock(null); setConfirming(false); setView('page');
        }}>{doc.variants.map((item, index) => <option key={item.id} value={item.id}>{item.label || (index === 0 ? t('blockout.yourBrief') : `${t('blockout.proposal')} ${index + 1}`)}</option>)}</Select></label>
          <Button variant="ghost" title={t('blockout.proposalCopyHint')} disabled={doc.variants.length >= 12 || saving} onClick={duplicateProposal}><Icon name="copy" size={15} />{t('blockout.createAlternative')}</Button>
<BlockoutBudgetCount document={doc} variantId={variant.id} />{pageBudgetStatus && (pageBudgetStatus.over > 0 || pageBudgetStatus.unfilled > 0) && <span className={styles.budgetWarning} data-warning role="status">{pageBudgetStatus.over > 0 ? t('blockout.budgetOver', { count: pageBudgetStatus.over }) : t('blockout.budgetUnder', { count: pageBudgetStatus.unfilled })}</span>}
        <details className={styles.documentSettings}><summary>{t('blockout.documentSettings')}</summary><div className={styles.documentSettingsPanel}><div className={styles.documentBar}><label>{t('blockout.document')}<Select aria-label={t('blockout.document')} disabled={saving} value={documentId} onChange={(event) => void chooseDocument(event.target.value)}>{documents.map((item, index) => <option key={item.id} value={item.id}>{item.id === doc.documentId && doc.title ? doc.title : item.title || `${t('blockout.document')} ${index + 1}`}</option>)}</Select></label>
          <Input aria-label={t('blockout.documentName')} placeholder={t('blockout.documentName')} value={doc.title} maxLength={240} disabled={saving} onChange={(event) => commit({ ...doc, title: event.target.value })} />
          <Button variant="ghost" disabled={saving || documents.length >= 50} onClick={() => void addDocument()}><Icon name="plus" size={15} />{t('blockout.newDocument')}</Button>
          <span>{approved ? t('blockout.phaseDesign') : t('blockout.phaseBlockout')}</span>
          <Button variant="ghost" disabled={saving || dirty.current} onClick={() => setReload((n) => n + 1)}>{t('blockout.reloadProposals')}</Button>
        </div><BlockoutPageBudget embedded document={doc} busy={saving} onChange={commit} onAddPages={addTargetPages} /></div></details>
          {!readiness.legacy && <details className={styles.checksMenu}><summary><Icon name={readiness.error || readiness.assessment?.status === 'blocked' || readiness.assessment?.status === 'warning' ? 'alert-triangle' : 'info'} size={14} />{t('blockout.editorChecks')}</summary><div className={styles.checksPanel}><BlockoutReadiness value={readiness} compact /></div></details>}
        </div>
        {proposalNotice && <p className={styles.proposalNotice} aria-live="polite">{proposalNotice}</p>}
        {view === 'page' && <div className={styles.editingTools}>
        <div className={styles.pageToolbar} role="toolbar" aria-label={t('blockout.pageActions')}>
          <div className={styles.pageNavigation}>
            <Button variant="ghost" aria-label={t('blockout.previousPage')} disabled={saving || pageIndex <= 0} onClick={() => navigatePage(variant.pages[pageIndex - 1]!.id)}><Icon name="arrow-left" size={15} /></Button>
            <Select aria-label={t('blockout.goToPage')} disabled={saving} value={page.id} onChange={(event) => navigatePage(event.target.value)}>{variant.pages.map((item, index) => <option key={item.id} value={item.id}>{index + 1} / {variant.pages.length} · {item.label || t('blockout.page')}</option>)}</Select>
            <Button variant="ghost" aria-label={t('blockout.nextPage')} disabled={saving || pageIndex >= variant.pages.length - 1} onClick={() => navigatePage(variant.pages[pageIndex + 1]!.id)}><Icon name="arrow-right" size={15} /></Button>
          </div>
          <Button variant="ghost" disabled={variant.pages.length >= 60 || saving} onClick={addPage}><Icon name="plus" size={15} />{t('blockout.addPage')}</Button>
          <Button variant="ghost" aria-label={t('blockout.duplicatePage')} title={t('blockout.duplicatePage')} disabled={saving || variant.pages.length >= 60} onClick={() => { const item = { ...structuredClone(page), id: newId('page'), label: `${page.label || t('blockout.page')} · ${t('blockout.copy')}` }; changePages([...variant.pages, item], item.id); setConfirming(false); }}><Icon name="copy" size={15} /></Button>
          <Button variant="ghost" aria-label={t('blockout.deletePage')} disabled={variant.pages.length <= 1 || saving} onClick={deletePage} title={t('blockout.deletePageHint')}><Icon name="trash" size={15} /></Button>
        </div>
        <div className={styles.toolbar} role="toolbar" aria-label={t('blockout.blockActions')}>
          <Button variant="secondary" disabled={saving || page.blocks.length >= 200} onClick={addBlock}><Icon name="plus" size={16} />{t('blockout.addBlock')}</Button>
          <Button variant="ghost" disabled={!block || saving || page.blocks.length >= 200} onClick={() => { if (!block) return; const id = newId('block'); patchPage({ blocks: [...page.blocks, { ...structuredClone(block), id, box: constrainBlockoutBox({ ...block.box, x: block.box.x + 3, y: block.box.y + 3 }) }] }); setSelectedBlock(id); }} aria-label={t('blockout.duplicateBlock')} title={t('blockout.duplicateBlock')}><Icon name="copy" size={16} /></Button>
          <Button variant="ghost" disabled={!block || saving} aria-label={t('blockout.deleteBlock')} onClick={() => { patchPage({ blocks: page.blocks.filter((item) => item.id !== block!.id) }); setSelectedBlock(null); }}><Icon name="trash" size={16} /></Button>
          <div className={styles.undoTools} ref={historyTools}>
            <Button variant="ghost" aria-label={t('blockout.undo')} disabled={!history.past.length || saving} onClick={() => undo()}><Icon name="arrow-left" size={16} /></Button>
            <Button variant="ghost" aria-label={t('blockout.redo')} disabled={!history.future.length || saving} onClick={() => undo(true)}><Icon name="arrow-right" size={16} /></Button>
            <Button variant="ghost" aria-label={t('blockout.editHistory')} aria-expanded={historyOpen} aria-controls="blockout-edit-history" disabled={saving} onClick={() => setHistoryOpen(!historyOpen)}><Icon name="history" size={16} /></Button>
            {historyOpen && <section id="blockout-edit-history" className={styles.undoMenu} aria-label={t('blockout.editHistory')} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setHistoryOpen(false); } }}>
              <header><strong>{t('blockout.editHistory')}</strong><Button variant="ghost" aria-label={t('common.close')} onClick={() => setHistoryOpen(false)}><Icon name="close" size={14} /></Button></header>
              <p>{t('blockout.historyHint')}</p>
              {!history.past.length && !history.future.length && <p>{t('blockout.historyEmpty')}</p>}
              {history.future.length > 0 && <div><h4>{t('blockout.redo')}</h4>{[...history.future].reverse().map((value, index, values) => {
                const change = historyChange(index === 0 ? doc : values[index - 1]!, value);
                return <Button key={index} variant="ghost" onClick={() => undo(true, index + 1)}>{t('blockout.redoSteps', { count: index + 1 })} · {t(change.key, { name: change.name })}</Button>;
              })}</div>}
              {history.past.length > 0 && <div><h4>{t('blockout.undo')}</h4>{[...history.past].reverse().map((value, index, values) => {
                const change = historyChange(value, index === 0 ? doc : values[index - 1]!);
                return <Button key={index} variant="ghost" onClick={() => undo(false, index + 1)}>{t('blockout.undoSteps', { count: index + 1 })} · {t(change.key, { name: change.name })}</Button>;
              })}</div>}
            </section>}
          </div>
          <Button variant={galleryOpen ? 'secondary' : 'ghost'} aria-expanded={galleryOpen} onClick={() => setGalleryOpen(!galleryOpen)}><Icon name="image" size={16} />{t('blockout.galleryDrawer')}</Button>
          <label className={styles.snapToggle} title={t('blockout.snapHint')}><input type="checkbox" checked={snapEnabled} onChange={(event) => {
            setSnapEnabled(event.target.checked); try { localStorage.setItem(`melillodesign:blockout-snap:${projectId}`, event.target.checked ? 'on' : 'off'); } catch { /* optional preference */ }
          }} />{t('blockout.snap')}</label>
          <label className={styles.zoom}><span>{t('blockout.zoom')}</span><Select aria-label={t('blockout.zoom')} value={zoom} onChange={(event) => setZoom(Number(event.target.value))}><option value={0.75}>75%</option><option value={1}>{t('blockout.fit')}</option><option value={1.5}>150%</option><option value={2}>200%</option></Select></label>
          <span className={styles.toolbarSpacer} />
        </div></div>}
        {question && !questionFound && <div className={styles.error} role="alert">{t('blockout.targetMissing')}</div>}
        {(doc.approval || design?.applied || design?.pending.length || designError) ? <div className={styles.designStatus} role="status"><p>{designError || (design?.sourceChanged ? t('blockout.designSourceChanged') : design?.pending.some((entry) => entry.status === 'pending') ? t('blockout.designRegistrationPending') : design?.applied ? t('blockout.designPendingHint') : design?.pending.length ? t('blockout.designRegistrationFailed') : t('blockout.designRegistrationMissing'))}{underlayError ? ` ${underlayError}` : ''}</p>
          {design?.applied && <label><input type="checkbox" checked={showDesign} onChange={(event) => setShowDesign(event.target.checked)} />{t('blockout.showDesignReference')}</label>}
        </div> : null}
        {view === 'overview' ? <div className={styles.overviewBody}>
          <BlockoutDocumentOverview document={doc} busy={saving} inventory={readiness.inventory} assessment={readiness.assessment} projectId={projectId} workspaceContext={workspaceContext} onOpenPage={openOverviewPage} onMoveBlock={moveOverviewBlock}
            onReorderPages={(variantId, pageIds) => commit(reorderBlockoutPages(doc, variantId, pageIds))}
            onSelectProposal={(variantId) => { selectProposal(variantId); setConfirming(false); }}
            onCountPage={(variantId, pageId, counted) => commit({ ...doc, variants: doc.variants.map((item) => item.id === variantId ? { ...item, pages: item.pages.map((value) => value.id === pageId ? { ...value, countsTowardLimit: counted } : value) } : item) })} />
        </div> : <div className={styles.body} aria-busy={saving}>
          <nav className={styles.pages} aria-label={t('blockout.pages')}>
            <h3>{t('blockout.pages')} · {variant.pages.length}</h3>
            <div className={styles.pageList} ref={pageList}>{variant.pages.map((item, index) => <Button key={item.id} variant="ghost" aria-label={item.label || `${t('blockout.page')} ${index + 1}`} aria-current={item.id === page.id ? 'page' : undefined} onClick={() => navigatePage(item.id)}>
              <span className={styles.pageThumbnail} style={{ aspectRatio: `${item.widthMm} / ${item.heightMm}` }}>{item.blocks.map((b) => <i key={b.id} style={{ left: `${b.box.x}%`, top: `${b.box.y}%`, width: `${b.box.width}%`, height: `${b.box.height}%`, transform: `rotate(${b.box.rotation}deg)` }} />)}</span><span><small>{index + 1}</small>{item.label || `${t('blockout.page')} ${index + 1}`}</span>
            </Button>)}</div>
          </nav>
          <BlockoutCanvas page={page} presentation={doc.presentation} pageIndex={pageIndex} totalPages={variant.pages.length} selectedId={block?.id ?? null} questionPage={confirming || Boolean(questionHere && !question?.target.blockId)} questionBlockId={questionHere ? question?.target.blockId : undefined}
            designUnderlay={showDesign && !design?.sourceChanged && design?.applied?.snapshot.variant.id === variant.id ? underlay : null} designProjectId={designOwner}
            projectId={projectId} workspaceContext={workspaceContext} inventory={readiness.inventory} assessment={readiness.assessment?.variants.find((entry) => entry.variantId === variant.id)?.pages.find((entry) => entry.pageId === page.id)} zoom={zoom} busy={saving} snapEnabled={snapEnabled} onSelect={setSelectedBlock} onAdd={addBlock}
            onTransform={(id, box) => patchPage({ blocks: page.blocks.map((item) => item.id === id ? { ...item, box } : item) })}
            onDelete={(id) => { patchPage({ blocks: page.blocks.filter((item) => item.id !== id) }); setSelectedBlock(null); }} onImagesDrop={dropImages}
            imageDrop={imageDrop?.pageId === page.id && imageDrop.variantId === variant.id ? imageDrop : null}
            onImageDropChoice={(append) => { if (imageDrop) applyImages(imageDrop, append); }} onCancelImageDrop={() => setImageDrop(null)} />
          {galleryOpen ? <BlockoutGalleryDrawer projectId={projectId} workspaceContext={workspaceContext} selectedBlock={block} busy={saving}
            onClose={() => setGalleryOpen(false)} onAssets={(assets) => { galleryAssets.current = new Map(assets.map((asset) => [asset.id, asset])); }}
            onUse={(ids) => { if (block) dropImages(block.id, ids); }} onRemove={(assetId) => { if (block) patchBlock({ images: block.images.filter((image) => image.assetId !== assetId) }); }} /> : <BlockoutInspector key={`${variant.id}-${page.id}-${block?.id ?? 'page'}`} page={page} block={block} projectId={projectId} workspaceContext={workspaceContext}
            onOpenGallery={() => setGalleryOpen(true)}
            approval={confirming ? <section className={styles.questionPanel} aria-label={t('blockout.useForDesign')}><p className={styles.approvalHint}>{t('blockout.approvalDraftHint')}</p><QuestionFormView form={{ id: 'accept-blockout', title: t('blockout.useForDesign'), questions: [{ id: 'decision', type: 'radio', label: t('blockout.acceptQuestion'), required: true, options: [{ value: 'accept', label: t('blockout.acceptYes') }, { value: 'revise', label: t('blockout.acceptNo') }] }] }} interactive autoContinueAfterTimeout={false} submitDisabled={saving} onSubmit={async (_text, answers) => {
              if (answers.decision !== 'accept') { setConfirming(false); return; }
              const current = draft.current;
              if (!current) return;
              const status = getBlockoutPageBudgetStatus(current); if (status.over > 0 || status.unfilled > 0) { setConfirming(false); setView('overview'); return; }
              const next = { ...current, approval: { variantId: current.activeVariantId, acceptedAt: new Date().toISOString() }, needsReadaptation: false };
              if (!await persist(next, true)) return; draft.current = next; dirty.current = false; setSaved(true); setDoc(next); setConfirming(false); onPhaseChange?.('design');
              publishHandoff(t('blockout.handoffDesign', { title: next.title || t('blockout.document') }), 'design'); onClose();
            }} /></section> : undefined}
            question={questionHere && (question?.target.blockId ? question.target.blockId === block?.id : !block) ? question : null} busy={saving} onPage={patchPage} onBlock={patchBlock} onPageSelect={() => setSelectedBlock(null)}
            onAnswer={async (text, answers, source, files) => {
              if (!question || !questionFound) return;
              const next = { ...doc, answers: [...doc.answers.filter((item) => item.formId !== question.props.form.id || item.target.pageId !== question.target.pageId || item.target.blockId !== question.target.blockId || item.target.variantId !== question.target.variantId),
                { formId: question.props.form.id, target: question.target, answers, answeredAt: new Date().toISOString() }] };
              commit(next);
              if (!await persist(next, true)) return;
              await question.props.onSubmit?.(text, answers, source, files);
              onClose();
            }} />}
        </div>}
        <section className={styles.actionDock} aria-label={t('blockout.nextStep')}>
          <div className={styles.actionSummary}><strong>{doc.title || t('blockout.document')} · {variant.pages.length} {t('blockout.pages')} · {variant.label || t('blockout.yourBrief')}</strong>
            <span className={styles.saveStatus} role="status"><Icon name={error ? 'alert-triangle' : dirty.current ? 'edit' : 'check'} size={13} />{saving || autosaving ? t('blockout.saving') : dirty.current ? t(error ? 'blockout.autosaveFailed' : 'blockout.autosavePending') : t('blockout.autosaved')}</span>
            {error && dirty.current && <Button variant="ghost" disabled={saving || autosaving} onClick={() => draft.current && void persist(draft.current)}>{t('blockout.retryAutosave')}</Button>}
          </div>
          <div className={styles.nextActions}>
            <Button variant="secondary" disabled={saving || Boolean(designError) || (!design?.applied && design?.pending.some((entry) => entry.status === 'pending')) || !variant.pages.some((item) => item.blocks.length || item.expectation.trim() || item.references.length)} onClick={() => void useBrief()}>{t('blockout.editInChat')}<Icon name="arrow-right" size={16} /></Button>
            <Button variant="primary" title={budgetNeedsAttention ? t('blockout.budgetAcceptance') : undefined} disabled={saving || Boolean(designError) || (!design?.applied && design?.pending.some((entry) => entry.status === 'pending')) || budgetNeedsAttention || !variant.pages.some((item) => item.blocks.length)} onClick={() => {
              if (design?.applied) { void useBrief(); return; }
              setGalleryOpen(false); setSelectedBlock(null); setConfirming(true); setView('page');
            }}>{t(design?.applied ? 'blockout.updateDesign' : 'blockout.goToDesign')}</Button>
          </div>
        </section>
      </>}
    </div>
  </Dialog></>;
}

function parseRecovery(value: unknown): BlockoutDocument | null { const parsed = BlockoutDocumentSchema.safeParse(value); return parsed.success ? parsed.data : null; }
