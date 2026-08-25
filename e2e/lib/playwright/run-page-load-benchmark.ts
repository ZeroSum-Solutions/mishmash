import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Page } from '@playwright/test';

import {
  PAGE_LOAD_TARGETS,
  evaluatePageLoad,
  type PageLoadTarget,
} from './page-load-benchmark.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const e2eDir = path.resolve(scriptDir, '../..');
const baseUrl = (process.env.OD_PERF_BASE_URL ?? 'http://127.0.0.1:7456').replace(/\/$/, '');
const outputPath = path.resolve(
  process.env.OD_PERF_OUTPUT ?? path.join(e2eDir, 'ui/reports/page-load-benchmark.json'),
);
const thresholdMs = readPositiveNumber('OD_PERF_THRESHOLD_MS', 50);
const runCount = readPositiveInteger('OD_PERF_RUNS', 7);
const warmupCount = readPositiveInteger('OD_PERF_WARMUPS', 1);
const viewport = { width: 1440, height: 900 } as const;

function readPositiveNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.length === 0) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = readPositiveNumber(name, fallback);
  if (!Number.isInteger(value)) throw new Error(`${name} must be a positive integer`);
  return value;
}

async function navigateAndMeasure(page: Page, target: PageLoadTarget): Promise<number> {
  return page.evaluate(async ({ targetPath, selector }) => {
    const start = performance.now();
    window.history.pushState({}, '', targetPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
    const deadline = start + 15_000;

    while (performance.now() < deadline) {
      if (window.location.pathname === targetPath && document.querySelector(selector)) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        return performance.now() - start;
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    throw new Error(`route-ready timeout: ${targetPath} (${selector})`);
  }, { targetPath: target.path, selector: target.readySelector });
}

function sourceFor(target: PageLoadTarget): PageLoadTarget {
  if (target.path !== '/') return PAGE_LOAD_TARGETS[0]!;
  return PAGE_LOAD_TARGETS.find(({ path: targetPath }) => targetPath === '/projects')!;
}

async function warmRoute(page: Page, target: PageLoadTarget): Promise<void> {
  for (let i = 0; i < warmupCount; i += 1) {
    await navigateAndMeasure(page, sourceFor(target));
    await navigateAndMeasure(page, target);
  }
}

async function measureWarmRoutes(page: Page) {
  const pages: Array<{ path: string; samplesMs: number[] }> = [];
  for (const target of PAGE_LOAD_TARGETS) {
    await warmRoute(page, target);
    const samplesMs: number[] = [];
    for (let run = 0; run < runCount; run += 1) {
      await navigateAndMeasure(page, sourceFor(target));
      samplesMs.push(await navigateAndMeasure(page, target));
    }
    pages.push({ path: target.path, samplesMs });
  }
  return pages;
}

async function measureColdNavigation(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const results: Array<{
    path: string;
    domContentLoadedMs: number;
    loadEventMs: number;
    transferSizeBytes: number;
  }> = [];

  for (const target of PAGE_LOAD_TARGETS) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${baseUrl}${target.path}`, { waitUntil: 'load', timeout: 30_000 });
    const timing = await page.evaluate(() => {
      const [navigation] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      if (navigation == null) throw new Error('Navigation Timing entry unavailable');
      return {
        domContentLoadedMs: navigation.domContentLoadedEventEnd,
        loadEventMs: navigation.loadEventEnd,
        transferSizeBytes: navigation.transferSize,
      };
    });
    results.push({ path: target.path, ...timing });
    await context.close();
  }

  return results;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

const browser = await chromium.launch({ headless: true });
try {
  const browserVersion = browser.version();
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/`, { waitUntil: 'load', timeout: 30_000 });
  await page.locator(PAGE_LOAD_TARGETS[0]!.readySelector).waitFor({ state: 'visible', timeout: 30_000 });

  const warmPages = await measureWarmRoutes(page);
  await context.close();
  const coldNavigation = await measureColdNavigation(browser);
  const evaluation = evaluatePageLoad(warmPages, thresholdMs);

  const report = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    conditions: {
      baseUrl,
      browser: `Chromium ${browserVersion}`,
      node: process.version,
      viewport,
      reducedMotion: 'reduce',
      warmups: warmupCount,
      runs: runCount,
      thresholdMs,
      metric: 'warm SPA route navigation to ready selector plus two animation frames (p95)',
    },
    routes: evaluation.results.map((summary) => ({
      ...summary,
      samplesMs: warmPages.find(({ path: targetPath }) => targetPath === summary.path)!.samplesMs.map(round),
    })),
    coldNavigation: coldNavigation.map((row) => ({
      ...row,
      domContentLoadedMs: round(row.domContentLoadedMs),
      loadEventMs: round(row.loadEventMs),
    })),
    passed: evaluation.passed,
    failingRoutes: evaluation.failing.map(({ path: targetPath }) => targetPath),
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.table(report.routes.map(({ path: targetPath, medianMs, p95Ms, maxMs }) => ({
    path: targetPath,
    medianMs: round(medianMs),
    p95Ms: round(p95Ms),
    maxMs: round(maxMs),
    pass: p95Ms < thresholdMs,
  })));
  console.log(`Report: ${outputPath}`);
  if (!evaluation.passed) {
    console.error(`Sub-${thresholdMs} ms gate failed: ${report.failingRoutes.join(', ')}`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
