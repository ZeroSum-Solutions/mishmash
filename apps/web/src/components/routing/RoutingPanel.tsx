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
//
// t7 fix-round disposition (Sol HIGH-2): this component being unreachable
// from any real view is a t2 lease limitation, not something t7 can fix --
// reachability lands in t9 via the leased AssistantMessage.tsx "why this
// model" surface plus a governance amendment to this wave's lease, both
// tracked outside this tranche.

import { useEffect, useState } from 'react';
import { Button } from '@open-design/components';
import {
  isRoutingDecisionPreviewResponse,
  isRoutingGatesRegistryResponse,
  isRoutingMetersResponse,
  isRoutingPolicyResponse,
  isRoutingRatesResponse,
  type GateDefinitionDTO,
  type LaneMeter,
  type RoutingCooldownStatus,
  type RoutingDecision,
  type RoutingRatesByStage,
} from '@open-design/contracts';
import styles from './RoutingPanel.module.css';

// t9 addition (plan §3.1 dispatch-time routing integration): the override
// surface's request shape. Kept local to this component rather than
// imported from contracts -- packages/contracts/src/api/chat.ts is outside
// this wave's lease, so `routingOverride` is not yet a first-class
// ChatRequest DTO field (see apps/daemon/src/routing/dispatch.ts's header
// for the full governance-amendment rationale). This form is a STUB: it is
// not wired to any live chat run (RoutingPanel is not yet mounted in the
// chat flow -- see this file's own header), so "Preview" only renders the
// same rationale sentence `resolveDispatchRouting`'s override path would
// record, computed locally, to demonstrate the surface shape.
interface RoutingOverrideDraft {
  model: string;
  lane: string;
  reason: string;
}

function overrideRationale(draft: RoutingOverrideDraft): string {
  const reason = draft.reason.trim().length > 0 ? draft.reason.trim() : 'no reason given';
  return `user override to ${draft.model} on lane "${draft.lane}": ${reason}.`;
}

export interface RoutingPanelProps {
  /** Base daemon URL for the fetch calls below; empty string performs a
   * same-origin fetch (the default when the web app is served through the
   * daemon's own proxy). */
  daemonUrl?: string;
}

