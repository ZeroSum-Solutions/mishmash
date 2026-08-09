<h1 align="center">MishMash</h1>

<p align="center">
  Agent-native design studio — brief in, real HTML/CSS/PPTX/MP4 out, streamed
  by the coding agent already on your laptop.
</p>

<p align="center">
  <a href="#what-is-mishmash">What is MishMash</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#this-fork">This fork</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#skills-and-design-templates">Skills &amp; templates</a> ·
  <a href="#design-systems">Design systems</a> ·
  <a href="#plugins">Plugins</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat" /></a>
  <a href="QUICKSTART.md"><img alt="quickstart" src="https://img.shields.io/badge/quickstart-3%20commands-green?style=flat" /></a>
</p>

---

## What is MishMash

MishMash is a local-first, agent-native design studio: give it a brief, and a
coding agent already on your machine (Claude Code, Codex, Cursor, OpenCode,
and 20+ others) streams back a real, runnable artifact — a prototype, a live
dashboard, a deck, an image, a video — shaped by your team's own `DESIGN.md`
brand contract instead of a generic template.

Instead of pushing pixels on a canvas, it delivers single-page artifacts in
real CSS, real fonts, real components, exported straight to HTML / PDF / PPTX
/ MP4 — already shaped by your design system, already runnable inside the
agent you use every day.

🎨 **Local-first web app for macOS, Linux, and Windows (WSL2).** &nbsp;⚡
**Composable skills, brand-grade `DESIGN.md` design systems, and ready-to-use
plugins.** &nbsp;🖼️ Generates **web · dashboard · mobile prototypes**,
**decks**, **images**, **video**, plus **HyperFrames** motion graphics.
🔒 Sandboxed iframe preview · HTML / PDF / PPTX / MP4 export. &nbsp;🤖 **Runs
on Claude Code, Codex, Cursor, OpenCode, and 20+ other local CLI
executables**, or any OpenAI-compatible endpoint via BYOK.

## This fork

MishMash is a **hard-pinned, private fork** of an upstream open-source design
studio project, frozen at a specific upstream commit — the one-stop workbench
for the team that maintains it, not a public product. Full policy, the exact
upstream repository, the pin commit, and the cherry-pick lane for pulling
specific upstream fixes back in: **[`docs/FORK-PIN.md`](docs/FORK-PIN.md)**.
The maintenance cadence — what gets cherry-picked, what's a permanent
compatibility alias — is recorded in
[`docs/decisions/fork-cadence.md`](docs/decisions/fork-cadence.md).

Because this is an internal fork, this README does not carry upstream's
community links, hosted cloud service, or public contributor program — those
belong to the upstream project, not to this repository. Where a section below
still points at general design/engineering references, they apply here
unchanged; naming and identity do not.

## Quick start

```bash
git clone git@github.com:wiggdevin/mishmash.git
cd mishmash
corepack enable && pnpm install
pnpm tools-dev run web
```

Open the URL printed by `tools-dev`; development ports are allocated
dynamically unless you pass explicit port flags, e.g.
`pnpm tools-dev run web --daemon-port 17456 --web-port 17573`.

Node `~24`, pnpm `10.33.x`. WSL2 users, see [`docs/wsl-setup.md`](docs/wsl-setup.md);
native Windows users, see [`docs/windows-troubleshooting.md`](docs/windows-troubleshooting.md).
Full quickstart, env vars, Nix flake, and Docker deploy → [`QUICKSTART.md`](QUICKSTART.md),
[`deploy/README.md`](deploy/README.md).

### Install into your coding agent (no UI)

You can use MishMash without ever opening the GUI — call it as a skill,
plugin, or MCP server inside Claude Code, Codex, Cursor, Copilot, OpenClaw,
Antigravity, Hermes, Kimi, and more.

