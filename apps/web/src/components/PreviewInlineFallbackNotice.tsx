import { Button } from '@open-design/components';

import { useI18n } from '../i18n';
import styles from './PreviewInlineFallbackNotice.module.css';

export interface PreviewInlineFallbackNoticeProps {
  /** Switch the preview to the inline srcDoc render. */
  onRenderInline: () => void;
}

/**
 * Names the one preview failure the host cannot see into: a URL-loaded
 * artifact that builds its boot script at runtime (see
 * `htmlBuildsScriptAtRuntime`). The iframe runs at an opaque origin, so a Web
 * Storage read in that script throws and the canvas goes blank with no error
 * anywhere on screen.
 *
 * The notice states the cause and offers the recovery that used to require
 * knowing to type `?forceInline=1` by hand.
 */
export function PreviewInlineFallbackNotice({ onRenderInline }: PreviewInlineFallbackNoticeProps) {
  const { t } = useI18n();
  return (
    <div className={styles.notice} role="status" data-testid="preview-inline-fallback-notice">
      <strong className={styles.title}>{t('fileViewer.previewInlineFallbackTitle')}</strong>
      <span className={styles.detail}>{t('fileViewer.previewInlineFallbackDetail')}</span>
      <Button
        variant="subtle"
        className={styles.action}
        data-testid="preview-inline-fallback-action"
        onClick={onRenderInline}
      >
        {t('fileViewer.previewInlineFallbackAction')}
      </Button>
    </div>
  );
}
