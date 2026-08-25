export interface PageLoadTarget {
  path: string;
  readySelector: string;
}

export interface PageLoadSamples {
  path: string;
  samplesMs: number[];
}

export interface PageLoadSummary {
  minMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

export interface PageLoadEvaluation {
  passed: boolean;
  results: Array<PageLoadSummary & { path: string }>;
  failing: Array<PageLoadSummary & { path: string }>;
}

export const PAGE_LOAD_TARGETS: PageLoadTarget[] = [
  { path: '/', readySelector: '[data-testid="entry-view-home"][data-active="true"]' },
  { path: '/projects', readySelector: '[data-testid="entry-view-projects"][data-active="true"]' },
  { path: '/automations', readySelector: '[data-testid="entry-view-tasks"][data-active="true"] [data-testid="tasks-view"]' },
  { path: '/plugins', readySelector: '[data-testid="entry-view-plugins"][data-active="true"]' },
  { path: '/design-systems', readySelector: '[data-testid="entry-view-design-systems"][data-active="true"]' },
  { path: '/design-library', readySelector: '[data-testid="entry-view-design-library"][data-active="true"]' },
  { path: '/storyboard', readySelector: '[data-testid="entry-view-storyboard"][data-active="true"]' },
  { path: '/templates', readySelector: '[data-testid="entry-view-templates"][data-active="true"] [data-testid="templates-card"]' },
  { path: '/typefaces', readySelector: '[data-testid="entry-view-typefaces"][data-active="true"] [data-testid="typefaces-section"]' },
  { path: '/academy', readySelector: '[data-testid="entry-view-academy"][data-active="true"]' },
  { path: '/integrations', readySelector: '[data-testid="integrations-tab-mcp"]' },
  { path: '/marketplace', readySelector: '[data-testid="marketplace-view"]' },
  { path: '/interview', readySelector: '[data-testid="interview-view"]' },
];

export function summarizeSamples(samplesMs: number[]): PageLoadSummary {
  if (samplesMs.length === 0) throw new Error('At least one page-load sample is required');
  if (!samplesMs.every(Number.isFinite)) throw new Error('Page-load samples must be finite numbers');

  const sorted = [...samplesMs].sort((a, b) => a - b);
  const medianIndex = Math.floor(sorted.length / 2);
  const p95Index = Math.ceil(sorted.length * 0.95) - 1;
  return {
    minMs: sorted[0]!,
    medianMs: sorted[medianIndex]!,
    p95Ms: sorted[p95Index]!,
    maxMs: sorted.at(-1)!,
  };
}

export function evaluatePageLoad(
  pages: PageLoadSamples[],
  thresholdMs: number,
): PageLoadEvaluation {
  const results = pages.map(({ path, samplesMs }) => ({
    path,
    ...summarizeSamples(samplesMs),
  }));
  const failing = results.filter(({ p95Ms }) => p95Ms >= thresholdMs);
  return { passed: failing.length === 0, results, failing };
}
