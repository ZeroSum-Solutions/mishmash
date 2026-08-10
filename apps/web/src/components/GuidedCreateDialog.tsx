// GuidedCreateDialog (PRD C8) — the shared low-friction brief flow shown in
// front of "start from a kit/template". One component, two entry points:
// the Design Library "Use as template" action (DesignLibrarySection.tsx)
// and the Templates tab create-from-template action (TemplatesSection.tsx).
//
// Three steps (Scope / Content / Direction), progress dots, Back/Next, and a
// Skip-all escape hatch. Every field is optional and `Start` is reachable
// from every step — skipping every question yields an empty brief, which
// the daemon treats identically to no brief at all (see
// apps/daemon/src/prompts/guided-brief.ts), so the current single-click
// behavior stays exactly backward compatible.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle, Input, Textarea } from '@open-design/components';
import type { GuidedCreateBrief, GuidedCreateFidelity } from '@open-design/contracts';
import { useT } from '../i18n';
import styles from './GuidedCreateDialog.module.css';

const SCREEN_PRESETS = [1, 3, 5, 8] as const;
const ITERATION_OPTIONS = [1, 2, 3] as const;
const FIDELITY_OPTIONS: readonly GuidedCreateFidelity[] = ['wireframe', 'clean-prototype', 'high-fidelity'];
const FIDELITY_LABEL_KEY: Record<GuidedCreateFidelity, Parameters<ReturnType<typeof useT>>[0]> = {
  'wireframe': 'guidedCreate.fidelity.wireframe',
  'clean-prototype': 'guidedCreate.fidelity.cleanPrototype',
  'high-fidelity': 'guidedCreate.fidelity.highFidelity',
};
const QUICK_PAGE_CHIPS: Array<{ value: string; key: Parameters<ReturnType<typeof useT>>[0] }> = [
  { value: 'Home', key: 'guidedCreate.chip.home' },
  { value: 'Pricing', key: 'guidedCreate.chip.pricing' },
  { value: 'About', key: 'guidedCreate.chip.about' },
  { value: 'Dashboard', key: 'guidedCreate.chip.dashboard' },
  { value: 'Onboarding', key: 'guidedCreate.chip.onboarding' },
  { value: 'Settings', key: 'guidedCreate.chip.settings' },
  { value: 'Checkout', key: 'guidedCreate.chip.checkout' },
];

const STEP_COUNT = 3;
const MAX_SCREENS = 200;
const MAX_ITERATIONS = 3;

export interface GuidedCreateDialogProps {
  /** Item/template name — shown in the dialog title. */
  title: string;
  /** Label used for the "match its own look" toggle's copy, when shown. */
  subjectLabel?: string;
  /** Offer the "match the kit's own look" toggle — only relevant when starting from a kit. */
  showMatchKitLook?: boolean;
  /** True while the caller's start-project request is in flight. */
  busy?: boolean;
  onClose: () => void;
  /** Always reachable — an empty brief (every field skipped) is a valid submission. */
  onSubmit: (brief: GuidedCreateBrief) => void;
}

function collectPages(selected: string[], freeText: string): string[] {
  const freeform = freeText
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([...selected, ...freeform])];
}