export function RoutingPanel({ daemonUrl = '' }: RoutingPanelProps) {
  const [policyVersion, setPolicyVersion] = useState<number | null>(null);
  const [laneMeters, setLaneMeters] = useState<LaneMeter[]>([]);
  // t7 addition (plan §3.2 L1): per-runtime/per-lane cooldown status --
  // `/api/routing/meters`'s additive `cooldowns` field. `undefined` (not
  // `[]`) distinguishes "not fetched yet / daemon has no db" from "fetched,
  // no active cooldown history" -- see RoutingMetersResponse#cooldowns's own
  // doc comment.
  const [cooldowns, setCooldowns] = useState<RoutingCooldownStatus[] | undefined>(undefined);
  const [decision, setDecision] = useState<RoutingDecision | null>(null);
  // t8 addition (plan §3.2 L3): the L3 gate registry -- read-only display
  // of GET /api/routing/gates. Running a gate needs an artifactDir this
  // overview panel has no natural input for yet, so this section shows the
  // registry only; `od route gates run` / POST /api/routing/gates/run
  // cover execution.
  const [gates, setGates] = useState<GateDefinitionDTO[]>([]);
  // t9 addition (plan §5 P2 gate: "escalation/pass rates visible"):
  // GET /api/routing/rates -- overall escalation/pass rate + by-stage
  // breakdown, the same shape `od route rates --json` reads.
  const [ratesTotalRuns, setRatesTotalRuns] = useState<number | null>(null);
  const [ratesEscalation, setRatesEscalation] = useState<number | null>(null);
  const [ratesPass, setRatesPass] = useState<number | null>(null);
  const [ratesByStage, setRatesByStage] = useState<RoutingRatesByStage[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  // t9 addition: override control stub -- see `RoutingOverrideDraft`'s own
  // doc comment above for why this is local-only, not wired to a live run.
  const [overrideDraft, setOverrideDraft] = useState<RoutingOverrideDraft>({ model: '', lane: '', reason: '' });
  const [overridePreview, setOverridePreview] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`${daemonUrl}/api/routing/policy`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${daemonUrl}/api/routing/meters`).then((r) => (r.ok ? r.json() : null)),
      // GET, param-only, no `promptText` -- Sol review MED-5 (t5 fix
      // commit): a composed-prompt excerpt is potentially client-
      // confidential and must never ride a query string. A caller that
      // needs promptText-derived estimation uses `POST
      // /api/routing/decision/preview` (JSON body) instead; this panel is a
      // plain policy-version/lane-meter/decision-shape overview and never
      // sends one.
      fetch(`${daemonUrl}/api/routing/decision/preview`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${daemonUrl}/api/routing/gates`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${daemonUrl}/api/routing/rates`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([policyData, metersData, previewData, gatesData, ratesData]) => {
        if (cancelled) return;
        setPolicyVersion(isRoutingPolicyResponse(policyData) ? policyData.policyVersion : null);
        setLaneMeters(isRoutingMetersResponse(metersData) ? metersData.laneMeters : []);
        setCooldowns(isRoutingMetersResponse(metersData) ? metersData.cooldowns : undefined);
        setDecision(isRoutingDecisionPreviewResponse(previewData) ? previewData.decision : null);
        setGates(isRoutingGatesRegistryResponse(gatesData) ? gatesData.gates : []);
        const rates = isRoutingRatesResponse(ratesData) ? ratesData : null;
        setRatesTotalRuns(rates ? rates.totalRuns : null);
        setRatesEscalation(rates ? rates.escalationRate : null);
        setRatesPass(rates ? rates.passRate : null);
        setRatesByStage(rates ? rates.byStage : []);
      })
      .catch(() => {
        if (cancelled) return;
        setPolicyVersion(null);
        setLaneMeters([]);
        setCooldowns(undefined);
        setDecision(null);
        setGates([]);
        setRatesTotalRuns(null);
        setRatesEscalation(null);
        setRatesPass(null);
        setRatesByStage([]);
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

      <div className={styles.section} data-testid="routing-cooldowns">
        <h3 className={styles.sectionTitle}>Reliability cooldowns</h3>
        {loading ? (
          <p className={styles.empty}>Loading…</p>
        ) : !cooldowns || cooldowns.length === 0 ? (
          <p className={styles.empty}>No active cooldown history.</p>
        ) : (
          <ul className={styles.reasonList}>
            {cooldowns.map((cooldown) => (
              <li
                key={`${cooldown.scopeType}-${cooldown.scopeId}`}
                className={cooldown.inCooldown ? styles.cooldownRowActive : styles.cooldownRow}
                data-testid="routing-cooldown-row"
                data-in-cooldown={cooldown.inCooldown}
              >
                <span className={styles.reasonStep}>
                  {cooldown.scopeType}:{cooldown.scopeId}
                </span>
                <span>
                  {cooldown.inCooldown ? `cooling (${cooldown.remainingMs}ms left)` : 'clear'} —{' '}
                  {cooldown.consecutiveFailures} consecutive failure(s) — {cooldown.reason}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Decision preview</h3>
        {decision ? (
          <div
            className={
              decision.status === 'fail-closed-stop' || decision.status === 'denied-admission'
                ? styles.decisionFailClosed
                : styles.decisionOk
            }
            data-testid="routing-decision-status"
            data-status={decision.status}
          >
            <p className={styles.previewPlaceholder}>
              {decision.status === 'fail-closed-stop'
                ? 'FAIL-CLOSED — '
                : decision.status === 'denied-admission'
                  ? 'DENIED (BUDGET) — '
                  : decision.status === 'error'
                    ? 'ERROR — '
                    : ''}
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
            {decision.admissionResults.length > 0 ? (
              <div data-testid="routing-admission-results">
                <h4 className={styles.sectionTitle}>Admission ({decision.admissionVerdict})</h4>
                <ul className={styles.reasonList}>
                  {decision.admissionResults.map((r, i) => (
                    <li key={`${r.model}-${r.lane}-${i}`} className={styles.reasonRow} data-verdict={r.verdict}>
                      <span className={styles.reasonStep}>{r.verdict}</span>
                      <span>
                        {r.model}@{r.lane} ({r.estimatedCostUsd !== null ? `$${r.estimatedCostUsd.toFixed(4)}` : 'unknown cost'}) —{' '}
                        {r.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className={styles.previewPlaceholder}>No decision preview available yet.</p>
        )}
      </div>

      <div className={styles.section} data-testid="routing-rates">
        <h3 className={styles.sectionTitle}>Escalation / pass rates</h3>
        {loading ? (
          <p className={styles.empty}>Loading…</p>
        ) : ratesTotalRuns === null || ratesTotalRuns === 0 ? (
          <p className={styles.empty}>No routed runs recorded yet.</p>
        ) : (
          <>
            <dl className={styles.summary}>
              <dt>Escalation rate</dt>
              <dd>{Math.round((ratesEscalation ?? 0) * 100)}%</dd>
              <dt>Pass rate</dt>
              <dd>{Math.round((ratesPass ?? 0) * 100)}%</dd>
              <dt>Runs</dt>
              <dd>{ratesTotalRuns}</dd>
            </dl>
            {ratesByStage.length > 0 ? (
              <ul className={styles.meterList}>
                {ratesByStage.map((s) => (
                  <li key={`${s.stage}-${s.templateId ?? ''}`} className={styles.meterRow}>
                    <span>
                      {s.stage}
                      {s.templateId ? ` (${s.templateId})` : ''}
                    </span>
                    <span>{s.runs} run(s)</span>
                    <span>{Math.round(s.escalationRate * 100)}% escalated</span>
                    <span>{Math.round(s.passRate * 100)}% pass</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>

      <div className={styles.section} data-testid="routing-override">
        <h3 className={styles.sectionTitle}>Override (stub)</h3>
        <p className={styles.previewPlaceholder}>
          Explicit overrides are resolved dispatch-side
          (`resolveDispatchRouting`, `mode: &apos;override&apos;`) -- this panel is not yet
          mounted in a live chat run, so the fields below only preview the
          rationale sentence a real override would record.
        </p>
        <div className={styles.section}>
          <input
            type="text"
            placeholder="model (e.g. claude-opus-5)"
            value={overrideDraft.model}
            onChange={(e) => setOverrideDraft((d) => ({ ...d, model: e.target.value }))}
            data-testid="routing-override-model"
          />
          <input
            type="text"
            placeholder="lane (e.g. claude-code-oauth)"
            value={overrideDraft.lane}
            onChange={(e) => setOverrideDraft((d) => ({ ...d, lane: e.target.value }))}
            data-testid="routing-override-lane"
          />
          <input
            type="text"
            placeholder="reason"
            value={overrideDraft.reason}
            onChange={(e) => setOverrideDraft((d) => ({ ...d, reason: e.target.value }))}
            data-testid="routing-override-reason"
          />
        </div>
        <Button
          variant="ghost"
          disabled={!overrideDraft.model.trim() || !overrideDraft.lane.trim()}
          onClick={() => setOverridePreview(overrideRationale(overrideDraft))}
        >
          Preview override
        </Button>
        {overridePreview ? (
          <p className={styles.previewPlaceholder} data-testid="routing-override-preview">
            {overridePreview}
          </p>
        ) : null}
      </div>

      <div className={styles.section} data-testid="routing-gates">
        <h3 className={styles.sectionTitle}>L3 gates</h3>
        {loading ? (
          <p className={styles.empty}>Loading…</p>
        ) : gates.length === 0 ? (
          <p className={styles.empty}>No gate registry available.</p>
        ) : (
          <ul className={styles.reasonList}>
            {gates.map((gate) => (
              <li key={gate.id} className={styles.reasonRow} data-testid="routing-gate-row" data-gate-class={gate.class}>
                <span className={styles.reasonStep}>{gate.id}</span>
                <span>
                  [{gate.class}
                  {gate.runnable ? '' : ', advisory only'}] {gate.label}
                </span>
              </li>
            ))}
          </ul>
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
