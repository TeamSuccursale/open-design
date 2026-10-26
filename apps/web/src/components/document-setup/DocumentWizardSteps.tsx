import { useT } from '../../i18n';
import styles from './DocumentSetup.module.css';

export function DocumentWizardSteps({ step }: { step: 0 | 1 }) {
  const t = useT();
  return <ol className={styles.wizardSteps} aria-label={t('documentWizard.progress')}>
    {(['document', 'folders'] as const).map((name, index) => <li key={name} aria-current={index === step ? 'step' : undefined} data-complete={index < step || undefined}><span>{index + 1}</span>{t(`documentWizard.step.${name}`)}</li>)}
  </ol>;
}
