// L3 deterministic gate runner + cascade classification (WR wave, P2
// tranche -- plan docs/plans/2026-08-05-model-routing-system.md §3.2 L3).
//
// Two gate classes (plan §3.2 L3, resolves Grok F9/F13, Sol #12):
//   - DETERMINISTIC (cascade triggers): TS compile, ESLint, design.md lint,
//     tokens-schema, link/form smoke, axe accessibility, Lighthouse CI
//     budgets, screenshot SSIM vs per-build baselines, Supabase migration
//     dry-run for app builds. `runGates` executes these; a FAIL feeds
//     `classifyCascadeTrigger`'s cheap->mid->frontier escalation ladder.
//   - STOCHASTIC (advisory ship-report): vision-model DESIGN.md conformance,
//     review-panel prose findings. DEFINITIONS ONLY below -- no `run()` at
//     all, by construction: this module never executes a stochastic gate,
//     so there is no code path that could accidentally treat one as a
//     cascade trigger. `classifyCascadeTrigger` additionally enforces this
//     at RUNTIME (not just via the type system) by throwing on any gate
//     result whose `class !== 'deterministic'`, per this task's brief.
//
// Discipline (WR t8, mirrors admission.ts/reliability.ts's own scope
// notes): deterministic gates only; no vision-model calls anywhere in this
// file; no craft gates (plan §4b.5 is P2.5 scope, explicitly out of this
// wave's contract per WR-routing.md's "Explicitly out of scope"); no
// dispatch wiring -- `classifyCascadeTrigger`'s output is read by a FUTURE
// tranche's dispatch loop (t9), never called from here.
//
// "Unavailable" over reimplementation (this task's brief, restated because
// it is the single rule most of this file's branches exist to honor): a
// gate whose underlying tool is not installed/configured in this workspace
// reports `'unavailable'` with evidence explaining why, NEVER a silent or
// fabricated `'pass'`. Verified per tool at the time this tranche was
// written (grep across the repo's package.json files): ESLint is not a
// dependency anywhere in this monorepo (this repo's own static checks run
// through `scripts/guard.ts` instead); `@google/design.md` and `@lhci/cli`
// are not dependencies either. `axe-core` + `playwright` ARE real
// `apps/daemon` dependencies (reused below via the daemon's own EXISTING
// harness, `apps/daemon/src/plugins/atoms/a11y-audit-playwright.ts` --
// genuine reuse, not a second axe integration). `sharp` is a real
// `apps/daemon` dependency, reused for the screenshot-SSIM gate's pixel
// comparison (see that gate's own doc comment for why this is a documented
// SSIM PROXY, not a claim of implementing the real windowed-SSIM
// algorithm). `typescript` is a real repo devDependency, reused directly
// (no `npx`, no network) for the TS-compile gate.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type Database from 'better-sqlite3';
import sharp from 'sharp';
import {
  getAllSchemaNames,
  getRequiredA1Names,
  getRequiredA2Names,
  type RoutingGateOutcome,
} from '@open-design/contracts';
import { playwrightAxeAnalyzer } from '../plugins/atoms/a11y-audit-playwright.js';
import { updateGateOutcomes } from './telemetry.js';

const require_ = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Gate identity + result types
// ---------------------------------------------------------------------------

export type DeterministicGateId =
  | 'ts-compile'
  | 'eslint'
  | 'design-md-lint'
  | 'tokens-schema'
  | 'link-smoke'
  | 'form-smoke'
  | 'axe'
  | 'lighthouse-ci'
  | 'screenshot-ssim'
  | 'supabase-migration-dry-run';

/** plan §3.2 L3: advisory ship-report gates -- never cascade triggers. No
 * `run()` exists for these anywhere in this module (see this file's own
 * header comment). */
export type StochasticGateId = 'vision-conformance' | 'review-panel-prose';

export type GateId = DeterministicGateId | StochasticGateId;

export type GateClass = 'deterministic' | 'stochastic';

/**
 * `'unavailable'` (tool not installed/configured -- never a fake pass) and
 * `'skipped-not-applicable'` (the gate genuinely does not apply to this
 * artifact, e.g. no TS files to type-check) are distinct typed statuses,
 * per this task's brief -- neither is a `'pass'`, and `classifyCascadeTrigger`
 * treats both identically as "never trigger escalation" while still
 * recording them honestly (see `RoutingGateOutcome`'s own doc comment in
 * packages/contracts/src/api/routing-telemetry.ts, which this type is a
 * strict subset of).
 */
export type GateExecutionStatus = 'pass' | 'fail' | 'unavailable' | 'skipped-not-applicable';

interface GateResultBase {
  evidence: string[];
  durationMs: number;
  status: GateExecutionStatus;
}

export interface DeterministicGateResult extends GateResultBase {
  id: DeterministicGateId;
  class: 'deterministic';
}

export interface StochasticGateResult extends GateResultBase {
  id: StochasticGateId;
  class: 'stochastic';
}

export type GateResult = DeterministicGateResult | StochasticGateResult;

/** Context every deterministic gate's `run()` receives. `db`/`ssim` are
 * optional (mirrors admission.ts's "arrives as a plain argument" style):
 * most gates never touch either; only `screenshot-ssim` needs both. */
export interface GateContext {
  artifactDir: string;
  buildId: string | null;
  db?: Database.Database;
  ssim?: {
    /** Absolute path to THIS render's screenshot. */
    screenshotPath: string;
    /** Current token-freeze version (plan §3.3) -- see `baselineState`'s
     * own doc comment for the freeze-revision invalidation this drives. */
    tokenFreezeVersion?: string;
    /** Overrides `DEFAULT_SSIM_FLOOR` for this comparison. */
    floorOverride?: number;
  };
  timeoutMs: number;
}

export interface DeterministicGateDefinition {
  id: DeterministicGateId;
  class: 'deterministic';
  label: string;
  description: string;
  run: (ctx: GateContext) => Promise<DeterministicGateResult>;
}

/** Stochastic gates are DEFINITIONS ONLY -- advisory, never executed by
 * `runGates` (there is nothing to run here by construction: no `run` field
 * exists on this shape at all). A future ship-report surface (out of this
 * tranche's scope) is what would eventually invoke a vision model / review
 * panel and attach its findings as prose, never as a `GateResult`. */
export interface StochasticGateDefinition {
  id: StochasticGateId;
  class: 'stochastic';
  label: string;
  description: string;
}

export type GateDefinition = DeterministicGateDefinition | StochasticGateDefinition;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GateRunnerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GateRunnerInputError';
  }
}

export class GateSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GateSelectionError';
  }
}

