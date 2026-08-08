#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser } from 'playwright';
import sharp from 'sharp';
import type { DesignLibraryGroup, DesignLibraryItem } from '@open-design/contracts';
import { isDesignLibraryPrivateMetadataName } from '../src/design-library/private-metadata.js';
import { resolvePublishedDesignLibraryGroups } from '../src/design-library/rights.js';

export type NeuformEntry = {
  id: string;
  title: string;
  status: string;
  files: { html: string | null; design: string | null };
  source: {
    htmlSha256: string | null;
    designSha256: string | null;
    htmlBytes: number;
    designBytes: number;
  };
  runtimeDependencies?: { remoteUrls?: string[]; remoteHosts?: string[] };
};

type NeuformManifest = {
  schemaVersion: number;
  library: string;
  counts: { uniqueEntries: number };
  entries: NeuformEntry[];
};

type Category = 'templates' | 'components' | 'tools';

const CATEGORY_META: Record<Category, { title: string; folder: string; blurb: string; kind: string }> = {
  templates: {
    title: 'NeuForm · Templates',
    folder: '05 NeuForm Favorites/Templates',
    blurb: 'Complete layout and site directions for starting a new original project.',
    kind: 'NeuForm site template',
  },
  components: {
    title: 'NeuForm · Components',
    folder: '05 NeuForm Favorites/Components',
    blurb: 'Focused heroes, cards, mobile flows, dashboards, and reusable interface sections.',
    kind: 'NeuForm component reference',
  },
  tools: {
    title: 'NeuForm · Motion & WebGL Tools',
    folder: '05 NeuForm Favorites/Tools',
    blurb: 'WebGL, Three.js, shader, particle, animation, and interaction techniques to remix into a build.',
    kind: 'NeuForm motion/WebGL tool',
  },
};

const COMPONENT_TITLE = /\b(component|cards?|elements?|widgets?|mobile (ui|flow)|app ui|dashboard interface|heading|archive|product card|job app flow)\b/i;
const TOOL_TITLE = /\b(webgl|three[ .-]?js|shader|fluid|particle|render|3d|simulation|field engine|interactive gestures|motion|animation)\b/i;
const PREVIEW_WIDTH = 1440;
const PREVIEW_HEIGHT = 900;
export const CATALOG_LOCK_FILENAME = 'catalog.lock';
const INDEX_TEMPLATE_FILENAME = 'index-template.html';
const INDEX_DATA_TOKEN = '__OD_CATALOG_BASE64__';
const LOCK_READY = 'OD_CATALOG_LOCK_READY';

export interface CatalogLockCommand {
  executable: string;
  args: string[];
}

export function catalogLockCommand(
  platform: NodeJS.Platform,
  lockPath: string,
  command: string,
  commandArgs: readonly string[],
): CatalogLockCommand {
  if (platform === 'darwin') {
    return {
      executable: '/usr/bin/lockf',
      args: ['-k', '-t', '0', lockPath, command, ...commandArgs],
    };
  }
  if (platform === 'linux') {
    return {
      executable: '/usr/bin/flock',
      args: ['-n', lockPath, command, ...commandArgs],
    };
  }
  if (platform === 'win32') {
    throw new Error('Catalog writer locking is unsupported on native Windows; use WSL2');
  }
  throw new Error(`Catalog writer locking is unsupported on ${platform}`);
}

export function resolveConfiguredTarget(rawTarget: string, source: string): string {
  const trimmed = rawTarget.trim();
  if (!trimmed) throw new Error(`${source} must not be blank`);
  const expanded = trimmed === '~'
    ? os.homedir()
    : trimmed.startsWith('~/')
      ? path.join(os.homedir(), trimmed.slice(2))
      : trimmed;
  if (!path.isAbsolute(expanded)) throw new Error(`${source} must be an absolute path`);
  return path.normalize(expanded);
}

