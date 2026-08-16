# Canvas / Workbench end-to-end hardening

**Status:** APPROVED for autonomous execution (`/goal`), 2026-08-15
**Slug:** `mishmash-canvas-hardening`
**Baseline commit:** `a8dd0663e` (main, up to date with origin)
**Author:** authored from the operator's 2026-08-15 directive; the operator explicitly
delegated authoring of this contract ("If you need to fill anything out, please do so").

---

## Why

The Canvas/Workbench is the surface where MishMash's value actually lands: a user opens a
project, sees the artifact render, clicks something, edits it, uploads to it, and pulls from
the catalog. Everything else in the product is upstream plumbing for that moment.

That surface has grown to ~32k lines across three components and 81 distinct user-facing
capabilities, 28 of which have **no test at all**. The most recent commit on `main`
(`a8dd0663e`, "optimize responsive mobile experience") shipped with a **failing test**. The
product cannot be "the best system for rapidly creating premium websites" while a third of
its primary surface is unverified and `main` is red.

This run verifies every catalogued capability with a mechanical proof, fixes what is broken,
and durably logs what cannot be fixed.

## What the Canvas actually is (verified at `a8dd0663e`)

Not one component — a three-layer composition behind a single physical Next.js route.

| Layer | File | Lines | Role |
|---|---|---|---|
| Route | `apps/web/app/[[...slug]]/page.tsx` | — | Only App-Router page; optional catch-all, static-exported shell served by the daemon's SPA fallback for every deep link |
| 1 | `apps/web/src/components/ProjectView.tsx` | 10,094 | Per-project shell: resizable ChatPane ⇄ FileWorkspace split, focus mode, manual-edit divider |
| 2 | `apps/web/src/components/FileWorkspace.tsx` | 7,812 | Tabbed canvas shell: Design System tab, Canvas tab, Pages dropdown, dynamic file/terminal/side-chat/browser/live-artifact tabs |
| 3 | `apps/web/src/components/FileViewer.tsx` | 14,639 | Per-file renderer; `HtmlViewer` (line 5967) is the live preview canvas — zoom, viewport, deck, comment/inspect/edit/draw, version history, export, deploy |
| bridge | `apps/web/src/components/file-viewer-render-mode.ts` | 308 | Pure decision fn: URL-load vs srcDoc. Interactive bridges **only** work through srcDoc |
| overlay | `apps/web/src/components/PreviewDrawOverlay.tsx` | 2,158 | Canvas annotation layer composited over any preview |

There is no server route per project. "Opening the canvas" is client-side navigation inside
one static shell.

## Scope

**In scope:** the 81 capabilities catalogued in Appendix A, spanning `canvas-surface` (31),
`catalog` (22), `upload-attach` (14), `editing` (10), `runtime-wiring` (4).

**Out of scope** (explicitly, to prevent scope creep under §4 of the `/goal` skill):
- Visual redesign of the canvas. The repo's `AGENTS.md` "Design authority" section disclaims
  operator design doctrine here; this repo has no house aesthetic to impose.
- New capabilities not already present. This is a hardening run, not a feature run.
- Expanding visual motion authoring beyond the existing global `--motion` multiplier —
  forbidden by the GSAP licence analysis in `docs/decisions/gsap-licensing.md`.
- Implementing missing `od` CLI surfaces. C6 **audits and logs** the dual-track gap; closing
  it is follow-up work with its own PRs.

## The bar (gauntlet)

Two halves, both required. A feature is not done until it clears both.

1. **Measurable half.** A named command, run, captured to
   `~/.claude/goal-state/mishmash-canvas-hardening/proof/<criterion>.txt`, exiting 0. No
   feature may end this run with proof `none`.
2. **Taste half.** A separate harsh critic with fresh context — never the agent that wrote
   the code — is given the feature's test plus its implementation and asked one binary
   question: *can you name a way a real user breaks this that the test does not catch?* If it
   names one, the piece goes back to the builder. The loop exits when the critic cannot.

Praise is not useful. A critic that returns "looks good" without having attempted a concrete
break is a failed critic and its verdict is discarded.

## Success criteria

| id | criterion | verification command | authority |
|---|---|---|---|
| C1 | Static + unit baseline green on the branch | `pnpm guard && pnpm typecheck` | exit 0 |
| C2 | apps/web unit suite green (currently **1 failed / 483 passed**) | `pnpm --filter @open-design/web test` | exit 0 |
| C3 | daemon unit suite green | `pnpm --filter @open-design/daemon test` | exit 0 |
| C4 | Every one of the 81 catalogued features has a named passing proof; zero features remain `none` | `scripts/canvas-coverage-report.ts` emits `UNCOVERED 0` | exit 0 |
| C5 | The 28 currently-untested features (Appendix B) each gain a test that runs and passes | same coverage report, per-id | exit 0 |
| C6 | Playwright critical path green | `pnpm --filter @open-design/e2e test:ui:critical` | exit 0 |
| C7 | Every defect found is fixed with a red-spec-first test, or logged with repro + severity + reason-not-fixed | `docs/KNOWN-ISSUES-CANVAS.md` exists and every open row has all four fields | exit 0 |
| C8 | Dual-track UI/CLI gap audited and recorded (audit only — see Scope) | `docs/canvas-cli-parity.md` covers all 81 ids | exit 0 |
| C9 | Canvas documentation reflects verified reality | `docs/canvas-workbench.md` written; every claim in it traces to a passing proof | exit 0 |
| C10 | Independent adversarial audit run per workstream, with disposition recorded | `run.log.md` contains a Grok 4.5 verdict + disposition per workstream | exit 0 |