export function GuidedCreateDialog({
  title,
  subjectLabel,
  showMatchKitLook = false,
  busy = false,
  onClose,
  onSubmit,
}: GuidedCreateDialogProps) {
  const t = useT();
  const [step, setStep] = useState(0);

  // Step 1: Scope
  const [screensPreset, setScreensPreset] = useState<number | 'custom' | null>(null);
  const [screensCustom, setScreensCustom] = useState('');
  const [fidelity, setFidelity] = useState<GuidedCreateFidelity | null>(null);
  const [iterations, setIterations] = useState<number | null>(null);

  // Step 2: Content
  const [selectedPages, setSelectedPages] = useState<string[]>([]);
  const [pagesText, setPagesText] = useState('');
  const [product, setProduct] = useState('');
  const [audience, setAudience] = useState('');
  const [useCase, setUseCase] = useState('');

  // Step 3: Direction
  const [direction, setDirection] = useState('');
  const [matchKitLook, setMatchKitLook] = useState(false);

  // Guards every submit path (Start and Skip all) against a double-fire —
  // e.g. a fast double-click before the parent's own `busy` prop flips true,
  // or a caller that never passes `busy` at all. Reset is unnecessary: a
  // submit always leads the caller to close this dialog (see both entry
  // points), so there is no "let the user retry from here" path to unstick.
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const submitDisabled = busy || localSubmitting;

  function buildBrief(): GuidedCreateBrief {
    const brief: GuidedCreateBrief = {};
    const rawScreens = screensPreset === 'custom' ? Number(screensCustom) : screensPreset;
    // Non-positive/NaN custom counts are omitted rather than sent — rounding
    // BEFORE the >=1 check (not after) so a value like 0.4 can't round down
    // to 0 and slip past the guard. Mirrors normalizeGuidedBrief's server-side
    // `Number.isInteger(screens) && screens >= 1` check.
    const roundedScreens = Number.isFinite(rawScreens) ? Math.round(rawScreens as number) : NaN;
    if (Number.isFinite(roundedScreens) && roundedScreens >= 1) {
      brief.screens = Math.min(roundedScreens, MAX_SCREENS);
    }
    if (fidelity) brief.fidelity = fidelity;
    if (iterations) brief.iterations = Math.min(iterations, MAX_ITERATIONS);
    const pages = collectPages(selectedPages, pagesText);
    if (pages.length > 0) brief.pages = pages;
    if (product.trim()) brief.product = product.trim();
    if (audience.trim()) brief.audience = audience.trim();
    if (useCase.trim()) brief.useCase = useCase.trim();
    if (direction.trim()) brief.direction = direction.trim();
    if (matchKitLook) brief.matchKitLook = true;
    return brief;
  }

  function togglePage(value: string) {
    setSelectedPages((prev) => (prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]));
  }

  function handleSkipAll() {
    if (submitDisabled) return;
    setLocalSubmitting(true);
    onSubmit({});
  }

  function handleStart() {
    if (submitDisabled) return;
    setLocalSubmitting(true);
    onSubmit(buildBrief());
  }

  const dialog = (
    <Dialog
      ariaLabel={title}
      onClose={onClose}
      closeOnEscape
      backdropClassName={styles.backdrop}
      className={styles.dialog}
      data-testid="guided-create-dialog"
    >
      <DialogHeader className={styles.header}>
        <DialogTitle className={styles.title}>{title}</DialogTitle>
        <p className={styles.subtitle}>{t('guidedCreate.subtitle')}</p>
        <div className={styles.progress} role="group" aria-label={t('guidedCreate.stepIndicator', { current: step + 1, total: STEP_COUNT })}>
          {Array.from({ length: STEP_COUNT }, (_, i) => (
            <span
              key={i}
              className={styles.progressDot}
              data-active={i === step ? 'true' : 'false'}
              data-testid="guided-create-progress-dot"
            />
          ))}
        </div>
      </DialogHeader>

      <DialogBody className={styles.body}>
        {step === 0 ? (
          <div className={styles.step} data-testid="guided-create-step" data-step="0">
            <h3 className={styles.stepTitle}>{t('guidedCreate.step.scope.title')}</h3>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('guidedCreate.screensLabel')}</span>
              <div className={styles.chipRow}>
                {SCREEN_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={styles.chip}
                    aria-pressed={screensPreset === preset}
                    data-testid="guided-create-screens-preset"
                    data-value={preset}
                    onClick={() => setScreensPreset(preset)}
                  >
                    {preset}
                  </button>
                ))}
                <button
                  type="button"
                  className={styles.chip}
                  aria-pressed={screensPreset === 'custom'}
                  data-testid="guided-create-screens-preset"
                  data-value="custom"
                  onClick={() => setScreensPreset('custom')}
                >
                  …
                </button>
                {screensPreset === 'custom' ? (
                  <Input
                    type="number"
                    min={1}
                    max={MAX_SCREENS}
                    className={styles.customInput}
                    placeholder={t('guidedCreate.screensCustomPlaceholder')}
                    value={screensCustom}
                    onChange={(e) => setScreensCustom(e.target.value)}
                    data-testid="guided-create-screens-custom"
                  />
                ) : null}
              </div>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('guidedCreate.fidelityLabel')}</span>
              <div className={styles.chipRow}>
                {FIDELITY_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={styles.chip}
                    aria-pressed={fidelity === option}
                    data-testid="guided-create-fidelity"
                    data-value={option}
                    onClick={() => setFidelity(option)}
                  >
                    {t(FIDELITY_LABEL_KEY[option])}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('guidedCreate.iterationsLabel')}</span>
              <div className={styles.chipRow}>
                {ITERATION_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={styles.chip}
                    aria-pressed={iterations === option}
                    data-testid="guided-create-iterations"
                    data-value={option}
                    onClick={() => setIterations(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className={styles.step} data-testid="guided-create-step" data-step="1">
            <h3 className={styles.stepTitle}>{t('guidedCreate.step.content.title')}</h3>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('guidedCreate.pagesLabel')}</span>
              <div className={styles.chipRow}>
                {QUICK_PAGE_CHIPS.map((chip) => (
                  <button
                    key={chip.value}
                    type="button"
                    className={styles.chip}
                    aria-pressed={selectedPages.includes(chip.value)}
                    data-testid="guided-create-page-chip"
                    data-page={chip.value}
                    onClick={() => togglePage(chip.value)}
                  >
                    {t(chip.key)}
                  </button>
                ))}
              </div>
              <Input
                className={styles.textInput}
                placeholder={t('guidedCreate.pagesPlaceholder')}
                value={pagesText}
                onChange={(e) => setPagesText(e.target.value)}
                data-testid="guided-create-pages-text"
              />
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('guidedCreate.productLabel')}</span>
              <Input
                className={styles.textInput}
                placeholder={t('guidedCreate.productPlaceholder')}
                value={product}
                onChange={(e) => setProduct(e.target.value)}
                data-testid="guided-create-product"
              />
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('guidedCreate.audienceLabel')}</span>
              <Input
                className={styles.textInput}
                placeholder={t('guidedCreate.audiencePlaceholder')}
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                data-testid="guided-create-audience"
              />
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('guidedCreate.useCaseLabel')}</span>
              <Input
                className={styles.textInput}
                placeholder={t('guidedCreate.useCasePlaceholder')}
                value={useCase}
                onChange={(e) => setUseCase(e.target.value)}
                data-testid="guided-create-use-case"
              />
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className={styles.step} data-testid="guided-create-step" data-step="2">
            <h3 className={styles.stepTitle}>{t('guidedCreate.step.direction.title')}</h3>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('guidedCreate.directionLabel')}</span>
              <Textarea
                className={styles.textarea}
                rows={4}
                placeholder={t('guidedCreate.directionPlaceholder')}
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                data-testid="guided-create-direction"
              />
            </div>
            {showMatchKitLook ? (
              <label className={styles.toggleRow}>
                <input
                  type="checkbox"
                  checked={matchKitLook}
                  onChange={(e) => setMatchKitLook(e.target.checked)}
                  data-testid="guided-create-match-kit-look"
                />
                {subjectLabel
                  ? `${t('guidedCreate.matchKitLook')} (${subjectLabel})`
                  : t('guidedCreate.matchKitLook')}
              </label>
            ) : null}
          </div>
        ) : null}
      </DialogBody>

      <DialogFooter className={styles.footer}>
        <button
          type="button"
          className={styles.skipBtn}
          disabled={submitDisabled}
          onClick={handleSkipAll}
          data-testid="guided-create-skip"
        >
          {t('guidedCreate.skipAll')}
        </button>
        <div className={styles.footerNav}>
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} data-testid="guided-create-back">
              {t('guidedCreate.back')}
            </Button>
          ) : null}
          {step < STEP_COUNT - 1 ? (
            <Button onClick={() => setStep((s) => Math.min(STEP_COUNT - 1, s + 1))} data-testid="guided-create-next">
              {t('guidedCreate.next')}
            </Button>
          ) : null}
          <Button
            variant="primary"
            disabled={submitDisabled}
            onClick={handleStart}
            data-testid="guided-create-start"
          >
            {busy ? t('guidedCreate.starting') : t('guidedCreate.start')}
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}