export async function validateLibraryTargetRoot(target: string): Promise<string> {
  const canonical = await realpath(target).catch(() => {
    throw new Error(`Invalid Design Assets library root: ${target}`);
  });
  const sentinels = [
    'catalog.json',
    'index.html',
    path.join('.catalog', 'groups.json'),
    path.join('.catalog', INDEX_TEMPLATE_FILENAME),
  ];
  for (const sentinel of sentinels) {
    const details = await stat(path.join(canonical, sentinel)).catch(() => null);
    if (!details?.isFile()) throw new Error(`Invalid Design Assets library root: missing ${sentinel}`);
  }
  return canonical;
}

export async function renderCatalogIndex(targetRoot: string, catalogContent: string): Promise<string> {
  const templatePath = path.join(targetRoot, '.catalog', INDEX_TEMPLATE_FILENAME);
  const template = await readFile(templatePath, 'utf8');
  if (template.split(INDEX_DATA_TOKEN).length !== 2) {
    throw new Error(`${templatePath} must contain exactly one ${INDEX_DATA_TOKEN}`);
  }
  return template.replace(INDEX_DATA_TOKEN, Buffer.from(catalogContent, 'utf8').toString('base64'));
}

export function mergeOwnedCatalogGroups(
  existingGroups: DesignLibraryGroup[],
  replacementGroups: DesignLibraryGroup[],
): DesignLibraryGroup[] {
  const ownedFolders = new Set(replacementGroups.map((group) => group.folder));
  const remaining = new Map(replacementGroups.map((group) => [group.folder, group]));
  const merged: DesignLibraryGroup[] = [];
  for (const group of existingGroups) {
    if (!ownedFolders.has(group.folder)) {
      merged.push(group);
      continue;
    }
    const replacement = remaining.get(group.folder);
    if (replacement) {
      merged.push(replacement);
      remaining.delete(group.folder);
    }
  }
  for (const group of replacementGroups) {
    if (remaining.delete(group.folder)) merged.push(group);
  }
  return merged;
}

async function tryKernelCatalogLock(
  lockPath: string,
  ownerPid: number,
): Promise<ChildProcessWithoutNullStreams | null> {
  const helperBody = [
    `const ownerPid = ${ownerPid};`,
    `process.stdout.write('${LOCK_READY}\\n');`,
    `process.stdin.on('end', () => process.exit(0));`,
    `process.stdin.resume();`,
    `setInterval(() => { try { process.kill(ownerPid, 0); } catch { process.exit(0); } }, 50);`,
  ].join(' ');
  const command = catalogLockCommand(process.platform, lockPath, process.execPath, ['-e', helperBody]);
  const helper = spawn(
    command.executable,
    command.args,
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      helper.kill('SIGKILL');
      reject(new Error(`Timed out starting catalog lock helper: ${lockPath}`));
    }, 2_000);
    const cleanup = () => {
      clearTimeout(timer);
      helper.stdout.off('data', onData);
      helper.off('error', onError);
      helper.off('exit', onExit);
    };
    const onData = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (!output.includes(`${LOCK_READY}\n`)) return;
      cleanup();
      resolve(helper);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = () => {
      cleanup();
      resolve(null);
    };
    helper.stdout.on('data', onData);
    helper.once('error', onError);
    helper.once('exit', onExit);
  });
}

async function stopKernelCatalogLock(helper: ChildProcessWithoutNullStreams): Promise<void> {
  if (helper.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => helper.once('exit', () => resolve()));
  helper.stdin.end();
  await exited;
}

