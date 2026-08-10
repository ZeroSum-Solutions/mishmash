import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

import { checkCrossAppImports } from "./check-cross-app-imports.ts";
import { checkTsNocheckImports } from "./check-ts-nocheck-imports.ts";
import { checkDesignSystemManifests } from "./check-design-system-manifests.ts";
import { checkDesignSystemPackageQuality } from "./check-design-system-package-quality.ts";
import { checkDesignSystemComponentFixtureReport } from "./check-components-fixtures.ts";
import { checkDesignSystemFlagParity } from "./check-design-system-flag-parity.ts";
import { checkComponentsManifestExtraction } from "./check-components-manifest-extraction.ts";
import { checkPluginPreviewManifest } from "./check-plugin-preview-manifest.ts";
import { checkBrandSurfaces } from "./check-brand-surfaces.ts";
import { checkForkRepoLinks } from "./check-fork-repo-links.ts";
import { checkDaemonFilesystemWrites } from "./check-daemon-filesystem-writes.ts";
import { validatePlaywrightSuiteTopology } from "../e2e/lib/playwright/suites.ts";
import {
  checkDesignSystemA1RequiredTokens,
  checkDesignSystemA2DefaultsParity,
  checkDesignSystemA2RequiredTokens,
  checkDesignSystemBSlotRequiredTokens,
  checkDesignSystemTokenFixtureSync,
  checkDesignSystemUnknownTokens,
} from "./check-tokens-fixture-sync.ts";
import { checkCraftReferences } from "./lint-craft-references.ts";
import { collectCssHardcodedColorMatches, cssWideAndSpecialColorKeywords, realNamedColors } from "./style-policy.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const allowedE2eScripts = new Set([
  "e2e/scripts/playwright.ts",
  "e2e/scripts/release-smoke.ts",
  "e2e/scripts/visual-report.ts",
]);

type GuardCheck = {
  name: string;
  run: () => Promise<boolean>;
};

function toRepositoryPath(filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

const residualExtensions = new Set([".js", ".mjs", ".cjs"]);

const residualSkippedDirectories = new Set([
  ".agents",
  ".astro",
  ".claude",
  ".claude-sessions",
  ".codex",
  ".cursor",
  ".git",
  ".od",
  ".od-e2e",
  ".opencode",
  ".task",
  ".tmp",
  ".vite",
  "dist",
  "node_modules",
  "out",
]);

const residualAllowedExactPaths = new Set([
  // esbuild config entrypoints are executed directly by Node before package
  // dist output exists.
  "packages/agui-adapter/esbuild.config.mjs",
  "packages/contracts/esbuild.config.mjs",
  "packages/diagnostics/esbuild.config.mjs",
  "packages/download/esbuild.config.mjs",
  "packages/host/esbuild.config.mjs",
  "packages/launcher-proto/esbuild.config.mjs",
  "packages/metatool/esbuild.config.mjs",
  "packages/platform/esbuild.config.mjs",
  "packages/plugin-runtime/esbuild.config.mjs",
  "packages/registry-protocol/esbuild.config.mjs",
  "packages/sidecar/esbuild.config.mjs",
  "packages/sidecar-proto/esbuild.config.mjs",
  // Maintainer utility scripts ported from the media branch. They are
  // executed directly by Node and are not loaded by the app runtime.
  "scripts/import-prompt-templates.mjs",
  "scripts/postinstall.mjs",
  // Checked-in bin shim so pnpm can link `od` before daemon dist output exists.
  "apps/daemon/bin/od.mjs",
  // Browser service workers must be served as JavaScript files.
  "apps/web/public/od-notifications-sw.js",
  // PostCSS loads Tailwind through a web-local .mjs compatibility config entry.
  "apps/web/postcss.config.mjs",
  "scripts/bake-html-ppt-examples.mjs",
  // CI-only plugin-preview renderer. Kept .mjs and run directly by Node so its
  // runtime deps (puppeteer-core + a headless Chrome + ffmpeg) are provided by
  // the CI environment and never pulled into the daemon/web TS build or bundle.
  "scripts/bake-plugin-previews.mjs",
  // Manifest diff guard + its node:test coverage. Run directly by Node from the
  // bake workflows (no TS build step there) to decide whether a `previews` entry
  // actually changed, ignoring the per-run `generatedAt` timestamp.
  "scripts/plugin-previews-diff.mjs",
  "scripts/plugin-previews-diff.test.mjs",
  // CI-only R2 garbage collector for orphaned preview clips + its node:test.
  "scripts/plugin-previews-gc.mjs",
  "scripts/plugin-previews-gc.test.mjs",
  "scripts/scaffold-html-ppt-skills.mjs",
  "scripts/sync-hyperframes-skill.mjs",
  "scripts/verify-media-models.mjs",
  // AMR (vela) verifier: ad-hoc dev runner that imports the daemon's compiled
  // `dist/acp.js` and drives a real `vela agent run` against a live model.
  // Kept as .mjs so it can be invoked directly via Node without any transform.
  "apps/daemon/scripts/verify-amr-real-vela.mjs",
  // Fake `vela agent run --runtime opencode` ACP stdio stub used by the AMR
  // integration tests. The Vitest test spawns it via `child_process.spawn`,
  // which needs a directly-executable file (shebang + .mjs).
  "apps/daemon/tests/fixtures/fake-vela.mjs",
  "tools/dev/bin/tools-dev.mjs",
  "tools/dev/esbuild.config.mjs",
  "tools/pack/bin/tools-pack.mjs",
  "tools/pack/esbuild.config.mjs",
  // Checked-in bin shim so pnpm can link `tools-release` before dist output exists.
  "tools/release/bin/tools-release.mjs",
  "tools/release/esbuild.config.mjs",
  "tools/serve/bin/tools-serve.mjs",
  "tools/serve/esbuild.config.mjs",
  "tools/pack/resources/mac/notarize.cjs",
  // electron-builder hook path; CJS compatibility entry used by tools-pack desktop builds.
  "tools/pack/resources/web-standalone-after-pack.cjs",
]);

const residualAllowedPathPrefixes = [
  "apps/daemon/dist/",
  "apps/web/.next/",
  "apps/web/out/",
  "generated/",
  "e2e/playwright-report/",
  "e2e/reports/html/",
  "e2e/reports/playwright-html-report/",
  "e2e/reports/test-results/",
  "e2e/ui/.od-data/",
  "e2e/ui/reports/playwright-html-report/",
  "e2e/ui/reports/test-results/",
  "e2e/ui/test-results/",
  // Vendored upstream HyperFrames helper scripts (design template).
  "design-templates/hyperframes/scripts/",
  // Vendored upstream Web Clone skill helper scripts. These are portable
  // Node-run skill utilities executed from user workspaces via explicit script
  // paths, and stay as `.mjs` to preserve the upstream skill packaging.
  "skills/web-clone/scripts/",
  // Vendored upstream Last30Days runtime helper used by the engine (design template).
  "design-templates/last30days/scripts/lib/vendor/",
  // Vendored upstream html-ppt runtime assets (lewislulu/html-ppt-skill, design template).
  "design-templates/html-ppt/assets/",
  // Vendored pinned motion runtime for the scroll-film template (GSAP 3.12.7,
  // ScrollTrigger 3.12.7, Lenis 1.1.18). GSAP licensing decision
  // docs/decisions/gsap-licensing.md requires pinned versions; same
  // precedent as design-templates/html-ppt/assets/ above.
  "design-templates/scroll-film-hero/assets/vendor/",
  // Vendored upstream website-clone recon/mirror/audit helpers
  // (Jane-xiaoer/claude-skill-web-clone). Global skill assets staged into the
  // project cwd for direct `node scripts/...` execution by the agent.
  "skills/web-clone/scripts/",
  // Replay-based mock CLIs that impersonate the agent CLIs OD spawns
  // (opencode/claude/codex/gemini/cursor-agent + ACP family). Need to
  // be directly executable via Node so `child_process.spawn` from test
  // harnesses and PATH-overlay shells work without any transform step.
  // `mocks/scripts/` holds the maintainer-facing helpers (manifest math,
  // fetch from R2) which are also pure-node single-file modules — same
  // precedent as `apps/daemon/tests/fixtures/fake-vela.mjs` (an ACP
  // stdio stub, allowlisted individually above). See `mocks/README.md`.
  "mocks/lib/",
  "mocks/mock-agent.mjs",
  "mocks/scripts/",
  // OD Clipper - a standalone Chrome MV3 extension subproject (not a pnpm
  // workspace package, no build step). It ships hand-written browser-loadable
  // JavaScript (service worker, content script, popup) the same way as the
  // web notifications service worker; it must not be retypecast to TypeScript.
  "clipper/",
  // OD Figma Import - a standalone Figma plugin subproject (no build step,
  // not a pnpm workspace package). Figma plugins load hand-written
  // browser-loadable JavaScript (`code.js` sandbox + `ui.html`); same
  // precedent as the clipper, and it must not be retypecast to TypeScript.
  "figma-plugin/",
  "test-results/",
  "vendor/",
];

const residualAllowedPathPatterns: RegExp[] = [
  // Vendored upstream Zara template runtimes — one design template per template,
  // name prefix `html-ppt-zhangzara-` (zarazhangrui/beautiful-html-templates).
  // Only the vendored deck-stage runtime asset is allowlisted; any other
  // JavaScript under these design-template directories must still be converted
  // to TypeScript or explicitly listed in `residualAllowedExactPaths`.
  /^design-templates\/html-ppt-zhangzara-[^/]+\/assets\/deck-stage\.js$/,
  // Bundled example/skill plugins copy the upstream skill's `assets/`
  // and `references/` directories verbatim so the daemon's preview
  // surface can render the baked HTML without staging detours. Those
  // assets are vendored runtime, never project-owned code, and must
  // not be retypecasted to TypeScript.
  /^plugins\/_official\/examples\/[^/]+\/(assets|references)\/.+$/,
];

// Vendored claude-directory templates (pulkitxm/claude-directory, MIT) baked by
// `scripts/import-claude-directory.ts`. Upstream builds these with Vite, and a
// bundle resolves its lazy chunks and imported media against `import.meta.url`
// — so the bake ships the build output as files rather than inlining it, which
// would rebase every one of those URLs onto the host document. The chunks are
// bundler output, never project-owned source.
//
// The exemption is keyed on the template's own provenance file rather than a
// hand-kept id list, so a re-import cannot silently drift out of the list, and
// a directory without that marker gets no exemption at all.
const VENDORED_TEMPLATE_ASSET_PATTERN = /^design-templates\/([^/]+)\/.+$/;

function isVendoredClaudeDirectoryAsset(repositoryPath: string): boolean {
  const templateId = VENDORED_TEMPLATE_ASSET_PATTERN.exec(repositoryPath)?.[1];
  if (templateId === undefined) return false;
  const provenance = path.join(repoRoot, "design-templates", templateId, "template.json");
  if (!existsSync(provenance)) return false;
  try {
    return JSON.parse(readFileSync(provenance, "utf8")).vendored_from === "pulkitxm/claude-directory";
  } catch {
    return false;
  }
}

function isResidualAllowedPath(repositoryPath: string): boolean {
  if (residualAllowedExactPaths.has(repositoryPath)) return true;
  if (residualAllowedPathPrefixes.some((prefix) => repositoryPath.startsWith(prefix))) return true;
  if (isVendoredClaudeDirectoryAsset(repositoryPath)) return true;
  return residualAllowedPathPatterns.some((pattern) => pattern.test(repositoryPath));
}

function isResidualSkippedDirectoryName(directoryName: string): boolean {
  return (
    residualSkippedDirectories.has(directoryName) || directoryName === ".next" || directoryName.startsWith(".next-")
  );
}

async function collectResidualJavaScript(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const residualFiles: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    const repositoryPath = toRepositoryPath(fullPath);

    if (entry.isDirectory()) {
      if (isResidualSkippedDirectoryName(entry.name) || isResidualAllowedPath(`${repositoryPath}/`)) {
        continue;
      }

      residualFiles.push(...(await collectResidualJavaScript(fullPath)));
      continue;
    }

    if (!entry.isFile() || !residualExtensions.has(path.extname(entry.name))) {
      continue;
    }

    if (isResidualAllowedPath(repositoryPath)) {
      continue;
    }

    residualFiles.push(repositoryPath);
  }

  return residualFiles;
}

