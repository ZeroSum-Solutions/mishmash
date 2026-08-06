// RoutingPanel -- web UI stub for the routing capability (WR wave, P0
// skeleton, plan docs/plans/2026-08-05-model-routing-system.md §3.4
// capability closure). Renders the policy version, lane meters, and a
// decision-preview placeholder over the same /api/routing/* surface `od
// route` reads. Real policy content, admission control, and dispatch-time
// decisions land in later WR tranches (P1/P2) -- see
// docs/plans/waves/WR-routing.md's Tranche register.
//
// TODO(WR lease): apps/web/src/i18n/types.ts and locales/en.ts are not in
// this wave's lease allow list (docs/plans/waves/WR-routing.md's "Lease"
// section), so the strings below are hardcoded English instead of routed
// through useT(). A tranche that gets an i18n lease grant should replace
// them with real keys.
//
// Not yet registered into any parent view: the lease's only web
// integration points are this directory and AssistantMessage.tsx (a
// per-message "why this model" render -- a different, P2-scoped surface),
// and neither is a natural mount point for a standalone policy/meters
// panel. Exported for a later tranche to wire up once one exists.

import { useEffect, useState } from 'react';
import { Button } from '@open-design/components';
import {
  isRoutingDecisionPreviewResponse,
  isRoutingMetersResponse,
  isRoutingPolicyResponse,
  type LaneMeter,
  type RoutingDecision,
} from '@open-design/contracts';
import styles from './RoutingPanel.module.css';

export interface RoutingPanelProps {
  /** Base daemon URL for the fetch calls below; empty string performs a
   * same-origin fetch (the default when the web app is served through the
   * daemon's own proxy). */
  daemonUrl?: string;
}

export function RoutingPanel({ daemonUrl = '' }: RoutingPanelProps) {
  const [policyVersion, setPolicyVersion] = useState<number | null>(null);
  const [laneMeters, setLaneMeters] = useState<LaneMeter[]>([]);
  const [decision, setDecision] = useState<RoutingDecision | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`${daemonUrl}/api/routing/policy`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${daemonUrl}/api/routing/meters`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${daemonUrl}/api/routing/decision/preview`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([policyData, metersData, previewData]) => {
        if (cancelled) return;
        setPolicyVersion(isRoutingPolicyResponse(policyData) ? policyData.policyVersion : null);
        setLaneMeters(isRoutingMetersResponse(metersData) ? metersData.laneMeters : []);
        setDecision(isRoutingDecisionPreviewResponse(previewData) ? previewData.decision : null);
      })
      .catch(() => {
        if (cancelled) return;
        setPolicyVersion(null);
        setLaneMeters([]);
        setDecision(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `refreshNonce` intentionally re-runs this effect on demand -- see the
    // Refresh button below.
  }, [daemonUrl, refreshNonce]);

  return (
    <section className={styles.root} data-testid="routing-panel">
      <header className={styles.header}>
        <h2 className={styles.title}>Model routing</h2>
      </header>

      <dl className={styles.summary}>
        <dt>Policy version</dt>
        <dd data-testid="routing-policy-version">{policyVersion ?? '—'}</dd>
      </dl>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Lane meters</h3>
        {loading ? (
          <p className={styles.empty}>Loading…</p>
        ) : laneMeters.length === 0 ? (
          <p className={styles.empty}>No lane meters recorded yet.</p>
        ) : (
          <ul className={styles.meterList}>
            {laneMeters.map((meter) => (
              <li key={meter.lane} className={styles.meterRow}>
                <span>{meter.lane}</span>
                <span>{meter.runsRouted} routed</span>
                <span>{Math.round(meter.passRate * 100)}% pass</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Decision preview</h3>
        {decision ? (
          <div
            className={decision.status === 'fail-closed-stop' ? styles.decisionFailClosed : styles.decisionOk}
            data-testid="routing-decision-status"
            data-status={decision.status}
          >
            <p className={styles.previewPlaceholder}>
              {decision.status === 'fail-closed-stop' ? 'FAIL-CLOSED — ' : decision.status === 'error' ? 'ERROR — ' : ''}
              {decision.rationale}
            </p>
            {decision.reasons.length > 0 ? (
              <ol className={styles.reasonList} data-testid="routing-decision-reasons">
                {decision.reasons.map((reason, i) => (
                  <li key={`${reason.step}-${i}`} className={styles.reasonRow}>
                    <span className={styles.reasonStep}>{reason.step}</span>
                    <span>{reason.message}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : (
          <p className={styles.previewPlaceholder}>No decision preview available yet.</p>
        )}
      </div>

      <Button
        variant="ghost"
        className={styles.refresh ?? ''}
        onClick={() => setRefreshNonce((n) => n + 1)}
        disabled={loading}
      >
        Refresh
      </Button>
    </section>
  );
}
