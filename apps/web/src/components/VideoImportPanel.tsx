// Video import form (Part 8 F-05): project picker, URL field, provider,
// and progress + fraction polled from the job status route. Mounted inside
// the Settings "Video sources" card (SettingsDialog.tsx), below the Vimeo
// connect/disconnect row that card already renders. Vimeo is the only
// submittable provider this wave; YouTube renders as a disabled option so
// its "next, not enabled" status is visible from the same control instead
// of a separate one.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { useI18n } from '../i18n';
import type { VideoImportJob, VideoImportProvider } from '@open-design/contracts';
import { listProjects } from '../state/projects';
import type { Project } from '../types';
import { cancelMediaTask, createVideoImport, getVideoImportJob } from '../providers/registry';
import styles from './VideoImportPanel.module.css';

const POLL_INTERVAL_MS = 1500;

export interface VideoImportPanelProps {
  /** True once the connected Vimeo account can accept an import (Settings
   * card's own `vimeo?.connected`). The form still renders when false so
   * the field layout doesn't jump the moment connect completes, but submit
   * is disabled and a hint explains why. */
  vimeoConnected: boolean;
}

function statusLabel(t: ReturnType<typeof useI18n>['t'], status: VideoImportJob['status']): string {
  switch (status) {
    case 'queued':
      return t('videoImport.statusQueued');
    case 'running':
      return t('videoImport.statusRunning');
    case 'done':
      return t('videoImport.statusDone');
    default:
      return t('videoImport.statusFailed');
  }
}

export function VideoImportPanel({ vimeoConnected }: VideoImportPanelProps) {
  const { t } = useI18n();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [provider] = useState<VideoImportProvider>('vimeo');
  const [url, setUrl] = useState('');
  const [as, setAs] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob] = useState<VideoImportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void listProjects().then(setProjects);
  }, []);

  const clearPoll = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => () => clearPoll(), [clearPoll]);

  const pollJob = useCallback(
    (pid: string, jobId: string) => {
      const tick = async () => {
        const result = await getVideoImportJob(pid, jobId);
        if (!result.ok) {
          setError(t('videoImport.jobLoadError'));
          return;
        }
        setJob(result.job);
        if (result.job.status === 'queued' || result.job.status === 'running') {
          pollTimer.current = setTimeout(tick, POLL_INTERVAL_MS);
        }
      };
      void tick();
    },
    [t],
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    if (!projectId) {
      setError(t('videoImport.projectRequired'));
      return;
    }
    if (!url.trim()) {
      setError(t('videoImport.urlRequired'));
      return;
    }
    setSubmitting(true);
    setJob(null);
    clearPoll();
    try {
      const result = await createVideoImport(projectId, provider, url.trim(), as.trim() || undefined);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setJob(result.job);
      if (result.job.status === 'queued' || result.job.status === 'running') {
        pollJob(projectId, result.job.jobId);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const fractionPercent = job?.fraction != null ? Math.round(job.fraction * 100) : null;

  /** A queued or running import is the only state the daemon can still stop. */
  const jobInFlight = job != null && (job.status === 'queued' || job.status === 'running');

  // The generic media-task cancel route, the same one `od media cancel
  // <taskId>` drives (INV-7.6/7.12): a video import IS a media task, so it
  // needs no cancel endpoint of its own. The poll keeps running afterwards
  // and carries the terminal `failed` / `CANCELED` state into the block
  // below, so nothing here has to guess the outcome.
  const cancelImport = useCallback(async () => {
    if (!job) return;
    setCanceling(true);
    try {
      const result = await cancelMediaTask(job.taskId);
      if (!result.ok) setError(t('videoImport.cancelError'));
    } finally {
      setCanceling(false);
    }
  }, [job, t]);

  return (
    <form className={styles.panel} onSubmit={handleSubmit} aria-labelledby="video-import-panel-title">
      <h4 id="video-import-panel-title" className={styles.title}>
        {t('videoImport.panelTitle')}
      </h4>

      <label className={styles.field}>
        <span>{t('videoImport.projectLabel')}</span>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={submitting}>
          <option value="">{t('videoImport.projectPlaceholder')}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span>{t('videoImport.providerLabel')}</span>
        <select value={provider} disabled aria-readonly="true">
          <option value="vimeo">{t('videoImport.vimeoName')}</option>
          <option value="youtube" disabled>
            {t('videoImport.youtubeName')} — {t('videoImport.youtubeComingSoon')}
          </option>
        </select>
      </label>

      <label className={styles.field}>
        <span>{t('videoImport.urlLabel')}</span>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('videoImport.urlPlaceholder')}
          disabled={submitting}
        />
      </label>

      <label className={styles.field}>
        <span>{t('videoImport.asLabel')}</span>
        <input
          type="text"
          value={as}
          onChange={(e) => setAs(e.target.value)}
          placeholder={t('videoImport.asPlaceholder')}
          disabled={submitting}
        />
      </label>

      {!vimeoConnected ? <span className={`hint ${styles.hint}`}>{t('videoImport.notConnectedHint')}</span> : null}

      <button type="submit" className="ghost" disabled={submitting || !vimeoConnected}>
        {submitting ? t('videoImport.submitting') : t('videoImport.submit')}
      </button>

      {error ? (
        <span className={`hint ${styles.hint}`} role="alert">
          {error}
        </span>
      ) : null}

      {job ? (
        <div className={styles.progress} role="status" aria-live="polite">
          <span>
            {fractionPercent != null
              ? t('videoImport.progressWithPercent', { status: statusLabel(t, job.status), percent: fractionPercent })
              : statusLabel(t, job.status)}
          </span>
          {jobInFlight ? (
            <button type="button" className="ghost" onClick={cancelImport} disabled={canceling}>
              {t('videoImport.cancel')}
            </button>
          ) : null}
          {job.status === 'done' && job.file ? (
            <span>{t('videoImport.doneMessage', { name: job.file.path ?? job.file.name })}</span>
          ) : null}
          {job.status === 'failed' && job.error ? <span role="alert">{job.error.message}</span> : null}
        </div>
      ) : null}
    </form>
  );
}