```bash
# One-line install into the agent you're using:
od mcp install <agent>
# <agent> = claude | codex | reasonix | cursor | copilot | openclaw
#         | antigravity | gemini | pi | vibe | hermes | cline | kimi
#         | trae | opencode
```

`od mcp install <agent> --print` for a dry-run preview · `--uninstall` to
remove · full list with `od mcp install --help`. If your shell resolves `od`
to Apple's built-in `/usr/bin/od` octal-dump utility, open **Settings → MCP
server** in the web app and copy the client-specific snippet instead; it uses
absolute paths and does not rely on the bare `od` command.

Then, inside the agent:

```
> Use mishmash to generate a landing page with the Linear design system
```

In a filesystem-backed local CLI run, the agent composes the selected
functional skill or design template with your `DESIGN.md`, writes the
canonical project files, and MishMash previews those files. A BYOK/plain-API
run without filesystem tools instead returns one complete `<artifact>` block.

### A full workflow — from brief to artifact

`brief → plugin → direction → design system → artifact → handoff → memory`

1. **A PM submits a brief.** The plugin picker offers landing page · pitch
   deck · dashboard · social post · PM spec · OKR scorecard…
2. **A designer (or the agent) locks the direction.** No brand? Pick from 5
   curated directions. Have a brand? Drop a screenshot / URL → the agent
   connects GitHub, imports Figma, and codifies a reusable `DESIGN.md`.
3. **The agent creates the first deliverable.** Plugin + functional skill or
   design template + `DESIGN.md` are bound. Filesystem-backed CLI runs write
   canonical project files and the preview follows them; BYOK/plain-API runs
   without file tools return one complete `<artifact>` block.
4. **Hand off to engineering.** The artifact is real HTML/CSS — drop it into
   Cursor, Codex, or Claude Code to keep building as code. Or export PPTX /
   PDF / MP4 straight to marketing.
5. **MishMash gets smarter as you use it.** Your screenshots, fonts, palettes,
   and confirmed artifacts accumulate as defaults for the next session. Less
   rework, less drift.

## Use MishMash from your coding agent

MishMash ships a **stdio MCP server** and per-agent **install scripts**. Any
MCP-compatible agent in another repo can read files from your local MishMash
projects directly — tokens CSS, JSX components, entry HTML — as a structured
API queryable by name. The agent always sees the live file, not a stale
export.

```bash
# One-line install:
od mcp install <agent>

# Then the agent can:
od project list --json
od files list <project-id> --json
od files read <project-id> <relative-path>
od plugin list --json
od skills list --json
```

**Security model.** Read-only by default, the daemon binds to `127.0.0.1`,
and SSRF is blocked at the proxy edge. LAN exposure requires an explicit
`OD_BIND_HOST` plus `OD_ALLOWED_ORIGINS`. Connector credentials and
live-artifact preview routes stay loopback-only regardless. To prevent SSRF,
the daemon also blocks provider base URLs that resolve to private/internal
address ranges by default; opt an internally-hosted gateway out with
`OD_ALLOWED_INTERNAL_HOSTS=<host1>,<host2>,...` (see
[`docs/architecture.md`](docs/architecture.md) for the full allowlist rules).

## Skills and design templates

**Functional skills ship in [`skills/`](skills/)**. Each follows the Agent
Skills [`SKILL.md`][skill] convention and supplies reusable agent behavior,
references, or utilities. Renderable starters live separately in
[`design-templates/`](design-templates/); they may also use `SKILL.md`, but
they populate the design-template catalog rather than the functional-skill
registry.

Two **modes** anchor the design-template catalog: `prototype` (web/mobile/desktop
single-page artifacts) and `deck` (horizontal-swipe presentations). Other
templates cover `image`, `video`, `audio`, and utility surfaces. The
**`scenario`** field groups templates by audience: `design` · `marketing` ·
`operation` · `engineering` · `product` · `finance` · `hr` · `sale` ·
`personal`.

