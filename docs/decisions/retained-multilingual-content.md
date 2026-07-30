# Decision: retained multilingual content vs. removed foreign UI chrome

**Status:** Accepted
**Date:** 2026-07-28
**Context:** W2 (brand honesty), retraction of the earlier "A3 is done"
assessment (`docs/plans/waves/W2-brand-honesty.md`, "Retraction 2"). The
earlier de-brand pass slimmed the web app's own i18n dictionary
(`apps/web/src/i18n/locales/en.ts`) to English-only and treated that as proof
the whole repository was English-only. It was not: `clipper/i18n.js` still
shipped 20 non-English UI dictionaries (removed in this pass — see
`clipper/i18n.js`'s `LOCALES` array), and an orphaned
`settings.memoryEmptyHintZh` key survived in `en.ts` referencing nothing.

This document draws the line this wave actually applied: **foreign UI
chrome** (interface strings — buttons, labels, tooltips, status messages) is
removed; **deliberate multilingual content** (bundled third-party material
whose entire value is a specific language's design methodology or example
copy) is retained, unchanged.

## What was removed as foreign UI chrome

- `clipper/i18n.js`: the `id`, `de`, `zh-CN`, `zh-TW`, `pt-BR`, `es-ES`, `ru`,
  `fa`, `ar`, `ja`, `ko`, `pl`, `hu`, `fr`, `uk`, `tr`, `th`, `it`, `vi`, `nl`
  locale override dictionaries. This was UI interface text (button labels,
  status messages, tooltips) for the browser-extension clipper, duplicating
  in spirit what `AGENTS.md` already forbids for the main web app ("Open
  Design ships English-only... Do not reintroduce non-English locale
  dictionaries"). `LOCALES` is now `['en']`; the clipper's locale-resolution
  functions were simplified to match (there is nothing left to resolve to).
- `apps/web/src/i18n/locales/en.ts` / `types.ts`:
  `settings.memoryEmptyHintZh` (a Chinese-language string with zero
  consumers anywhere in `apps/web/src`) — an orphaned leftover of a feature
  whose English counterpart (`settings.memoryEmptyHintEn`) is what's
  actually used.

Both are UI chrome: text a user reads as part of operating the product,
never content a user asked the product to produce or reference.

## What is retained, and why

`plugins/_official/examples/huashu-*/` (nine example decks:
`huashu-annual-letter`, `huashu-bento-insight`, `huashu-golden-circle`,
`huashu-keynote-black`, `huashu-luxe-whitespace`, `huashu-pentagram-grid`,
`huashu-slides`, `huashu-sparkline-arc`, `huashu-takram-soft-tech`) and
`plugins/community/humanize-ppt/` carry genuine Chinese-language (CJK)
content — manifests, `SKILL.md` methodology references, QA scripts, and
example decks sourced from `alchaincyf/huashu-design` (see README
"References & lineage") and its associated deck-generation methodology.

This is retained **unchanged** because:

1. **It is content, not chrome.** A user who installs the `huashu-*` example
   plugins or the `humanize-ppt` skill is deliberately reaching for
   Chinese-design-methodology material — the Chinese text is the substance
   of what they asked for, not an interface label standing between them and
   the product.
2. **Deleting or translating it would be a different, larger, and unrelated
   change** — it would either destroy attributed third-party work bundled
   under its own license terms, or require a translation pass this wave
   does not have the design authority to perform (see `AGENTS.md` → "Design
   authority": the target's own content is the specification, and these
   examples are exactly that kind of target-owned material).
3. **The W2 gate enforces this distinction mechanically, not just by
   prose.** `scripts/waves/verify-w2.ts`'s C2-7 check enumerates every
   tracked file under the nine `huashu-*` roots plus `humanize-ppt/` at the
   wave's base commit and asserts each one is byte-identical at HEAD —
   sha256-equal, not just "still present." Any edit to this content,
   including a well-intentioned partial translation, is a hard fail.

## The line, restated

| | Foreign UI chrome | Deliberate multilingual content |
|---|---|---|
| Example | `clipper/i18n.js` locale overrides, `memoryEmptyHintZh` | `huashu-*` example decks, `humanize-ppt` |
| What it is | Interface text for operating the product | Content the product renders or a methodology it ships |
| This wave's action | Removed | Retained, byte-identical |