`main` is **not** the target branch. All work lands on `feat/canvas-workbench-hardening` and
merges by PR per `CONTRIBUTING.md`.

## Known-red at baseline

| what | evidence |
|---|---|
| `tests/styles/home-hero-compact-controls.test.ts` — switcher chip height `44px`, expected `32px` | Introduced by `a8dd0663e` (#128), which added 61 lines to `apps/web/src/styles/home/home-hero.css`. `main`'s HEAD ships red. |

Both `pnpm guard` (104/104) and `pnpm typecheck` pass clean at baseline — so defects in this
run are behavioral, not static.

## Method

Per feature group, run the gauntlet: a builder agent writes the proof, a separate critic
agent with fresh context attacks it, loop until the critic cannot break it. Then the
deterministic command runs and its output is captured to disk. Proof artifacts, not
narrative, are the record.

Bug fixes follow the repo's own **red-spec-first** rule (`AGENTS.md` § Bug follow-up
workflow): encode the defect as a falsifiable test that goes red before any source change.

### Model routing

Routing follows the operator's global model-lane rules, which **override** the `/goal`
skill's default table (that table's `gpt-5.6-terra` default contradicts the standing
"Terra is not a default route" rule; `sol` is used instead). Deviation logged here
deliberately rather than applied silently.

| Work | Lane |
|---|---|
| Mechanical scans, coverage bookkeeping, id extraction | Haiku 4.5 |
| Routine test authoring, per-feature probes | Sonnet 5 |
| Hard debugging, fix authoring, synthesis | Opus 5 (`xhigh`) |
| Long-horizon autonomous fix loops on the gnarliest surfaces | Fable 5 |
| Bulk triage / classification at speed | `google/gemini-3.7-flash` (OpenRouter) |
| Adversarial second opinion on fixes | GPT-5.6 `sol` (`codex exec`, ChatGPT OAuth) |
| **Mandatory independent audit per workstream** | `x-ai/grok-4.5` (OpenRouter) |

All lanes are subscription-first or on the approved OK list in `~/.claude/billing-lanes.md`.
`api.anthropic.com` direct is not used.

---

## Appendix A — feature inventory (81)

Generated from the discovery pass; machine copy at
`~/.claude/goal-state/mishmash-canvas-hardening/artifacts/inventory.json`.


#### group: `canvas-surface`

| id | risk | feature | user action | expected result | proof | existing test |
|---|---|---|---|---|---|---|
| `deploy-vercel-cloudflare` | high | Deploy to Vercel or Cloudflare Pages | Open the Share menu, pick a provider, enter token/account settings, click deploy | Opens a deploy modal per provider (Vercel default; Cloudflare Pages with account id + zone selection), deploys to preview or production, tracks deploy result, allows re-deploy | e2e | `apps/web/tests/components/FileViewer.deploy-target.test.tsx` |
| `html-live-preview-canvas` | high | HTML/live prototype preview canvas (HtmlViewer) | Open an HTML/prototype file in the workspace | Iframe renders the artifact via direct URL load or srcDoc inline (chosen by file-viewer-render-mode.ts); auto-detects and works around focus-stealing, redirect loops, sandbox-storage needs,  | e2e | **none** |

#### group: `catalog`

| id | risk | feature | user action | expected result | proof | existing test |
|---|---|---|---|---|---|---|
| `connectors-catalog` | high | Connectors catalog (MCP tool integrations) — connect/disconnect | Open Connectors, type in search, click Connect on a card | Grid is masked/disabled until a Composio key is configured; search ranks by name/provider match; Connect opens an OAuth popup or system-browser flow and polls status until connected | e2e | `apps/web/tests/components/App.connectors.test.tsx` |

#### group: `editing`

