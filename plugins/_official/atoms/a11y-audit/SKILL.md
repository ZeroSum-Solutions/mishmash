---
name: a11y-audit
description: Run axe-core against the rendered artifact and emit the a11y.passing + a11y.violations signals devloop convergence reads.
od:
  scenario: new-generation
  mode: critique
---

# Accessibility audit

`craft/accessibility-baseline.md` describes a WCAG conformance target in
prose, but nothing measured it. The `a11y` panelist in Critique Theater
scores accessibility the same way it scores taste — by reading the artifact
and forming an opinion — and a model is a poor judge of whether `#999` on
white clears 4.5:1.

This atom measures instead. It loads the rendered artifact in the headless
chromium the daemon already ships, injects axe-core, and reports what the
rules actually found.

## Inputs

- The rendered artifact at the project root, `index.html` by default.
- `OD_A11Y_AUDIT_TARGET` overrides the path for projects whose primary
  artifact lives elsewhere (e.g. `dist/report.html`).

## Rule set

WCAG 2.1 A + AA (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`). Deliberately
narrower than axe's default set: `best-practice` rules are advisory, and
advisory findings must never block a devloop.

## Output

```text
project-cwd/
└── critique/
    └── a11y-audit.json   # { status, counts, blockingCount, violations: [...], signals, engine, endedAt }
```

The atom emits **two** signals:

- `a11y.violations: number` — violating *nodes* at or above the fail
  threshold (`serious` + `critical` by default). Nodes, not rules: one
  contrast rule failing across nine elements is nine problems to fix.
- `a11y.passing: boolean` — `a11y.violations === 0`.

Plus the legacy `critique.score` (5 passing / 1 failing) so pipelines
already gating on `critique.score >= 4` inherit the accessibility gate
without being rewritten.

## Silence when it cannot measure

If the target artifact is missing, the analyzer throws, or the audit times
out, the atom emits **no signals at all** and records a `reason`.

This is load-bearing. `evaluateTerm` in `apps/daemon/src/plugins/until.ts`
reads an undefined signal as `false`, so a pipeline gated on
`a11y.passing == true` stalls visibly and hits its iteration cap rather than
converging on an accessibility pass that was never performed. An atom that
reported `passing` when it had measured nothing would be worse than no atom
at all.

## Convergence

```jsonc
{
  "id": "verify",
  "atoms": ["live-artifact", "a11y-audit"],
  "repeat": true,
  "until": "a11y.passing == true || iterations >= 6"
}
```

To allow a known, accepted debt level instead of demanding zero:

```jsonc
{ "until": "a11y.violations <= 3 || iterations >= 6" }
```

## Anti-patterns

- Raising `failOn` to `['critical']` to make a run converge. The threshold
  describes the conformance target, not the current artifact's quality.
- Auditing a page the user never sees (a fragment, a partial) so the gate
  passes while the real artifact stays broken.
- Treating a skipped audit as a pass. See "Silence when it cannot measure".

## Status

Implemented by the daemon runner in
`apps/daemon/src/plugins/atoms/a11y-audit.ts`, with the Playwright + axe-core
analyzer in `a11y-audit-playwright.ts` and the registry adapter in
`a11y-audit-worker.ts`.
