import { useEffect, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import { useT } from '../i18n';
import { testAgent } from '../providers/connection-test';
import type { AgentInfo, AppConfig } from '../types';
import { AgentIcon } from './AgentIcon';
import { Icon } from './Icon';
import { LanguageMenu } from './LanguageMenu';
import styles from './CodexOnboarding.module.css';

interface Props {
  config: AppConfig;
  agents: AgentInfo[];
  daemonLive: boolean;
  onRefreshAgents: () => Promise<AgentInfo[]> | AgentInfo[];
  onConfigPersist: (config: AppConfig) => Promise<void> | void;
  onFinish: () => void;
  onOtherOptions: () => void;
}

type ConnectError = 'missing' | 'login' | 'connection' | null;

/** Connect the existing local CLI without a separate provider setup wizard. */
export function CodexOnboarding({
  config, agents, daemonLive, onRefreshAgents, onConfigPersist, onFinish, onOtherOptions,
}: Props) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ConnectError>(null);
  const pending = useRef<AbortController | null>(null);
  const codex = agents.find((agent) => agent.id === 'codex');

  useEffect(() => () => { pending.current?.abort(); }, []);

  async function connect() {
    if (pending.current || !daemonLive) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);
    try {
      const discovered = (await onRefreshAgents()).find((agent) => agent.id === 'codex');
      if (controller.signal.aborted) return;
      if (!discovered?.available) {
        setError('missing');
        return;
      }
      if (discovered.authStatus === 'missing') {
        setError('login');
        return;
      }
      const choice = config.agentModels?.codex ?? {};
      const model = choice.model || (
        discovered.models?.some((item) => item.id === 'gpt-6-luna')
          ? 'gpt-6-luna'
          : 'default'
      );
      const result = await testAgent({
        agentId: 'codex', model, reasoning: choice.reasoning, serviceTier: choice.serviceTier,
        agentCliEnv: config.agentCliEnv,
      }, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setError(result.kind === 'auth_failed' ? 'login' : 'connection');
        return;
      }
      // Completion follows the acknowledged daemon write, so a failed save
      // cannot strand the user on Home with an unconfigured runtime.
      await onConfigPersist({
        ...config,
        mode: 'daemon',
        agentId: 'codex',
        agentModels: { ...config.agentModels, codex: { ...choice, model } },
      });
      if (!controller.signal.aborted) onFinish();
    } catch {
      if (!controller.signal.aborted) setError('connection');
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <section className="onboarding-view onboarding-view--cloud" aria-label={t('settings.codexConnectTitle')}>
      <div className="onboarding-cloud__pane">
        <div className="onboarding-cloud__center">
          <div className={styles.mark}><AgentIcon id="codex" size={42} /></div>
          <h1 className="onboarding-cloud__title">{t('settings.codexConnectTitle')}</h1>
          <p className={`onboarding-cloud__body ${styles.body}`}>
            {t('settings.codexConnectBody')}
          </p>
          <Button
            variant="primary"
            className={`onboarding-cloud__primary ${styles.connect}`}
            disabled={busy || !daemonLive}
            aria-busy={busy}
            onClick={() => { void connect(); }}
          >
            <Icon name="link" size={18} />
            {busy ? t('settings.testRunning') : t('settings.codexConnectTitle')}
          </Button>
          <div className={styles.feedback} aria-live="polite">
            {!daemonLive ? (
              <p role="alert">{t('settings.modeDaemonOffline')}</p>
            ) : error ? (
              <p role="alert">
                {error === 'missing' ? t('settings.codexMissing')
                  : error === 'login' ? t('settings.codexLoginRequired')
                    : t('settings.codexConnectionFailed')}
              </p>
            ) : !busy && codex?.available && codex.authStatus === 'ok' ? (
              <p className={styles.ready}><Icon name="check" size={15} />{t('settings.codexReady')}</p>
            ) : null}
          </div>
          <Button variant="ghost" disabled={busy} onClick={onOtherOptions}>
            {t('settings.codexOtherOptions')}
          </Button>
        </div>
        <footer className="onboarding-cloud__footer">
          <LanguageMenu placement="up" align="start" />
          <span>© {new Date().getFullYear()} MelilloDesign · {t('settings.onboardingCloudRights')}</span>
        </footer>
      </div>
      <div className="onboarding-cloud__art" aria-hidden="true">
        <img src="/onboarding/melillodesign-architecture.png" alt="" />
      </div>
    </section>
  );
}
