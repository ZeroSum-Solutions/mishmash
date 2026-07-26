# Decision: GSAP may remain first-party motion infrastructure

**Status:** Accepted
**Date:** 2026-07-25
**Resolves:** the `gsap-default-permission` `PENDING-DECISION` entry in `docs/design-authority.json`

## Context

This repository ships eight GSAP skills (`skills/gsap-*`), and all sixteen bundled
`webgl-*` example artifacts load GSAP, ScrollTrigger, SplitText and Flip from a CDN.
GSAP is already load-bearing.

An adversarial review flagged that GSAP is **not OSI open source** and asked whether it
is safe as core infrastructure for this product specifically. The concern is real and
non-obvious: GitHub reports the `greensock/GSAP` repository's license as `none` — there
is no SPDX license file — and GreenSock is now owned by Webflow. This repository's job
is generating websites, which is adjacent to Webflow's own business.

## What the license actually says

Source: <https://gsap.com/community/standard-license/> — "Standard 'No Charge' GSAP
License", effective 2025-04-30, last modified 2025-05-30, © Webflow.

- **Grant (§II).** Non-exclusive, worldwide license to use, reproduce, display and
  implement GSAP for "Permitted Uses" — explicitly including use "by any person or
  entity (which may include, for clarity, those of companies that compete with Webflow
  in other areas of business)".
- **Prohibited Uses (§I).** Use of GSAP "in tools that allow users to **build visual
  animations without code** that encourages, induces, or materially assists in creating
  a solution that competes with Webflow's visual animation building capabilities."
- **Competitive Products (§I).** Software that "enables users to create, edit, or manage
  animations **through a visual interface or builder** similar to Webflow".
- **FAQ, verbatim:** *"Is it acceptable for AI tools like ChatGPT, Cursor, Lovable,
  Webstudio, etc. to generate GSAP code? **Absolutely! AI-generated code is not a
  'Prohibited Use'.**"*
- Commercial use is free, including the formerly members-only plugins (SplitText,
  MorphSVG).

## Decision

**GSAP stays, CONDITIONALLY.** `gsap-default-permission` moves from `PENDING-DECISION`
to `CONDITIONAL` — not `RETAINED`.

Code generation is the well-covered case. MishMash spawns a coding-agent CLI that writes
GSAP **code** into artifacts, and that is the category the licensor blessed by name — the
list even includes Webstudio, a direct Webflow competitor. For that use, the position is
strong.

## Correction: the exposure is present-tense, not future

An earlier draft of this decision framed visual motion authoring as a *future* risk to
escalate on. **That was wrong, and an adversarial review caught it.**

`design-templates/tweaks/SKILL.md` already ships a **`--motion` control (Off / Subtle /
Lively)** that maps to a `--motion-mult` variable scaling every `transition-duration`
and `animation-duration` in a rendered artifact. That is a visual interface through
which a user edits animation timing. It exists today.

This is not a finding of infringement. `--motion` is a coarse three-position global
multiplier, not a timeline or keyframe editor, and whether it is "similar to Webflow's
visual animation building capabilities" is genuinely uncertain. But the claim that the
line is safely in the future is false, and the risk register must say so.

## Conditions

1. **Code generation is the sanctioned path.** Generating, previewing, and re-generating
   GSAP code is unaffected.
2. **Do not expand visual motion authoring.** No timeline or keyframe editor; no
   per-element easing/duration UI; no extending `tweaks` / `palette` / inspect-and-edit
   beyond the existing global `--motion` multiplier. Any expansion needs written consent
   from Webflow first.
3. **Pin exact GSAP versions.** §VI.2 preserves rights to versions released before an
   amendment, which is only worth anything if the version is pinned. Note the `gsap-*`
   skills currently recommend an unversioned `npm install gsap` — that gap should close.
4. **Re-read this decision** on any GSAP version bump or licence revision.

## Residual risks accepted

These are properties of the license, not defects to fix. They are accepted with a
mitigation, not dismissed:

1. **Not open source.** Proprietary and Webflow-owned (§IV). No SPDX identifier, no
   redistribution rights beyond the grant.
2. **Unilaterally amendable (§VI.2).** Webflow may revise the terms by posting them.
   *Mitigation:* §VI.2 preserves the right to keep using versions released before a
   revision under the terms in force at the time. **Pin GSAP versions** and treat a
   version bump as the moment to re-read this decision — that is what converts the
   amendment clause from an open-ended risk into a reviewable checkpoint.
3. **Revocable (§V).** Webflow may terminate for non-compliance at its discretion.
   *Mitigation:* the escalation line above is the compliance surface; keep it bright.
4. **Subordinate to Webflow's Terms of Service (§VI.1).**

## Consequences

- No change to existing GSAP usage, skills, or examples.
- `docs/design-authority.json` moves `gsap-default-permission` to `RETAINED`, and
  `scripts/check-context-isolation.test.ts` is updated to expect that.
- The operator-global "no GSAP-by-default" rule remains disclaimed here, and now has a
  reasoned basis rather than an assertion.
- Motion-stack work may treat GSAP as a sanctioned default.

## Not legal advice

This is an engineering decision recorded by reading the published license. It is not a
legal opinion. The escalation triggers above are the point at which the question stops
being an engineering call and should go to counsel.
