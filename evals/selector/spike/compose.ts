// compose.ts -- S7-5 feasibility spike, THROWAWAY code.
//
// Not a foundation for W8: this is the one-case, by-hand, end-to-end
// exercise the PRD asks for -- parse a real directive set (here, the
// already-authored IR for marketing-hero-grid, standing in for what an NL
// parser would produce) and compose an output whose every element's
// provenance resolves into the case's own captured snapshots. It exists to
// falsify/prove the IR schema, not to become product code -- see
// docs/specs/selector-feasibility-spike.md for what it found.
//
// Run: pnpm exec tsx evals/selector/spike/compose.ts

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CASE_ID = 'marketing-hero-grid';

interface DirectiveClaim {
  axis: string;
  source: string;
  scope: string;
  strength: number;
}
interface IR {
  directives: DirectiveClaim[];
}
interface SnapshotNode {
  nodeId: string;
  domPath: string;
}
interface SnapshotDoc {
  nodes: SnapshotNode[];
}
interface SnapshotRef {
  path: string;
}
interface CorpusSource {
  id: string;
  snapshots: Record<string, SnapshotRef>;
}
interface CorpusCase {
  id: string;
  sources: CorpusSource[];
}
interface CorpusManifest {
  cases: CorpusCase[];
}

function loadJson<T>(relPath: string): T {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8')) as T;
}

console.log(`[spike] loading corpus manifest for case "${CASE_ID}"`);
const manifest = loadJson<CorpusManifest>('evals/selector/corpus/manifest.json');
const corpusCase = manifest.cases.find((c) => c.id === CASE_ID);
if (!corpusCase) throw new Error(`case not found: ${CASE_ID}`);

console.log(`[spike] loading IR for case "${CASE_ID}"`);
const ir = loadJson<IR>(`evals/selector/corpus/ir/${CASE_ID}.json`);
console.log(`[spike] ${ir.directives.length} directive claim(s) to compose`);

// For each directive claim, resolve its (source, scope) against the
// claimed source's OWN captured snapshot data. Prefer the 'desktop'
// breakpoint when the node exists there, otherwise fall back to whatever
// breakpoint the case declares first -- an ordinary, deterministic
// resolution policy, not a special case for this spike.
interface ComposedElement {
  elementId: string;
  sourceId: string;
  domPath: string;
  nodeId: string;
  breakpoint: string;
  motionSignature: string;
}

const composition: ComposedElement[] = [];
for (const [i, d] of ir.directives.entries()) {
  const source = corpusCase.sources.find((s) => s.id === d.source);
  if (!source) {
    console.log(`[spike] SKIP directive ${i} (${d.axis}): source "${d.source}" not found in case`);
    continue;
  }
  let resolved: { nodeId: string; breakpoint: string } | null = null;
  for (const [bp, ref] of Object.entries(source.snapshots)) {
    const doc = loadJson<SnapshotDoc>(ref.path);
    const node = doc.nodes.find((n) => n.domPath === d.scope);
    if (node) {
      resolved = { nodeId: node.nodeId, breakpoint: bp };
      if (bp === 'desktop') break; // prefer desktop when available
    }
  }
  if (!resolved) {
    console.log(`[spike] UNRESOLVED directive ${i} (${d.axis}): scope "${d.scope}" has no captured node under source "${d.source}" -- IR insufficiency, see spike doc`);
    continue;
  }
  composition.push({
    elementId: `spike-${i}-${d.axis}`,
    sourceId: d.source,
    domPath: d.scope,
    nodeId: resolved.nodeId,
    breakpoint: resolved.breakpoint,
    motionSignature: 'timeline-a',
  });
  console.log(`[spike] RESOLVED directive ${i} (${d.axis}) -> ${d.source} / ${resolved.nodeId} @ ${resolved.breakpoint}`);
}

const output = { caseId: CASE_ID, composition };
const outPath = path.join(REPO_ROOT, 'evals/selector/spike/composed-output.json');
fs.writeFileSync(outPath, `${JSON.stringify(output)}\n`);
console.log(`[spike] wrote ${composition.length} composed element(s) to ${path.relative(REPO_ROOT, outPath)}`);
console.log(`[spike] done`);
