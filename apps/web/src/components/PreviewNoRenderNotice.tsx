import { useI18n } from '../i18n';
import styles from './PreviewNoRenderNotice.module.css';

/**
 * Names the failure the preview watchdog detects: this frame never showed the
 * host anything it rendered.
 *
 * The watchdog records that as a `preview-error` anomaly, which a maintainer
 * reads later. This is the half the person looking at the blank canvas needs
 * NOW — without it the surface is indistinguishable from an artifact that is
 * simply still loading, which is the state users sat in while nothing was
 * recorded at all.
 *
 * Deliberately does not claim a cause. From outside an opaque-origin frame the
 * host knows only that no laid-out box was reported; it cannot tell a stuck
 * document from a deliberately blank one, and saying more than that would be
 * inventing a diagnosis.
 */
export function PreviewNoRenderNotice() {
  const { t } = useI18n();
  return (
    <div className={styles.notice} role="status" data-testid="preview-no-render-notice">
      <strong className={styles.title}>{t('fileViewer.previewNoRenderTitle')}</strong>
      <span className={styles.detail}>{t('fileViewer.previewNoRenderDetail')}</span>
    </div>
  );
}