/** Thrown by `classifyCascadeTrigger` on a runtime (not just type-level)
 * violation of "only deterministic results may feed the escalation
 * decision." */
export class GateClassificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GateClassificationError';
  }
}

export class SsimLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsimLifecycleError';
  }
}

// ---------------------------------------------------------------------------
// Small internal helpers
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function finishDeterministic(
  id: DeterministicGateId,
  status: GateExecutionStatus,
  evidence: string[],
  startedAtMs: number,
): DeterministicGateResult {
  return { id, class: 'deterministic', status, evidence, durationMs: Math.max(0, Math.round(performance.now() - startedAtMs)) };
}

const DEFAULT_MAX_WALK_FILES = 5000;
const SKIPPED_WALK_DIR_NAMES = new Set(['node_modules', '.git', 'dist', '.next', '.cache']);

/** Bounded recursive file listing, skipping common non-artifact
 * directories. Used by the applicability checks below (e.g. "are there any
 * .ts files at all") -- never used to feed an unbounded-size operation. */
function listFilesRecursive(dir: string, opts: { extensions: readonly string[] }): string[] {
  const results: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0 && results.length < DEFAULT_MAX_WALK_FILES) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIPPED_WALK_DIR_NAMES.has(entry.name)) stack.push(path.join(current, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (opts.extensions.some((ext) => lower.endsWith(ext))) {
        results.push(path.join(current, entry.name));
      }
      if (results.length >= DEFAULT_MAX_WALK_FILES) break;
    }
  }
  return results;
}

function findEntryHtmlFile(artifactDir: string): string | null {
  const indexPath = path.join(artifactDir, 'index.html');
  if (fs.existsSync(indexPath)) return indexPath;
  try {
    const topLevelHtml = fs
      .readdirSync(artifactDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
      .map((entry) => entry.name)
      .sort();
    return topLevelHtml.length > 0 ? path.join(artifactDir, topLevelHtml[0] as string) : null;
  } catch {
    return null;
  }
}

interface RunNodeScriptResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Spawns `node <scriptPath> ...args` with a hard timeout -- used to invoke
 * an already-installed CLI's entry script directly (tsc, design.md's bin)
 * without shelling through `npx` (no network dependency, no ambient PATH
 * assumption). */
function runNodeScript(scriptPath: string, args: string[], opts: { cwd: string; timeoutMs: number }): Promise<RunNodeScriptResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      stderr += errorMessage(err);
      resolve({ code: null, stdout, stderr, timedOut });
    });
  });
}

function nonEmptyLines(text: string, max: number): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, max);
}

// ---------------------------------------------------------------------------
// Gate: ts-compile
// ---------------------------------------------------------------------------

async function runTsCompileGate(ctx: GateContext): Promise<DeterministicGateResult> {
  const start = performance.now();
  const tsFiles = listFilesRecursive(ctx.artifactDir, { extensions: ['.ts', '.tsx'] });
  if (tsFiles.length === 0) {
    return finishDeterministic(
      'ts-compile',
      'skipped-not-applicable',
      [`no .ts/.tsx files found under ${ctx.artifactDir} -- lane-A artifacts are typically HTML/CSS/JS.`],
      start,
    );
  }
  const tsconfigPath = path.join(ctx.artifactDir, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) {
    return finishDeterministic(
      'ts-compile',
      'unavailable',
      [`${tsFiles.length} TS file(s) found but no tsconfig.json at ${tsconfigPath} -- cannot type-check without a project config; reusing tsc requires one rather than inventing compiler options here.`],
      start,
    );
  }
  let tscBinPath: string;
  try {
    tscBinPath = require_.resolve('typescript/bin/tsc');
  } catch (err) {
    return finishDeterministic('ts-compile', 'unavailable', [`typescript is not resolvable from this workspace: ${errorMessage(err)}`], start);
  }
  const { code, stdout, stderr, timedOut } = await runNodeScript(tscBinPath, ['--noEmit', '-p', tsconfigPath], {
    cwd: ctx.artifactDir,
    timeoutMs: ctx.timeoutMs,
  });
  if (timedOut) {
    return finishDeterministic('ts-compile', 'unavailable', [`tsc --noEmit timed out after ${ctx.timeoutMs}ms.`], start);
  }
  if (code === 0) {
    return finishDeterministic(
      'ts-compile',
      'pass',
      [`tsc --noEmit -p ${path.relative(ctx.artifactDir, tsconfigPath)} exited 0 across ${tsFiles.length} TS file(s).`],
      start,
    );
  }
  const evidence = nonEmptyLines(stdout + stderr, 20);
  return finishDeterministic('ts-compile', 'fail', evidence.length > 0 ? evidence : [`tsc exited ${code}`], start);
}

// ---------------------------------------------------------------------------
// Gate: eslint
// ---------------------------------------------------------------------------

const ESLINT_CONFIG_NAMES = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs'];

