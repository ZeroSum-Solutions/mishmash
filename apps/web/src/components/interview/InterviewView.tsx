// F002 R1/R6 — the client discovery interview's web surface. Tier picker →
// turn loop (rendered through `QuestionFormView`, the same component the
// in-chat `<question-form>` artifact uses, per R1's "run the interview over
// the existing <question-form> contract") → a completion screen that gates
// starting a project on the REQUIRED gate, with an explicit confirmation to
// override it (R1's "--force-incomplete / equivalent UI confirmation").
//
// Standalone top-level surface (apps/web/src/router.ts `interview` /
// `interview-session` routes), not embedded inside an agent-driven chat run.
// See apps/daemon/src/interview/engine.ts's module docblock for why the
// engine itself is a deterministic state machine rather than a live-model
// conversation — this view is a thin client over that engine's HTTP surface
// (apps/daemon/src/routes/interviews.ts), nothing more.
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@open-design/components';
import type {
  ClientBrief,
  GuidedCreateBrief,
  InterviewQuestionDef,
  InterviewSessionSummary,
  InterviewTier,
} from '@open-design/contracts';
import { INTERVIEW_TIERS } from '@open-design/contracts';
import { QuestionFormView } from '../QuestionForm';
import type { FormQuestion, QuestionForm as QuestionFormShape } from '../../artifacts/question-form';
import { navigate } from '../../router';
import { useT } from '../../i18n';
import { createProject } from '../../state/projects';
import styles from './InterviewView.module.css';

type Phase = 'picker' | 'running' | 'terminal';

interface TurnState {
  message: string;
  questions: InterviewQuestionDef[];
}

interface PushBackState {
  fieldId: string;
  message: string;
}

function toQuestionForm(turn: TurnState): QuestionFormShape {
  const questions: FormQuestion[] = turn.questions.map((q) => ({
    id: q.id,
    label: q.label,
    type: q.type,
    required: q.required,
    ...(q.placeholder ? { placeholder: q.placeholder } : {}),
  }));
  return { id: 'interview-turn', title: turn.message, questions };
}

interface InterviewViewProps {
  /** Present when the route deep-links an existing session (`/interview/:id`) —
   * resumes it via GET instead of showing the tier picker. */
  resumeSessionId?: string;
}

