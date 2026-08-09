import { useEffect, useState, type DragEvent } from 'react';
import {
  isLibraryUploadMimeAllowed,
  LIBRARY_UPLOAD_MAX_BYTES,
  type DesignLibraryPromotion,
  type DesignLibraryPromotionGroup,
} from '@open-design/contracts';
import { useT } from '../i18n';
import {
  createDesignLibraryPromotion,
  fetchDesignLibraryPromotions,
  uploadLibraryFile,
} from '../providers/registry';
import styles from './DesignLibraryPromotionPanel.module.css';

interface Props {
  inboxPath: string;
}

const BULK_EXTENSIONS = new Set(['.fig', '.figma', '.zip']);

function extension(name: string): string {
  const index = name.lastIndexOf('.');
  return index < 0 ? '' : name.slice(index).toLowerCase();
}

export function DesignLibraryPromotionPanel({ inboxPath }: Props) {
  const t = useT();
  const [group, setGroup] = useState<DesignLibraryPromotionGroup>('app-captures');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [promotions, setPromotions] = useState<DesignLibraryPromotion[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const result = await fetchDesignLibraryPromotions('all');
    if (result.ok) setPromotions(result.response.promotions);
    else setMessage(result.message);
  };

  useEffect(() => { void refresh(); }, []);

  const rejectToInbox = () => {
    setMessage(t('designLibrary.promotions.bulkError').replace('{path}', inboxPath));
  };

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (busy) return;
    const items = [...event.dataTransfer.items];
    const hasDirectory = items.some((item) => {
      const entry = (item as DataTransferItem & {
        webkitGetAsEntry?: () => { isDirectory?: boolean } | null;
      }).webkitGetAsEntry?.();
      return entry?.isDirectory === true;
    });
    const files = [...event.dataTransfer.files];
    if (hasDirectory || files.length !== 1) return rejectToInbox();
    const file = files[0];
    if (!file || file.size > LIBRARY_UPLOAD_MAX_BYTES || BULK_EXTENSIONS.has(extension(file.name))
      || !isLibraryUploadMimeAllowed(file.type || undefined, file.name)) {
      return rejectToInbox();
    }
    setBusy(true);
    setMessage(null);
    try {
      const uploaded = await uploadLibraryFile(file);
      if (!uploaded.ok || !uploaded.asset) {
        setMessage(uploaded.error ?? t('designLibrary.promotions.failed'));
        return;
      }
      const promoted = await createDesignLibraryPromotion({
        assetId: uploaded.asset.id,
        proposedGroup: group,
        ...(note.trim() ? { requesterNote: note.trim() } : {}),
      });
      if (!promoted.ok) {
        setMessage(promoted.message);
        return;
      }
      setMessage(t('designLibrary.promotions.queued'));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.panel} data-testid="design-library-promotion-panel">
      <div>
        <h2 className={styles.title}>{t('designLibrary.promotions.title')}</h2>
        <p className={styles.policy}>
          {t('designLibrary.promotions.policy').replace('{path}', inboxPath)}
        </p>
      </div>
      <div className={styles.controls}>
        <select value={group} onChange={(event) => setGroup(event.target.value as DesignLibraryPromotionGroup)}>
          <option value="app-captures">{t('designLibrary.promotions.groupApp')}</option>
          <option value="site-capture">{t('designLibrary.promotions.groupSite')}</option>
          <option value="site-clone">{t('designLibrary.promotions.groupClone')}</option>
        </select>
        <input
          value={note}
          maxLength={2000}
          onChange={(event) => setNote(event.target.value)}
          placeholder={t('designLibrary.promotions.note')}
        />
      </div>
      <div
        className={styles.dropZone}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => void onDrop(event)}
      >
        {busy ? t('designLibrary.promotions.uploading') : t('designLibrary.promotions.drop')}
      </div>
      {message ? <p className={styles.message} role="status">{message}</p> : null}
      {promotions.length > 0 ? (
        <ul className={styles.queue}>
          {promotions.map((promotion) => (
            <li key={promotion.id}>
              <span>{promotion.status}</span>
              <code>{promotion.finalRel ?? promotion.proposedGroup}</code>
              {promotion.error ? <span>{promotion.error.message}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
