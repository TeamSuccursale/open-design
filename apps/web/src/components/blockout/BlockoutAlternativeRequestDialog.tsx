import { useState } from 'react';
import { Button, Dialog, Select, Textarea } from '@open-design/components';
import { useT } from '../../i18n';
import styles from './BlockoutWorkspace.module.css';

export function BlockoutAlternativeRequestDialog({ documentName, proposalName, maxCount = 3, busy, error, onClose, onSubmit }: {
  documentName:string; proposalName:string; maxCount?:number; busy:boolean; error:string;
  onClose:()=>void; onSubmit:(count:number,instruction:string)=>void;
}) {
  const t = useT(), [count,setCount] = useState(1), [instruction,setInstruction] = useState('');
  return <Dialog ariaLabel={t('blockout.askAlternative')} onClose={() => { if (!busy) onClose(); }} className={styles.alternativeRequest}>
    <h2>{t('blockout.askAlternative')}</h2>
    <p><strong>{documentName}</strong><br />{proposalName}</p>
    <p role="note">{t('blockout.alternativePreservesBase')}</p>
    <label>{t('blockout.alternativeCount')}<Select disabled={busy} value={count} onChange={(event) => setCount(Number(event.target.value))}>{[1,2,3].filter((value) => value <= maxCount).map((value) => <option key={value} value={value}>{value}</option>)}</Select></label>
    <label>{t('blockout.alternativeFeedback')}<Textarea disabled={busy} value={instruction} maxLength={12_000} rows={3} onChange={(event) => setInstruction(event.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    <footer><Button variant="ghost" disabled={busy} onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={busy} onClick={() => onSubmit(count,instruction)}>{t(busy ? 'blockout.saving' : 'blockout.sendAlternativeRequest')}</Button></footer>
  </Dialog>;
}
