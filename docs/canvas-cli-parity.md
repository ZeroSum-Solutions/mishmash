# Canvas UI ↔ CLI parity audit

Audited at commit `96bd50cd8` on branch `feat/canvas-workbench-hardening`.

This audits every entry in `docs/canvas-feature-inventory.json` (81 capabilities)
against `AGENTS.md`'s "Capability exposure (UI/CLI dual-track)" rule:

> Every user-facing capability must be reachable through both the web UI **and**
> the `od` CLI (`apps/daemon/src/cli.ts`). Shipping a feature with only one of
> the two surfaces is a regression. ... Both surfaces must call the same
> `/api/*` endpoints.

The CLI matters because it is the embeddability contract — external agents
drive Open Design through `od` subcommands and never render the web UI, so a
UI-only capability cannot be composed into them.

## Summary

| Grade | Count |
|---|---|
| BOTH | 32 |
| UI-ONLY | 25 |
| N-A | 24 |
| **Total** | **81** |

BOTH means the same `/api/*` endpoint (or an equivalent end-state) is reachable
from both `od` and the web UI. UI-ONLY means a real, distinct server capability
exists that has no `od` subcommand reaching it. N-A means the capability is a
pure display/interaction affordance (viewport sizing, clipboard, a static
catalog, a pure client function) with no meaningful headless equivalent — the
same category the task brief names for a zoom control or a pane toggle.

## Table (all 81 features)