| Design template | Mode | Scenario | What it produces |
|---|---|---|---|
| [`web-prototype`](design-templates/web-prototype/) | prototype | design | Default landing page / hero |
| [`saas-landing`](design-templates/saas-landing/) | prototype | marketing | Hero / features / pricing / CTA |
| [`mobile-app`](design-templates/mobile-app/) | prototype | design | iPhone 15 Pro / Pixel framed app |
| [`mobile-onboarding`](design-templates/mobile-onboarding/) | prototype | design | Splash · value-prop · sign-in flow |
| [`email-marketing`](design-templates/email-marketing/) | prototype | marketing | Table-fallback-safe brand email |
| [`magazine-poster`](design-templates/magazine-poster/) | prototype | marketing | Single-page magazine layout |
| [`motion-frames`](design-templates/motion-frames/) | prototype | marketing | Looping CSS motion hero |
| [`sprite-animation`](design-templates/sprite-animation/) | prototype | marketing | 8-bit pixel animated explainer |
| [`pm-spec`](design-templates/pm-spec/) | prototype | product | PM spec doc (with TOC + decision log) |
| [`team-okrs`](design-templates/team-okrs/) | prototype | product | OKR scorecard |
| [`eng-runbook`](design-templates/eng-runbook/) | prototype | engineering | Incident runbook |
| [`hr-onboarding`](design-templates/hr-onboarding/) | prototype | hr | Role onboarding plan |
| [`guizang-ppt`](design-templates/guizang-ppt/) | deck | marketing | Magazine-style web PPT (deck default) |
| [`html-ppt-*`](design-templates/) | deck | marketing | Deck template family, multiple themes (master template in [`design-templates/html-ppt/`](design-templates/html-ppt/)) |
| [`hyperframes`](design-templates/hyperframes/) | video | marketing | HTML → MP4 motion graphics (HeyGen OSS framework) |
| [`critique`](design-templates/critique/) | utility | design | Five-dimensional self-critique scoresheet |
| [`tweaks`](design-templates/tweaks/) | utility | design | AI-emitted tweaks-panel manifest |

Full protocol and directory split → [`docs/skills-protocol.md`](docs/skills-protocol.md).
Registry endpoints: `GET /api/skills` for functional skills and
`GET /api/design-templates` for rendering templates.

## Design Systems

**Brand-grade design-system packages centered on `DESIGN.md`** ship with the
repo. Legacy packages may contain only that Markdown contract; newer packages
can also carry `manifest.json`, compiled `tokens.css`, component fixtures,
assets, and provenance evidence. [`design-systems/README.md`](design-systems/README.md)
records the package shape and provenance. Switch a system → the next render
uses the new tokens. Re-import the library via
[`scripts/sync-design-systems.ts`](scripts/sync-design-systems.ts). Add your
own brand → drop a `DESIGN.md` into `design-systems/<brand>/`.

## Plugins

**Official plugins plus remixable reference examples** live in
[`plugins/_official/`](plugins/_official/). Each entry is a portable plugin
directory anchored by `open-design.json` plus the payload required by its
type: for example `SKILL.md` for agent workflows, `template.json` for media
templates, or `DESIGN.md` for design-system entries.