async function runEslintGate(ctx: GateContext): Promise<DeterministicGateResult> {
  const start = performance.now();
  const lintableFiles = listFilesRecursive(ctx.artifactDir, { extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'] });
  if (lintableFiles.length === 0) {
    return finishDeterministic('eslint', 'skipped-not-applicable', [`no lintable JS/TS files found under ${ctx.artifactDir}.`], start);
  }
  let eslintBinPath: string;
  try {
    eslintBinPath = require_.resolve('eslint/bin/eslint.js');
  } catch (err) {
    return finishDeterministic(
      'eslint',
      'unavailable',
      [
        `ESLint is not installed anywhere in this monorepo (${errorMessage(err)}) -- this repo's own static checks run through scripts/guard.ts instead. Reusing eslint means installing it, not reimplementing lint rules here.`,
      ],
      start,
    );
  }
  const hasConfig = ESLINT_CONFIG_NAMES.some((name) => fs.existsSync(path.join(ctx.artifactDir, name)));
  if (!hasConfig) {
    return finishDeterministic(
      'eslint',
      'unavailable',
      [`${lintableFiles.length} lintable file(s) found but no ESLint config under ${ctx.artifactDir}.`],
      start,
    );
  }
  const { code, stdout, stderr, timedOut } = await runNodeScript(eslintBinPath, ['.', '--format', 'json'], {
    cwd: ctx.artifactDir,
    timeoutMs: ctx.timeoutMs,
  });
  if (timedOut) {
    return finishDeterministic('eslint', 'unavailable', [`eslint timed out after ${ctx.timeoutMs}ms.`], start);
  }
  if (code === 0) {
    return finishDeterministic('eslint', 'pass', [`eslint exited 0 across ${lintableFiles.length} lintable file(s).`], start);
  }
  try {
    const parsed = JSON.parse(stdout) as Array<{ filePath: string; messages: Array<{ ruleId: string | null; message: string; severity: number }> }>;
    const evidence = parsed
      .flatMap((file) => file.messages.filter((m) => m.severity >= 2).map((m) => `${path.relative(ctx.artifactDir, file.filePath)}: ${m.ruleId ?? 'error'} -- ${m.message}`))
      .slice(0, 20);
    return finishDeterministic('eslint', 'fail', evidence.length > 0 ? evidence : [`eslint exited ${code}`], start);
  } catch {
    return finishDeterministic('eslint', 'fail', nonEmptyLines(stdout + stderr, 20) || [`eslint exited ${code}`], start);
  }
}

// ---------------------------------------------------------------------------
// Gate: design-md-lint
// ---------------------------------------------------------------------------

async function runDesignMdLintGate(ctx: GateContext): Promise<DeterministicGateResult> {
  const start = performance.now();
  const designMdPath = path.join(ctx.artifactDir, 'DESIGN.md');
  if (!fs.existsSync(designMdPath)) {
    return finishDeterministic(
      'design-md-lint',
      'skipped-not-applicable',
      [`no DESIGN.md found under ${ctx.artifactDir} -- not every lane-A artifact ships a design contract.`],
      start,
    );
  }
  let pkgJsonPath: string;
  try {
    pkgJsonPath = require_.resolve('@google/design.md/package.json');
  } catch (err) {
    return finishDeterministic(
      'design-md-lint',
      'unavailable',
      [`@google/design.md is not installed in this workspace (${errorMessage(err)}) -- this gate reuses that tool rather than reimplementing a design-token linter.`],
      start,
    );
  }
  let bin: string | undefined;
  try {
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as { name?: string; bin?: string | Record<string, string> };
    bin = typeof pkgJson.bin === 'string' ? pkgJson.bin : (pkgJson.bin?.['design.md'] ?? (pkgJson.name ? pkgJson.bin?.[pkgJson.name] : undefined));
  } catch (err) {
    return finishDeterministic('design-md-lint', 'unavailable', [`could not read @google/design.md's package.json: ${errorMessage(err)}`], start);
  }
  if (!bin) {
    return finishDeterministic('design-md-lint', 'unavailable', ['@google/design.md package.json declares no resolvable bin entry.'], start);
  }
  const binPath = path.join(path.dirname(pkgJsonPath), bin);
  const { code, stdout, stderr, timedOut } = await runNodeScript(binPath, ['lint', '--format', 'json', 'DESIGN.md'], {
    cwd: ctx.artifactDir,
    timeoutMs: ctx.timeoutMs,
  });
  if (timedOut) {
    return finishDeterministic('design-md-lint', 'unavailable', [`design.md lint timed out after ${ctx.timeoutMs}ms.`], start);
  }
  if (code === 0) {
    return finishDeterministic('design-md-lint', 'pass', [`design.md lint exited 0 for ${designMdPath}.`], start);
  }
  const evidence = nonEmptyLines(stdout + stderr, 20);
  return finishDeterministic('design-md-lint', 'fail', evidence.length > 0 ? evidence : [`design.md lint exited ${code}`], start);
}

// ---------------------------------------------------------------------------
// Gate: tokens-schema
// ---------------------------------------------------------------------------

async function runTokensSchemaGate(ctx: GateContext): Promise<DeterministicGateResult> {
  const start = performance.now();
  const tokensPath = path.join(ctx.artifactDir, 'design-tokens.json');
  if (!fs.existsSync(tokensPath)) {
    return finishDeterministic(
      'tokens-schema',
      'skipped-not-applicable',
      [`no design-tokens.json found at ${tokensPath} -- not every lane-A artifact ships one.`],
      start,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
  } catch (err) {
    return finishDeterministic('tokens-schema', 'fail', [`design-tokens.json is not valid JSON: ${errorMessage(err)}`], start);
  }
  const tokensArray = parsed && typeof parsed === 'object' ? (parsed as { tokens?: unknown }).tokens : undefined;
  if (!Array.isArray(tokensArray)) {
    return finishDeterministic('tokens-schema', 'fail', ['design-tokens.json has no `tokens` array -- does not match the od-design-tokens/v1 shape.'], start);
  }
  const names = new Set(
    tokensArray
      .map((token) => (token && typeof token === 'object' ? (token as { name?: unknown }).name : undefined))
      .filter((name): name is string => typeof name === 'string'),
  );
  const missingA1 = getRequiredA1Names().filter((name) => !names.has(name));
  const missingA2 = getRequiredA2Names().filter((name) => !names.has(name));
  if (missingA1.length > 0 || missingA2.length > 0) {
    return finishDeterministic(
      'tokens-schema',
      'fail',
      [
        ...(missingA1.length > 0 ? [`missing required A1 token(s): ${missingA1.join(', ')}`] : []),
        ...(missingA2.length > 0 ? [`missing required A2 token(s): ${missingA2.join(', ')}`] : []),
      ],
      start,
    );
  }
  return finishDeterministic(
    'tokens-schema',
    'pass',
    [`${names.size} token(s) declared; every required A1/A2 schema name is present (${getAllSchemaNames().length} schema names known).`],
    start,
  );
}

// ---------------------------------------------------------------------------
// Gate: link-smoke
// ---------------------------------------------------------------------------

const HREF_REGEX = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

function extractHrefs(html: string): string[] {
  const hrefs: string[] = [];
  HREF_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HREF_REGEX.exec(html)) !== null) {
    hrefs.push(match[1] ?? match[2] ?? '');
  }
  return hrefs;
}

function isExternalOrSpecialHref(href: string): boolean {
  if (href.length === 0) return true;
  if (href.startsWith('#')) return true;
  if (href.startsWith('//')) return true;
  return /^(?:https?|mailto|tel|data|javascript):/i.test(href);
}

async function runLinkSmokeGate(ctx: GateContext): Promise<DeterministicGateResult> {
  const start = performance.now();
  const htmlFiles = listFilesRecursive(ctx.artifactDir, { extensions: ['.html', '.htm'] });
  if (htmlFiles.length === 0) {
    return finishDeterministic('link-smoke', 'skipped-not-applicable', [`no HTML files found under ${ctx.artifactDir}.`], start);
  }
  const broken: string[] = [];
  let checked = 0;
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    for (const href of extractHrefs(html)) {
      if (isExternalOrSpecialHref(href)) continue;
      checked++;
      const targetPath = (href.split('#')[0] ?? '').split('?')[0] ?? '';
      let resolved: string;
      try {
        resolved = path.resolve(path.dirname(file), decodeURIComponent(targetPath));
      } catch {
        broken.push(`${path.relative(ctx.artifactDir, file)}: href "${href}" is not a decodable path.`);
        continue;
      }
      const relativeToRoot = path.relative(ctx.artifactDir, resolved);
      if (relativeToRoot.startsWith('..')) {
        broken.push(`${path.relative(ctx.artifactDir, file)}: href "${href}" escapes the artifact directory.`);
        continue;
      }
      if (!fs.existsSync(resolved)) {
        broken.push(`${path.relative(ctx.artifactDir, file)}: href "${href}" -> missing target "${relativeToRoot}".`);
      }
    }
  }
  if (broken.length > 0) {
    return finishDeterministic('link-smoke', 'fail', broken, start);
  }
  return finishDeterministic('link-smoke', 'pass', [`${checked} local href(s) across ${htmlFiles.length} HTML file(s) all resolve.`], start);
}

