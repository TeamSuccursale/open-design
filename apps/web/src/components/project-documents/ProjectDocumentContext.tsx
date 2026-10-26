import { Button } from '@open-design/components';
import { useT } from '../../i18n';
import styles from './ProjectDocumentContext.module.css';

export function ProjectDocumentContext({ name, canReference, disabled, onReference }: {
  name?: string; canReference: boolean; disabled?: boolean; onReference: () => void;
}) {
  const t = useT();
  if (!name && !canReference) return null;
  return <div className={styles.context}>
    {name && <p>{t('projectDocuments.editing')} <strong>{name}</strong></p>}
    {canReference && <Button variant="ghost" disabled={disabled} onClick={onReference} title={t('projectDocuments.referenceHint')}><span>@</span>{t('projectDocuments.referenceAction')}</Button>}
  </div>;
}
