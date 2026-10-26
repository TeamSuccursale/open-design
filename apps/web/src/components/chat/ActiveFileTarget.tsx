import { Button } from '@open-design/components';
import { useT } from '../../i18n';
import { Icon } from '../Icon';
import styles from './ActiveFileTarget.module.css';

interface Props { file: string; selected: boolean; disabled?: boolean; onRemove: () => void; onAttach: () => void }
export function ActiveFileTarget({ file, selected, disabled, onRemove, onAttach }: Props) {
  const t = useT();
  const fileName = file.replaceAll('\\', '/').split('/').pop() || file;
  if (!selected) return <Button variant="ghost" className={styles.attach} disabled={disabled} title={file} onClick={onAttach}><Icon name="file" size={14} />{t('chat.activeFile.attachTarget', { file: fileName })}</Button>;
  return <div className="composer-active-file" data-testid="composer-active-file" title={file}>
    <span className="composer-active-file__label">{t('chat.activeFileEditingLabel')}</span>
    <span className="composer-active-file__name">{file}</span>
    <Button variant="ghost" className={styles.remove} disabled={disabled} aria-label={t('chat.activeFile.removeTarget', { file: fileName })} onClick={onRemove}><Icon name="close" size={14} /></Button>
  </div>;
}
