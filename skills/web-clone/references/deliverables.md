# Deliverable spec and templates

Standard deliverables for each clone sub-project (`current-project-dir/`).

## NOTES.md (required)

```markdown
# <site-name> · Clone Notes

## Source info
- Original site URL:
- Source repo: (if any)
- Original author:
- License: MIT / Apache / NONE / Proprietary  <- must be verified, see the license table in SKILL.md
- Attribution requirements:

## Tech stack
- Framework / key libraries / Node version:

## Pre-clone assessment
- Complexity level: L1 / L2 / L3 / L4 / L5 / L6 (see the web-clone skill's references/assessment.md)
- Recommended mode: faithful clone / visual clone / content overhaul / technical teardown
- Parts that can be high-fidelity:
- Parts that need approximation or substitution:
- Parts that will not be cloned:
- Main risks:

## How to run
\`\`\`bash
cd current-project-dir
# single-file static site: python3 -m http.server 8123
# framework site: nvm use <ver> && npm install && npm run dev
\`\`\`

## What changed (vs. the original)
- Removed tracking scripts: ... (GA/gtag line numbers)
- ...

## Original vs. clone
| Module | Original behavior | Clone implementation | Difference / tradeoff | Evidence |
|---|---|---|---|---|
| Hero |  |  |  | screenshot / file:line |
| Nav |  |  |  |  |
| Core motion |  |  |  |  |
| Content sections |  |  |  |  |
| Mobile |  |  |  |  |

## Clone score
- Source evidence: /5
- Structural fidelity: /5
- Visual fidelity: /5
- Motion/interaction: /5
- Responsive: /5
- Functional completeness: /5
- Content replacement: /5
- Legal/deployment risk: /5
- Overall:

## Replacement map (what to swap, where)
- Text -> file, line
- Images/media -> directory
- Colors -> CSS variables / theme
- 3D models / fonts -> ...

## Verification
- [ ] Runs locally, 0 console errors
- [ ] Screenshots compared against the original (RECON/screenshots/)
- [ ] `route-crawl.mjs` output for original/clone route maps (required for multi-page sites)
- [ ] `interaction-probe.mjs` output for hover/click/scroll/canvas state evidence (required for interactive sites)
- [ ] `visual-diff.mjs` screenshot diff report (when feasible)
- [ ] `audit-clone.mjs` leftover-audit report
- Anything that couldn't be verified (write it down honestly, don't fake it): ...
```

## TEARDOWN.md (add for complex interactive sites)

The technical teardown doc — **every conclusion must cite a real source line number**. Structure:
- **0. One-sentence essence**
- **A. Real technical teardown** (by pillar: rendering/compositing/physics/interaction/audio, each item tagged with a line number **+ evidence level `SOURCE`/`PARTIAL`/`GUESS`**, see `effect-extraction.md`)
- **B. Secondhand-analysis verification table** (if an AI analysis doc exists: `Claim | Real source | Accuracy ✅/⚠️/❌ | Notes`, focused on catching substantive errors)
- **C. Transferable methodology** (general patterns / site-specific quirks / clone path)

Example: `current-project-dir/marbles-clone/TEARDOWN.md`.

## RECON/ (recon deliverables)
- `screenshots/original-{1440,768,390}.png` original site, three sizes
- `screenshots/clone-1440.png` clone screenshot (for comparison)
- `screenshots/visual-diff-1440.png` screenshot diff image (when feasible)
- `global-recon.json` recon probe output (framework/canvas/scroll library/fonts/etc.)
- `routes/original-route-map.json` / `.md` original site's internal route map and per-route screenshots
- `routes-clone/clone-route-map.json` / `.md` clone site's internal route map and per-route screenshots
- `interactions/original-interactions.json` / `.md` original site's interaction state, network, console, screenshot evidence
- `interactions-clone/clone-interactions.json` / `.md` clone site's interaction state, network, console, screenshot evidence
- `asset-manifest.json` original site's asset manifest and download status (when feasible)
- `network/original-network.json` API/XHR capture manifest (required for SPA/SaaS)
- `network/fixtures/` saved JSON/text responses
- `sourcemaps/sourcemap-manifest.json` source-map search results (prioritize for complex frontends)
- `visual-diff-1440.json` pixel-diff metrics
- `design-dna.json` structured design identity (produced in visual-clone/content-overhaul mode, scaffolded by `dna-scaffold.mjs` and completed manually; schema in `design-dna.md`)
- `baseline/` the "minimal, as-is reproduction" deliverable plus evidence package from WebGL/effect reverse-engineering (see the baseline-first gate in `effect-extraction.md`)

## CLONE_REPORT.md (add when reporting externally or evaluating skill quality)

```markdown
# <site-name> · Original vs. Clone Assessment Report

## Conclusion
- Complexity level:
- Clone mode:
- Overall fidelity:
- Best used for: local learning / continued overhaul / deployable demo / technical teardown only

## Comparison
| Dimension | Original | Clone | Conclusion |
|---|---|---|---|
| Information architecture |  |  |  |
| Visual language |  |  |  |
| Motion/interaction |  |  |  |
| Responsive |  |  |  |
| Content replacement |  |  |  |
| Functional boundary |  |  |  |

## Score
Scored on the 8 dimensions in the web-clone skill's `references/assessment.md`.

## Known gaps
-

## Suggested next-step upgrades
-
```

## CLONE_AUDIT.md (add before shipping)

Generated by `scripts/audit-clone.mjs`. Key things to check:
- Whether tracking scripts / analytics pixels have been removed
- Whether the original site's brand name, leftover Japanese text, or TODOs remain
- Whether external URLs still point at the original site or uncontrolled third-party resources
- Whether asset and license risk has been documented

## Wrap-up
- Update the status-emoji index line in the hub `current-project-dir/README.md` (🟡 recon / 🟢 running / 🔵 in progress / ✅ shipped / 🔴 stuck / 🗂️ archived)
- Keep the original source as a read-only baseline `index-original.html` — don't edit it
- Kill the local server process once you're done
