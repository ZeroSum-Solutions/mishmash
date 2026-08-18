// Quiet, factual readout of the rendered layout-risk measurement (see
// `CompositionMetrics` in `@open-design/contracts` and
// `injectCompositionMetricsBridge` in `apps/web/src/runtime/srcdoc.ts`).
//
// Deliberately not a score. AGENTS.md's "Design authority" section forbids
// this repository having a taste of its own — this component reports raw,
// reader-interpreted counts ("3 sections, 1 out-of-flow element") and never
// a grade, a pass/fail badge, or a color keyed to "good"/"bad".

import { useT } from '../i18n';
import type { CompositionMetricsRecord } from '@open-design/contracts';
import styles from './CompositionMetricsReadout.module.css';

export interface CompositionMetricsReadoutProps {
  /** `null` before any measurement has been reported for this artifact. */
  record: CompositionMetricsRecord | null;
}

export function CompositionMetricsReadout({ record }: CompositionMetricsReadoutProps) {
  const t = useT();

  if (!record) {
    return <p className={styles.note}>{t('fileViewer.compositionMetricsEmpty')}</p>;
  }

  // A clone reproducing a uniform target is not a defect — the same
  // exemption `lintArtifact`'s `isWebCloneRun` option and `craft.ts`'s
  // `resolveRequestedCraft` already give clone runs. Showing the raw counts
  // next to a clone would still read as "this matters here" even without
  // any scoring language, so this total-suppresses the readout instead —
  // matching how the source-level checks suppress themselves entirely.
  if (record.isWebCloneRun) {
    return <p className={styles.note}>{t('fileViewer.compositionMetricsCloneExempt')}</p>;
  }

  const m = record.metrics;
  const rows: Array<[string, string]> = [
    [t('fileViewer.compositionMetricsSections'), String(m.sectionCount)],
    [t('fileViewer.compositionMetricsOutOfFlow'), String(m.outOfFlowElementCount)],
    [t('fileViewer.compositionMetricsTransformed'), String(m.transformedElementCount)],
    [t('fileViewer.compositionMetricsBackgrounds'), String(m.distinctSectionBackgroundCount)],
    [t('fileViewer.compositionMetricsWidths'), String(m.distinctSectionWidthCount)],
    [t('fileViewer.compositionMetricsFullBleed'), m.fullBleedAgainstContained ? 'yes' : 'no'],
    [
      t('fileViewer.compositionMetricsFontRatio'),
      `${m.displayToBodyFontRatio.toFixed(1)}x (${Math.round(m.maxDisplayFontSizePx)}px / ${Math.round(m.bodyFontSizePx)}px)`,
    ],
  ];

  return (
    <dl className={styles.rows}>
      {rows.map(([label, value]) => (
        <div className={styles.row} key={label}>
          <dt className={styles.label}>{label}</dt>
          <dd className={styles.value}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