async function checkResidualJavaScript(): Promise<boolean> {
  const residualFiles = await collectResidualJavaScript(repoRoot);

  if (residualFiles.length > 0) {
    console.error("Residual project-owned JavaScript files found:");
    for (const filePath of residualFiles) {
      console.error(`- ${filePath}`);
    }
    console.error("Convert these files to TypeScript or add a documented generated/vendor/output allowlist entry.");
    return false;
  }

  console.log("Residual JavaScript check passed: project-owned code is TypeScript-only.");
  return true;
}

const sourcePackageManifestRootPaths = ["package.json", "e2e/package.json"];
const sourcePackageManifestScopedDirectories = ["apps", "packages", "tools"];
const packageDependencySections = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const packageManagerOverridePaths = ["pnpm.overrides", "overrides", "resolutions"];
const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const exactNpmAliasPattern = /^npm:(?:@[^/]+\/)?[^@]+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

type DependencySpecViolation = {
  filePath: string;
  fieldPath: string;
  name: string;
  spec: unknown;
  reason: string;
};

type DependencySpecStats = {
  exact: number;
  manifests: number;
  total: number;
  workspace: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAllowedDependencySpec(spec: string): boolean {
  return spec === "workspace:*" || exactVersionPattern.test(spec) || exactNpmAliasPattern.test(spec);
}

function dependencySpecReason(spec: string): string {
  if (spec.startsWith("workspace:") && spec !== "workspace:*") {
    return "workspace dependencies must use exactly workspace:*";
  }

  return "dependency specs must be exact versions like 1.2.3 or workspace:*";
}

function dependencySpecFieldValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function collectScopedPackageManifestPaths(scopeDirectory: string): Promise<string[]> {
  const scopeRoot = path.join(repoRoot, scopeDirectory);
  const entries = await readdir(scopeRoot, { withFileTypes: true });
  const manifestPaths: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const packageDirectory = path.join(scopeRoot, entry.name);
    const packageEntries = await readdir(packageDirectory, { withFileTypes: true });
    if (packageEntries.some((packageEntry) => packageEntry.isFile() && packageEntry.name === "package.json")) {
      manifestPaths.push(`${scopeDirectory}/${entry.name}/package.json`);
    }
  }

  return manifestPaths;
}

async function collectSourcePackageManifestPaths(): Promise<string[]> {
  const scopedManifestPaths = (
    await Promise.all(sourcePackageManifestScopedDirectories.map((scope) => collectScopedPackageManifestPaths(scope)))
  ).flat();

  return [...sourcePackageManifestRootPaths, ...scopedManifestPaths].sort();
}

function getPackageJsonField(packageJson: Record<string, unknown>, fieldPath: string): unknown {
  let current: unknown = packageJson;
  for (const part of fieldPath.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function checkDependencySpecRecord(
  record: Record<string, unknown>,
  filePath: string,
  fieldPath: string,
  violations: DependencySpecViolation[],
  stats: DependencySpecStats,
): void {
  for (const [name, spec] of Object.entries(record).sort(([left], [right]) => left.localeCompare(right))) {
    if (isRecord(spec)) {
      checkDependencySpecRecord(spec, filePath, `${fieldPath}.${name}`, violations, stats);
      continue;
    }

    stats.total += 1;
    if (typeof spec !== "string") {
      violations.push({
        filePath,
        fieldPath,
        name,
        spec,
        reason: "dependency specs must be strings",
      });
      continue;
    }

    if (spec === "workspace:*") {
      stats.workspace += 1;
      continue;
    }

    if (isAllowedDependencySpec(spec)) {
      stats.exact += 1;
      continue;
    }

    violations.push({
      filePath,
      fieldPath,
      name,
      spec,
      reason: dependencySpecReason(spec),
    });
  }
}

async function checkPackageDependencySpecs(): Promise<boolean> {
  const manifestPaths = await collectSourcePackageManifestPaths();
  const violations: DependencySpecViolation[] = [];
  const stats: DependencySpecStats = {
    exact: 0,
    manifests: manifestPaths.length,
    total: 0,
    workspace: 0,
  };

  for (const manifestPath of manifestPaths) {
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, manifestPath), "utf8")) as Record<string, unknown>;

    for (const section of packageDependencySections) {
      const value = packageJson[section];
      if (value === undefined) continue;
      if (!isRecord(value)) {
        violations.push({
          filePath: manifestPath,
          fieldPath: section,
          name: section,
          spec: value,
          reason: "dependency sections must be objects",
        });
        continue;
      }

      checkDependencySpecRecord(value, manifestPath, section, violations, stats);
    }

    for (const overridePath of packageManagerOverridePaths) {
      const value = getPackageJsonField(packageJson, overridePath);
      if (value === undefined) continue;
      if (!isRecord(value)) {
        violations.push({
          filePath: manifestPath,
          fieldPath: overridePath,
          name: overridePath,
          spec: value,
          reason: "package-manager override sections must be objects",
        });
        continue;
      }

      checkDependencySpecRecord(value, manifestPath, overridePath, violations, stats);
    }
  }

  if (violations.length > 0) {
    console.error("Package dependency spec violations found:");
    for (const violation of violations) {
      console.error(
        `- ${violation.filePath} ${violation.fieldPath}.${violation.name}=${dependencySpecFieldValue(violation.spec)} -> ${violation.reason}`,
      );
    }
    return false;
  }

  console.log(
    `Package dependency spec check passed: ${stats.manifests} package.json files, ${stats.exact} exact specs, ${stats.workspace} workspace:* specs.`,
  );
  return true;
}

const testLayoutScopedDirectories = ["apps", "packages", "tools"];
const testLayoutSkippedDirectories = new Set([".next", ".od-data", "dist", "node_modules", "out", "reports", "test-results"]);

function isTestFile(fileName: string): boolean {
  return /\.test\.tsx?$/.test(fileName);
}

function expectedTestPath(repositoryPath: string): string {
  const [scope, project, ...relativeParts] = repositoryPath.split("/");
  if (!testLayoutScopedDirectories.includes(scope ?? "") || project == null || relativeParts.length === 0) {
    return repositoryPath;
  }

  const normalizedRelativeParts = relativeParts[0] === "src" ? relativeParts.slice(1) : relativeParts;
  return [scope, project, "tests", ...normalizedRelativeParts].join("/");
}

function isAllowedScopedTestPath(repositoryPath: string): boolean {
  const [scope, project, directory] = repositoryPath.split("/");
  return testLayoutScopedDirectories.includes(scope ?? "") && project != null && directory === "tests";
}