| id | risk | feature | user action | expected result | proof | existing test |
|---|---|---|---|---|---|---|
| `comment-pods-mode` | high | Comment / Board mode — inspect + pod (lasso) element selection | Click the comment toolbar icon to enter board mode; hover/click an element (inspect) or lasso-drag across multiple elements to group them into a 'pod' | A live selection overlay highlights the hovered/selected DOM target or grouped pod (weighted opacity by area); a composer anchored to the selection lets the note send immediately as a chat a | e2e | `apps/web/tests/lib/pod-members.test.ts` |
| `draw-mark-annotation` | high | Draw / Mark annotation overlay (box, pen, text) with screenshot capture and upload | Click the mark-pen toolbar icon; draw a box, freehand stroke, or drop a draggable text label over the live preview; undo/redo; Send/Queue/Add-to-input | PreviewDrawOverlay renders a canvas layer over the preview, normalizing marks to frame coordinates (0..1) so they track zoom/viewport; on submit, a client-composited screenshot uploads throu | e2e | `apps/web/tests/components/PreviewDrawOverlay.test.tsx` |
| `manual-edit-mode-core` | high | Manual Edit Mode — click-to-select element, inline text edit | Toggle the Edit tool in the artifact toolbar; click any tagged element in the preview; type directly (contenteditable) for text/link elements | Element discovery/click-to-select/inline-text-edit runs via an injected iframe bridge; typed text commits on blur/Enter, is applied to the HTML source string, persisted to the server as a ne | e2e | `e2e/ui/app-manual-edit.test.ts` |
| `manual-edit-undo-redo` | high | Manual Edit Mode — undo/redo across saves | Trigger undo/redo from the edit panel or keyboard while in Manual Edit mode | Each undo/redo re-persists the before/after source as a new server-tracked version (not an ephemeral in-memory stack) and the preview reflects the reverted/reapplied state; a stale local his | e2e | `apps/web/tests/components/FileViewer.manual-edit-history.test.tsx` |
| `storyboard-shot-crud-render-takes` | high | Storyboard — shot CRUD, frame generation, video render, take review | Add/duplicate/delete/reorder shots; generate or iterate a start/end frame; upload an image; render a shot to video; compare multiple 'takes' and appro | Each mutation applies optimistically then PATCHes /api/storyboards/:id with a single 409-conflict retry; renders poll a long-running media task; the selected take marks the shot 'done' for a | e2e | `apps/web/tests/components/storyboard-persist.test.ts` |

#### group: `runtime-wiring`

| id | risk | feature | user action | expected result | proof | existing test |
|---|---|---|---|---|---|---|
| `manual-edit-source-patch-engine` | high | Manual edit source-patch engine (applyManualEditPatch) | N/A — invoked by every Manual Edit Mode action (text/link/image/outer-html/delete/page-style edits) | A pure HTML-string patcher handles set-text/set-link/set-image/set-style/set-attributes/set-outer-html/remove-element/set-token against the raw source, independent of any DOM/iframe; every m | unit | `apps/web/tests/edit-mode/source-patches.test.ts` |
| `url-vs-srcdoc-render-mode-decision` | high | URL-load vs srcDoc iframe render-mode decision engine | N/A — automatic per file based on which bridges are active (comment/inspect/edit/palette/tweaks/deck/draw) | shouldUrlLoadHtmlPreview() forces srcDoc whenever any interactive bridge, root-relative project asset refs, focus-stealing, or self-redirect patterns are detected; otherwise defaults to fast | unit | **none** |

#### group: `upload-attach`

| id | risk | feature | user action | expected result | proof | existing test |
|---|---|---|---|---|---|---|
| `figma-import-offline-decode` | high | Figma import — offline .fig file decode | '+' → Import from Figma → Upload .fig tab → drop or browse a .fig file exported from Figma, optionally add build notes | Decoded entirely on-device (no Figma account) via POST /api/projects/:id/figma/import; returns node/page/frame/component counts, colors, fonts, and a 'Build' action that seeds the chat promp | e2e | `apps/daemon/tests/figma-import.test.ts` |
| `od-library-clipper-ingest` | high | OD Library clipper ingest (browser extension) | Via the paired OD 'clipper' Chrome extension, browse any live webpage and capture an element/screenshot/HTML | POSTs to /api/library/ingest with sourceKind='clipper', authenticated by a pairing token (allowlisted origin), capped at 5,000,000 total bytes/request regardless of the manual-upload MIME po | e2e | `apps/daemon/tests/library-ingest-ssrf.test.ts` |

#### group: `canvas-surface`