| Category | Contents |
|---|---|
| [`scenarios/`](plugins/_official/scenarios/) | Complete design scenarios — [`od-default`](plugins/_official/scenarios/od-default/), [`od-design-refine`](plugins/_official/scenarios/od-design-refine/), [`od-figma-migration`](plugins/_official/scenarios/od-figma-migration/), [`od-code-migration`](plugins/_official/scenarios/od-code-migration/), [`od-react-export`](plugins/_official/scenarios/od-react-export/), [`od-nextjs-export`](plugins/_official/scenarios/od-nextjs-export/), [`od-vue-export`](plugins/_official/scenarios/od-vue-export/), [`od-media-generation`](plugins/_official/scenarios/od-media-generation/), [`od-new-generation`](plugins/_official/scenarios/od-new-generation/), [`od-tune-collab`](plugins/_official/scenarios/od-tune-collab/), [`od-plugin-authoring`](plugins/_official/scenarios/od-plugin-authoring/), [`od-share-to-community`](plugins/_official/scenarios/od-share-to-community/), [`od-web-effect-extractor`](plugins/_official/scenarios/od-web-effect-extractor/) |
| [`image-templates/`](plugins/_official/image-templates/) | One-shot image prompts — editorial, cinematic, product, portrait |
| [`video-templates/`](plugins/_official/video-templates/) | HyperFrames / Seedance / Veo motion templates |
| [`design-systems/`](plugins/_official/design-systems/) | Brand `DESIGN.md` wrapped as plugins |
| [`atoms/`](plugins/_official/atoms/) | Reusable UI fragments (buttons, heroes, KPI cards) |
| [`examples/`](plugins/_official/examples/) | Remixable reference outputs |

Also [`plugins/community/`](plugins/community/) for community-sourced plugins
and [`plugins/registry/`](plugins/registry/) for the publishing flow.

**In the web app:** open the **Plugin** page to browse the catalog and click
**Install**; inside a project's Studio, plugins appear as composer chips you
click to apply (with the inputs they declare).

**On the command line** (runs without a UI — this is the path external
agents use):

```bash
od plugin list                       # list installed plugins (--task-kind / --mode / --tag filters)
od plugin search "landing page"      # search by keyword
od plugin info od-default            # inspect a plugin's metadata, inputs, capabilities
od plugin install od-figma-migration # install from a registry; also accepts ./local-folder or an https://… link
od plugin apply od-default --input brief="a one-page pitch for our seed round"
od plugin upgrade od-default         # upgrade
od plugin uninstall od-default       # uninstall
```

Every command supports `--json`, so you can pipe it through `jq` / `xargs`
into automation. Full field set and runtime contract →
[`plugins/spec/SPEC.md`](plugins/spec/SPEC.md); developing a plugin with a
coding agent → [`plugins/spec/AGENT-DEVELOPMENT.md`](plugins/spec/AGENT-DEVELOPMENT.md);
copy-paste minimal templates → [`plugins/spec/examples/`](plugins/spec/examples/).

## Architecture

```
┌────────────────── browser (Next.js 16) ────────────────────────────────┐
│  chat · file workspace · iframe preview · settings · import · MCP     │
└──────────────┬─────────────────────────────────────┬─────────────────┘
               │ /api/*                              │
               ▼                                     ▼
   ┌─────────────────────────────────┐   /api/proxy/{provider}/stream (SSE)
   │  local daemon (Express+SQLite)  │   ─→ any OpenAI-compatible BYOK,
   │                                  │       SSRF-guarded at the edge
   │  /api/skills    /api/design-templates    /api/plugins    │
   │  /api/design-systems            │
   │  /api/chat (SSE)   /api/proxy/* │
   │  /api/projects/:id/files/...    │
   │  /api/artifacts/{save,lint}     │
   │  /api/import/claude-design      │
   │  MCP stdio server                │
   └─────────┬───────────────────────┘
             │ spawn(cli, [...], { cwd: managed project cwd })
             ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  Local runtime definitions come from runtimes/registry.ts;                 │
   │  composes a functional skill or design template + DESIGN.md; writes files │
   └──────────────────────────────────────────────────────────────────┘
```

| Layer | Stack |
|---|---|
| Frontend | Next.js 16 App Router + React 18 + TypeScript |
| Daemon | Node 24 · Express · SSE streaming · `better-sqlite3` |
| Storage | Before changing or documenting daemon storage paths, you MUST read `AGENTS.md` → **Daemon data directory contract**. This README MUST NOT restate it. |
| Preview | Filesystem runs render canonical project files; BYOK/plain-API runs parse one complete `<artifact>` block into a sandboxed `srcdoc` iframe |
| Export | HTML (inlined) · PDF (browser print) · PPTX (agent-driven) · ZIP · Markdown · MP4 (HyperFrames) |
| Lifecycle | One entry point: `pnpm tools-dev` (start / stop / run / status / logs / inspect / check) |

