// check-fork-repo-links.ts -- fork-identity link guard.
//
// This repository is a hard-pinned fork (docs/FORK-PIN.md): `origin` is
// wiggdevin/mishmash and the upstream `nexu-io/open-design` repo is a
// different project's identity. The Help popover shipped pointing its
// "Get help on GitHub" link at the upstream tracker, so bug reports filed
// "through the app" landed in another project's repo (production-note F,
// 2026-08-03) -- and the W2 brand-surface guard could not catch it: its two
// signatures cover the retired marketing host and display name, not the
// upstream GitHub URL, and EntryHelpMenu.tsx is not in its inventory.
//
// Allowlist, not denylist: FORK_LINK_SURFACES names the user-facing help,
// support, update, and issue-reporting surfaces whose links must carry the
// fork's own identity. Deliberately NOT inventoried: the community-catalog
// publishing flows (plugin-source.ts, pluginFolderActions.ts, plugins/
// publish.ts, share-to-community, home-hero/plugin-authoring) -- those open
// PRs/issues against the upstream community catalog on purpose -- and code
// comments citing upstream issue numbers, which are history, not links.
//
// TS/TSX files are AST-scanned (string literals, template literals, JSX
// text; never comments -- same convention as check-brand-surfaces.ts).
// YAML issue templates are plain-text scanned: everything in them renders
// on github.com, comments included.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const UPSTREAM_REPO_URL = /github\.com\/nexu-io\/open-design/i;

export const FORK_LINK_SURFACES: string[] = [
  // Help popover: issues, PRs, releases -- the surface the founder's bug
  // reports went through.
  "apps/web/src/components/EntryHelpMenu.tsx",
  // Release/changelog surfaces reachable from the web studio.
  "apps/web/src/components/WhatsNewPopup.tsx",
  "apps/web/src/components/SettingsDialog.tsx",
  "apps/web/src/components/UpdateDialog.tsx",
  // First-run privacy disclosure links the policy document — and the policy
  // itself carries a questions contact, so both are inventoried.
  "apps/web/src/components/PrivacyConsentModal.tsx",
  "PRIVACY.md",
  // Operator doc whose example payload gets copy-pasted into the
  // OD_WHATS_NEW_URL document (its linkUrl wins over the in-app fallback).
  "docs/whats-new.md",
  // Issue templates render on the fork's own new-issue chooser. The upstream
  // tutorial-submission and preview-feedback templates were deleted outright
  // (they solicited content for the upstream project's marketing site and a
  // past upstream preview cycle).
  ".github/ISSUE_TEMPLATE/bug-report.yml",
  ".github/ISSUE_TEMPLATE/feature-request.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
];

function scanTsFileForUpstreamLinks(absPath: string): string[] {
  const text = fs.readFileSync(absPath, "utf8");
  const kind = absPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, kind);
  const hits: string[] = [];
  const relPath = path.relative(repoRoot, absPath).split(path.sep).join("/");

  function record(value: string, node: ts.Node): void {
    if (!UPSTREAM_REPO_URL.test(value)) return;
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

function scanTextFileForUpstreamLinks(absPath: string): string[] {
  const relPath = path.relative(repoRoot, absPath).split(path.sep).join("/");
  const hits: string[] = [];
  const lines = fs.readFileSync(absPath, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (UPSTREAM_REPO_URL.test(line)) {
      hits.push(`${relPath}:${index + 1} -- "${line.trim().slice(0, 160)}"`);
    }
  });
  return hits;
}

export async function checkForkRepoLinks(): Promise<boolean> {
  const problems: string[] = [];
  for (const file of FORK_LINK_SURFACES) {
    const absPath = path.join(repoRoot, file);
    if (!fs.existsSync(absPath)) {
      problems.push(`${file}: inventoried fork-link surface no longer exists on disk`);
      continue;
    }
    problems.push(
      ...(file.endsWith(".ts") || file.endsWith(".tsx")
        ? scanTsFileForUpstreamLinks(absPath)
        : scanTextFileForUpstreamLinks(absPath)),
    );
  }

  if (problems.length > 0) {
    console.error(`Fork-link check failed -- upstream repo URL found in ${problems.length} inventoried location(s):`);
    for (const problem of problems) console.error(`- ${problem}`);
    return false;
  }

  console.log(
    `Fork-link check passed: ${FORK_LINK_SURFACES.length} inventoried surface(s) carry no upstream-repo GitHub URL.`,
  );
  return true;
}