| id | risk | feature | user action | expected result | proof | existing test |
|---|---|---|---|---|---|---|
| `chat-workspace-split-resize` | medium | Chat/Workspace resizable split | Drag the vertical divider between chat and the file workspace, or Tab-focus it and use arrow keys | Chat panel width adjusts live, clamped between a computed min/max relative to split width; final width persists to localStorage and survives reload | e2e | `e2e/ui/split-resize-scrollbar-hitbox.test.ts` |
| `deck-slide-presentation-controls` | medium | Deck / slide presentation controls | Use Prev/Next slide buttons, keyboard arrows/PageUp/PageDown/Home/End/R, or click a slide thumbnail | Slide index advances/resets via a postMessage bridge to the deck runtime; a collapsible thumbnail rail shows all slides; counter displays 'current / total' | unit | `apps/web/tests/components/deck-thumbnail-rail.test.tsx` |
| `design-files-panel` | medium | Design Files panel — file tree/grid, upload, rename, delete, download project | Open the Design Files tab; drag-drop or click Upload; right-click or use row actions to rename/delete; click Download Project | Files render as a list/grid rooted at rootDirName; upload shows progress/error banner; delete supports single and multi-select; Download Project produces a zip archive | e2e | `e2e/ui/app-design-files.test.ts` |
| `design-system-project-panel` | medium | Design System project panel | Click the Design System tab (present when the project is a design-system project) | Shows generation progress, section review cards (colors, typography, spacing/radius, guidance, preview, UI kit, assets), 'needs work' feedback, and use/duplicate/delete actions | e2e | `apps/web/tests/components/FileWorkspace.design-system.test.tsx` |
| `embedded-browser-tab` | medium | Embedded in-app Browser tab | Click 'New Browser' from the tab launcher or Design Files panel | A DesignBrowserPanel tab opens with URL navigation, page snapshot toast, and the ability to attach the browsed page as a comment/board attachment | e2e | `apps/web/tests/components/DesignBrowserPanel.test.tsx` |
| `export-pdf-pptx-image` | medium | Export: PDF, PPTX (editable or screenshot), image (PNG/JPEG/WebP) | Open the Download menu and pick an export format | Triggers the corresponding export pipeline; PPTX offers 'editable' vs 'screenshot' modes and is disabled while streaming; image export offers a PNG/JPEG/WebP picker | e2e | `apps/web/tests/components/file-viewer-image-export.test.tsx` |
| `in-app-terminal-tab` | medium | In-app Terminal tab | Open 'New Terminal' from the tab launcher | A TerminalViewer tab opens bound to a persisted terminal session id; multiple terminals are numbered | unit | `apps/web/tests/components/TerminalViewer.test.tsx` |
| `live-artifact-viewer` | medium | Live Artifact viewer (connector-backed / data-bearing) | Open a Live Artifact tab | Tabs across Preview / Code / metadata / provenance / refresh history; supports manual refresh with event/status timeline and error surfacing | e2e | **none** |
| `manual-edit-split-divider` | medium | Manual-edit fixed left inspector layout | Enter Edit mode on an HTML preview | Split layout switches from a draggable resize handle to a fixed 'split-edit-divider'; the chat slot region hosts a comment-left-host or edit inspector instead of ChatPane | e2e | **none** |
| `page-creator-dialog` | medium | Page Creator dialog (new page from template/preset) | Click '+' in the Pages menu to open the Page Creator | Category-filtered gallery of blank/preset page templates (prototype, deck, wireframe, mobile, image, video, audio, live-artifact, document/markdown, hyperframes) with live thumbnail previews | e2e | **none** |
| `present-mode` | medium | Present mode (in-tab, fullscreen, new tab) | Click the Present (slideshow) icon, choose 'In this tab', 'Fullscreen', or 'Open in new tab' | Preview enters a chrome-less presentation state; fullscreen shows an Esc-to-exit hint; deck files get slide-navigation controls in presentation mode | e2e | **none** |
| `react-component-viewer` | medium | React component viewer | Open a .jsx/.tsx component file | ReactComponentViewer renders the compiled component in an isolated preview alongside module-pointer diagnostics | unit | `apps/web/tests/runtime/react-component.test.ts` |
| `share-link` | medium | Share link / share page | Open the Share menu and click 'Copy share link' or 'Open share page' | Copies or opens a public share URL for the deployed artifact; disabled with a guiding hint when nothing is deployed yet or the run is still streaming | e2e | **none** |
| `side-chat-tab` | medium | Side-chat tab | Open a side chat from the tab launcher | A secondary ChatPane-style conversation opens as its own workspace tab, independent of the main chat | unit | `apps/web/tests/components/workspace/SideChatTab.test.tsx` |
| `tabbed-workspace-tabs` | medium | Tabbed workspace — tab bar, Pages dropdown, dynamic tabs, drag reorder | Click a workspace tab, open the Pages dropdown, or open a file/terminal/side-chat/browser tab via the '+' launcher; drag a tab to reorder; wheel-scrol | One persistent tab per open file/terminal/side-chat/browser/live-artifact; tabs are draggable with a drop-edge indicator, horizontally wheel-scrollable, and closeable | e2e | `apps/web/tests/components/WorkspaceTabsBar.test.tsx` |
| `version-history` | medium | File version history — browse, preview, restore | Open version history from the toolbar/more-menu; scroll/search the list; click a version to preview; click Restore | Each version (ai/manual/restore-sourced) previews in an isolated iframe with its generating prompt shown; Restore reverts the live file to that content and records a new 'restore' version | e2e | `apps/web/tests/components/file-viewer-version-download.test.tsx` |

#### group: `catalog`