// ---------------------------------------------------------------------------
// Gate: form-smoke
// ---------------------------------------------------------------------------

const FORM_TAG_REGEX = /<form\b([^>]*)>/gi;
const ATTR_REGEX = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseTagAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_REGEX.exec(attrString)) !== null) {
    const name = (match[1] ?? '').toLowerCase();
    attrs[name] = match[2] ?? match[3] ?? '';
  }
  return attrs;
}

/** Heuristic "does anything handle submit" check across every JS file in
 * the artifact (inline `<script>` blocks are covered by the caller passing
 * the raw HTML text in too) -- deliberately NOT scoped per-form-id: a smoke
 * test's job is to catch the common bug of a totally handler-less form, not
 * to prove which script binds to which form. */
function hasSubmitJsHandler(text: string): boolean {
  return /addEventListener\(\s*['"]submit['"]/i.test(text) || /\.onsubmit\s*=/i.test(text);
}

async function runFormSmokeGate(ctx: GateContext): Promise<DeterministicGateResult> {
  const start = performance.now();
  const htmlFiles = listFilesRecursive(ctx.artifactDir, { extensions: ['.html', '.htm'] });
  if (htmlFiles.length === 0) {
    return finishDeterministic('form-smoke', 'skipped-not-applicable', [`no HTML files found under ${ctx.artifactDir}.`], start);
  }
  const jsFiles = listFilesRecursive(ctx.artifactDir, { extensions: ['.js'] });
  const jsContent = jsFiles.map((file) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  });

  let formCount = 0;
  const problems: string[] = [];
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    const combinedText = [html, ...jsContent].join('\n');
    FORM_TAG_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FORM_TAG_REGEX.exec(html)) !== null) {
      formCount++;
      const attrs = parseTagAttrs(match[1] ?? '');
      const hasActionAndMethod = attrs.action !== undefined && attrs.action.length > 0 && attrs.method !== undefined && attrs.method.length > 0;
      const hasInlineHandler = attrs.onsubmit !== undefined && attrs.onsubmit.length > 0;
      if (!hasActionAndMethod && !hasInlineHandler && !hasSubmitJsHandler(combinedText)) {
        const idAttr = attrs.id ? ` id="${attrs.id}"` : '';
        problems.push(`${path.relative(ctx.artifactDir, file)}: <form${idAttr}> has neither action+method nor an onsubmit/JS submit handler.`);
      }
    }
  }
  if (formCount === 0) {
    return finishDeterministic('form-smoke', 'skipped-not-applicable', [`no <form> elements found under ${ctx.artifactDir}.`], start);
  }
  if (problems.length > 0) {
    return finishDeterministic('form-smoke', 'fail', problems, start);
  }
  return finishDeterministic('form-smoke', 'pass', [`${formCount} form(s) each have action+method or a submit handler.`], start);
}

// ---------------------------------------------------------------------------
// Gate: axe (reuses apps/daemon/src/plugins/atoms/a11y-audit-playwright.ts,
// the daemon's EXISTING Playwright + axe-core harness -- see this file's
// header comment).
// ---------------------------------------------------------------------------