async function collectTestLayoutViolations(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const violations: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (testLayoutSkippedDirectories.has(entry.name)) {
        continue;
      }

      violations.push(...(await collectTestLayoutViolations(fullPath)));
      continue;
    }

    if (!entry.isFile() || !isTestFile(entry.name)) {
      continue;
    }

    const repositoryPath = toRepositoryPath(fullPath);
    if (!isAllowedScopedTestPath(repositoryPath)) {
      violations.push(repositoryPath);
    }
  }

  return violations;
}

async function checkTestLayout(): Promise<boolean> {
  const violations = (
    await Promise.all(
      testLayoutScopedDirectories.map((directory) => collectTestLayoutViolations(path.join(repoRoot, directory))),
    )
  ).flat();

  if (violations.length > 0) {
    console.error("Test files under apps/, packages/, and tools/ must live in tests/ sibling to src/:");
    for (const violation of violations) {
      console.error(`- ${violation} -> ${expectedTestPath(violation)}`);
    }
    return false;
  }

  console.log("Test layout check passed: apps/packages/tools tests live in sibling tests directories.");
  return true;
}

const e2ePackageJsonPath = path.join(repoRoot, "e2e", "package.json");
const e2eSkippedDirectories = new Set([".od-data", "node_modules", "reports", "test-results"]);
const e2eAllowedScripts = [
  "test",
  "test:p0",
  "test:p0p1",
  "test:p1",
  "test:p2",
  "test:ui",
  "test:ui:critical",
  "test:ui:extended",
  "test:ui:p0",
  "test:ui:p0p1",
  "test:ui:p1",
  "test:ui:p2",
  "typecheck",
];

async function collectRepositoryFiles(directory: string, skippedDirectoryNames = new Set<string>()): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (skippedDirectoryNames.has(entry.name)) continue;
      files.push(...(await collectRepositoryFiles(fullPath, skippedDirectoryNames)));
      continue;
    }
    if (entry.isFile()) files.push(toRepositoryPath(fullPath));
  }

  return files;
}

const productNeutralitySkippedDirectories = new Set([
  ".git",
  ".od",
  ".tmp",
  "dist",
  "node_modules",
  "out",
  "test-results",
]);
// Public contracts, help/prompt strings, docs, and shipped content should
// describe the integration role, not name a private deployment. The default
// check blocks named "orchestrator such as ..." examples; private forks can
// add stricter local terms through OD_PRODUCT_NEUTRALITY_FORBIDDEN_TERMS.
const productNeutralityCheckedPathPrefixes = [
  "apps/daemon/src/",
  "apps/web/app/",
  "apps/web/src/",
  "craft/",
  "design-systems/",
  "design-templates/",
  "docs/",
  "packages/contracts/src/",
  "skills/",
];
const productNeutralityTextExtensions = new Set([".md", ".mdx", ".ts", ".tsx"]);
const productNeutralityDocFilePattern =
  /(?:^|\/)(?:AGENTS|CLAUDE|CONTRIBUTING(?:\.[^.]+)?|QUICKSTART|README(?:\.[^.]+)?)\.md$/;
const namedOrchestratorExamplePattern =
  /\borchestrator\s+(?:such as|like|for example,?)\s+[`"']?[A-Z][A-Za-z0-9_-]+/gi;

type ProductNeutralityViolation = {
  filePath: string;
  lineNumber: number;
  reason: string;
};

export function isProductNeutralityCheckedPath(repositoryPath: string): boolean {
  return (
    productNeutralityCheckedPathPrefixes.some((prefix) => repositoryPath.startsWith(prefix)) ||
    productNeutralityDocFilePattern.test(repositoryPath)
  );
}

function isProductNeutralityTextFile(repositoryPath: string): boolean {
  return productNeutralityTextExtensions.has(path.extname(repositoryPath));
}

function productNeutralityForbiddenTerms(): string[] {
  return String(process.env.OD_PRODUCT_NEUTRALITY_FORBIDDEN_TERMS ?? "")
    .split(",")
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}

export function collectProductNeutralityViolationsFromSource(
  repositoryPath: string,
  source: string,
  forbiddenTerms = productNeutralityForbiddenTerms(),
): ProductNeutralityViolation[] {
  if (!isProductNeutralityCheckedPath(repositoryPath) || !isProductNeutralityTextFile(repositoryPath)) {
    return [];
  }

  const lowerSource = source.toLowerCase();
  const violations: ProductNeutralityViolation[] = [];

  for (const match of source.matchAll(namedOrchestratorExamplePattern)) {
    violations.push({
      filePath: repositoryPath,
      lineNumber: lineNumberForIndex(source, match.index ?? 0),
      reason: "use generic \"external orchestrator\" phrasing instead of named orchestrator examples",
    });
  }

  for (const term of forbiddenTerms) {
    const lowerTerm = term.toLowerCase();
    let index = lowerSource.indexOf(lowerTerm);

    while (index !== -1) {
      violations.push({
        filePath: repositoryPath,
        lineNumber: lineNumberForIndex(source, index),
        reason: "use generic \"external orchestrator\" phrasing instead of private deployment names",
      });
      index = lowerSource.indexOf(lowerTerm, index + lowerTerm.length);
    }
  }

  return violations;
}

async function checkProductNeutrality(): Promise<boolean> {
  const violations: ProductNeutralityViolation[] = [];

  for (const repositoryPath of await collectRepositoryFiles(repoRoot, productNeutralitySkippedDirectories)) {
    if (!isProductNeutralityCheckedPath(repositoryPath) || !isProductNeutralityTextFile(repositoryPath)) {
      continue;
    }
    const source = await readFile(path.join(repoRoot, repositoryPath), "utf8");
    violations.push(...collectProductNeutralityViolationsFromSource(repositoryPath, source));
  }

  if (violations.length > 0) {
    console.error("Product-neutrality violations found:");
    for (const violation of violations) {
      console.error(`${violation.filePath}:${violation.lineNumber} -> ${violation.reason}`);
    }
    return false;
  }

  console.log("Product-neutrality check passed: public docs, contracts, and prompts use generic orchestrator naming.");
  return true;
}

async function checkE2eLayout(): Promise<boolean> {
  const violations: string[] = [];
  const packageJson = JSON.parse(await readFile(e2ePackageJsonPath, "utf8")) as {
    scripts?: Record<string, unknown>;
  };
  const scriptNames = Object.keys(packageJson.scripts ?? {}).sort();
  if (scriptNames.join("\0") !== e2eAllowedScripts.join("\0")) {
    violations.push(
      `e2e/package.json scripts must be exactly ${e2eAllowedScripts.join(", ")} (found: ${scriptNames.join(", ")})`,
    );
  }

  const e2eRoot = path.join(repoRoot, "e2e");
  for (const repositoryPath of await collectRepositoryFiles(e2eRoot, e2eSkippedDirectories)) {
    if (
      repositoryPath === "e2e/package.json" ||
      repositoryPath === "e2e/tsconfig.json" ||
      repositoryPath === "e2e/vitest.config.ts" ||
      repositoryPath === "e2e/playwright.config.ts" ||
      repositoryPath === "e2e/playwright.visual.config.ts" ||
      repositoryPath === "e2e/AGENTS.md"
    ) {
      continue;
    }

    if (repositoryPath.startsWith("e2e/specs/")) {
      if (!/\.spec\.ts$/.test(repositoryPath)) {
        violations.push(`${repositoryPath} -> e2e specs must be *.spec.ts`);
      }
      continue;
    }

    if (repositoryPath.startsWith("e2e/tests/")) {
      if (!/\.test\.ts$/.test(repositoryPath)) {
        violations.push(`${repositoryPath} -> e2e tests must be *.test.ts`);
      }
      continue;
    }

    if (repositoryPath.startsWith("e2e/ui/")) {
      const relativePath = repositoryPath.slice("e2e/ui/".length);
      if (relativePath.includes("/") || !/\.test\.ts$/.test(repositoryPath)) {
        violations.push(`${repositoryPath} -> e2e UI files must be flat Playwright *.test.ts files under ui/`);
      }
      continue;
    }

    if (repositoryPath.startsWith("e2e/resources/")) {
      const relativePath = repositoryPath.slice("e2e/resources/".length);
      if (relativePath.includes("/") || !/\.ts$/.test(repositoryPath)) {
        violations.push(`${repositoryPath} -> e2e resources must be flat TypeScript files under resources/`);
      }
      continue;
    }

    if (repositoryPath.startsWith("e2e/lib/")) {
      if (!/\.ts$/.test(repositoryPath)) {
        violations.push(`${repositoryPath} -> e2e lib files must be TypeScript`);
      }
      continue;
    }

    if (repositoryPath.startsWith("e2e/scripts/")) {
      if (!allowedE2eScripts.has(repositoryPath)) {
        violations.push(`${repositoryPath} -> e2e scripts must be an approved package-owned entrypoint`);
      }
      continue;
    }

    violations.push(`${repositoryPath} -> e2e source files must live in specs/, tests/, ui/, resources/, lib/, or approved scripts`);
  }

  if (violations.length > 0) {
    console.error("E2E package layout violations found:");
    for (const violation of violations) console.error(`- ${violation}`);
    return false;
  }

  console.log("E2E layout check passed: Vitest, Playwright UI, resources, lib, and scripts stay in their lanes.");
  return true;
}

const webTestSkippedDirectories = new Set([".od-data", "reports", "test-results"]);

async function checkWebTestLayout(): Promise<boolean> {
  const violations: string[] = [];
  const webTestsRoot = path.join(repoRoot, "apps", "web", "tests");

  for (const repositoryPath of await collectRepositoryFiles(webTestsRoot, webTestSkippedDirectories)) {
    if (repositoryPath.startsWith("apps/web/tests/vitest/") || repositoryPath.startsWith("apps/web/tests/playwright/")) {
      violations.push(`${repositoryPath} -> web tests should stay lightweight under apps/web/tests/ without vitest/playwright nesting`);
      continue;
    }

    if (/\.(spec|test)\.tsx?$/.test(repositoryPath) && !/\.test\.tsx?$/.test(repositoryPath)) {
      violations.push(`${repositoryPath} -> web Vitest test files must be *.test.ts or *.test.tsx`);
    }
  }

  if (violations.length > 0) {
    console.error("Web test layout violations found:");
    for (const violation of violations) console.error(`- ${violation}`);
    return false;
  }

  console.log("Web test layout check passed: web tests stay lightweight and Vitest-only.");
  return true;
}

const webImportIsolationSourcePrefixes = ["apps/web/app/", "apps/web/src/"];
const webImportIsolationExtensions = new Set([".ts", ".tsx"]);
const webImportIsolationSkippedDirectories = new Set([
  ".next",
  "dist",
  "node_modules",
  "out",
  "reports",
  "test-results",
]);
const webImportIsolationForbiddenPackages = [
  "@open-design/platform",
  "@open-design/sidecar",
  "@open-design/sidecar-proto",
];
const webImportIsolationForbiddenDaemonRoots = [
  "apps/daemon/src",
  "apps/daemon/tests",
];
const webImportIsolationForbiddenPackageRoots = [
  "packages/platform",
  "packages/sidecar",
  "packages/sidecar-proto",
];

type WebImportIsolationViolation = {
  filePath: string;
  lineNumber: number;
  specifier: string;
  reason: string;
};

type SourceImportSpecifier = {
  lineNumber: number;
  specifier: string;
};

export function isWebImportIsolationSourcePath(repositoryPath: string): boolean {
  return (
    webImportIsolationSourcePrefixes.some((prefix) => repositoryPath.startsWith(prefix)) &&
    webImportIsolationExtensions.has(path.extname(repositoryPath))
  );
}

function pushStringSpecifier(
  imports: SourceImportSpecifier[],
  sourceFile: ts.SourceFile,
  node: ts.Node | undefined,
): void {
  if (!node) return;
  if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) return;

  imports.push({
    lineNumber: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    specifier: node.text,
  });
}

function collectImportSpecifiersFromSource(repositoryPath: string, source: string): SourceImportSpecifier[] {
  const sourceFile = ts.createSourceFile(
    repositoryPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    repositoryPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports: SourceImportSpecifier[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      pushStringSpecifier(imports, sourceFile, node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      pushStringSpecifier(imports, sourceFile, node.argument.literal);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      pushStringSpecifier(imports, sourceFile, node.arguments[0]);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return imports;
}

function isPackageOrSubpath(specifier: string, packageName: string): boolean {
  return specifier === packageName || specifier.startsWith(`${packageName}/`);
}

function isPathOrDescendant(repositoryPath: string, root: string): boolean {
  return repositoryPath === root || repositoryPath.startsWith(`${root}/`);
}

function resolveWebImportRepositoryPath(fromRepositoryPath: string, specifier: string): string | null {
  const pathOnly = specifier.split(/[?#]/, 1)[0];
  if (!pathOnly) return null;

  if (pathOnly.startsWith("@/")) {
    return path.posix.normalize(path.posix.join("apps/web", pathOnly.slice("@/".length)));
  }

  if (!pathOnly.startsWith(".")) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromRepositoryPath), pathOnly));
}

function webImportIsolationViolationReason(fromRepositoryPath: string, specifier: string): string | null {
  if (webImportIsolationForbiddenPackages.some((packageName) => isPackageOrSubpath(specifier, packageName))) {
    return "apps/web must not import sidecar or platform control-plane packages directly";
  }

  const resolvedPath = resolveWebImportRepositoryPath(fromRepositoryPath, specifier);
  if (!resolvedPath) return null;

  if (webImportIsolationForbiddenDaemonRoots.some((root) => isPathOrDescendant(resolvedPath, root))) {
    return "apps/web must use daemon HTTP APIs or @open-design/contracts instead of daemon private source";
  }

  if (webImportIsolationForbiddenPackageRoots.some((root) => isPathOrDescendant(resolvedPath, root))) {
    return "apps/web must not import sidecar or platform control-plane source directly";
  }

  return null;
}

export function collectWebImportIsolationViolationsFromSource(
  repositoryPath: string,
  source: string,
): WebImportIsolationViolation[] {
  if (!isWebImportIsolationSourcePath(repositoryPath)) return [];

  return collectImportSpecifiersFromSource(repositoryPath, source).flatMap((sourceImport) => {
    const reason = webImportIsolationViolationReason(repositoryPath, sourceImport.specifier);
    if (!reason) return [];
    return [{
      filePath: repositoryPath,
      lineNumber: sourceImport.lineNumber,
      specifier: sourceImport.specifier,
      reason,
    }];
  });
}

async function checkWebImportIsolation(): Promise<boolean> {
  const violations: WebImportIsolationViolation[] = [];

  for (const repositoryPrefix of webImportIsolationSourcePrefixes) {
    const repositoryDirectory = repositoryPrefix.replace(/\/$/, "");
    if (!(await repositoryDirectoryExists(repositoryDirectory))) continue;

    for (const repositoryPath of await collectRepositoryFiles(
      path.join(repoRoot, repositoryDirectory),
      webImportIsolationSkippedDirectories,
    )) {
      if (!isWebImportIsolationSourcePath(repositoryPath)) continue;
      const source = await readFile(path.join(repoRoot, repositoryPath), "utf8");
      violations.push(...collectWebImportIsolationViolationsFromSource(repositoryPath, source));
    }
  }

  if (violations.length > 0) {
    console.error("Web import isolation violations found:");
    for (const violation of violations) {
      console.error(`- ${violation.filePath}:${violation.lineNumber} \`${violation.specifier}\` -> ${violation.reason}`);
    }
    return false;
  }

  console.log("Web import isolation check passed: web runtime imports stay behind contracts and daemon HTTP APIs.");
  return true;
}

