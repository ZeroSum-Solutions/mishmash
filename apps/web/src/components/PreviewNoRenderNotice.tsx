import { Button } from '@open-design/components';

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

/**
 * Names the OTHER thing the preview watchdog detects: this frame reported that
 * it rendered, and nothing could corroborate it.
 *
 * The two notices are deliberately different in tone because the evidence is.
 * `PreviewNoRenderNotice` above states a failure — no render evidence at all.
 * This one states a caveat: the user agent reported a contentful paint, or the
 * document held an image whose pixels it was not allowed to read, so the
 * preview may be exactly what the artifact should look like, or it may be
 * blank. Saying "did not render" over a document that probably did would be
 * the same mistake in the other direction.
 *
 * The Re-check action asks the document in the frame to report itself again.
 * A late paint, a decoded image, a canvas draw — anything that arrived after
 * the watchdog settled — answers that ask, and a corroborated answer removes
 * this notice.
 */
export function PreviewUnverifiedRenderNotice({ onRecheck }: { onRecheck: () => void }) {
  const { t } = useI18n();
  return (
    <div
      className={`${styles.notice} ${styles.unverified}`}
      role="status"
      data-testid="preview-unverified-render-notice"
    >
      <strong className={styles.title}>{t('fileViewer.previewUnverifiedTitle')}</strong>
      <span className={styles.detail}>{t('fileViewer.previewUnverifiedDetail')}</span>
      <Button variant="subtle" className={styles.action} onClick={onRecheck}>
        {t('fileViewer.previewUnverifiedRecheck')}
      </Button>
    </div>
  );
}