export async function withCatalogWriterLock<T>(
  targetRoot: string,
  action: () => Promise<T>,
  options: { timeoutMs?: number; retryMs?: number } = {},
): Promise<T> {
  const catalogDir = path.join(targetRoot, '.catalog');
  const lockPath = path.join(catalogDir, CATALOG_LOCK_FILENAME);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retryMs = options.retryMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  const token = randomUUID();
  catalogLockCommand(process.platform, lockPath, process.execPath, []);
  await mkdir(catalogDir, { recursive: true });

  let helper: ChildProcessWithoutNullStreams | null = null;
  while (true) {
    helper = await tryKernelCatalogLock(lockPath, process.pid);
    if (helper) break;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for catalog writer lock: ${lockPath}`);
    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }

  try {
    await writeFile(lockPath, `${JSON.stringify({ version: 1, token, pid: process.pid, created_at: Date.now() / 1000 })}\n`);
    return await action();
  } finally {
    await stopKernelCatalogLock(helper);
  }
}

export function classifyNeuformEntry(entry: NeuformEntry, design: string, html: string): Category {
  const combined = `${entry.title}\n${design}\n${html}`;
  const hasThree = /(?:##\s+(?:WebGL|ThreeJS)|\bTHREE\.(?:Scene|WebGLRenderer)|three(?:\.min)?\.js)/i.test(combined);
  if (hasThree || TOOL_TITLE.test(entry.title)) return 'tools';
  if (COMPONENT_TITLE.test(entry.title)) return 'components';
  return 'templates';
}

export function deriveAspects(entry: NeuformEntry, design: string, html: string): string[] {
  const combined = `${entry.title}\n${design}\n${html}`;
  const candidates: Array<[string, RegExp]> = [
    ['WebGL', /(?:##\s+WebGL|WebGLRenderer|\bwebgl\b)/i],
    ['Three.js', /(?:##\s+ThreeJS|\bTHREE\.|three(?:\.min)?\.js)/i],
    ['GSAP motion', /(?:\bGSAP\b|ScrollTrigger)/i],
    ['Hero', /\bhero\b/i],
    ['Layout', /(?:##\s+Layout|\bgrid composition\b|\bbento\b)/i],
    ['Typography', /(?:##\s+Typography|fontFamily|font-family)/i],
    ['Color system', /(?:##\s+Colors|colors:|--color-)/i],
    ['Glass surfaces', /\b(?:glass|backdrop-blur|backdrop-filter)\b/i],
    ['Scroll choreography', /\b(?:parallax|scroll choreography|ScrollTrigger)\b/i],
    ['Dashboard UI', /\bdashboard\b/i],
    ['Mobile flow', /\b(?:mobile flow|mobile ui|phone frame|app flow)\b/i],
    ['Cards', /\b(?:cards?|widgets?)\b/i],
  ];
  return candidates.filter(([, pattern]) => pattern.test(combined)).map(([label]) => label).slice(0, 8);
}

export function deriveStacks(entry: NeuformEntry, design: string, html: string): string[] {
  const urls = entry.runtimeDependencies?.remoteUrls ?? [];
  const combined = `${design}\n${html}\n${urls.join('\n')}`;
  const stacks = ['React', 'Tailwind CSS'];
  if (/\b(?:GSAP|ScrollTrigger)\b/i.test(combined)) stacks.push('GSAP');
  if (/\b(?:THREE\.|ThreeJS|three(?:\.min)?\.js)\b/i.test(combined)) stacks.push('Three.js');
  if (/\b(?:shader|glsl|fragmentShader|vertexShader)\b/i.test(combined)) stacks.push('GLSL');
  return stacks;
}

function descriptionFromDesign(entry: NeuformEntry, design: string, category: Category): string {
  const raw = design.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (raw) {
    try {
      const parsed = raw.startsWith('"') ? JSON.parse(raw) : raw;
      if (typeof parsed === 'string') return parsed.slice(0, 360);
    } catch {
      return raw.replace(/^['"]|['"]$/g, '').slice(0, 360);
    }
  }
  const purpose = category === 'tools' ? 'motion and rendering technique' : category === 'components' ? 'interface component direction' : 'full layout direction';
  return `${entry.title} — a private NeuForm ${purpose} ready to use as a prompt-based design reference.`;
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function verifiedRead(file: string, expected: string | null): Promise<Buffer> {
  const value = await readFile(file);
  if (expected && sha256(value) !== expected) throw new Error(`SHA-256 mismatch: ${file}`);
  return value;
}

async function readOptional(sourceRoot: string, rel: string | null, expected: string | null): Promise<Buffer | null> {
  if (!rel) return null;
  const target = path.resolve(sourceRoot, rel);
  if (!target.startsWith(path.resolve(sourceRoot) + path.sep)) throw new Error(`Invalid source path: ${rel}`);
  return verifiedRead(target, expected);
}

function itemDomains(category: Category, aspects: string[], stacks: string[]): string[] {
  const values = [
    'neuform',
    category === 'tools' ? 'webgl-motion' : category === 'components' ? 'components' : 'templates',
    ...aspects.map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')),
    ...stacks.map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')),
  ];
  return [...new Set(values)].slice(0, 10);
}

async function prepareEntry(sourceRoot: string, targetRoot: string, entry: NeuformEntry): Promise<{ category: Category; item: DesignLibraryItem }> {
  const htmlBuffer = await readOptional(sourceRoot, entry.files.html, entry.source.htmlSha256);
  const designBuffer = await readOptional(sourceRoot, entry.files.design, entry.source.designSha256);
  const html = htmlBuffer?.toString('utf8') ?? '';
  const design = designBuffer?.toString('utf8') ?? '';
  const category = classifyNeuformEntry(entry, design, html);
  const meta = CATEGORY_META[category];
  const itemDir = path.join(targetRoot, meta.folder, entry.id);
  await mkdir(itemDir, { recursive: true });
  if (htmlBuffer) await copyFile(path.resolve(sourceRoot, entry.files.html!), path.join(itemDir, 'reference.html'));
  if (designBuffer) await copyFile(path.resolve(sourceRoot, entry.files.design!), path.join(itemDir, 'DESIGN.md'));

  const aspects = deriveAspects(entry, design, html);
  const stacks = deriveStacks(entry, design, html);
  const thumbName = `neuform-${entry.id}.jpg`;
  const thumbPath = path.join(targetRoot, '.catalog', 'thumbs', thumbName);
  const hasThumb = await stat(thumbPath).then(() => true).catch(() => false);
  const rel = path.posix.join(meta.folder, entry.id);
  return {
    category,
    item: {
      id: `neuform-${entry.id}`,
      label: entry.title,
      rel,
      thumb: hasThumb ? `.catalog/thumbs/${thumbName}` : null,
      kind: meta.kind,
      files: Number(Boolean(htmlBuffer)) + Number(Boolean(designBuffer)),
      size: humanBytes((htmlBuffer?.byteLength ?? 0) + (designBuffer?.byteLength ?? 0)),
      category: meta.folder,
      domains: itemDomains(category, aspects, stacks),
      allowed_use: 'blocked-pending-license',
      description: descriptionFromDesign(entry, design, category),
      aspects,
      stacks,
      reference: {
        source: 'NeuForm Pro favorite export',
        design: designBuffer ? 'DESIGN.md' : null,
        html: htmlBuffer ? 'reference.html' : null,
        ...(entry.source.designSha256 ? { design_sha256: entry.source.designSha256 } : {}),
        ...(entry.source.htmlSha256 ? { html_sha256: entry.source.htmlSha256 } : {}),
      },
    },
  };
}

function localFileServer(sourceRoot: string) {
  const resolvedRoot = path.resolve(sourceRoot);
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname).replace(/^\/+/, '');
    const target = path.resolve(resolvedRoot, pathname);
    if (!target.startsWith(resolvedRoot + path.sep)) {
      res.writeHead(400).end();
      return;
    }
    try {
      const value = await readFile(target);
      const ext = path.extname(target).toLowerCase();
      const contentType = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.css' ? 'text/css' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' }).end(value);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise<{ origin: string; close: () => Promise<void> }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Could not bind preview server'));
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      });
    });
  });
}

async function renderPreviews(sourceRoot: string, targetRoot: string, entries: NeuformEntry[], refresh: boolean, concurrency: number) {
  const previewEntries = entries.filter((entry) => entry.files.html);
  const thumbs = path.join(targetRoot, '.catalog', 'thumbs');
  await mkdir(thumbs, { recursive: true });
  const server = await localFileServer(sourceRoot);
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    });
    let cursor = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, 10)) }, async () => {
      while (cursor < previewEntries.length) {
        const index = cursor++;
        const entry = previewEntries[index];
        if (!entry) continue;
        const output = path.join(thumbs, `neuform-${entry.id}.jpg`);
        if (!refresh && (await stat(output).then(() => true).catch(() => false))) continue;
        const page = await browser!.newPage({ viewport: { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }, deviceScaleFactor: 1 });
        try {
          // Render one deterministic animation frame. Infinite WebGL/GSAP
          // loops can keep Chrome's compositor busy forever during capture.
          await page.addInitScript(`{
            const requestFrame = window.requestAnimationFrame.bind(window);
            let frameCount = 0;
            window.requestAnimationFrame = (callback) => frameCount++ < 240 ? requestFrame(callback) : 0;
          }`);
          const url = `${server.origin}/${entry.files.html!.split('/').map(encodeURIComponent).join('/')}`;
          // Several NeuForm exports use parser-blocking CDN scripts. Waiting
          // for DOMContentLoaded makes a slow CDN erase an otherwise useful
          // hero capture, so bind only to the committed local document and
          // allow a fixed settle window for Tailwind/fonts/animation frames.
          await page.goto(url, { waitUntil: 'commit', timeout: 10_000 });
          await page.waitForTimeout(2_500);
          // Playwright's screenshot helper waits for every web font and CSS
          // animation to settle; third-party pages can keep that preflight
          // alive even after window.stop(). Capture the committed viewport
          // directly from Chrome instead.
          const cdp = await page.context().newCDPSession(page);
          const capture = () =>
            Promise.race([
              cdp.send('Page.captureScreenshot', {
                format: 'jpeg',
                quality: 86,
                fromSurface: true,
                captureBeyondViewport: false,
              }),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Chrome screenshot timed out after 10 seconds')), 10_000),
              ),
            ]);
          let captured = await capture();
          let image = Buffer.from(captured.data, 'base64');
          if ((await sharp(image).stats()).entropy < 0.2) {
            await page.waitForTimeout(4_000);
            captured = await capture();
            image = Buffer.from(captured.data, 'base64');
          }
          await page.evaluate('window.stop()');
          await writeFile(output, image);
          await cdp.detach();
          process.stdout.write(`preview ${index + 1}/${previewEntries.length} ${entry.id}\n`);
        } catch (error) {
          process.stderr.write(`preview failed ${entry.id}: ${error instanceof Error ? error.message : error}\n`);
        } finally {
          await page.close();
        }
      }
    });
    await Promise.all(workers);
  } finally {
    await browser?.close();
    await server.close();
  }
}

function parseArgs(argv: string[]) {
  const value = (name: string) => {
    const index = argv.indexOf(name);
    if (index < 0) return undefined;
    const result = argv[index + 1];
    if (result === undefined || result.startsWith('--')) throw new Error(`${name} requires a value`);
    return result;
  };
  const explicitTarget = value('--target');
  const configuredTarget = explicitTarget !== undefined
    ? resolveConfiguredTarget(explicitTarget, '--target')
    : process.env.OD_DESIGN_LIBRARY_DIR !== undefined
      ? resolveConfiguredTarget(process.env.OD_DESIGN_LIBRARY_DIR, 'OD_DESIGN_LIBRARY_DIR')
      : path.join(os.homedir(), 'Desktop', 'Design Assets');
  return {
    source: value('--source') ?? path.join(os.homedir(), 'Desktop', 'neuform-favorites-design-library'),
    target: configuredTarget,
    skipPreviews: argv.includes('--skip-previews'),
    refreshPreviews: argv.includes('--refresh-previews'),
    concurrency: Number(value('--concurrency') ?? '4'),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  options.target = await validateLibraryTargetRoot(options.target);
  const manifest = JSON.parse(await readFile(path.join(options.source, 'manifest.json'), 'utf8')) as NeuformManifest;
  if (manifest.schemaVersion !== 1 || manifest.entries.length !== manifest.counts.uniqueEntries) {
    throw new Error('Unsupported or inconsistent NeuForm manifest');
  }
  await mkdir(path.join(options.target, '.catalog', 'thumbs'), { recursive: true });
  if (!options.skipPreviews) {
    await renderPreviews(options.source, options.target, manifest.entries, options.refreshPreviews, options.concurrency);
  }

  const prepared: Array<Awaited<ReturnType<typeof prepareEntry>>> = [];
  for (const entry of manifest.entries) prepared.push(await prepareEntry(options.source, options.target, entry));
  const groups = (Object.keys(CATEGORY_META) as Category[]).map((category) => {
    const meta = CATEGORY_META[category];
    return {
      title: meta.title,
      folder: meta.folder,
      blurb: meta.blurb,
      items: prepared
        .filter((value) => value.category === category)
        .map((value) => value.item)
        .sort((a, b) => a.label.localeCompare(b.label)),
    } satisfies DesignLibraryGroup;
  });
  await withCatalogWriterLock(options.target, async () => {
    const existingPath = path.join(options.target, 'catalog.json');
    const existing = JSON.parse(await readFile(existingPath, 'utf8')) as { groups: DesignLibraryGroup[]; [key: string]: unknown };
    const mergedGroups = await resolvePublishedDesignLibraryGroups(
      options.target,
      mergeOwnedCatalogGroups(existing.groups, groups),
    );
    const next = {
      ...existing,
      note: `${String(existing.note ?? '')
        .replaceAll('NeuForm favorites stay private, local, prompt-reference only.', '')
        .trim()} NeuForm favorites stay private, local, prompt-reference only.`,
      groups: mergedGroups,
      total_collections: mergedGroups.reduce((sum, group) => sum + group.items.length, 0),
    };
    const catalogContent = `${JSON.stringify(next, null, 2)}\n`;
    const indexContent = await renderCatalogIndex(options.target, catalogContent);

    const backupDir = path.join(os.homedir(), 'Backups', 'mishmash');
    await mkdir(backupDir, { recursive: true });
    await copyFile(existingPath, path.join(backupDir, `design-assets-catalog-${Date.now()}.json`));
    const indexPath = path.join(options.target, 'index.html');
    await copyFile(existingPath, `${existingPath}.bak`);
    await copyFile(indexPath, `${indexPath}.bak`);
    const tempCatalog = `${existingPath}.neuform-${process.pid}.tmp`;
    const tempIndex = `${indexPath}.neuform-${process.pid}.tmp`;
    try {
      await writeFile(tempCatalog, catalogContent);
      await writeFile(tempIndex, indexContent);
      await rename(tempCatalog, existingPath);
      await rename(tempIndex, indexPath);
    } finally {
      await rm(tempCatalog, { force: true });
      await rm(tempIndex, { force: true });
    }
  });
  await writeFile(
    path.join(options.target, '05 NeuForm Favorites', 'RIGHTS.md'),
    '# NeuForm Favorites\n\nPrivate, user-owned reference material from a NeuForm Pro account. Keep local. Do not redistribute, commit, or ship the source HTML/DESIGN files. MishMash may use them as bounded prompt and visual references for original implementations.\n',
  );
  process.stdout.write(`${JSON.stringify({ imported: prepared.length, groups: Object.fromEntries(groups.map((group) => [group.title, group.items.length])) }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`);
    process.exitCode = 1;
  });
}