| id | group | grade | od command / endpoint | note |
|---|---|---|---|---|
| html-live-preview-canvas | canvas-surface | N-A | `od files read` (raw HTML), `od export --format image` (raster) | Interactive cross-origin-isolated iframe rendering is inherently a browser capability. The underlying artifact bytes and a rasterized screenshot are both CLI-reachable; the live rendering surface itself is not a "capability" in the dual-track sense, same category as zoom/viewport. |
| url-vs-srcdoc-render-mode-decision | runtime-wiring | N-A | — | Pure client decision function (`file-viewer-render-mode.ts`); user_action is `N/A` by its own inventory entry. Underlies html-live-preview-canvas. |
| deploy-vercel-cloudflare | canvas-surface | BOTH | `od deploy <projectId> --file <name> [--provider vercel-self\|cloudflare-pages] [--target preview\|production] [--cf-zone-id/--cf-zone-name/--cf-domain-prefix]` → `POST /api/projects/:id/deploy` | Verified cli.ts:12420-12501. Same endpoint and field shape as the FileViewer.tsx deploy modal (both providers, both targets). |
| comment-pods-mode | editing | UI-ONLY | none | Grepped cli.ts for "comment", "pod", "board" — no subcommand posts to a comments/board endpoint. Comments/board state has no `/api/*` route referenced anywhere in cli.ts. |
| draw-mark-annotation | editing | UI-ONLY | none | Screenshot capture + structured comment attachment goes through `apps/web/src/comments.ts` and the same upload path as the composer (`uploadProjectFiles` → `POST /api/projects/:id/upload`, see composer-file-picker below). Neither the comments pipeline nor that upload endpoint has a CLI verb. |
| manual-edit-mode-core | editing | UI-ONLY | `od files write` (coarser fallback) | Click-to-select + inline-commit patch operations (`edit-mode/source-patches.ts`) have no CLI verb. Only a full-file overwrite (`od files write`) exists, which is a materially different capability — the caller must reconstruct the entire HTML source itself rather than apply a scoped element patch. |
| manual-edit-undo-redo | editing | BOTH | `od files versions` / `od files version-restore <projectId> <relpath> <versionId>` | Indirect but real: the described behavior ("each undo/redo re-persists the before/after source as a new server-tracked version") is exactly what version-restore does generically. No dedicated undo/redo verb, but the underlying persistence model is fully reachable. Stale-local-history detection is client-only UX, not part of the server capability. |
| manual-edit-source-patch-engine | runtime-wiring | N-A | — | Pure internal function (`applyManualEditPatch`); user_action is `N/A` by its own inventory entry. Invoked by every manual-edit UI-ONLY row above but is not itself a distinct user action. |
| storyboard-shot-crud-render-takes | editing | UI-ONLY | `od storyboard render-shot\|review-take\|upload\|draft` cover part of this | `od storyboard` (cli.ts:9902) has list/create/get/style-reference/upload/render-shot/review-take/assemble/draft — render-shot, take review, manual frame upload-to-shot, and AI shot-drafting ARE covered. But shot add/duplicate/delete/reorder (`PATCH /api/storyboards/:id` with an edited `shots` array) has no dedicated verb, and AI frame generation (`POST /api/storyboards/:id/frames`) is not wired into the CLI at all — only manual image upload to a start/end slot is (`od storyboard upload --shot --slot`). Graded UI-ONLY because two of the five described actions (shot list CRUD, AI frame gen) are unreachable. |
| figma-import-offline-decode | upload-attach | BOTH | `od figma import --project <id> --file <path.fig> [--notes] [--subdir] [--page] [--list-pages] [--build]` → `POST /api/projects/:id/figma/import` | Verified cli.ts:6055-6130, matches `importProjectFigma()` in registry.ts exactly (same multipart endpoint). |
| od-library-clipper-ingest | upload-attach | N-A | `od library pair` (pairing only), `od library list`/`get` (read results) | Capture requires a live rendered browser DOM (element/screenshot/HTML capture from an arbitrary webpage). This is a third capture surface (a Chrome extension), not the MishMash web UI, so the UI/CLI dual-track rule doesn't map cleanly onto it. Pairing and reading captured results are CLI-reachable; the capture action itself is not and cannot be without a browser. |
| connectors-catalog | catalog | UI-ONLY | none | Grepped cli.ts for `auth-configs/prepare`, `connectors/status`, `connectors/discovery`, `'/api/connectors` — zero matches. `od tools connectors list/execute` hits a different endpoint (`/api/tools/connectors/list`, `/api/tools/connectors/execute`) for USING already-connected connectors at run time, not for browsing/searching the catalog or the OAuth connect/disconnect flow. |
| chat-workspace-split-resize | canvas-surface | N-A | — | Pure client layout state (drag width, persisted to localStorage). No server endpoint. |
| workspace-focus-mode | canvas-surface | N-A | — | Pure client layout toggle (`hidden={workspaceFocused}`). |
| manual-edit-split-divider | canvas-surface | N-A | — | Pure client layout state tied to Edit mode (fixed divider vs draggable). |
| tabbed-workspace-tabs | canvas-surface | N-A | — | Client-side tab-bar state (open/close/reorder/scroll). No server endpoint of its own. |
| design-files-panel | canvas-surface | UI-ONLY | `od files list\|upload\|delete`, `od project archive` (partial) | List (`od files list`), delete (`od files delete`), and "Download Project" (`od project archive`) are reachable. But: (1) rename has zero CLI path — `POST /api/projects/:id/files/rename` is called nowhere in cli.ts, and there's no lossless workaround (read+write-new+delete-old drops version history); (2) the panel's own upload button actually calls the batch `uploadProjectFiles()` → `POST /api/projects/:id/upload`, not the endpoint `od files upload` hits (`POST /api/projects/:id/files`) — the outcome is similar (a file lands in the project) but via a different, single-file-only route. Graded UI-ONLY primarily for the rename gap. |
| embedded-browser-tab | canvas-surface | N-A | — | An in-app browser pane is inherently a rendering/interaction surface. "Attach browsed page as comment" inherits comment-pods-mode's UI-ONLY gap rather than adding a new one. |
| in-app-terminal-tab | canvas-surface | UI-ONLY | `od shell` exists in source but is **not wired into `SUBCOMMAND_MAP`** | `runShell` (cli.ts:7380) POSTs to `POST /api/projects/:id/terminals` — the exact endpoint the comment at cli.ts:7376 says "both surfaces drive" — and even attaches an interactive PTY via SSE + `/stdin`/`/resize`. But it is absent from `SUBCOMMAND_MAP` (verified: cross-referencing every top-level `run*` function against the map's value list, and confirming `runShell(` has exactly one occurrence in the file — its own definition, never called). `od shell --project <id>` currently does nothing; it falls through to "unknown subcommand." See "Dual-track gaps" below — this is the cheapest fix in the whole audit. |
| side-chat-tab | canvas-surface | BOTH | `od chat new --project <id> [--seed-from <cid>] [--fork-after <mid>] [--title] [--mode]` → `POST /api/projects/:id/conversations` | Verified cli.ts:8153-8217. Same endpoint as the UI's side-chat creation. |
| sketch-editor-tab | canvas-surface | N-A | `od files read/write` (file-level only) | Interactive vector drawing has no CLI equivalent. The underlying `.sketch.json` is a plain project file, technically readable/writable, but hand-authoring valid Excalidraw scene JSON isn't a realistic substitute for the drawing capability itself. |
| design-system-project-panel | canvas-surface | UI-ONLY | none | Generation progress and section review are driven by `POST /api/design-systems/generation-jobs` and `GET .../generation-jobs/:jobId`. Grep for "generation-jobs" in cli.ts returns zero matches. |
| page-creator-dialog | canvas-surface | UI-ONLY | `od files write` (persistence only, no content source) | The preset catalog (prototype/deck/wireframe/mobile/image/video/audio/live-artifact/document/hyperframes) and its boilerplate content are compiled into the web client bundle (`contentForPagePreset` in FileWorkspace.tsx). No server endpoint exposes the presets, so a CLI-only caller has no way to obtain the preset content — only the final `od files write` persistence step is generic. |
| zoom-control | canvas-surface | N-A | — | Pure CSS-transform display control. Task brief's own worked example of N-A. |
| device-viewport-switcher | canvas-surface | N-A | — | Pure preview-frame sizing. Task brief's own worked example of N-A. |
| source-preview-toggle | canvas-surface | N-A | — | Pure display toggle between rendered iframe and raw source view. |
| screenshot-copy | canvas-surface | N-A | — | Clipboard/browser-only interaction (`verifiable_by: manual-browser`). |
| comment-side-panel | editing | UI-ONLY | none | Same comment/board pipeline as comment-pods-mode; no CLI verb. |
| inspect-panel | editing | UI-ONLY | `od files write` (coarser fallback) | Live CSS tuning + "Save to source" is client-computed like manual edit (injected style block via srcDoc bridge). No dedicated endpoint or verb; only whole-file overwrite exists. |
| manual-edit-inspector-panel | editing | UI-ONLY | `od files write` (coarser fallback) | Same source-patches.ts gap as manual-edit-mode-core (set-style/set-text/set-link/set-image patches). |
| manual-edit-outer-html | editing | UI-ONLY | `od files write` (coarser fallback) | `set-outer-html` patch is a pure, `verifiable_by: unit` function with no CLI verb. |
| manual-edit-delete-image-page-styles | editing | UI-ONLY | `od files write` (coarser fallback) | `remove-element`/`set-image`/body-level `set-style` patches — same gap. |
| tweaks-bridge | runtime-wiring | N-A | — | Automatic srcDoc bridge detection (`od:tweaks-available`); no user action of its own. The `--motion` multiplier it carries is a design-time authoring concern (design-templates content), not something this bridge exposes as a runtime toggle. |
| present-mode | canvas-surface | N-A | — | Pure UI chrome/fullscreen state. |
| deck-slide-presentation-controls | canvas-surface | N-A | — | postMessage-driven client navigation state (slide index, thumbnail rail). |
| speaker-notes | canvas-surface | BOTH | `od files read` / `od files write` | Notes are embedded as a `<script id="speaker-notes">` JSON block inside the deck's own HTML (`apps/web/src/runtime/speaker-notes.ts`) — readable/writable like any file. No dedicated speaker-notes verb; a CLI caller must replicate the embed format itself, which is a real but modest gap. |
| version-history | canvas-surface | BOTH | `od files versions\|version-read\|version-create\|version-restore <projectId> <relpath> [...]` | Verified cli.ts:7654-7747. Matches the given pre-verified finding. |
| export-pdf-pptx-image | canvas-surface | UI-ONLY | `od export <file> --project <id> --format pdf\|image\|pptx [--image-format png\|jpeg] [--deck\|--page\|--no-deck]` | PDF and image export are fully covered, and PPTX in its default "screenshot" mode is too. But `EXPORT_BOOLEAN_FLAGS` in cli.ts (line ~927) has no `editable` flag, and the request body builder never sets one — so the UI's fully-editable PPTX mode (`{deck:true, editable:true}`, distinct slides you can still edit in PowerPoint, not a screenshot) is unreachable from the CLI. Matches the given pre-verified finding; graded UI-ONLY because the editable mode is a real, distinct, UI-only capability, not a cosmetic difference. |
| share-link | canvas-surface | BOTH | `od deploy --json` → read `.url` from the response | `sharePageUrl` in FileViewer.tsx = `shareUrlForDeployment(latestShareDeployment)` = `deployment.url` (or a ready custom domain). `od deploy --json` returns the same deployment record. Caveat: there is no CLI verb for `GET /api/projects/:id/deployments` (grep for "deployments" in cli.ts returns nothing), so an agent can only get this URL by triggering a fresh deploy, not by reading already-deployed state. |
| social-share-flow | canvas-surface | BOTH | `od share url --url <https-url> [--title] [--text] [--copy-text] [--locale] [--platform]` → `POST /api/social-share` | Verified cli.ts:5951-6021. Matches the given pre-verified finding. |
| save-as-template | canvas-surface | BOTH | `od templates save <projectId> --name <name> [--description <text>]` | Verified cli.ts:7903+. Matches the given pre-verified finding. |
| react-component-viewer | canvas-surface | N-A | — | Passive compiled-component rendering + diagnostics; no edit/mutation described in the inventory entry. |
| live-artifact-viewer | canvas-surface | BOTH | `od tools live-artifacts <create\|list\|update\|refresh>` | Covers metadata and the "manual refresh" action described. |
| media-viewers | canvas-surface | N-A | — | Passive per-type viewers (img/video/audio/SVG/binary fallback); no edit action described. |
| markdown-viewer | canvas-surface | BOTH | `od files read` / `od files write` | Explicit inline edit/save is just a file write. GFM rendering, code-block copy buttons, and scroll-sync are display-only and not part of the graded capability. |
| json-text-viewer | canvas-surface | N-A | — | Purely a display/formatting feature (precision-safe JSON formatting, line numbers, copy). Unlike markdown-viewer, no edit/save action is described in the inventory entry. |
| critique-theater | canvas-surface | UI-ONLY | none (`od run cancel` hits a different endpoint) | Interrupt POSTs to `POST /api/projects/:id/critique/:runId/interrupt`; `od run cancel` hits `POST /api/runs/:id/cancel` instead — a different route. Grep for "critique" in cli.ts returns no route usage. The inventory entry itself flags this feature as explicitly out of scope for edit-hardening ("Confirmed out of scope ... included only so the exclusion is explicit"), which is reflected in the note rather than the grade. |
| design-systems-catalog-browse | catalog | BOTH | `od design-systems list` (+ client-side filtering) | `od design-systems` falls through to the generic list/show handler (`GET /api/design-systems`). Category/scope/search narrowing is straightforward client-side filtering over the same list payload. "Enterprise: Coming Soon" is a fixed UI-only placeholder state, not a capability. |
| design-system-preview | catalog | BOTH | `od design-systems show <id>` → `GET /api/design-systems/:id` | Same full-detail payload (tokens, kit, package file list) the preview pane renders. |
| design-system-select-apply | catalog | UI-ONLY | `od config set designSystemId <id>` covers only the global-default half | The global-default half ("Make default") is reachable: `App.tsx` persists `config.designSystemId` through the same `PUT /api/app-config` that `od config set` wraps generically. But the per-project / in-chat "switch this project's active design system" half (`DesignSystemSwitchPicker`) has no CLI verb — `od project` has no `update`/`set-design-system` case for an *existing* project (only `create`/`create-design-system`/`duplicate`/`archive`/`import`/`import-folder`/`delete`/`editors`/`open-in`/`list`/`info`). |
| design-system-import | catalog | BOTH | `od design-systems import-local\|import-github\|import-shadcn <source> [--name] [--import-mode] [--craft]` | Verified cli.ts:8982-9160. Matches the given pre-verified finding. |
| design-system-publish-unpublish-delete | catalog | UI-ONLY | none | `PATCH /api/design-systems/:id` (status draft↔published) and `DELETE /api/design-systems/:id` both exist server-side (routes/design-systems.ts:342,358). `od design-systems rename` is the only CLI verb that PATCHes `.../:id`, and it only ever sends `{title}`. There is no delete/publish/unpublish subcommand at all. |
| design-templates-gallery | catalog | BOTH | `od design-templates list\|show\|preview <id> [--url]` | Browsing is fully covered; `preview` streams the rendered example HTML via `GET /api/skills/:id/example` — design templates live in the same skills registry design templates share with skills. `od project create --skill <id>` plausibly seeds a new project from a template id, mirroring "opens or seeds a new project from that template," though this wasn't independently verified end-to-end. |
| reference-board | catalog | N-A | — | Static curated list of external site URLs (`REFERENCE_GROUPS`) with client-side category/search filtering and click tracking. No server mutation. |
| browser-use-action-catalog | catalog | N-A | — | ~35 canned prompts sent to the same in-page agent chat that IS reachable via `od run`/`od chat`. The catalog/menu itself is discovery sugar, not a distinct server capability. |
| connector-tool-preview | catalog | UI-ONLY | none | Hits `GET /api/connectors/:id` (hydrated tool list, `CONNECTOR_TOOL_PREVIEW_LIMIT=50`). No cli.ts route matches `/api/connectors/` at all — same gap family as connectors-catalog. |
| brand-reference-picker | catalog | BOTH | `od brand create <url> [--locale] [--json]` → `POST /api/brands` | `BrandReferencePicker.tsx` is purely presentational (`onPick` bubbles up a domain); the extraction it ultimately kicks off is the same `POST /api/brands` endpoint `od brand create` hits. |
| library-assets-registry | catalog | BOTH | `od library list\|search [--kind] [--tag] [--source] [--date] [--project] [--limit] [--offset]` → `GET /api/library/assets` | Verified cli.ts:8590-8635, including the SSE-backed live grid's underlying data source. |
| library-multiselect-bulk-delete | catalog | BOTH | `od library rm <id>` → `DELETE /api/library/assets/:id` | Same per-asset delete endpoint the UI's bulk action loops over; neither surface has a native batch-delete request, so parity is at the same granularity (loop the CLI call per id). |
| library-insert-picker | catalog | BOTH | `od library apply <id> --project <projectId> [--dir <subdir>]` → `POST /api/library/assets/:id/apply` | Verified cli.ts (`case 'apply'` in runLibrary). |
| plugins-home-discovery | catalog | BOTH | `od plugin list\|search` | Reproduces the category/subcategory/query narrowing (`usePluginFacets`) over the same installed-plugin data. |
| plugin-use-duplicate | catalog | BOTH | `od plugin duplicate <id> [--name]` → `POST /api/plugins/:id/duplicate-project`; "Use" ≈ `od run start --plugin <id> [--inputs <json>]` | "Duplicate" matches exactly (verified cli.ts:4641-4674). "Use" has no literal client-staging equivalent (it just pre-fills the composer before send), but the same end-state — a plugin-driven run — is reachable via `od run start --project <id> --plugin <id> --inputs '<json>'` (verified the `start` case sets `body.pluginId`/`body.pluginInputs` from these flags). |
| plugin-detail-modal | catalog | BOTH | `od plugin info <id>` / `od plugin manifest <id>` | Surfaces the same tags/description/type-specific data the modal renders. The modal's rich per-type rendering (design-system patch diff, media preview) is display-only sugar over that data. |
| plugin-marketplace-browse-install | catalog | BOTH | `od plugin search\|list` + `od plugin install <source>` → `POST /api/plugins/install` | Verified. Matches the UI's `filterAvailablePlugins` + Install button exactly. |
| plugin-marketplace-sources | catalog | BOTH | `od plugin sources` | `runPluginSources` (cli.ts:3750+) manages marketplace.json sources (add/refresh/remove/trust-level). |
| plugin-import | upload-attach | BOTH | `od plugin install ./local-folder \| github:owner/repo[@ref] \| https://…tar.gz` → `POST /api/plugins/install` | The CLI's single unified endpoint achieves the same install outcome as the UI's three separate routes (`/api/plugins/install`, `/upload-zip`, `/upload-folder`) — they diverge only because the CLI runs co-located with the daemon and can read local paths directly, while the browser must upload bytes. Same end-state, different transport. |
| community-gallery | catalog | BOTH | `od plugin list` | Same `PluginsHomeSection` component/data as plugins-home-discovery, filtered to installed community plugins. |
| share-to-community | catalog | BOTH | `od plugin scaffold` → `od plugin validate` → `od plugin pack` → `od plugin install`, then `od plugin publish` / `od plugin publish-repo` / `od plugin open-design-pr` | Strong match: the packaging pipeline (scaffold/validate/pack/install-locally) and all three publish-direction actions ("Add to My plugins", "Publish repo", "MishMash PR") each have a dedicated, named subcommand (cli.ts:2563-2565). |
| stock-media-gap | catalog | N-A | — | The inventory JSON itself sets `not_applicable` on this entry: documented absence, not a capability to grade. |
| composer-file-picker | upload-attach | UI-ONLY | none (`od files upload` hits a different endpoint) | `ChatComposer.tsx` uploads via the batch `uploadProjectFiles()` → `POST /api/projects/:id/upload` (12/batch, 200MB/file, no MIME check, reshaped into `ChatAttachment`s). No cli.ts code references `/api/projects/:id/upload` anywhere. `od files upload` hits the different, single-file, versioned `POST /api/projects/:id/files` endpoint used by the Design Files panel instead — a real, distinct capability gap, not a naming coincidence. |
| composer-drag-drop | upload-attach | UI-ONLY | none | Same `uploadProjectFiles()` call as composer-file-picker (verified: `ChatComposer.tsx:1741`). |
| composer-paste-clipboard | upload-attach | UI-ONLY | none | Same `uploadProjectFiles()` call (verified: `ChatComposer.tsx:1893`, the annotation/clipboard path). |
| connector-mention-context | upload-attach | UI-ONLY | none | `insertConnectorMention()` stages `RunContextSelection.connectorIds` client-side only. Neither `od run start` nor `od chat` accepts a `--connector` flag (verified against `od run start`'s full usage banner and body-construction code). |
| reference-project-link-code | upload-attach | UI-ONLY | none | PATCHes `project.metadata.linkedDirs` to grant `--add-dir` read access. Grep for "linkedDirs" and "add-dir" in cli.ts returns nothing; `od project` has no update/link subcommand for an *existing* project (only at `create`/`create-design-system`/`import` time). |
| od-library-manual-upload | upload-attach | BOTH | `od library import <file\|url> [<file\|url> ...] [--kind] [--tag]` → `POST /api/library/ingest` | Verified cli.ts (`case 'import'` in runLibrary). Same endpoint and MIME/size re-validation `LibraryUploadModal.tsx` relies on. |
| design-system-asset-dropzone | upload-attach | BOTH | `od files upload <workspaceProjectId> <localpath> [--as <relpath>]` → `POST /api/projects/:id/files` | Uploads go through the singular `uploadProjectFile()` (verified: `DesignSystemFlow.tsx:4971,5037`), which is the exact endpoint `od files upload` hits — unlike the chat composer's batch path above. |
| kit-upload-logo-font-image | upload-attach | BOTH | `od files upload` (asset) + `od files read`/`od files write` (brand.json rewrite) | `kit-upload.ts`'s own comment: "Reuses the existing project file providers — no new daemon endpoint is required." Both the asset upload and the brand.json patch go through the standard `/api/projects/:id/files` endpoint. No single dedicated verb, and the caller must independently know the design system's backing workspace project id and brand.json's schema, which the CLI doesn't teach — a real but modest usability gap, not a missing endpoint. |
| folder-import-project | upload-attach | BOTH | `od project import <baseDir> [--name] [--skill] [--design-system]` → `POST /api/import/folder` | Verified cli.ts:6957-6986. |
| skill-package-import | upload-attach | UI-ONLY | none (`od skills` is list/show only) | `POST /api/skills/import` exists (registry.ts:336) but `od skills` resolves to the generic `runLibraryList('skills', args)` handler, which only supports `list`/`show`. No import subcommand anywhere in cli.ts. |
| storyboard-uploads | upload-attach | BOTH | `od storyboard upload <id> --file <path> [--shot <shotId>] [--slot start\|end]` → `POST /api/storyboards/:id/uploads` | Verified. Same route as the given pre-verified finding for storyboard-shot-crud-render-takes. |
| api-attachment-context-injection | runtime-wiring | N-A | — | Automatic context-rendering triggered by staged attachments in BYOK/API mode; user_action is `N/A` by its own inventory entry. Its trigger condition (staged attachments) is itself only reachable through composer-file-picker/drag-drop/paste today, all graded UI-ONLY above, but the injection logic is plumbing, not a user-facing capability in its own right. |

## Dual-track gaps worth closing

Only the 25 UI-ONLY rows. Each lists the endpoint a CLI command would call and
a one-line suggested command shape.

- **in-app-terminal-tab** — `POST /api/projects/:id/terminals` (+ SSE stream, `POST .../stdin`, `POST .../resize`). This is the cheapest fix in the audit: `runShell` already exists at cli.ts:7380 and already does the right thing (`od shell --project <id> [--shell <path>] [--json]`) — it is simply missing from `SUBCOMMAND_MAP`. Add `shell: runShell` to the map.
- **comment-pods-mode** — no endpoint exists yet for board/pod state; would need a new `POST /api/projects/:id/comments` (or similar) plus `od comments add --project <id> --selector <css> --note "<text>"`.
- **comment-side-panel** — same backing store as comment-pods-mode; `od comments list/resolve <projectId>` once the endpoint exists.
- **draw-mark-annotation** — depends on both the comments endpoint above and the composer upload endpoint below; `od draw send --project <id> --screenshot <path> --bounds <json>` once both exist.
- **manual-edit-mode-core** — `edit-mode/source-patches.ts`'s pure patch operations have no server endpoint at all (they run client-side against the DOM, then the *result* is saved via the generic files endpoint). Suggested shape: `POST /api/projects/:id/files/:relpath/patch` taking one of `{set-text, set-link, set-image, set-style, set-attributes, set-outer-html, remove-element, set-token}` + a target selector, then `od files patch <projectId> <relpath> --op set-text --selector "#hero h1" --value "New headline"`.
- **manual-edit-inspector-panel**, **manual-edit-outer-html**, **manual-edit-delete-image-page-styles** — same missing patch endpoint as manual-edit-mode-core; would ride the same `od files patch` verb with different `--op` values.
- **inspect-panel** — same missing patch endpoint (its "Save to source" is a `set-style` patch specifically).
- **storyboard-shot-crud-render-takes** — two distinct gaps on an otherwise well-covered feature: (1) shot list mutation rides the generic `PATCH /api/storyboards/:id` the UI already uses optimistically — `od storyboard shots add|remove|duplicate|reorder <id> [...]` could wrap that same PATCH the way `od storyboard upload --shot` already does; (2) AI frame generation is `POST /api/storyboards/:id/frames`, currently unreachable — `od storyboard frame <id> --shot <shotId> --slot start|end --prompt "<text>"`.
- **connectors-catalog** — `GET /api/connectors`, `GET /api/connectors/discovery`, `GET /api/connectors/status`, `POST /api/connectors/auth-configs/prepare`. Suggested: `od connectors list|search`, `od connectors connect <id>` (prints/opens the OAuth URL and polls status), `od connectors disconnect <id>`.
- **connector-tool-preview** — `GET /api/connectors/:id` (hydrated tool list). Suggested: `od connectors show <id> [--tools]`.
- **design-files-panel** — `POST /api/projects/:id/files/rename`. Suggested: `od files rename <projectId> <oldRelpath> <newRelpath>`.
- **design-system-project-panel** — `POST /api/design-systems/generation-jobs`, `GET .../generation-jobs/:jobId`. Suggested: `od design-systems generate <id>` / `od design-systems generation-status <jobId>`.
- **page-creator-dialog** — the preset catalog itself needs a server-readable form first (currently baked into the web bundle); once it has one (e.g. `GET /api/page-presets`), `od project new-page <projectId> --preset <id>` becomes straightforward.
- **export-pdf-pptx-image** — `od export` already exists; the gap is a missing flag, not a missing endpoint. Add `--editable` to `EXPORT_BOOLEAN_FLAGS` and thread it into `buildExportCliRequestBody` for `--format pptx`.
- **critique-theater** — `POST /api/projects/:id/critique/:runId/interrupt`. Suggested: `od critique interrupt <projectId> <runId>` (the feature is explicitly out of scope for the current hardening effort per its own inventory entry, so this is lowest priority in this list).
- **design-system-select-apply** — the missing half specifically is "switch the active project's design system," which needs an update path for an *existing* project (e.g. `PATCH /api/projects/:id`). Suggested: `od project set-design-system <projectId> <designSystemId>`.
- **design-system-publish-unpublish-delete** — `PATCH /api/design-systems/:id` (with `{status}`) and `DELETE /api/design-systems/:id` both already exist server-side. Suggested: `od design-systems publish|unpublish|delete <id>`.
- **composer-file-picker**, **composer-drag-drop**, **composer-paste-clipboard** — all three share one gap: `POST /api/projects/:id/upload` (batch, staged as `ChatAttachment`s). Suggested: `od files attach <projectId> <localpath> [<localpath> ...] [--dir <subdir>]` distinct from `od files upload` so the CLI's output shape matches `ChatAttachment`, not a raw file write.
- **connector-mention-context** — needs a `--connector <id>[,<id>]` flag threaded through `od run start`/`od chat` bodies (`RunContextSelection.connectorIds`).
- **reference-project-link-code** — `PATCH` on project metadata for `linkedDirs`. Suggested: `od project link-dir <projectId> <localPath>` / `od project link-project <projectId> <otherProjectId>`.
- **skill-package-import** — `POST /api/skills/import` already exists. Suggested: `od skills import <path|url>`, mirroring `od plugin install`'s source-detection pattern.

## Method and limits

For each of the 81 inventory entries: read the entry's `source_files`,
`user_action`, and `expected_result`; grep those source files (and, where the
UI called a shared client (`registry.ts`, `kit-upload.ts`, etc.), the shared
file) for the `/api/*` endpoint the action actually posts/fetches to; then
grep `apps/daemon/src/cli.ts` for a subcommand hitting that same endpoint
(exact path match preferred; a different route serving the same end-state
was accepted as BOTH only when explicitly noted in the table, e.g.
share-link's redeploy-only path, plugin-import's local-vs-upload divergence).
`SUBCOMMAND_MAP` (cli.ts:874-922) and the full `run*` function inventory were
extracted once and used as the standing reference for "does a CLI verb exist
at all," including a systematic cross-check (every top-level `run*` function
against the map's values, plus an occurrence count for each) that surfaced the
orphaned `runShell`/`od shell` finding.

What was verified directly, with line numbers cited in the table: `od deploy`,
`od share`, `od figma import`, `od files` (all subcommands), `od templates
save`, `od design-systems` (all subcommands), `od storyboard` (all
subcommands), `od library` (all subcommands), `od plugin` (install, duplicate,
sources, publish/publish-repo/open-design-pr), `od chat new`, `od run start`
(plugin/inputs flags), `od run cancel`, `od project` (all subcommands), `od
config`, `od brand create`, `od export`, `od tools connectors`, `od tools
live-artifacts` (existence only, not a full flag audit).

What was NOT independently verified end-to-end (noted inline where it affects
a grade): whether `od project create --skill <id>` actually accepts a
design-template id and seeds a matching project (design-templates-gallery);
the exact response shape of `od design-systems list` vs. what
DesignSystemsTab.tsx's live search narrows over (assumed client-side
filtering over the same list, not confirmed the daemon doesn't also support
server-side query params); whether `od plugin install <local-path>` actually
produces byte-for-byte the same installed plugin as the UI's
`/upload-zip`/`/upload-folder` routes (assumed equivalent outcome, not diffed).

Two files were deliberately not read in full: `apps/daemon/src/cli.ts` is
~488KB (12,501 lines) — read via targeted `grep`/`sed` line ranges rather than
end to end, so a subcommand whose relevant behavior lives far from its
`case`/usage-banner text (e.g., a flag parsed in a shared helper) could have
been missed. `FileViewer.tsx` (14,809 lines), `FileWorkspace.tsx` (7,816
lines), `ChatComposer.tsx` (5,625 lines), and `ProjectView.tsx` (10,094 lines)
were each grepped for endpoint references and specific feature keywords
rather than read start to end.

No code was changed and nothing was committed as part of this audit.