Full architecture → [`docs/architecture.md`](docs/architecture.md). Skill
protocol → [`docs/skills-protocol.md`](docs/skills-protocol.md). Agent adapter
contract → [`docs/agent-adapters.md`](docs/agent-adapters.md).

## Internal development

`CONTRIBUTING.md` covers PR scope, title format, dependency policy, and
commit conventions; [`docs/code-review-guidelines.md`](docs/code-review-guidelines.md)
is the reviewer-facing complement. Read `AGENTS.md` first when working in
this repository — it is the single source of truth for directory layout,
workflow, and the design-authority rules that govern this codebase.

```bash
# Boot locally
git clone git@github.com:wiggdevin/mishmash.git
cd mishmash && corepack enable && pnpm install
pnpm tools-dev run web

# Make the change, run the checks
pnpm guard && pnpm typecheck
pnpm --filter @open-design/<package> test

# Open the PR
gh pr create --fill
```

## References & lineage

| Project | Role |
|---|---|
| Upstream project | This fork's upstream is an open-source, agent-native alternative to Claude Design. Exact repository and pin commit: [`docs/FORK-PIN.md`](docs/FORK-PIN.md). |
| Claude Design | The closed-source product the upstream project is the open-source alternative to. |
| [`alchaincyf/huashu-design`](https://github.com/alchaincyf/huashu-design) | The design-philosophy compass — junior-designer workflow, brand-asset protocol, anti-AI-slop checklist, five-dimensional critique. |
| [`op7418/guizang-ppt-skill`](https://github.com/op7418/guizang-ppt-skill) | The magazine-style web PPT skill, bundled verbatim under [`design-templates/guizang-ppt/`](design-templates/guizang-ppt/). Default for deck mode. |
| [`lewislulu/html-ppt-skill`](https://github.com/lewislulu/html-ppt-skill) | The HTML PPT Studio family — deck templates, themes, page layouts, animation runtime, magnetic-card presenter mode. |
| [`OpenCoworkAI/open-codesign`](https://github.com/OpenCoworkAI/open-codesign) | An early open-source Claude Design alternative; UX patterns the upstream project borrows (streaming-artifact loop, sandboxed iframe, live agent panel). |
| [`multica-ai/multica`](https://github.com/multica-ai/multica) | The daemon + adapter architecture — PATH-scan agent detection, local daemon as the only privileged process. |
| [`VoltAgent/awesome-design-md`](https://github.com/VoltAgent/awesome-design-md) | Historical source of the original 9-section `DESIGN.md` schema and upstream-derived systems; current packages may extend that baseline. |
| [`bergside/awesome-design-skills`](https://github.com/bergside/awesome-design-skills) | Source of design skills added under `design-systems/`. |
| [`heygen-com/hyperframes`](https://github.com/heygen-com/hyperframes) | The HTML→MP4 motion-graphics framework, integrated as the first-class `hyperframes-html` template. |
| [Claude Code skills][skill] | The `SKILL.md` convention adopted verbatim. |

Detailed provenance → [`docs/references.md`](docs/references.md).

[skill]: https://docs.anthropic.com/en/docs/claude-code/skills

## License

Apache-2.0. Bundled skills and templates with their own `LICENSE` files
retain those licenses, including `design-templates/guizang-ppt/` (MIT,
[@op7418](https://github.com/op7418)), `design-templates/html-ppt/` (MIT,
[@lewislulu](https://github.com/lewislulu)), and `skills/web-clone/` (MIT,
[@Jane-xiaoer](https://github.com/Jane-xiaoer)).