const toolsRootAllowlist = new Map<string, "directory" | "file">([
  // Keep top-level tools intentionally small. `tools/launcher` was an incoming
  // Windows shim experiment from PR #683 and is not an active repo boundary.
  ["AGENTS.md", "file"],
  ["dev", "directory"],
  ["pack", "directory"],
  ["release", "directory"],
  ["serve", "directory"],
]);

async function checkToolsLayout(): Promise<boolean> {
  const toolsRoot = path.join(repoRoot, "tools");
  const entries = await readdir(toolsRoot, { withFileTypes: true });
  const seen = new Set<string>();
  const violations: string[] = [];

  for (const entry of entries) {
    const expected = toolsRootAllowlist.get(entry.name);
    const repositoryPath = `tools/${entry.name}${entry.isDirectory() ? "/" : ""}`;

    if (expected == null) {
      violations.push(`${repositoryPath} -> tools/ top-level entries are allowlisted; expected only AGENTS.md, dev/, pack/, release/, and serve/`);
      continue;
    }

    seen.add(entry.name);
    if (expected === "directory" && !entry.isDirectory()) {
      violations.push(`${repositoryPath} -> expected tools/${entry.name}/ to be a directory`);
    }
    if (expected === "file" && !entry.isFile()) {
      violations.push(`${repositoryPath} -> expected tools/${entry.name} to be a file`);
    }
  }

  for (const [entryName, expected] of toolsRootAllowlist) {
    if (!seen.has(entryName)) {
      violations.push(`tools/${entryName}${expected === "directory" ? "/" : ""} -> required tools boundary is missing`);
    }
  }

  if (violations.length > 0) {
    console.error("Tools layout violations found:");
    for (const violation of violations) console.error(`- ${violation}`);
    return false;
  }

  console.log("Tools layout check passed: tools/ top-level entries match the active boundary allowlist.");
  return true;
}

const stylePolicySkippedDirectories = new Set([
  ".next",
  ".od-data",
  "dist",
  "node_modules",
  "out",
  "reports",
  "test-results",
]);

const stylePolicySourcePrefixes = ["apps/web/app/", "apps/web/src/"];
const stylePolicyHardcodedColorEnforcedPrefixes = ["scripts/guard-style-policy-fixtures/"];
const stylePolicyCheckedDirectoryPrefixes = [
  ...new Set([...stylePolicySourcePrefixes, ...stylePolicyHardcodedColorEnforcedPrefixes]),
];
const stylePolicyExtensions = new Set([".css", ".ts", ".tsx"]);
const tailwindDefaultColorNames = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
  "white",
  "black",
].join("|");
const tailwindDefaultPaletteClassPrefixes = [
  "bg",
  "text",
  "border(?:-(?:x|y|s|e|t|r|b|l))?",
  "divide",
  "placeholder",
  "marker",
  "from",
  "via",
  "to",
  "ring(?:-offset)?",
  "outline",
  "decoration",
  "(?:inset-|text-|drop-)?shadow",
  "accent",
  "caret",
  "fill",
  "stroke",
].join("|");
const defaultTailwindPaletteClassPattern = new RegExp(
  `\\b(?:${tailwindDefaultPaletteClassPrefixes})-(?:${tailwindDefaultColorNames})(?:-\\d{2,3})?\\b`,
  "g",
);

