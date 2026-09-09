// Per-file upload progress, rendered ONLY from contract-typed staged-upload
// events (`ProjectUploadSseEvent`, `packages/contracts/src/sse/uploads.ts`)
// — never an inferred percentage derived client-side from XHR
// `upload.onprogress` (INV-7.1, INV-7.3, F-01).

import { useMemo } from 'react';
import type { ProjectUploadSseEvent } from '@open-design/contracts';
import { useT } from '../i18n';
import styles from './UploadProgressCard.module.css';

export interface UploadProgressFileRow {
  index: number;
  name: string;
  totalBytes: number;
  bytesReceived: number;
  status: 'pending' | 'uploading' | 'done' | 'failed';
}

export type UploadProgressOutcome =
  | { type: 'completed' }
  | { type: 'failed'; code: string; message: string; file?: string };

/** Folds an ordered list of one session's staged-upload events into the
 *  per-file rows a progress card renders. Byte progress is read straight
 *  off each `upload-progress` event — it is never derived or smoothed. */
export function deriveUploadProgressState(events: ProjectUploadSseEvent[]): {
  rows: UploadProgressFileRow[];
  outcome: UploadProgressOutcome | null;
} {
  const rows = new Map<number, UploadProgressFileRow>();
  let outcome: UploadProgressOutcome | null = null;

  for (const evt of events) {
    if (evt.type === 'upload-started') {
      for (const f of evt.files) {
        rows.set(f.index, { index: f.index, name: f.name, totalBytes: f.size, bytesReceived: 0, status: 'pending' });
      }
    } else if (evt.type === 'upload-progress') {
      const row = rows.get(evt.index);
      if (row) {
        row.bytesReceived = evt.bytesReceived;
        row.totalBytes = evt.totalBytes;
        row.status = 'uploading';
      }
    } else if (evt.type === 'upload-completed') {
      for (const row of rows.values()) {
        row.status = 'done';
        row.bytesReceived = row.totalBytes;
      }
      outcome = { type: 'completed' };
    } else if (evt.type === 'upload-failed') {
      for (const row of rows.values()) {
        if (row.status !== 'done') row.status = 'failed';
      }
      outcome = { type: 'failed', code: evt.code, message: evt.message, file: evt.file };
    }
  }

  return { rows: [...rows.values()].sort((a, b) => a.index - b.index), outcome };
}

export interface UploadProgressCardProps {
  /** The full ordered event history for one upload session, exactly as
   *  received from `GET /api/projects/:id/uploads/:uploadId/events`. */
  events: ProjectUploadSseEvent[];
}

export function UploadProgressCard({ events }: UploadProgressCardProps) {
  const t = useT();
  const { rows, outcome } = useMemo(() => deriveUploadProgressState(events), [events]);

  if (rows.length === 0) return null;

  return (
    <div className={styles.card} data-testid="upload-progress-card">
      {rows.map((row) => (
        <div key={row.index} className={styles.row} data-testid={`upload-progress-row-${row.index}`} data-status={row.status}>
          <span className={styles.name}>{row.name}</span>
          {row.status === 'failed' ? (
            <span className={styles.statusFailed}>
              {t('uploadProgress.failed', { name: row.name, message: outcome?.type === 'failed' ? outcome.message : '' })}
            </span>
          ) : row.status === 'done' ? (
            <span className={styles.statusDone}>{t('uploadProgress.completed', { name: row.name })}</span>
          ) : (
            <>
              <div className={styles.track} role="progressbar" aria-valuemin={0} aria-valuemax={row.totalBytes} aria-valuenow={row.bytesReceived}>
                <div
                  className={styles.fill}
                  style={{ width: `${row.totalBytes > 0 ? Math.min(100, (row.bytesReceived / row.totalBytes) * 100) : 0}%` }}
                />
              </div>
              <span className={styles.statusPending}>{t('uploadProgress.uploading', { name: row.name })}</span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