async function runAxeGate(ctx: GateContext): Promise<DeterministicGateResult> {
  const start = performance.now();
  const entryHtml = findEntryHtmlFile(ctx.artifactDir);
  if (!entryHtml) {
    return finishDeterministic(
      'axe',
      'unavailable',
      [`no HTML entry file found under ${ctx.artifactDir} -- axe requires a renderable HTML document (looked for index.html, then the first *.html file).`],
      start,
    );
  }
  const analyze = playwrightAxeAnalyzer();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
  try {
    const result = await analyze(entryHtml, { timeoutMs: ctx.timeoutMs, signal: controller.signal });
    if (result.violations.length > 0) {
      const evidence = result.violations
        .slice(0, 10)
        .map((v) => `${v.id} (impact=${v.impact ?? 'unknown'}): ${v.help} -- ${v.nodes.length} node(s)`);
      return finishDeterministic('axe', 'fail', evidence, start);
    }
    return finishDeterministic(
      'axe',
      'pass',
      [`0 accessibility violations scanning ${entryHtml} (WCAG 2.1 AA, via the daemon's existing Playwright/axe-core harness).`],
      start,
    );
  } catch (err) {
    return finishDeterministic('axe', 'unavailable', [`axe scan could not complete: ${errorMessage(err)}`], start);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Gate: lighthouse-ci ('unavailable' -- @lhci/cli is not a dependency of
// this workspace and no lighthouserc config exists anywhere in the repo,
// verified at the time this tranche was written).
// ---------------------------------------------------------------------------

const LIGHTHOUSE_CONFIG_NAMES = ['lighthouserc.js', 'lighthouserc.json', 'lighthouserc.cjs', '.lighthouserc.js', '.lighthouserc.json'];

async function runLighthouseCiGate(ctx: GateContext): Promise<DeterministicGateResult> {
  const start = performance.now();
  let lhciResolvable = true;
  try {
    require_.resolve('@lhci/cli/package.json');
  } catch {
    lhciResolvable = false;
  }
  const hasConfig = LIGHTHOUSE_CONFIG_NAMES.some((name) => fs.existsSync(path.join(ctx.artifactDir, name)));
  if (!lhciResolvable || !hasConfig) {
    return finishDeterministic(
      'lighthouse-ci',
      'unavailable',
      [
        !lhciResolvable
          ? '@lhci/cli is not installed anywhere in this workspace.'
          : `@lhci/cli is installed but no Lighthouse CI config was found under ${ctx.artifactDir}.`,
      ],
      start,
    );
  }
  // Reached only once BOTH the dependency and a config exist -- neither is
  // true in this repo today (see this gate's own header note), so this
  // branch is intentionally not implemented further: a future tranche that
  // adds @lhci/cli as a real dependency replaces this with a real
  // `lhci autorun` invocation without changing this gate's id/contract.
  return finishDeterministic('lighthouse-ci', 'unavailable', ['Lighthouse CI is configured but this gate has no runner wired yet.'], start);
}

// ---------------------------------------------------------------------------
// Gate: supabase-migration-dry-run
// ---------------------------------------------------------------------------

async function runSupabaseMigrationDryRunGate(ctx: GateContext): Promise<DeterministicGateResult> {
  const start = performance.now();
  const migrationsDir = path.join(ctx.artifactDir, 'supabase', 'migrations');
  let migrationFiles: string[] = [];
  try {
    migrationFiles = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'));
  } catch {
    migrationFiles = [];
  }
  if (migrationFiles.length === 0) {
    return finishDeterministic(
      'supabase-migration-dry-run',
      'skipped-not-applicable',
      [`no supabase/migrations/*.sql found under ${ctx.artifactDir} -- this gate applies to app builds with Supabase migrations only.`],
      start,
    );
  }
  // Deliberately never executes a live dry-run: doing so needs a linked/
  // live Supabase project (network) and could carry side effects a
  // deterministic, side-effect-free gate must not risk -- plan §3.2 L3
  // frames this class as cascade-trigger-safe precisely because it is
  // otherwise side-effect-free. A future tranche that wires an
  // offline-safe dry-run harness (e.g. a local Postgres via
  // `supabase start`) can replace this 'unavailable' with a real pass/fail
  // without changing this gate's id or calling contract.
  return finishDeterministic(
    'supabase-migration-dry-run',
    'unavailable',
    [
      `${migrationFiles.length} migration file(s) found, but this gate does not attempt a live/linked dry-run (would require network access and a project link) -- wire an offline-safe dry-run harness before promoting this gate beyond 'unavailable'.`,
    ],
    start,
  );
}

// ---------------------------------------------------------------------------
// Gate: screenshot-ssim (see the SSIM baseline lifecycle section below for
// the lifecycle store this gate reads).
// ---------------------------------------------------------------------------

async function runScreenshotSsimGate(ctx: GateContext): Promise<DeterministicGateResult> {
  const start = performance.now();
  if (ctx.buildId === null) {
    return finishDeterministic(
      'screenshot-ssim',
      'skipped-not-applicable',
      ['no buildId supplied -- SSIM baselines are scoped per build; non-build-scoped work has nothing to baseline against.'],
      start,
    );
  }
  if (!ctx.db) {
    return finishDeterministic('screenshot-ssim', 'unavailable', ['no database handle supplied -- cannot read/write the SSIM baseline lifecycle table.'], start);
  }
  if (!ctx.ssim?.screenshotPath) {
    return finishDeterministic('screenshot-ssim', 'unavailable', ['no screenshot supplied for this render -- SSIM comparison requires a rendered screenshot path.'], start);
  }
  const state = baselineState(ctx.db, ctx.buildId, ctx.ssim.tokenFreezeVersion);
  if (state === 'no-baseline-bootstrap') {
    return finishDeterministic(
      'screenshot-ssim',
      'unavailable',
      [
        `lifecycle state: no-baseline-bootstrap for build "${ctx.buildId}" -- this is the first render (or the token freeze revised); every OTHER deterministic gate must pass before this render can bootstrap a baseline (WR-routing.md Screenshot-baseline rules, step 1).`,
      ],
      start,
    );
  }
  if (state === 'negative-control-pending') {
    return finishDeterministic(
      'screenshot-ssim',
      'unavailable',
      [
        `lifecycle state: negative-control-pending for build "${ctx.buildId}" -- a candidate baseline is awaiting negative-control calibration (step 2); the SSIM gate stays inactive until a perturbed variant scores below the floor.`,
      ],
      start,
    );
  }
  const record = getSsimBaselineRow(ctx.db, ctx.buildId);
  if (!record?.baseline_screenshot_path) {
    return finishDeterministic(
      'screenshot-ssim',
      'unavailable',
      ['baseline marked active but no baseline screenshot path is recorded -- storage-contract violation, treated as unavailable rather than fabricating a comparison.'],
      start,
    );
  }
  const floor = ctx.ssim.floorOverride ?? DEFAULT_SSIM_FLOOR;
  let similarity: number;
  try {
    similarity = await compareScreenshotsSimilarity(record.baseline_screenshot_path, ctx.ssim.screenshotPath);
  } catch (err) {
    return finishDeterministic('screenshot-ssim', 'unavailable', [`screenshot comparison failed: ${errorMessage(err)}`], start);
  }
  const pass = similarity >= floor;
  return finishDeterministic(
    'screenshot-ssim',
    pass ? 'pass' : 'fail',
    [`similarity ${similarity.toFixed(4)} ${pass ? '>=' : '<'} floor ${floor} against baseline "${record.baseline_screenshot_path}".`],
    start,
  );
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const DETERMINISTIC_GATE_DEFINITIONS: Record<DeterministicGateId, DeterministicGateDefinition> = {
  'ts-compile': {
    id: 'ts-compile',
    class: 'deterministic',
    label: 'TypeScript compile',
    description: 'tsc --noEmit against the artifact\'s own tsconfig.json. skipped-not-applicable when the artifact has no .ts/.tsx files.',
    run: runTsCompileGate,
  },
  eslint: {
    id: 'eslint',
    class: 'deterministic',
    label: 'ESLint',
    description: 'eslint . --format json. unavailable in this repo today (ESLint is not installed anywhere in this monorepo).',
    run: runEslintGate,
  },
  'design-md-lint': {
    id: 'design-md-lint',
    class: 'deterministic',
    label: 'design.md lint',
    description: '@google/design.md lint --format json DESIGN.md. skipped-not-applicable when no DESIGN.md is present; unavailable when the tool is not installed.',
    run: runDesignMdLintGate,
  },
  'tokens-schema': {
    id: 'tokens-schema',
    class: 'deterministic',
    label: 'Design tokens schema',
    description: 'Validates design-tokens.json against @open-design/contracts\' TOKEN_SCHEMA (required A1/A2 names).',
    run: runTokensSchemaGate,
  },
  'link-smoke': {
    id: 'link-smoke',
    class: 'deterministic',
    label: 'Link smoke',
    description: 'Parses every local href across the artifact\'s HTML files and checks the target exists on disk.',
    run: runLinkSmokeGate,
  },
  'form-smoke': {
    id: 'form-smoke',
    class: 'deterministic',
    label: 'Form smoke',
    description: 'Every <form> has action+method or a submit JS handler.',
    run: runFormSmokeGate,
  },
  axe: {
    id: 'axe',
    class: 'deterministic',
    label: 'Accessibility (axe)',
    description: 'WCAG 2.1 AA scan via the daemon\'s existing Playwright/axe-core harness.',
    run: runAxeGate,
  },
  'lighthouse-ci': {
    id: 'lighthouse-ci',
    class: 'deterministic',
    label: 'Lighthouse CI budgets',
    description: 'Core Web Vitals budget check via @lhci/cli. unavailable in this repo today (not a dependency, no config).',
    run: runLighthouseCiGate,
  },
  'screenshot-ssim': {
    id: 'screenshot-ssim',
    class: 'deterministic',
    label: 'Screenshot SSIM vs baseline',
    description: 'Per-build screenshot similarity vs the active baseline, per WR-routing.md\'s bootstrap -> negative-control -> promotion -> steady-state lifecycle.',
    run: runScreenshotSsimGate,
  },
  'supabase-migration-dry-run': {
    id: 'supabase-migration-dry-run',
    class: 'deterministic',
    label: 'Supabase migration dry-run',
    description: 'For app builds carrying supabase/migrations. unavailable by design today -- a live dry-run needs a linked project (network + side-effect risk a deterministic gate must not assume).',
    run: runSupabaseMigrationDryRunGate,
  },
};

export const STOCHASTIC_GATE_DEFINITIONS: Record<StochasticGateId, StochasticGateDefinition> = {
  'vision-conformance': {
    id: 'vision-conformance',
    class: 'stochastic',
    label: 'Vision-model DESIGN.md conformance',
    description: 'Advisory vision-model comparison of a render against DESIGN.md. Reported to the human ship gate; never auto-escalates (plan §3.2 L3).',
  },
  'review-panel-prose': {
    id: 'review-panel-prose',
    class: 'stochastic',
    label: 'Review-panel prose findings',
    description: 'Advisory human/model review-panel prose findings. Reported to the human ship gate; never auto-escalates (plan §3.2 L3).',
  },
};

export const DETERMINISTIC_GATE_IDS: readonly DeterministicGateId[] = Object.keys(DETERMINISTIC_GATE_DEFINITIONS) as DeterministicGateId[];
export const STOCHASTIC_GATE_IDS: readonly StochasticGateId[] = Object.keys(STOCHASTIC_GATE_DEFINITIONS) as StochasticGateId[];

export const GATE_REGISTRY: readonly GateDefinition[] = [
  ...Object.values(DETERMINISTIC_GATE_DEFINITIONS),
  ...Object.values(STOCHASTIC_GATE_DEFINITIONS),
];

// ---------------------------------------------------------------------------
// runGates
// ---------------------------------------------------------------------------

const DEFAULT_GATE_TIMEOUT_MS = 30_000;

export interface RunGatesOptions {
  buildId?: string | null;
  db?: Database.Database;
  ssim?: GateContext['ssim'];
  timeoutMs?: number;
}

/**
 * Executes the SELECTED deterministic gates, in order, against a lane-A
 * artifact directory. Only deterministic gate ids are accepted -- a
 * stochastic id (or any unknown id) is a `GateSelectionError`, never
 * silently skipped, per this task's "definitions only for stochastic"
 * discipline (there is no `run()` to call for one in the first place).
 */
export async function runGates(
  artifactDir: string,
  gateSelection: readonly DeterministicGateId[] | 'all',
  opts: RunGatesOptions = {},
): Promise<DeterministicGateResult[]> {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(artifactDir);
  } catch (err) {
    throw new GateRunnerInputError(`artifactDir "${artifactDir}" does not exist or is not accessible: ${errorMessage(err)}`);
  }
  if (!stat.isDirectory()) {
    throw new GateRunnerInputError(`artifactDir "${artifactDir}" is not a directory.`);
  }

  const ids = gateSelection === 'all' ? DETERMINISTIC_GATE_IDS : gateSelection;
  if (ids.length === 0) {
    throw new GateRunnerInputError('gateSelection must name at least one deterministic gate id.');
  }
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new GateSelectionError(`duplicate gate id "${id}" in gateSelection.`);
    seen.add(id);
    if (!(id in DETERMINISTIC_GATE_DEFINITIONS)) {
      throw new GateSelectionError(
        `"${id}" is not a deterministic gate id -- stochastic gates (${STOCHASTIC_GATE_IDS.join(', ')}) have no run() and cannot be executed by runGates.`,
      );
    }
  }

  const ctx: GateContext = {
    artifactDir,
    buildId: opts.buildId ?? null,
    timeoutMs: opts.timeoutMs ?? DEFAULT_GATE_TIMEOUT_MS,
    ...(opts.db ? { db: opts.db } : {}),
    ...(opts.ssim ? { ssim: opts.ssim } : {}),
  };

  const results: DeterministicGateResult[] = [];
  for (const id of ids) {
    results.push(await DETERMINISTIC_GATE_DEFINITIONS[id].run(ctx));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Cascade classification (plan §3.2 L3: cheap -> mid -> frontier escalation
// ONLY on deterministic failures)
// ---------------------------------------------------------------------------

export type EscalationTier = 'cheap' | 'mid' | 'frontier';

function nextEscalationTier(tier: EscalationTier): EscalationTier {
  if (tier === 'cheap') return 'mid';
  return 'frontier';
}

export interface CascadeClassification {
  escalate: boolean;
  tier: EscalationTier;
  triggeringGates: DeterministicGateId[];
  reason: string;
  /** Gate-tax cap surfaced explicitly (this task's brief: "over cap -> no
   * further model-based verification, surfaced explicitly") -- `capUsd:
   * null` means no cap was supplied (gate-tax not evaluated), never an
   * implicit zero cap. */
  gateTax: { capUsd: number | null; spentUsd: number; overCap: boolean };
}

export interface ClassifyCascadeTriggerInput {
  gateResults: readonly DeterministicGateResult[];
  /** The tier the CURRENT attempt already ran at. Defaults to `'cheap'`
   * (the first attempt on the ladder). */
  currentTier?: EscalationTier;
  /** `RoutingPolicyBudgetCeilings#gateTaxCapUsd` -- `null`/`undefined` means
   * no cap configured. */
  gateTaxCapUsd?: number | null;
  /** Cumulative gate-triggered verifier spend for this build so far. */
  gateSpendSoFarUsd?: number;
}

function evaluateGateTax(capUsd: number | null | undefined, spentUsd: number): CascadeClassification['gateTax'] {
  if (capUsd === undefined || capUsd === null) {
    return { capUsd: null, spentUsd, overCap: false };
  }
  return { capUsd, spentUsd, overCap: spentUsd > capUsd };
}

/**
 * Classifies whether a set of deterministic gate results should trigger a
 * cheap->mid->frontier escalation.
 *
 * Runtime + type-level enforcement (this task's brief): every element of
 * `gateResults` is verified at RUNTIME to carry `class === 'deterministic'`
 * -- not merely trusted from the parameter's declared TS type, which a
 * caller could defeat with a cast. A stochastic result reaching this
 * function is a `GateClassificationError`, always, because stochastic gate
 * outcomes are advisory-only per plan §3.2 L3 ("never auto-escalate").
 *
 * `'unavailable'`/`'skipped-not-applicable'` never trigger escalation --
 * only `'fail'` does. Gate-tax is checked BEFORE the tier steps: an
 * over-cap build reports `escalate: false` even with real failing gates,
 * because "no further model-based verification" is exactly what the cap
 * means (the failures are still surfaced in `triggeringGates`, never
 * silently dropped). At the `'frontier'` tier, a failure still reports
 * `escalate: false` (there is nowhere higher to go) but keeps
 * `tier: 'frontier'` and lists the triggering gates, so a caller can tell
 * "gates failed and we're already at the ceiling" apart from "gates
 * passed."
 */
export function classifyCascadeTrigger(input: ClassifyCascadeTriggerInput): CascadeClassification {
  const currentTier = input.currentTier ?? 'cheap';

  for (const result of input.gateResults) {
    const cls: unknown = (result as { class: unknown }).class;
    if (cls !== 'deterministic') {
      throw new GateClassificationError(
        `classifyCascadeTrigger received a non-deterministic gate result (id="${result.id}", class="${String(cls)}") -- stochastic gate outcomes are advisory-only and must never feed the escalation decision (plan §3.2 L3).`,
      );
    }
  }

  const gateTax = evaluateGateTax(input.gateTaxCapUsd, input.gateSpendSoFarUsd ?? 0);
  const failing = input.gateResults.filter((r) => r.status === 'fail');
  const triggeringGates = failing.map((r) => r.id);

  if (failing.length === 0) {
    return { escalate: false, tier: currentTier, triggeringGates: [], reason: 'no deterministic gate failures -- no cascade trigger.', gateTax };
  }

  if (gateTax.overCap) {
    return {
      escalate: false,
      tier: currentTier,
      triggeringGates,
      reason: `gate-tax cap ($${gateTax.capUsd}) already exceeded (spent $${gateTax.spentUsd}) -- no further model-based verification is permitted despite ${triggeringGates.length} failing deterministic gate(s): ${triggeringGates.join(', ')}.`,
      gateTax,
    };
  }

  const atCeiling = currentTier === 'frontier';
  const nextTier = nextEscalationTier(currentTier);
  return {
    escalate: !atCeiling,
    tier: atCeiling ? currentTier : nextTier,
    triggeringGates,
    reason: atCeiling
      ? `${triggeringGates.length} deterministic gate(s) failed at the frontier tier (${triggeringGates.join(', ')}) -- already at the top of the cheap->mid->frontier ladder, no higher tier to escalate to.`
      : `${triggeringGates.length} deterministic gate(s) failed (${triggeringGates.join(', ')}) -- escalating ${currentTier} -> ${nextTier}.`,
    gateTax,
  };
}

// ---------------------------------------------------------------------------
// Telemetry recording
// ---------------------------------------------------------------------------

/**
 * Maps a run's `GateResult[]` (deterministic AND stochastic -- recording is
 * pure persistence, not escalation, so both classes may be recorded here
 * even though only deterministic results may ever reach
 * `classifyCascadeTrigger`) onto the telemetry row's `gateOutcomes` map and
 * persists it via `telemetry.ts`'s `updateGateOutcomes`.
 */
export function recordGateOutcomes(db: Database.Database, runId: string, attempt: number, results: readonly GateResult[]): void {
  const outcomes: Record<string, RoutingGateOutcome> = {};
  for (const result of results) {
    outcomes[result.id] = result.status;
  }
  updateGateOutcomes(db, runId, attempt, outcomes);
}

// ---------------------------------------------------------------------------
// SSIM baseline lifecycle (WR-routing.md "Screenshot-baseline rules",
// frozen at the P0 tranche): bootstrap -> negative-control-pending ->
// active. A token-freeze revision invalidates an active/pending baseline
// and re-enters bootstrap.
// ---------------------------------------------------------------------------

export type SsimLifecycleState = 'no-baseline-bootstrap' | 'negative-control-pending' | 'active';

export const DEFAULT_SSIM_FLOOR = 0.98;

const ROUTING_SSIM_BASELINES_DDL = `
    CREATE TABLE IF NOT EXISTS routing_ssim_baselines (
      build_id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      baseline_screenshot_path TEXT,
      token_freeze_version TEXT,
      negative_control_passed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
`;

export function ensureSsimBaselinesTable(db: Database.Database): void {
  db.exec(ROUTING_SSIM_BASELINES_DDL);
}

interface SsimBaselineDbRow {
  build_id: string;
  state: string;
  baseline_screenshot_path: string | null;
  token_freeze_version: string | null;
  negative_control_passed: number;
  updated_at: string;
}

function getSsimBaselineRow(db: Database.Database, buildId: string): SsimBaselineDbRow | null {
  ensureSsimBaselinesTable(db);
  return (db.prepare(`SELECT * FROM routing_ssim_baselines WHERE build_id = ?`).get(buildId) as SsimBaselineDbRow | undefined) ?? null;
}

function isSsimLifecycleState(value: string): value is SsimLifecycleState {
  return value === 'no-baseline-bootstrap' || value === 'negative-control-pending' || value === 'active';
}

/**
 * Reads a build's current SSIM lifecycle state. Defaults to
 * `'no-baseline-bootstrap'` for a build with no row at all.
 *
 * `currentTokenFreezeVersion`, when supplied and DIFFERENT from the stored
 * baseline's freeze version, auto-invalidates the baseline (deletes the
 * row) and reports `'no-baseline-bootstrap'` -- this is WR-routing.md step
 * 3's "a token-freeze revision invalidates its baseline; the next render
 * under the revised freeze re-enters bootstrap at step 1," applied at READ
 * time so no separate explicit "invalidate" call is required on every
 * freeze bump (a caller that wants to force invalidation without knowing
 * the new version can still call `invalidateSsimBaseline` directly).
 */
export function baselineState(db: Database.Database, buildId: string, currentTokenFreezeVersion?: string): SsimLifecycleState {
  const row = getSsimBaselineRow(db, buildId);
  if (!row) return 'no-baseline-bootstrap';
  if (currentTokenFreezeVersion !== undefined && row.token_freeze_version !== null && row.token_freeze_version !== currentTokenFreezeVersion) {
    invalidateSsimBaseline(db, buildId);
    return 'no-baseline-bootstrap';
  }
  return isSsimLifecycleState(row.state) ? row.state : 'no-baseline-bootstrap';
}

export function invalidateSsimBaseline(db: Database.Database, buildId: string): void {
  ensureSsimBaselinesTable(db);
  db.prepare(`DELETE FROM routing_ssim_baselines WHERE build_id = ?`).run(buildId);
}

export interface RecordBootstrapBaselineInput {
  buildId: string;
  screenshotPath: string;
  tokenFreezeVersion: string;
  now?: Date;
}

/**
 * Step 1 -> 2: call ONLY after every OTHER deterministic L3 gate has passed
 * on the build's first render (WR-routing.md step 1 -- the bootstrap render
 * has nothing to compare against, so `runScreenshotSsimGate` stays
 * `'unavailable'` through this transition). Throws if a baseline record
 * already exists for this build: bootstrap is a one-time
 * no-baseline -> negative-control-pending transition, not an overwrite --
 * a deliberate re-baseline goes through `invalidateSsimBaseline` first.
 */
export function recordBootstrapBaseline(db: Database.Database, input: RecordBootstrapBaselineInput): void {
  ensureSsimBaselinesTable(db);
  const existing = getSsimBaselineRow(db, input.buildId);
  if (existing) {
    throw new SsimLifecycleError(
      `build "${input.buildId}" already has an SSIM baseline record in state "${existing.state}" -- recordBootstrapBaseline is a one-time transition, not an overwrite. Call invalidateSsimBaseline first for a deliberate re-baseline.`,
    );
  }
  const now = (input.now ?? new Date()).toISOString();
  db.prepare(
    `INSERT INTO routing_ssim_baselines (build_id, state, baseline_screenshot_path, token_freeze_version, negative_control_passed, updated_at)
     VALUES (@buildId, 'negative-control-pending', @screenshotPath, @tokenFreezeVersion, 0, @now)`,
  ).run({ buildId: input.buildId, screenshotPath: input.screenshotPath, tokenFreezeVersion: input.tokenFreezeVersion, now });
}

export interface RunNegativeControlCheckInput {
  buildId: string;
  /** A DELIBERATELY perturbed variant of the candidate baseline render
   * (e.g. a swapped color token or a shifted layout, per WR-routing.md
   * step 2). */
  perturbedScreenshotPath: string;
  floor?: number;
  now?: Date;
}

export interface NegativeControlCheckResult {
  /** `true` when the perturbed variant scored BELOW the floor -- the proof
   * the comparison discriminates at all. */
  discriminates: boolean;
  similarity: number;
  floor: number;
  state: SsimLifecycleState;
}

/**
 * Step 2: scores a deliberately perturbed variant against the candidate
 * baseline. Promotes to `'active'` (step 3) ONLY when `discriminates` is
 * true; a non-discriminating comparison leaves the build in
 * `'negative-control-pending'` so a caller can fix the perturbation and
 * retry -- this function never promotes on a failed check. Throws if the
 * build is not currently awaiting calibration.
 */
export async function runNegativeControlCheck(db: Database.Database, input: RunNegativeControlCheckInput): Promise<NegativeControlCheckResult> {
  ensureSsimBaselinesTable(db);
  const row = getSsimBaselineRow(db, input.buildId);
  if (!row || row.state !== 'negative-control-pending' || !row.baseline_screenshot_path) {
    throw new SsimLifecycleError(
      `build "${input.buildId}" is not awaiting negative-control calibration (state: ${row?.state ?? 'no-baseline-bootstrap'}) -- call recordBootstrapBaseline first.`,
    );
  }
  const floor = input.floor ?? DEFAULT_SSIM_FLOOR;
  const similarity = await compareScreenshotsSimilarity(row.baseline_screenshot_path, input.perturbedScreenshotPath);
  const discriminates = similarity < floor;
  if (discriminates) {
    const now = (input.now ?? new Date()).toISOString();
    db.prepare(`UPDATE routing_ssim_baselines SET state = 'active', negative_control_passed = 1, updated_at = @now WHERE build_id = @buildId`).run({
      buildId: input.buildId,
      now,
    });
  }
  return { discriminates, similarity, floor, state: discriminates ? 'active' : 'negative-control-pending' };
}

/**
 * Sharp-based mean-absolute-pixel-difference similarity, in `[0, 1]` (1 =
 * identical). This is a documented PROXY for true windowed SSIM, not an
 * implementation of the SSIM algorithm itself (real SSIM compares local
 * luminance/contrast/structure over sliding windows; no SSIM-specific
 * library is a dependency of this workspace -- `sharp` is, and is reused
 * here rather than hand-rolling SSIM math, which would be exactly the
 * "reimplement a tool" this task's brief says to avoid). The gate's calling
 * contract (`compareScreenshotsSimilarity(baselinePath, candidatePath):
 * Promise<number>` thresholded against a floor) is the seam a future
 * tranche swaps in a real SSIM library behind, without touching any of the
 * lifecycle functions above.
 *
 * Throws on a dimension mismatch rather than resizing -- silently resizing
 * one render to match the other would compare two different images and
 * call it a similarity score, which is exactly the kind of fabricated
 * comparison this whole module exists to avoid.
 */
async function compareScreenshotsSimilarity(baselinePath: string, candidatePath: string): Promise<number> {
  const [baseline, candidate] = await Promise.all([
    sharp(baselinePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(candidatePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (baseline.info.width !== candidate.info.width || baseline.info.height !== candidate.info.height) {
    throw new Error(
      `image dimension mismatch: baseline ${baseline.info.width}x${baseline.info.height} vs candidate ${candidate.info.width}x${candidate.info.height}`,
    );
  }
  const a = baseline.data;
  const b = candidate.data;
  const length = Math.min(a.length, b.length);
  let sumAbsDiff = 0;
  for (let i = 0; i < length; i++) {
    sumAbsDiff += Math.abs((a[i] as number) - (b[i] as number));
  }
  const meanAbsDiff = length === 0 ? 0 : sumAbsDiff / length;
  return 1 - meanAbsDiff / 255;
}