const hardcodedColorPattern = new RegExp(
  `#[0-9a-fA-F]{3,8}\\b|rgba?\\([^)]*\\)|hsla?\\([^)]*\\)|(?<quote>['"])\\s*(?<named>${realNamedColors.join("|")}|transparent|currentColor|currentcolor|inherit|initial|unset|revert)\\s*\\k<quote>`,
  "g",
);

type StylePolicyAllowlistEntry = {
  pathPattern: RegExp;
  valuePattern: RegExp;
  reason: string;
};

const hardcodedColorAllowlist: StylePolicyAllowlistEntry[] = [
  {
    pathPattern: /^apps\/web\/src\/index\.css$/,
    valuePattern: /^(?:#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))$/,
    reason: "global token definitions, shadows, overlays, and retained migration inventory live in the CSS source of truth",
  },
  {
    pathPattern: /^apps\/web\/src\/components\/(?:AgentIcon|PetSettings|SettingsDialog)\.tsx$/,
    valuePattern: /^(?:#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))$/,
    reason: "brand accents, user accent choices, and legacy token fallbacks are classified as Phase 1 migration inventory",
  },
  {
    pathPattern: /^apps\/web\/src\/components\/(?:SketchEditor|SketchPreview|NewProjectPanel)\.tsx$/,
    valuePattern: /^(?:#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|['\"](?:none|currentColor|currentcolor|transparent)['\"])$/,
    reason: "sketch/canvas data and SVG illustrations keep narrow hardcoded color exceptions until their migration slice",
  },
  {
    pathPattern: /^apps\/web\/src\/components\/(?:FileViewer|ManualEditPanel)\.tsx$/,
    valuePattern: /^(?:#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))$/,
    reason: "user-authored file, inspect, and editable style colors are handled by the file/viewer migration slice",
  },
  {
    pathPattern: /^apps\/web\/src\/components\/(?:MemorySection|MemoryModelInline|MemoryToast)\.tsx$/,
    valuePattern: /^(?:#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))$/,
    reason: "memory UI legacy color fallbacks are classified as Phase 1 migration inventory",
  },
  {
    pathPattern: /^apps\/web\/tests\//,
    valuePattern: /.*/,
    reason: "tests and fixtures may assert rejected colors explicitly",
  },
];

type StylePolicyViolation = {
  filePath: string;
  lineNumber: number;
  match: string;
  reason: string;
};

function lineNumberForIndex(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function isStylePolicySource(repositoryPath: string): boolean {
  return stylePolicySourcePrefixes.some((prefix) => repositoryPath.startsWith(prefix));
}

function isHardcodedColorEnforcedPath(repositoryPath: string): boolean {
  return stylePolicyHardcodedColorEnforcedPrefixes.some((prefix) => repositoryPath.startsWith(prefix));
}

function isHardcodedColorAllowlisted(repositoryPath: string, match: string): boolean {
  const normalizedMatch = match.trim();
  const unquotedMatch = normalizedMatch.replace(/^['"]|['"]$/g, "");
  if (cssWideAndSpecialColorKeywords.has(unquotedMatch.toLowerCase())) return true;

  return hardcodedColorAllowlist.some(
    (entry) => entry.pathPattern.test(repositoryPath) && entry.valuePattern.test(normalizedMatch),
  );
}

function addStylePolicyViolation(
  violations: StylePolicyViolation[],
  repositoryPath: string,
  source: string,
  index: number,
  match: string,
  reason: string,
): void {
  violations.push({
    filePath: repositoryPath,
    lineNumber: lineNumberForIndex(source, index),
    match,
    reason,
  });
}

function collectStylePolicyViolationsFromSource(repositoryPath: string, source: string): StylePolicyViolation[] {
  const violations: StylePolicyViolation[] = [];

  if (isStylePolicySource(repositoryPath)) {
    for (const match of source.matchAll(defaultTailwindPaletteClassPattern)) {
      violations.push({
        filePath: repositoryPath,
        lineNumber: lineNumberForIndex(source, match.index ?? 0),
        match: match[0],
        reason: "default Tailwind palette classes must use Open Design token utilities instead",
      });
    }
  }

  if (isStylePolicySource(repositoryPath) || isHardcodedColorEnforcedPath(repositoryPath)) {
    if (repositoryPath.endsWith(".css") && isHardcodedColorEnforcedPath(repositoryPath)) {
      for (const match of collectCssHardcodedColorMatches(source)) {
        const value = match.value;
        if (value === undefined || isHardcodedColorAllowlisted(repositoryPath, value)) continue;

        addStylePolicyViolation(
          violations,
          repositoryPath,
          source,
          match.index,
          value,
          "unregistered hardcoded UI colors must use Open Design tokens or an explicit allowlist entry",
        );
      }
    } else {
      for (const match of source.matchAll(hardcodedColorPattern)) {
        const value = match[0];
        if (isHardcodedColorAllowlisted(repositoryPath, value)) continue;
        if (!isHardcodedColorEnforcedPath(repositoryPath)) continue;

        addStylePolicyViolation(
          violations,
          repositoryPath,
          source,
          match.index ?? 0,
          value,
          "unregistered hardcoded UI colors must use Open Design tokens or an explicit allowlist entry",
        );
      }
    }
  }

  return violations;
}

async function collectStylePolicyViolations(directory: string): Promise<StylePolicyViolation[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const violations: StylePolicyViolation[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (stylePolicySkippedDirectories.has(entry.name)) continue;
      violations.push(...(await collectStylePolicyViolations(fullPath)));
      continue;
    }

    if (!entry.isFile() || !stylePolicyExtensions.has(path.extname(entry.name))) continue;

    const repositoryPath = toRepositoryPath(fullPath);
    if (!isStylePolicySource(repositoryPath) && !isHardcodedColorEnforcedPath(repositoryPath)) continue;

    violations.push(...collectStylePolicyViolationsFromSource(repositoryPath, await readFile(fullPath, "utf8")));
  }

  return violations;
}

async function repositoryDirectoryExists(repositoryPath: string): Promise<boolean> {
  const parentPath = path.join(repoRoot, path.dirname(repositoryPath));
  const directoryName = path.basename(repositoryPath);
  const entries = await readdir(parentPath, { withFileTypes: true });

  return entries.some((entry) => entry.name === directoryName && entry.isDirectory());
}

async function collectStylePolicyViolationsFromCheckedPaths(): Promise<StylePolicyViolation[]> {
  const violations: StylePolicyViolation[] = [];

  for (const repositoryPrefix of stylePolicyCheckedDirectoryPrefixes) {
    const repositoryDirectory = repositoryPrefix.replace(/\/$/, "");
    if (!(await repositoryDirectoryExists(repositoryDirectory))) continue;

    violations.push(...(await collectStylePolicyViolations(path.join(repoRoot, repositoryDirectory))));
  }

  return violations;
}

async function checkStylePolicy(): Promise<boolean> {
  const violations = await collectStylePolicyViolationsFromCheckedPaths();

  if (violations.length > 0) {
    console.error("Style policy violations found:");
    for (const violation of violations) {
      console.error(`- ${violation.filePath}:${violation.lineNumber} \`${violation.match}\` -> ${violation.reason}`);
    }
    console.error("Use Open Design token utilities/CSS variables or add a narrow allowlist entry with a reason.");
    return false;
  }

  console.log("Style policy check passed: Tailwind palette classes and enforced hardcoded UI colors stay token-first.");
  return true;
}

async function checkCiTopology(): Promise<boolean> {
  const ciWorkflow = await readFile(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  const errors = [
    ...validatePlaywrightSuiteTopology(),
    ...[
      "run: node --experimental-strip-types scripts/scopes.ts github-output",
      "ci_mode: ${{ steps.detect.outputs.ci_mode }}",
      "ui_p0_validation_required: ${{ steps.detect.outputs.ui_p0_validation_required }}",
      "run_ui_p0: ${{ steps.detect.outputs.run_ui_p0 }}",
      "ui_p0_matrix: ${{ steps.detect.outputs.ui_p0_matrix }}",
      "visual_matrix: ${{ steps.detect.outputs.visual_matrix }}",
      "include: ${{ fromJSON(needs.scopes.outputs.ui_p0_matrix) }}",
      "include: ${{ fromJSON(needs.scopes.outputs.visual_matrix) }}",
      "needs.scopes.outputs.run_ui_p0 == 'true'",
      "pnpm -C e2e exec tsx scripts/playwright.ts run-ui-group critical-extras",
      "pnpm -C e2e exec tsx scripts/playwright.ts run-ui-group ${{ matrix.shard }}",
    ]
      .filter((needle) => !ciWorkflow.includes(needle))
      .map((needle) => `.github/workflows/ci.yml is missing ${needle}`),
  ];

  if (errors.length > 0) {
    console.error("CI topology check failed:");
    for (const error of errors) console.error(`- ${error}`);
    return false;
  }

  console.log("CI topology check passed: scopes, Playwright suites, and workflow matrices stay aligned.");
  return true;
}

// Workflows this fork deliberately removed (2026-07-24). They are upstream's
// community management, release/backport process, distribution channels, and the
// preview-bake pipeline that publishes to a bucket we cannot write to. Keeping
// them cost Actions minutes and, in the bake case, would have re-published the
// stale manifest we emptied on purpose.
//
// This check exists because the only upstream lane is `git cherry-pick`: a pick
// that touches one of these paths can silently resurrect the file, and a revived
// scheduled workflow would then run unattended. Failing `pnpm guard` is a much
// better outcome than discovering a Discord bot firing at 3am.
//
// Deliberately NOT listed: fork-pr-workflow-approval.yml. It was also removed,
// but it is a genuine security boundary for fork PRs, so restoring it must stay
// easy if this repo is ever made public. See docs/FORK-PIN.md.
const REMOVED_WORKFLOWS = [
  "agent-pr-explore-sandbox.yml",
  "agent-pr-explore.lock.yml",
  "backport-automerge.yml",
  "backport-label-guard.yml",
  "backport.yml",
  "bake-plugin-previews-automerge.yml",
  "bake-plugin-previews-gc.yml",
  "bake-plugin-previews-pr.yml",
  "bake-plugin-previews-release.yml",
  "bake-plugin-previews.yml",
  "contributor-card-bot.yml",
  "critique-conformance.yml",
  "discord-resolved.yml",
  "docker-image.yml",
  "e2e-coverage-reminder.yml",
  "metrics.yml",
  "nix.yml",
  "pr-author-inactivity.yml",
  "refresh-contributors-wall.yml",
  "refresh-plugin-popularity.yml",
  "release-branch-direct-pr-guard.yml",
  "release-gate.yml",
  "stale-issues.yml",
  "ui-extended-main.yml",
  "visual-baseline.yml",
] as const;

async function checkRemovedWorkflows(): Promise<boolean> {
  const present = new Set(await readdir(path.join(repoRoot, ".github/workflows")));
  const revived = REMOVED_WORKFLOWS.filter((name) => present.has(name));

  if (revived.length > 0) {
    console.error("Removed-workflow check failed: these were deleted on purpose and are back:");
    for (const name of revived) console.error(`- .github/workflows/${name}`);
    console.error(
      "A cherry-pick likely reintroduced them. Delete again, or update REMOVED_WORKFLOWS in scripts/guard.ts if the fork now wants one.",
    );
    return false;
  }

  console.log(
    `Removed-workflow check passed: all ${REMOVED_WORKFLOWS.length} deliberately-removed workflows stay removed.`,
  );
  return true;
}

// ---------------------------------------------------------------------------
// Capability manifest / CLI parity (C0-11)
//
// scripts/waves/capability-manifest.json documents, per SUBCOMMAND_MAP
// capability, a representative UI entry point, CLI invocation, HTTP
// endpoint, and a `knownNamespaceRoutes` snapshot: every `/api/<namespace>/...`
// route reachable through a static fetch() call in apps/daemon/src/cli.ts
// whose namespace (first path segment after `/api/`) matches the manifest
// row's own httpPath namespace. Per the 2026-07-27 W0 gate-adjudication
// ruling (docs/plans/waves/DECISIONS.md), this check is a deterministic,
// static, same-tree-in/same-verdict-out comparison against that committed
// snapshot -- it deliberately does NOT run the random live-sample value
// probe or require raw payload byte-equality (that design was ruled a gate
// defect and is being replaced separately, outside this check). This check
// never boots a daemon and never makes a network call.
//
// It validates four things:
//   (a) shape        -- every manifest row has the required fields, with the
//                        required types.
//   (b) CLI parity    -- the manifest's capability set is exactly the
//                        SUBCOMMAND_MAP key set (both-direction deltas named).
//   (c) route parity  -- every route cli.ts's static fetch() scan finds,
//                        grouped by namespace, is a subset of the committed
//                        knownNamespaceRoutes for that namespace (a route in
//                        a namespace the manifest doesn't cover at all, or a
//                        new route inside an already-covered namespace,
//                        fails by name).
//   (d) new-file drift -- (c) only sees routes cli.ts itself reaches, so a
//                        route registered directly in apps/daemon/src/routes/
//                        with no CLI caller yet is invisible to it. Every
//                        untracked (`git status --porcelain`-new) .ts file
//                        under apps/daemon/src/routes/ is statically scanned
//                        for app.<method>('/api/...', ...) registrations and
//                        checked against the same knownNamespaceRoutes
//                        baseline as (c). Deliberately scoped to brand-new
//                        files only -- retroactively requiring manifest
//                        coverage for the many pre-existing, legitimately
//                        CLI-exempt web-UI-only routes already committed
//                        under apps/daemon/src/routes/ is out of scope here
//                        and would be a large, unrelated blast radius.
// ---------------------------------------------------------------------------

const capabilityManifestPath = path.join(repoRoot, "scripts/waves/capability-manifest.json");
const capabilityManifestCliSourcePath = path.join(repoRoot, "apps/daemon/src/cli.ts");

type CapabilityManifestValueComparison = {
  mode: "exact" | "unordered-array" | "composite" | "binary";
  sortKey?: string;
  fields?: string[];
  encoding?: "base64" | "hex";
};

type CapabilityManifestRow = {
  capability: string;
  uiEntryPoint: string;
  cliArgs: string[];
  httpMethod: string;
  httpPath: string;
  outputSchema: string;
  parityApplicable: boolean;
  reason?: string;
  knownNamespaceRoutes: string[];
  probeMethod?: string;
  probePath?: string;
  probeBody?: unknown;
  valueComparison?: CapabilityManifestValueComparison;
};

const CAPABILITY_MANIFEST_REQUIRED_STRING_FIELDS = [
  "capability",
  "uiEntryPoint",
  "httpMethod",
  "httpPath",
  "outputSchema",
] as const;

const CAPABILITY_MANIFEST_VALID_HTTP_METHODS = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|ALL)$/;
const CAPABILITY_MANIFEST_VALID_CONCRETE_METHODS = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS)$/;
const CAPABILITY_MANIFEST_VALID_VALUE_COMPARISON_MODES = ["exact", "unordered-array", "composite", "binary"];
const isCapabilityManifestBodyBearingMethod = (method: string): boolean =>
  method === "POST" || method === "PUT" || method === "PATCH";

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Validates a single capability-manifest row's shape. Returns a (possibly
 * empty) list of human-readable violations; never throws, so a malformed
 * tree still gets a complete report instead of stopping at the first bad
 * row.
 */
function validateCapabilityManifestRowShape(row: unknown, index: number): string[] {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    return [`capability-manifest.json[${index}] must be a JSON object (found ${Array.isArray(row) ? "array" : typeof row})`];
  }

  const record = row as Record<string, unknown>;
  const capabilityName = typeof record.capability === "string" && record.capability !== "" ? record.capability : undefined;
  const label = (field: string) =>
    `capability-manifest.json[${index}]${capabilityName ? ` (capability: "${capabilityName}")` : ""}.${field}`;

  const violations: string[] = [];
  for (const field of CAPABILITY_MANIFEST_REQUIRED_STRING_FIELDS) {
    if (typeof record[field] !== "string" || record[field] === "") {
      violations.push(`${label(field)} must be a non-empty string`);
    }
  }
  if (!isStringArray(record.cliArgs) || record.cliArgs.length === 0) {
    violations.push(`${label("cliArgs")} must be a non-empty string array`);
  }
  if (typeof record.parityApplicable !== "boolean") {
    violations.push(`${label("parityApplicable")} must be a boolean`);
  }
  if (record.reason !== undefined && typeof record.reason !== "string") {
    violations.push(`${label("reason")} must be a string when present`);
  }
  if (!isStringArray(record.knownNamespaceRoutes)) {
    violations.push(`${label("knownNamespaceRoutes")} must be a string array`);
  }
  if (typeof record.httpMethod === "string" && !CAPABILITY_MANIFEST_VALID_HTTP_METHODS.test(record.httpMethod)) {
    violations.push(`${label("httpMethod")} must be one of GET|POST|PUT|PATCH|DELETE|OPTIONS|ALL`);
  }

  // C0-10 live-probe declarations (2026-07-27 gate amendment): a "ALL"
  // httpMethod (an Express .all() registration) cannot itself be sent as an
  // HTTP request method, so it structurally requires a concrete probeMethod
  // AND a concrete probePath to be live-probed at all.
  const isAllMethod = record.httpMethod === "ALL";
  const hasConcreteProbeMethod = typeof record.probeMethod === "string" && CAPABILITY_MANIFEST_VALID_CONCRETE_METHODS.test(record.probeMethod);
  if (isAllMethod && !hasConcreteProbeMethod) {
    violations.push(`${label("probeMethod")} is required (GET|POST|PUT|PATCH|DELETE|OPTIONS) when httpMethod is "ALL"`);
  }
  if (isAllMethod && !(typeof record.probePath === "string" && record.probePath.startsWith("/"))) {
    violations.push(`${label("probePath")} is required (starting with "/") when httpMethod is "ALL"`);
  }
  if (record.probeMethod !== undefined && !(typeof record.probeMethod === "string" && CAPABILITY_MANIFEST_VALID_CONCRETE_METHODS.test(record.probeMethod))) {
    violations.push(`${label("probeMethod")} must be a concrete HTTP method (GET|POST|PUT|PATCH|DELETE|OPTIONS) when present`);
  }
  if (record.probePath !== undefined && !(typeof record.probePath === "string" && record.probePath.startsWith("/"))) {
    violations.push(`${label("probePath")} must start with "/" when present`);
  }

  // A body-bearing effective method (POST/PUT/PATCH directly, or ALL whose
  // declared probeMethod is body-bearing) requires a declared probeBody for
  // live probing -- mirrors verify-w0.ts's own C0-10 shape validation so a
  // missing declaration is caught by `pnpm guard` before a full gate run.
  const effectiveMethodForBodyCheck = isAllMethod
    ? (typeof record.probeMethod === "string" ? record.probeMethod : undefined)
    : (typeof record.httpMethod === "string" ? record.httpMethod : undefined);
  if (
    typeof effectiveMethodForBodyCheck === "string" &&
    isCapabilityManifestBodyBearingMethod(effectiveMethodForBodyCheck) &&
    record.probeBody === undefined
  ) {
    violations.push(`${label("probeBody")} is required for a body-bearing method (${effectiveMethodForBodyCheck})`);
  }

  if (record.valueComparison !== undefined) {
    if (!isRecord(record.valueComparison)) {
      violations.push(`${label("valueComparison")} must be an object when present`);
    } else {
      const vc = record.valueComparison;
      if (typeof vc.mode !== "string" || !CAPABILITY_MANIFEST_VALID_VALUE_COMPARISON_MODES.includes(vc.mode)) {
        violations.push(`${label("valueComparison.mode")} must be one of ${CAPABILITY_MANIFEST_VALID_VALUE_COMPARISON_MODES.join("|")}`);
      }
      if (vc.mode === "composite" && (!Array.isArray(vc.fields) || vc.fields.length === 0 || !vc.fields.every((f) => typeof f === "string"))) {
        violations.push(`${label("valueComparison.fields")} must be a non-empty string array when mode is "composite"`);
      }
      if (vc.sortKey !== undefined && typeof vc.sortKey !== "string") {
        violations.push(`${label("valueComparison.sortKey")} must be a string when present`);
      }
      if (vc.encoding !== undefined && vc.encoding !== "base64" && vc.encoding !== "hex") {
        violations.push(`${label("valueComparison.encoding")} must be "base64" or "hex" when present`);
      }
    }
  }

  return violations;
}

/**
 * Parses `const SUBCOMMAND_MAP = { ... }` out of apps/daemon/src/cli.ts and
 * returns its property-name keys (sorted). Only ever reads keys -- it does
 * not evaluate the object -- so it works without importing daemon runtime
 * code into the guard process. Throws if the declaration can't be found,
 * since that means the extraction's structural assumption no longer holds.
 */
function extractSubcommandMapKeysFromCliSource(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    capabilityManifestCliSourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let objectLiteral: ts.ObjectLiteralExpression | undefined;

  const visit = (node: ts.Node): void => {
    if (objectLiteral) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "SUBCOMMAND_MAP" &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      objectLiteral = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (!objectLiteral) {
    throw new Error(`could not find "const SUBCOMMAND_MAP = { ... }" in ${toRepositoryPath(capabilityManifestCliSourcePath)}`);
  }

  const keys: string[] = [];
  for (const prop of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue;
    if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) keys.push(prop.name.text);
  }
  return keys.sort();
}

/**
 * Flattens a fetch() URL argument (string literal, template literal, or a
 * `+`-concatenation of literals and expressions) into a single string.
 * Every non-literal interpolation (`${...}`) becomes the literal marker
 * " PARAM " -- stable, and never collides with real path text since no
 * daemon route segment contains a space.
 */
function flattenFetchCallArgText(node: ts.Expression): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) out += ` PARAM ${span.literal.text}`;
    return out;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return flattenFetchCallArgText(node.left) + flattenFetchCallArgText(node.right);
  }
  if (ts.isParenthesizedExpression(node)) return flattenFetchCallArgText(node.expression);
  return " PARAM ";
}

/**
 * Normalizes flattened fetch() URL text into a `/api/...` path with every
 * interpolated segment collapsed to `:param`, dropping any query string.
 * Returns null when the flattened text has no `/api/` substring at all
 * (fetch calls to non-API URLs are not daemon routes and are out of scope).
 */
function normalizeApiPathFromFlatText(flatText: string): string | null {
  const apiIndex = flatText.indexOf("/api/");
  if (apiIndex === -1) return null;
  let rest = flatText.slice(apiIndex);
  const queryIndex = rest.indexOf("?");
  if (queryIndex !== -1) rest = rest.slice(0, queryIndex);
  return rest.split(" PARAM ").join(":param");
}

function fetchCallMethod(args: readonly ts.Expression[]): string {
  const opts = args[1];
  if (args.length < 2 || !opts || !ts.isObjectLiteralExpression(opts)) return "GET";
  for (const prop of opts.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === "method") {
      return ts.isStringLiteral(prop.initializer) ? prop.initializer.text.toUpperCase() : "DYNAMIC";
    }
  }
  return "GET";
}

