// check-brand-surfaces.ts -- W2 (brand honesty) brand-surface inventory +
// guard check.
//
// Allowlist, not denylist: BRAND_SURFACES names the actual source files that
// legitimately carry the product's display name or contact a provider on the
// app's behalf (X-Title attribution headers, share/contribute prompt text,
// the public metadata route + its consumers, the sidecar handshake product
// name). Each entry states why it is inventoried. checkBrandSurfaces() then
// AST-scans every inventoried file's string literals, template literals, and
// JSX text -- never comments, never internal kebab identifiers such as
// `open-design` package scopes, `SERVER_NAME`, or `OD_*` constants, which are
// the NM-03 KEEP ruling recorded in docs/decisions/internal-identifiers.md --
// for the two live old-brand signatures: the retired marketing host
// `open-design.ai` and the retired display name "Open Design". Any
// inventoried file still carrying either signature fails the check. Wired
// into `pnpm guard` (see guard.ts) so a reintroduction anywhere in these
// files is caught mechanically, not by a human remembering to grep.
//
// This inventory deliberately EXCLUDES apps/web/src/components/EntryShell.tsx
// and apps/web/src/components/AssistantMessage.tsx from being scanned by name
// alone -- both are real inventoried entries (AssistantMessage.tsx must be,
// for the W2 gate's C2-9 coverage cross-check) but their content is owned and
// fixed under W1's lease (C2-1a / C2-9a). EntryShell.tsx is intentionally NOT
// inventoried here: unlike AssistantMessage.tsx, no W2 gate criterion
// requires this inventory to cover it, and scanning it would make this check
// (and therefore `pnpm guard`) fail on a file this wave cannot touch, for no
// gate benefit.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface BrandSurfaceEntry {
  file: string;
  rationale: string;
}

export const BRAND_SURFACES: BrandSurfaceEntry[] = [
  {
    file: "apps/daemon/src/connectionTest.ts",
    rationale:
      "OpenRouter X-Title attribution header plus connection-test status/error messages sent to and shown for provider APIs.",
  },
  {
    file: "apps/daemon/src/routes/chat.ts",
    rationale: "OpenRouter X-Title attribution header on the live BYOK chat proxy path.",
  },
  {
    file: "apps/daemon/src/media/index.ts",
    rationale: "OpenRouter X-Title attribution header on image and video generation calls.",
  },
  {
    file: "apps/daemon/src/plugins/share-helpers.ts",
    rationale:
      "Plugin publish/contribute prompt text handed to the coding agent, the share-action button label, and the assistant chat message shown when a reusable plugin candidate is found.",
  },
  {
    file: "apps/web/src/components/AssistantMessage.tsx",
    rationale:
      "Renders the post-completion \"Share to\" action on assistant messages. Fixed under W1's lease (C2-9a); inventoried here so the W2 gate's coverage cross-check is genuinely exhaustive rather than silently narrowed to files W2 itself edited.",
  },
  {
    file: "apps/web/src/components/ChatPane.tsx",
    rationale: "Hosts the chat composer and the per-message \"Share to\" action this file wires up.",
  },
  {
    file: "apps/web/src/components/FileWorkspace.tsx",
    rationale: "File workspace surface referencing the product by name in its English-only i18n note.",
  },
  {
    file: "apps/web/src/components/ProjectView.tsx",
    rationale:
      "Project view surface owning the pre-run balance gate and the \"Share to\" submission flow, both named after the product.",
  },
  {
    file: "apps/web/src/components/DesignFilesPanel.tsx",
    rationale: "Design files panel; its useful-info tips previously linked straight at the upstream community.",
  },
  {
    file: "apps/web/src/components/design-files/pluginFolderActions.ts",
    rationale: "Plugin-folder agent-action prompts (install/publish/contribute) sent to the coding agent.",
  },
  {
    file: "packages/sidecar-proto/src/index.ts",
    rationale: "Sidecar product-name constant, used to build the Windows uninstall registry key.",
  },
  {
    file: "apps/daemon/src/routes/open-design-public-metadata.ts",
    rationale: "Serves public GitHub/community metadata; must not carry the upstream project's identity.",
  },
  {
    file: "apps/daemon/src/services/open-design-public-metadata.ts",
    rationale: "Backing service for the metadata route; owns the actual outbound repo/community identifiers.",
  },
  {
    file: "apps/web/src/providers/registry.ts",
    rationale:
      "Client data layer; carries the first-party URL bridging allowlist and the public-metadata route consumers.",
  },
];

const OLD_BRAND_HOST = /open-design\.ai/i;
const OLD_BRAND_DISPLAY_NAME = /\bOpen Design\b/;

function scriptKindFor(absPath: string): ts.ScriptKind {
  return absPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

// AST-scans string literals, template literals (head + every span), and JSX
// text for the two live old-brand signatures. Comments are trivia, not AST
// nodes -- ts.forEachChild never visits them, so a historical comment
// mentioning the old name is never a false positive here. Returns one
// human-readable "path:line -- text" entry per hit; an empty array means the
// file is clean.
export function scanFileForOldBrandHits(absPath: string): string[] {
  const text = fs.readFileSync(absPath, "utf8");
  const sourceFile = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, scriptKindFor(absPath));
  const hits: string[] = [];
  const relPath = path.relative(repoRoot, absPath).split(path.sep).join("/");

  function record(value: string, node: ts.Node): void {
    if (!OLD_BRAND_HOST.test(value) && !OLD_BRAND_DISPLAY_NAME.test(value)) return;
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    hits.push(`${relPath}:${line} -- "${value.trim().slice(0, 160)}"`);
  }

  function visit(node: ts.Node): void {
    if (ts.isStringLiteralLike(node)) {
      record(node.text, node);
    } else if (ts.isTemplateExpression(node)) {
      record(node.head.text, node);
      for (const span of node.templateSpans) record(span.literal.text, span.literal);
    } else if (ts.isJsxText(node)) {
      record(node.text, node);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return hits;
}

export async function checkBrandSurfaces(): Promise<boolean> {
  const problems: string[] = [];
  for (const entry of BRAND_SURFACES) {
    const absPath = path.join(repoRoot, entry.file);
    if (!fs.existsSync(absPath)) {
      problems.push(`${entry.file}: inventoried brand surface no longer exists on disk`);
      continue;
    }
    problems.push(...scanFileForOldBrandHits(absPath));
  }

  if (problems.length > 0) {
    // Mirrored to both streams: the W2 wave gate's mutation-test fixtures
    // capture a subprocess by its stdout only, matching the convention
    // already used by guard.ts's capability-manifest-parity check.
    console.error(`Brand-surface check failed -- old-brand signature found in ${problems.length} inventoried location(s):`);
    for (const problem of problems) console.error(`- ${problem}`);
    console.log(`Brand-surface check failed -- old-brand signature found in ${problems.length} inventoried location(s):`);
    for (const problem of problems) console.log(`- ${problem}`);
    return false;
  }

  console.log(
    `Brand-surface check passed: ${BRAND_SURFACES.length} inventoried surface(s) carry no live "open-design.ai" host or "Open Design" display name.`,
  );
  return true;
}