export function InterviewView({ resumeSessionId }: InterviewViewProps) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>(resumeSessionId ? 'running' : 'picker');
  const [sessionId, setSessionId] = useState<string | null>(resumeSessionId ?? null);
  const [session, setSession] = useState<InterviewSessionSummary | null>(null);
  const [turn, setTurn] = useState<TurnState | null>(null);
  const [pushBack, setPushBack] = useState<PushBackState | null>(null);
  const [clientBrief, setClientBrief] = useState<ClientBrief | null>(null);
  const [guidedBrief, setGuidedBrief] = useState<GuidedCreateBrief | null>(null);
  const [busy, setBusy] = useState(!!resumeSessionId);
  const [error, setError] = useState<string | null>(null);
  const [forceIncomplete, setForceIncomplete] = useState(false);
  const [projectName, setProjectName] = useState('');

  useEffect(() => {
    if (!resumeSessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`/api/interviews/${encodeURIComponent(resumeSessionId)}`);
        if (!resp.ok) throw new Error(t('interview.error.resume'));
        const data = (await resp.json()) as {
          session: InterviewSessionSummary;
          turn?: TurnState;
          result?: { clientBrief: ClientBrief; guidedBrief: GuidedCreateBrief };
        };
        if (cancelled) return;
        setSession(data.session);
        if (data.turn) {
          setTurn(data.turn);
          setPhase('running');
        } else if (data.result) {
          setClientBrief(data.result.clientBrief);
          setGuidedBrief(data.result.guidedBrief);
          setPhase('terminal');
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('interview.error.resume'));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resumeSessionId, t]);

  const startTier = useCallback(
    async (tier: InterviewTier) => {
      setBusy(true);
      setError(null);
      try {
        const resp = await fetch('/api/interviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tier }),
        });
        if (!resp.ok) throw new Error(t('interview.error.start'));
        const data = (await resp.json()) as { session: InterviewSessionSummary; turn: TurnState };
        setSessionId(data.session.id);
        setSession(data.session);
        setTurn(data.turn);
        setPushBack(null);
        setPhase('running');
        navigate({ kind: 'interview-session', sessionId: data.session.id }, { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : t('interview.error.start'));
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  const submitAnswers = useCallback(
    async (_text: string, rawAnswers: Record<string, string | string[]>) => {
      if (!sessionId) return;
      setBusy(true);
      setError(null);
      const answers: Record<string, string> = {};
      for (const [key, value] of Object.entries(rawAnswers)) {
        answers[key] = Array.isArray(value) ? value.join(', ') : value;
      }
      try {
        const resp = await fetch(`/api/interviews/${encodeURIComponent(sessionId)}/turns`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers }),
        });
        if (!resp.ok) throw new Error(t('interview.error.turn'));
        const data = (await resp.json()) as {
          session: InterviewSessionSummary;
          turn?: TurnState;
          pushBack?: PushBackState;
          result?: { clientBrief: ClientBrief; guidedBrief: GuidedCreateBrief };
        };
        setSession(data.session);
        if (data.pushBack) {
          setPushBack(data.pushBack);
          if (data.turn) setTurn(data.turn);
          return;
        }
        setPushBack(null);
        if (data.result) {
          setClientBrief(data.result.clientBrief);
          setGuidedBrief(data.result.guidedBrief);
          setPhase('terminal');
          return;
        }
        if (data.turn) setTurn(data.turn);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('interview.error.turn'));
      } finally {
        setBusy(false);
      }
    },
    [sessionId, t],
  );

  const startProjectFromBrief = useCallback(async () => {
    if (!guidedBrief || !clientBrief) return;
    if (clientBrief.status !== 'complete' && !forceIncomplete) return;
    setBusy(true);
    setError(null);
    try {
      const { project, conversationId } = await createProject({
        name: projectName.trim() || t('interview.defaultProjectName'),
        brief: guidedBrief,
        skipDiscoveryBrief: true,
      });
      navigate({ kind: 'project', projectId: project.id, conversationId: conversationId ?? null, fileName: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('interview.error.startProject'));
    } finally {
      setBusy(false);
    }
  }, [guidedBrief, clientBrief, forceIncomplete, projectName, t]);

  return (
    <div className={styles.root} data-testid="interview-view">
      <header className={styles.header}>
        <Button
          variant="ghost"
          onClick={() => navigate({ kind: 'home', view: 'home' })}
          data-testid="interview-back"
        >
          {t('interview.back')}
        </Button>
        <h1 className={styles.title}>{t('interview.title')}</h1>
      </header>

      {error ? (
        <div className={styles.error} role="alert" data-testid="interview-error">
          {error}
        </div>
      ) : null}

      {phase === 'running' && busy && !turn ? (
        <div className={styles.progress} data-testid="interview-resuming">
          {t('interview.resuming')}
        </div>
      ) : null}

      {phase === 'picker' ? (
        <div className={styles.tierPicker} data-testid="interview-tier-picker">
          <p className={styles.intro}>{t('interview.intro')}</p>
          {INTERVIEW_TIERS.map((tier) => (
            <button
              key={tier}
              type="button"
              className={styles.tierCard}
              data-testid={`interview-tier-${tier}`}
              disabled={busy}
              onClick={() => void startTier(tier)}
            >
              <span className={styles.tierName}>{t(`interview.tier.${tier}.name`)}</span>
              <span className={styles.tierDuration}>{t(`interview.tier.${tier}.duration`)}</span>
              <span className={styles.tierDesc}>{t(`interview.tier.${tier}.description`)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {phase === 'running' && turn ? (
        <div className={styles.turn} data-testid="interview-turn">
          {pushBack ? (
            <div className={styles.pushBack} role="alert" data-testid="interview-pushback">
              {pushBack.message}
            </div>
          ) : null}
          <QuestionFormView
            // A fresh `key` per turn forces a full remount: QuestionFormView
            // only resets its internal step/answer state on `[form.id]`, and
            // every turn shares the same synthetic form id ('interview-turn')
            // by design (it isn't a real <question-form> artifact id). Without
            // this, a session's second and later 2-question turns would
            // inherit the previous turn's stale `activeQuestionIndex`/answers.
            key={session ? `${session.id}-${session.stepIndex}` : 'interview-turn'}
            form={toQuestionForm(turn)}
            interactive={!busy}
            onSubmit={(_text, answers) => void submitAnswers(_text, answers)}
          />
          {session ? (
            <div className={styles.progress} data-testid="interview-progress">
              {t('interview.progress', { current: session.stepIndex + 1, total: session.totalSteps })}
            </div>
          ) : null}
        </div>
      ) : null}

      {phase === 'terminal' && clientBrief && guidedBrief ? (
        <div className={styles.terminal} data-testid="interview-terminal">
          <div
            className={clientBrief.status === 'complete' ? styles.statusComplete : styles.statusNeedsInfo}
            data-testid="interview-status"
          >
            {clientBrief.status === 'complete' ? t('interview.status.complete') : t('interview.status.needsInfo')}
          </div>

          {clientBrief.openItems.length > 0 ? (
            <div className={styles.openItems} data-testid="interview-open-items">
              <h2>{t('interview.openItems.title')}</h2>
              <ul>
                {clientBrief.openItems.map((item) => (
                  <li key={item.fieldId}>{item.label}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <label className={styles.projectNameLabel}>
            {t('interview.projectName.label')}
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder={t('interview.defaultProjectName')}
              data-testid="interview-project-name"
            />
          </label>

          {clientBrief.status !== 'complete' ? (
            <label className={styles.forceIncomplete}>
              <input
                type="checkbox"
                checked={forceIncomplete}
                onChange={(e) => setForceIncomplete(e.target.checked)}
                data-testid="interview-force-incomplete"
              />
              {t('interview.forceIncomplete.label')}
            </label>
          ) : null}

          <Button
            variant="primary"
            disabled={busy || (clientBrief.status !== 'complete' && !forceIncomplete)}
            onClick={() => void startProjectFromBrief()}
            data-testid="interview-start-project"
          >
            {t('interview.startProject')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