| id | risk | feature | user action | expected result | proof | existing test |
|---|---|---|---|---|---|---|
| `design-system-import` | medium | Import a design system (local upload / GitHub repo / shadcn registry) | Use the import controls in DesignSystemsSection or DesignSystemFlow to drop a local folder, paste a GitHub repo URL, or point at a shadcn registry | POST /api/design-systems/import/{local,github,shadcn} creates a new 'user:' draft under 'Mine'; GitHub import gated behind requireLocalOrigin; shadcn import enforces 100-file/256KB-per-file  | unit | `apps/web/tests/design-system-asset-dropzone.test.tsx` |
| `design-system-preview` | medium | Design system full preview (tokens/kit) | Click a catalog card to open the preview pane/modal | Right-hand pane (or modal) renders DESIGN.md-derived component kit, color/type/spacing tokens, and package file list | unit | `apps/web/tests/styles/design-system-modal-layer.test.ts` |
| `design-system-select-apply` | medium | Select/apply a design system (set default or switch project) | Click 'Make default' on a catalog row, or use the in-chat DesignSystemSwitchPicker for the active project | Project's or the global default designSystemId updates; no files are copied, only the id reference changes | unit | `apps/web/tests/styles/project-design-system-picker.test.ts` |
| `design-systems-catalog-browse` | medium | Design Systems catalog browse (Mine / Official / Enterprise) | Open Design Systems, switch scope tab, pick a category chip or surface pill, type in search | Grid/list narrows live; card count badges update; 'Enterprise' tab shows a fixed Coming Soon state | unit | `apps/web/tests/styles/design-system-review-density.test.ts` |
| `design-templates-gallery` | medium | Design Templates gallery (decks/prototypes/image/video/audio) | Open the Templates tab in EntryView/EntryShell and browse cards | Each of 353 template folders renders as a live example.html preview tile (deck templates are keyboard/wheel/touch navigable); clicking opens or seeds a new project from that template | e2e | `apps/web/tests/components/TemplatesSection.test.tsx` |
| `library-assets-registry` | medium | Library/Assets registry (personal multi-source asset catalog) | Open the Library tab, filter by kind in the left rail, scroll the day-grouped grid, click a card for full preview | Grid shows every asset that entered the system (clipper capture, upload, agent output, AI generation) with source+kind badges; live updates stream in over /api/library/events SSE; clicking o | unit | `apps/web/tests/components/LibrarySection.restructure.test.tsx` |
| `library-insert-picker` | medium | Insert-from-library picker (composer/design-files attach) | '+' → Select from library (in composer or Design Files); filter by kind, multi-select assets, confirm | Each picked asset copies into the active project's design files via POST /api/library/assets/:id/apply, staged as an attachment chip and recording a provenance back-link; element-pick captur | unit | `apps/web/tests/components/library-picker-perf.test.tsx` |
| `library-multiselect-bulk-delete` | medium | Multi-select and bulk-delete library assets | Checkbox-select, Cmd/Ctrl+click, Shift+click range, rubber-band drag, or Cmd/Ctrl+A across cards, then use the action bar or Delete key | Selected cards highlight; bulk delete removes them via deleteLibraryAsset and updates the grid | unit | `apps/web/tests/components/library/library-utils.test.ts` |
| `plugin-detail-modal` | medium | Plugin detail modal (per-type) | Click 'Details' on a plugin card | Modal renders type-specific content — design-system patch diff, static example, media preview, or scenario steps — plus tags, description, and primary actions | unit | `apps/web/tests/components/PluginDetailsModal.dispatch.test.tsx` |
| `plugin-marketplace-browse-install` | medium | Available Plugins / marketplace browse + install | Open Plugins manager, search/filter by source in the Available panel, click Install | filterAvailablePlugins narrows across all added marketplace manifests; Install POSTs /api/plugins/install and the card flips to a 'Use' state with a TrustBadge (restricted/trusted/official) | unit | `apps/web/tests/components/PluginsView.test.tsx` |
| `plugin-marketplace-sources` | medium | Plugin marketplace Sources management | Paste a marketplace.json URL, pick a trust level, Add; or Refresh/Remove/change trust on an existing source | Marketplace list updates; each row shows plugin count, catalog version, and trust badge; refresh re-fetches that manifest | manual-browser | **none** |
| `plugin-use-duplicate` | medium | Use / duplicate a plugin | Click 'Use' (or 'Use with query') / 'Duplicate' on a plugin card | Plugin becomes the active driver for the next agent run, seeding the composer with its rendered use-case query; duplicate spins up a copy of its example artifact | unit | `apps/web/tests/components/AssistantMessage.pluginInstall.test.tsx` |
| `plugins-home-discovery` | medium | Plugins Home discovery grid (installed + community) | On Home, click an artifact-kind chip (Prototype/Slides/Image/Video/HyperFrames/Audio), optionally a scene-bucket subcategory, search, or the Saved chi | usePluginFacets filters InstalledPluginRecord[] by category/subcategory/query; PluginCard renders a kind-aware hero preview (image/video poster, sandboxed HTML iframe, or design-system patch | unit | `apps/web/tests/components/plugins-home-facets.test.ts` |

#### group: `editing`

| id | risk | feature | user action | expected result | proof | existing test |
|---|---|---|---|---|---|---|
| `comment-side-panel` | medium | Comment side panel / side dock (list, thread, drag-reorder, board batch send) | Click the comment-count toolbar icon to open the side panel; drag comment cards to reorder; attach images to a batch and send | Docked or stacked (responsive) side panel lists all preview comments with reorder-by-drag, collapse/expand, image previews, and a 'send board batch' action that queues/sends attached comment | e2e | **none** |
| `inspect-panel` | medium | Inspect panel — quick live CSS tuning on one element | Toggle Inspect, click an element, drag color/font-size/weight/align/padding/radius controls | Style changes preview live in the iframe via a srcDoc bridge; 'Save to source' persists as an injected style block; 'Reset element' reverts to the pre-edit outerHTML snapshot | e2e | **none** |
| `manual-edit-delete-image-page-styles` | medium | Manual Edit — delete element / upload image / page-level styles | Click the trash icon on a selected element, upload a new image for an image element, or click empty canvas to open page-level background/font/size con | remove-element / set-image / body-level set-style patches apply and persist; deleting the last renderable body child is blocked with an error | unit | `apps/web/tests/edit-mode/source-patches.test.ts` |
| `manual-edit-inspector-panel` | medium | Manual Edit — style/content inspector panel | With an element selected in Edit mode, adjust typography/color/spacing/layout fields or link href/image src/alt in the right-docked panel, then Save | A set-style / set-text / set-link / set-image patch applies and persists; live preview streams style changes via postMessage before the explicit Save commits a version | e2e | `e2e/ui/app-manual-edit.test.ts` |
| `manual-edit-outer-html` | medium | Manual Edit — inline raw HTML editing for a container | Select a container element with nested markup; edit its outer HTML directly in the CONTENT textarea and Save | set-outer-html patch replaces the element's outerHTML (must remain exactly one root element) and persists as a version | unit | `apps/web/tests/edit-mode/source-patches.test.ts` |

#### group: `runtime-wiring`

| id | risk | feature | user action | expected result | proof | existing test |
|---|---|---|---|---|---|---|
| `api-attachment-context-injection` | medium | API-mode attachment context injection | N/A — automatic when a BYOK/API-mode run includes staged attachments | historyWithApiAttachmentContext() renders each attachment as a fenced code/text block (raw text for html/text/code/svg/sketch.json, section previews for pdf/document/presentation/spreadsheet | unit | `apps/web/tests/api-attachment-context.test.ts` |
| `tweaks-bridge` | medium | Tweaks bridge (class-based theme/motion toggle template) | Toggle the Tweaks palette on an artifact that ships the .tw-panel/.tw-hidden template | A srcDoc-injected bridge emits od:tweaks-available on mount and drives panel visibility; forces srcDoc render mode (never available on URL-load path); also carries the design-templates/tweak | unit | **none** |

#### group: `upload-attach`

| id | risk | feature | user action | expected result | proof | existing test |
|---|---|---|---|---|---|---|
| `composer-drag-drop` | medium | Drag-and-drop onto the composer/canvas | Drag one or more files from the OS Finder/Explorer and drop them anywhere on the chat composer shell | Same uploadFiles() path as the file picker; dropped files stage as attachment chips identically | e2e | **none** |
| `composer-file-picker` | medium | Chat composer file picker (native multi-select) | Click '+' → Attach files, or the paperclip; browser file dialog opens with no accept filter, multiple=true | Selected files upload via POST /api/projects/:id/upload (12/batch, 200MB/file cap, no MIME check), land flat in the project folder, and appear as staged ChatAttachment chips | e2e | `apps/web/tests/analytics/upload-tracking.test.ts` |
| `composer-paste-clipboard` | medium | Paste-from-clipboard (files and screenshots) | Cmd/Ctrl+V into the composer with an image or file on the clipboard | Synchronous clipboard files upload immediately; when the browser only exposes a screenshot via the async Clipboard API, it is read, named clipboard-screenshot-<timestamp>.<ext>, and uploaded | unit | `apps/web/tests/api-attachment-context.test.ts` |
| `design-system-asset-dropzone` | medium | Design-system creation: asset dropzone | During 'Create design system' flow, drag/drop/browse/paste logo, font, image, PDF, video, or slide-deck files | Files staged client-side (kind inferred from MIME then extension) with type-aware thumbnails/lightbox; uploaded through the generic project-upload path when the design system is created | unit | `apps/web/tests/design-system-asset-dropzone.test.tsx` |
| `folder-import-project` | medium | Import project from local folder | Choose 'Import folder' (native OS folder picker via the host bridge, or a web fallback) | Creates a new project whose metadata.baseDir points at the selected folder (files stay in place, not copied); import failures (cancel vs. real error) are distinguished | e2e | **none** |
| `kit-upload-logo-font-image` | medium | Design-system Kit: replace logo/font/image module | In an existing design system's Kit view, click an empty logo/font/image module and pick a replacement file | uploadProjectFile() PUTs the file into logos/ \| fonts/ \| imagery/, then rewrites brand.json to point at the server-returned stored path; a failed upload or brand.json write surfaces onErro | unit | **none** |
| `od-library-manual-upload` | medium | OD Library manual upload (global asset library, project-independent) | Open the Library panel → Upload → drag/drop, paste, or browse files | Strict MIME+extension allowlist (images, fonts, text, HTML, JSON/XML — audio/video explicitly rejected), ~3MB/file cap (base64-inflated JSON body limit); daemon re-validates the same policy  | unit | `packages/contracts/tests/library-upload-policy.test.ts` |
| `plugin-import` | medium | Plugin import (GitHub / zip / folder) | Open Import in Plugins manager, choose GitHub URL, upload a .zip, or pick a local folder | Plugin installs from the chosen source via /api/plugins/install, /api/plugins/upload-zip, or /api/plugins/upload-folder | e2e | **none** |

#### group: `canvas-surface`

| id | risk | feature | user action | expected result | proof | existing test |
|---|---|---|---|---|---|---|
| `critique-theater` | low | Critique Theater / Design Jury (read-only, non-editing) | Watch a live multi-panelist critique stream during a run; optionally click Interrupt | Read-only phase-driven UI (live -> shipped/degraded/interrupted/failed); Interrupt POSTs a kill request and optimistically flips to interrupted. Confirmed out of scope for edit-hardening — i | e2e | `e2e/ui/critique-theater.test.ts` |
| `device-viewport-switcher` | low | Device viewport switcher (Desktop / Tablet / Mobile) | Click the viewport icon/dropdown in the toolbar or the 'more' overflow menu | Preview frame resizes to fixed 820x1180 (tablet) or 390x844 (mobile) with auto-fit scaling within canvas padding, or fluid full-width (desktop); choice is cached per project+file | e2e | **none** |
| `json-text-viewer` | low | JSON / plain-text viewer | Open a .json or text file | Formats JSON preserving precision-sensitive numbers (avoids silent float rounding); plain text viewer shows line numbers and copy | unit | **none** |
| `markdown-viewer` | low | Markdown viewer (split/preview modes, code-block copy, image rewriting, inline edit/save) | Open a .md file; toggle split vs. preview; edit and save | Renders GFM with syntax-highlighted, copy-button-equipped code blocks; rewrites relative image sources against the project file root; tracks save state and scroll-ratio sync between edit/pre | unit | `apps/web/tests/components/file-viewer-markdown-copy.test.tsx` |
| `media-viewers` | low | Image / Video / Audio / SVG / Binary viewers | Open a file of that media type | Dedicated lightweight viewer per type (native img/video/audio, SVG source/preview toggle, generic binary fallback with metadata) | unit | **none** |
| `save-as-template` | low | Save as reusable Template | Use the template-save action to name and describe a project template | Persists the current artifact as a user template surfaced later in the New Project 'Template' tab | e2e | **none** |
| `screenshot-copy` | low | Screenshot copy | Click the screenshot icon while in preview mode | Captures the current preview frame and copies it to clipboard as an image | manual-browser | `apps/web/tests/components/file-viewer-screenshot-tooltip.test.tsx` |
| `sketch-editor-tab` | low | Sketch (Excalidraw) editor for .sketch.json files | Click 'New Sketch' in Design Files, or open an existing .sketch.json file; draw shapes/text/images/frames; Save or Export image | Lazy-loaded Excalidraw canvas with save/clear/export-image actions; dirty state tracked and autosaved; exported PNG saved as a sibling file; save-state indicator shows saving/dirty/saved | unit | `apps/web/tests/components/SketchEditor.default-color.test.tsx` |
| `social-share-flow` | low | Social share flow | Click 'Share to social' in the Share menu | Deploys (if needed) and produces a shareable social post/link | e2e | `apps/web/tests/components/PluginShareMenu.test.tsx` |
| `source-preview-toggle` | low | Source / Preview mode toggle | Click the code icon in the toolbar | Switches the pane between rendered iframe preview and raw source code view | e2e | **none** |
| `speaker-notes` | low | Speaker notes (view + inline edit) | Click into the speaker notes panel while on a deck; edit text; blur to save | Per-slide speaker notes editor with save-state feedback; placeholder shown when empty | unit | `apps/web/tests/runtime/speaker-notes.test.ts` |
| `workspace-focus-mode` | low | Workspace focus mode (hide chat) | Click the focus-expand chevron in the workspace tab bar | Chat pane is hidden (hidden={workspaceFocused}); FileWorkspace occupies full width; a chevron button restores split view | e2e | `e2e/ui/workspace-keyboard-flows.test.ts` |
| `zoom-control` | low | Zoom control (manual levels + desktop auto-fit) | Click the zoom percentage in the toolbar; pick 50/75/100/125/150/200% or leave it in auto mode | Preview scales via CSS transform; in 'auto' mode + desktop viewport, zoom auto-fits content width via desktopPreviewAutoFitZoomPercent(); manual selection pins zoomMode to 'manual' | unit | `desktopPreviewAutoFitZoomPercent / zoomPercentLabel are exported pure functions with no dedicated test file found — a gap` |

#### group: `catalog`

| id | risk | feature | user action | expected result | proof | existing test |
|---|---|---|---|---|---|---|
| `brand-reference-picker` | low | Brand Reference picker (start a brand extraction) | Open 'Start from a brand', browse quick-picks or the full categorized/searchable wall, click a brand tile | onPick fires with the brand's domain; host kicks off site extraction (or, in the Design System create flow, adds the domain as a source URL); no assets stored ahead of time, only the public  | unit | `apps/web/tests/components/BrandReferencePicker.test.tsx` |
| `browser-use-action-catalog` | low | Browser Use agent-action catalog | Inside the embedded Browser, open the action menu and search/pick an action (extract_colors, extract_svgs, screenshot_full, audit_accessibility, etc.) | filterBrowserUseCategories narrows ~35 actions across 7 categories; picking one sends the action's canned prompt to the agent bound to that browser tab | unit | **none** |
| `community-gallery` | low | Community gallery (installed community plugins, minimal preview) | Browse the Community section on Home (gallery card layout) | Same PluginsHomeSection component renders a top-bar-only tile per plugin (dot + name + fullscreen), using the plugin's baked example.html as the live preview | unit | `apps/web/tests/components/PluginsView.gallery-tab.test.tsx` |
| `connector-tool-preview` | low | Connector tool preview | Open a connector's detail view | Lazily fetches and lists up to 50 of that connector's available tools (CONNECTOR_TOOL_PREVIEW_LIMIT), with per-connector cached loading/failed states | unit | **none** |
| `design-system-publish-unpublish-delete` | low | Publish / unpublish / delete a design system draft | Use the row action menu on a 'Mine' entry | status flips draft<->published (or the entry is removed after a confirm dialog); busy spinner + toast reflect the async PATCH/DELETE | e2e | **none** |
| `reference-board` | low | Reference Board (curated external design-inspiration sites) | Open the in-app Browser's start page, pick a category chip or search, click a site card | filterReferenceGroups narrows the wall by category+query across label/host/detail; clicking navigates the embedded Browser to that URL and tracks a click event | unit | `apps/web/tests/components/DesignBrowserPanel.test.tsx` |
| `share-to-community` | low | Share project to community catalog (publish direction) | From a finished project, click 'Share to community' / run the od-share-to-community scenario | Agent packages the project into generated-plugin/, validates+packs+installs it locally, then the Design Files plugin-folder card exposes 'Add to My plugins', 'Publish repo', and 'MishMash PR | unit | `apps/web/tests/components/pluginFolderActions.test.ts` |
| `stock-media-gap` | low | Stock media — no native picker (documented gap, not a bug) | User looks for a built-in Unsplash/Pexels-style stock photo browser | None exists; the only paths are two static links (Unsplash, Pexels) inside the Reference Board that open the external site in the embedded Browser, or an agent 'asset-search' toolbox action  | manual-browser | **none** |

#### group: `upload-attach`

| id | risk | feature | user action | expected result | proof | existing test |
|---|---|---|---|---|---|---|
| `connector-mention-context` | low | Connector-sourced context (@-mention a connected service) | '+' → Connectors submenu, or type @<connector-name> in the composer, and pick a connected integration | No bytes transferred through the composer — insertConnectorMention() stages the connector in RunContextSelection.connectorIds and inserts an @-mention token; the agent accesses the connector | unit | **none** |
| `reference-project-link-code` | low | Reference project / Link local code (workspace context, not upload) | '+' → Reference project (pick another MishMash project) or Link local code (native folder picker) | PATCHes the project's metadata.linkedDirs so the agent gets --add-dir read access to that folder; nothing is copied into the current project or staged as a ChatAttachment | e2e | **none** |
| `skill-package-import` | low | Skill package import | Import a skill (zip/package) via the Skills settings surface | POST /api/skills/import ingests and installs a skill package into the local skills store | e2e | **none** |
| `storyboard-uploads` | low | Storyboard uploads | Upload media/assets within the Storyboard feature | POST /api/storyboards/:id/uploads handles storyboard-scoped uploads on a separate route module from the project-attachment pipeline | e2e | **none** |

## Appendix B — known open defects carried into this run

| # | severity | title | repro | files |
|---|---|---|---|---|
| B1 | high | Design Library reference reuse — licensing boundary left unresolved (MM-010) | Start a project from a restricted-tier Design Library reference via the canvas/workbench 'start from reference' flow. Verified live at repo HEAD 2941cfcc7: the reuse restrictions that used to ban verb | `apps/daemon/src/routes/design-library.ts:466`, `apps/daemon/src/prompts/system.ts:1635`, `packages/contracts/src/prompts/system.ts:759` |
| B2 | medium | Multi-file HTML Library assets lose siblings and render broken after project delete | Add a project's HTML file (with sibling CSS/JS/image files) to the Library as a 'referenced' asset, then delete the source project. Verified live: delete-time materialization only copies the entry fil | `apps/daemon/src/library.ts:525-533` |
| B3 | medium | Client-Website brand extraction ignores the real site's typography/radius CSS, synthesizes a generic scale instead | Start a 'Client Website' project by extracting a design system from a target URL. Verified live: apps/daemon/src/brands/css-facts.ts's analyzeCssFacts() computes real fontSizes/lineHeights/borderRadii | `apps/daemon/src/brands/css-facts.ts`, `apps/daemon/src/brands/engine/derive.ts:201`, `apps/daemon/src/brands/prefetch.ts:429` |
| B4 | medium | Brand extraction has no page-screenshot / vision input | Extract a design system from a URL that needs a logo or visual style judged by vision. Verified live: `screenshot` is hardcoded to `const screenshot: string \| null = null;` at apps/daemon/src/brands/ | `apps/daemon/src/brands/prefetch.ts:963` |
| B5 | low | library_embeddings table exists but is completely unused — no Library semantic/similar-asset search | Look for a 'similar assets' or semantic search feature in the Library/design-library surfaces. Verified live: the SQLite schema declares a full library_embeddings table (asset_id, model, dim, vector B | `apps/daemon/src/library-store.ts:100` |
