# OD repo map — what goes where

Mirrors `nexu-io/open-design` `CONTRIBUTING.md` so the skill doesn't need to re-fetch it on every run. **If this drifts from upstream CONTRIBUTING.md, upstream wins** — re-read the live file when in doubt.

## Three high-leverage contribution surfaces (per OD's CONTRIBUTING.md)

| If you want to… | You're really adding | Where it lives | Ship size |
|---|---|---|---|
| Make OD render a new kind of artifact | a **Skill** | `skills/<your-skill>/` | one folder, ~2 files |
| Make OD speak a new brand's visual language | a **Design System** | `design-systems/<brand>/DESIGN.md` | one Markdown file |
| Hook up a new coding-agent CLI | an **Agent adapter** | `apps/daemon/src/agents.ts` | ~10 lines (code — out of scope for this skill) |
| Improve docs, fix typos | docs | `README.md`, `docs/`, `QUICKSTART.md` | one PR |

## Localization (removed)

OD ships English-only as of the English-only de-bloat pass: `docs/i18n/`, `TRANSLATIONS.md`, and every non-English locale dictionary/content bundle were deleted. There are no localized doc files left to track. `discover-i18n-gaps.sh` is now vestigial — do not route contributors toward translation work.

## Issue templates

- `bug-report.yml` — required fields: description, steps to reproduce, expected, version, platform.
- `feature-request.yml` — out of scope for this skill (feature requests should come from product, not auto-routed.)
- `preview-v0.8.0-feedback.yml` — branch-specific.

## Out-of-scope surfaces (don't touch from this skill)

- `apps/daemon/src/` — daemon code. Requires real review.
- `apps/web/src/` — web app code. Requires real review.
- `packages/`, `plugins/`, `tools/` — internal libs.
- `e2e/` — Playwright-driven; non-trivial to author.

If a user asks to contribute to those surfaces, suggest the original `auto-github-contributor` skill (TDD pipeline) instead.
