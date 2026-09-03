import { useI18n } from '../i18n';
import styles from './PreviewRuntimeScriptNotice.module.css';

/**
 * Names the one preview failure the host cannot see into: an artifact that
 * attaches its script at runtime (see `htmlBuildsScriptAtRuntime`).
 *
 * Neither preview mode can run that script. The srcDoc pipeline recovers a
 * linked file by inlining it, but the inliner only sees a literal
 * `<script src>` tag; without one the file stays external and the preview
 * iframe's opaque origin cannot fetch it. So the canvas is blank in both
 * modes, and no host-side toggle changes that — the artifact has to reference
 * its script with a tag the inliner can see. This notice says exactly that,
 * where the blank canvas is.
 */
export function PreviewRuntimeScriptNotice() {
  const { t } = useI18n();
  return (
    <div className={styles.notice} role="status" data-testid="preview-runtime-script-notice">
      <strong className={styles.title}>{t('fileViewer.previewRuntimeScriptBlockedTitle')}</strong>
      <span className={styles.detail}>{t('fileViewer.previewRuntimeScriptBlockedDetail')}</span>
    </div>
  );
}