function apiNamespaceFromPath(apiPath: string): string | null {
  const match = /^\/api\/([^/]+)/.exec(apiPath);
  return match?.[1] ?? null;
}

/**
 * Statically scans a source file's fetch() calls for `/api/...` URLs and
 * groups them by namespace (the path segment right after `/api/`) into
 * `"METHOD /api/normalized/path"` strings. This is the same algorithm used
 * to seed each manifest row's committed `knownNamespaceRoutes` snapshot, so
 * re-running it live and diffing against that snapshot is a
 * same-tree-in/same-verdict-out check: both sides are normalized into sets,
 * so there is no ordering sensitivity.
 */
function extractCliApiRoutesByNamespace(source: string): Map<string, Set<string>> {
  const sourceFile = ts.createSourceFile(
    capabilityManifestCliSourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const byNamespace = new Map<string, Set<string>>();

  const visit = (node: ts.Node): void => {
    const firstArg = ts.isCallExpression(node) ? node.arguments[0] : undefined;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "fetch" &&
      firstArg
    ) {
      const flat = flattenFetchCallArgText(firstArg);
      const normalized = normalizeApiPathFromFlatText(flat);
      const namespace = normalized ? apiNamespaceFromPath(normalized) : null;
      if (normalized && namespace) {
        const method = fetchCallMethod(node.arguments);
        if (!byNamespace.has(namespace)) byNamespace.set(namespace, new Set());
        byNamespace.get(namespace)!.add(`${method} ${normalized}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return byNamespace;
}

const EXPRESS_ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "all"]);

/**
 * Statically scans a route-registration file for `app.<method>('/api/...', ...)`
 * Express calls (the convention every apps/daemon/src/routes/**\/*.ts file
 * uses -- see each file's `register*Routes(app: Express, ...)` export) and
 * returns each as a normalized `{ method, path }` pair (`:param`-normalized,
 * matching extractCliApiRoutesByNamespace's convention so the two are
 * directly comparable). Used only for NEW, untracked route files -- see
 * listNewRouteFiles below -- never the whole committed tree.
 */
function extractExpressRouteRegistrations(source: string, filePath: string): { method: string; path: string }[] {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: { method: string; path: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "app" &&
      EXPRESS_ROUTE_METHODS.has(node.expression.name.text)
    ) {
      const firstArg = node.arguments[0];
      if (firstArg && ts.isStringLiteral(firstArg) && firstArg.text.startsWith("/api/")) {
        found.push({
          method: node.expression.name.text.toUpperCase(),
          path: firstArg.text.replace(/:[a-zA-Z0-9_]+/g, ":param"),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * Lists .ts route files under apps/daemon/src/routes/ that `git status`
 * reports as untracked or newly staged-but-uncommitted (never a modified
 * pre-existing file -- see checkCapabilityManifestParityCore's "(d)" comment
 * for why this check is deliberately scoped to brand-new files only).
 */
function listNewRouteFiles(): string[] {
  let porcelain: string;
  try {
    porcelain = execFileSync("git", ["status", "--porcelain", "--", "apps/daemon/src/routes"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const line of porcelain.split("\n")) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2);
    const relPath = line.slice(3).trim();
    const isNew = status.includes("?") || status.startsWith("A");
    if (isNew && relPath.endsWith(".ts") && !relPath.endsWith(".test.ts")) {
      files.push(relPath);
    }
  }
  return files;
}

type CapabilityManifestParityResult = {
  ok: boolean;
  errors: string[];
};

/**
 * Pure core of the capability-manifest / CLI parity check: takes the parsed
 * manifest JSON, the live SUBCOMMAND_MAP key set, and the live
 * namespace -> route-set map (all produced by static analysis, no I/O
 * inside this function), and returns every violation found. Kept separate
 * from the async wrapper below so it is unit-testable without touching the
 * filesystem or re-parsing TypeScript.
 */
function checkCapabilityManifestParityCore(
  manifestRaw: unknown,
  subcommandKeys: readonly string[],
  liveNamespaceRoutes: ReadonlyMap<string, ReadonlySet<string>>,
  newRouteFileRegistrations: readonly { file: string; method: string; path: string }[] = [],
): CapabilityManifestParityResult {
  const errors: string[] = [];

  if (!Array.isArray(manifestRaw)) {
    return { ok: false, errors: ["capability-manifest.json must be a top-level JSON array"] };
  }

  // (a) shape
  const rows: CapabilityManifestRow[] = [];
  manifestRaw.forEach((row, index) => {
    const violations = validateCapabilityManifestRowShape(row, index);
    if (violations.length > 0) {
      errors.push(...violations);
    } else {
      rows.push(row as CapabilityManifestRow);
    }
  });

  // (b) CLI-set parity -- only over rows that passed shape validation (a
  // row with an unusable `capability` field already failed shape
  // validation above and would otherwise show up as a spurious delta too).
  const manifestCapabilities = new Set(rows.map((row) => row.capability));
  const cliCapabilities = new Set(subcommandKeys);

  const missingFromManifest = [...cliCapabilities].filter((key) => !manifestCapabilities.has(key)).sort();
  const missingFromCli = [...manifestCapabilities].filter((key) => !cliCapabilities.has(key)).sort();

  if (missingFromManifest.length > 0) {
    errors.push(
      `capability-manifest.json is missing a row for SUBCOMMAND_MAP capabilities: ${missingFromManifest.join(", ")}`,
    );
  }
  if (missingFromCli.length > 0) {
    errors.push(
      `capability-manifest.json has rows for capabilities no longer in SUBCOMMAND_MAP: ${missingFromCli.join(", ")}`,
    );
  }

  // (c) attributable unmanifested route detection -- only over rows that
  // passed shape validation. The baseline is keyed by each committed
  // route's OWN namespace (not the hosting row's httpPath namespace):
  // a capability's cli.ts code frequently reaches multiple namespaces (e.g.
  // "plugin" also calls /api/applied-plugins/...), and documenting those
  // extra routes on the capability row that actually owns the call site is
  // more honest than forcing a namespace to only ever be covered by a row
  // whose own representative httpPath happens to share it.
  const manifestNamespaceBaseline = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const route of row.knownNamespaceRoutes) {
      const routePath = route.slice(route.indexOf(" ") + 1);
      const namespace = apiNamespaceFromPath(routePath);
      if (!namespace) continue;
      if (!manifestNamespaceBaseline.has(namespace)) manifestNamespaceBaseline.set(namespace, new Set());
      manifestNamespaceBaseline.get(namespace)?.add(route);
    }
  }

  const unmanifested: string[] = [];
  for (const [namespace, liveRoutes] of liveNamespaceRoutes) {
    const baseline = manifestNamespaceBaseline.get(namespace);
    for (const route of liveRoutes) {
      if (!baseline || !baseline.has(route)) {
        unmanifested.push(
          baseline
            ? `${route} (namespace "${namespace}" is manifested, but this route is not in its committed knownNamespaceRoutes)`
            : `${route} (namespace "${namespace}" has no capability-manifest.json row at all)`,
        );
      }
    }
  }
  if (unmanifested.length > 0) {
    errors.push(
      `apps/daemon/src/cli.ts reaches ${unmanifested.length} route(s) not covered by any committed capability-manifest.json knownNamespaceRoutes snapshot:\n  - ${unmanifested.sort().join("\n  - ")}`,
    );
  }

  // (d) new-route-file source-surface drift -- (c) above only sees routes
  // apps/daemon/src/cli.ts itself calls, so a route registered directly in
  // apps/daemon/src/routes/ with no CLI caller (a web-UI-only endpoint, or a
  // genuinely new capability whose CLI wiring hasn't landed yet) is
  // invisible to it. Retroactively requiring every SUCH existing route to
  // carry manifest coverage would be a huge, unrelated blast radius (most
  // web-UI-only routes were never meant to be CLI capabilities), so this
  // check is scoped to UNTRACKED route files only -- `newRouteFileRegistrations`
  // is pre-filtered by the async wrapper to `git status --porcelain`-reported
  // new files, never the full committed tree. This is exactly the
  // "real, unmanifested route registration" source-level drift the doc
  // comment above describes: catches a brand-new route surface as it is
  // being introduced, without an ever-growing baseline of pre-existing,
  // legitimately-uncovered routes.
  const newFileUnmanifested: string[] = [];
  for (const reg of newRouteFileRegistrations) {
    const key = `${reg.method} ${reg.path}`;
    const namespace = apiNamespaceFromPath(reg.path);
    const baseline = namespace ? manifestNamespaceBaseline.get(namespace) : undefined;
    if (!baseline || !baseline.has(key)) {
      newFileUnmanifested.push(
        `${key} (new file ${reg.file}${namespace && baseline ? `, namespace "${namespace}" is manifested but this route is not in its committed knownNamespaceRoutes` : namespace ? `, namespace "${namespace}" has no capability-manifest.json row at all` : ", route has no /api/ namespace"})`,
      );
    }
  }
  if (newFileUnmanifested.length > 0) {
    errors.push(
      `${newFileUnmanifested.length} new, untracked route registration(s) under apps/daemon/src/routes/ are not covered by any committed capability-manifest.json knownNamespaceRoutes snapshot:\n  - ${newFileUnmanifested.sort().join("\n  - ")}`,
    );
  }

  return { ok: errors.length === 0, errors };
}

async function checkCapabilityManifestParity(): Promise<boolean> {
  const [manifestSource, cliSource] = await Promise.all([
    readFile(capabilityManifestPath, "utf8"),
    readFile(capabilityManifestCliSourcePath, "utf8"),
  ]);

  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(manifestSource);
  } catch (error) {
    const message = `Capability manifest parity check failed: ${toRepositoryPath(capabilityManifestPath)} is not valid JSON.`;
    console.error(message);
    console.error(error);
    console.log(message);
    console.log(String(error));
    return false;
  }

  const subcommandKeys = extractSubcommandMapKeysFromCliSource(cliSource);
  const liveNamespaceRoutes = extractCliApiRoutesByNamespace(cliSource);

  const newRouteFiles = listNewRouteFiles();
  const newRouteFileRegistrations: { file: string; method: string; path: string }[] = [];
  for (const relPath of newRouteFiles) {
    const absPath = path.join(repoRoot, relPath);
    let source: string;
    try {
      source = await readFile(absPath, "utf8");
    } catch {
      continue; // deleted between `git status` and the read -- nothing to scan
    }
    for (const reg of extractExpressRouteRegistrations(source, absPath)) {
      newRouteFileRegistrations.push({ file: relPath, ...reg });
    }
  }

  const result = checkCapabilityManifestParityCore(manifestRaw, subcommandKeys, liveNamespaceRoutes, newRouteFileRegistrations);

  if (!result.ok) {
    // Mirrored to stdout (not just stderr, the usual convention for guard
    // check failures in this file): tooling that captures a subprocess by
    // its stdout only -- e.g. the W0 wave gate's guard-defeat fixtures,
    // which mutate a real manifest row and assert the failure output names
    // the specific capability/route it broke -- would otherwise see no
    // attribution at all for this check, since Node's execFileSync-style
    // helpers commonly read back only the captured stdout on a non-zero
    // exit. The per-line detail is real either way; this only changes which
    // stream(s) carry it.
    console.error("Capability manifest parity check failed:");
    for (const error of result.errors) console.error(`- ${error}`);
    console.log("Capability manifest parity check failed:");
    for (const error of result.errors) console.log(`- ${error}`);
    return false;
  }

  console.log(
    `Capability manifest parity check passed: ${subcommandKeys.length} SUBCOMMAND_MAP capabilities match capability-manifest.json 1:1, and every cli.ts-reachable /api/ route stays inside its committed knownNamespaceRoutes snapshot.`,
  );
  return true;
}

const checks: GuardCheck[] = [
  { name: "residual JavaScript", run: checkResidualJavaScript },
  { name: "package dependency specs", run: checkPackageDependencySpecs },
  { name: "product neutrality", run: checkProductNeutrality },
  { name: "cross-app imports", run: checkCrossAppImports },
  { name: "@ts-nocheck import resolution", run: checkTsNocheckImports },
  { name: "test layout", run: checkTestLayout },
  { name: "e2e layout", run: checkE2eLayout },
  { name: "web test layout", run: checkWebTestLayout },
  { name: "web import isolation", run: checkWebImportIsolation },
  { name: "tools layout", run: checkToolsLayout },
  { name: "style policy", run: checkStylePolicy },
  { name: "CI topology", run: checkCiTopology },
  { name: "removed workflows", run: checkRemovedWorkflows },
  { name: "craft references", run: checkCraftReferences },
  { name: "plugin preview manifest", run: checkPluginPreviewManifest },
  { name: "design system manifests", run: checkDesignSystemManifests },
  { name: "design system package quality", run: checkDesignSystemPackageQuality },
  { name: "design system component fixture report", run: checkDesignSystemComponentFixtureReport },
  { name: "design system token-fixture sync", run: checkDesignSystemTokenFixtureSync },
  { name: "design system A1 required tokens", run: checkDesignSystemA1RequiredTokens },
  { name: "design system A2 required tokens", run: checkDesignSystemA2RequiredTokens },
  { name: "design system B-slot required tokens", run: checkDesignSystemBSlotRequiredTokens },
  { name: "design system unknown token allowlist", run: checkDesignSystemUnknownTokens },
  { name: "design system A2 defaults parity", run: checkDesignSystemA2DefaultsParity },
  { name: "design system flag parity", run: checkDesignSystemFlagParity },
  { name: "design system component manifest extraction", run: checkComponentsManifestExtraction },
  { name: "capability manifest parity", run: checkCapabilityManifestParity },
  { name: "daemon filesystem writes", run: checkDaemonFilesystemWrites },
  { name: "brand surfaces", run: checkBrandSurfaces },
  { name: "fork repo links", run: checkForkRepoLinks },
];

async function runChecks(): Promise<boolean> {
  const results: boolean[] = [];
  for (const check of checks) {
    try {
      results.push(await check.run());
    } catch (error) {
      console.error(`Guard check failed unexpectedly: ${check.name}`);
      console.error(error);
      results.push(false);
    }
  }

  return results.every(Boolean);
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain && !(await runChecks())) {
  process.exitCode = 1;
}
