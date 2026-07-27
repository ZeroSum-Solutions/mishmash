// corpus-loader.ts -- loads the frozen corpus manifest and a case's captured
// (non-sealed) snapshot nodes from disk, relative to THIS FILE's own
// location (not process.cwd()) so scoreComposition works regardless of the
// caller's working directory. Deliberately reads only the plaintext, real
// (non-sealed) snapshot files -- scoreComposition is never exercised against
// sealed cases (every criterion that calls it filters `!c.sealed`), and this
// module has no seal key and does not look for one.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'evals', 'selector', 'corpus', 'manifest.json');

export interface DirectiveClaim {
  axis: string;
  source: string;
  scope: string;
  strength: number;
  breakpoint?: string;
}
export interface SnapshotRef {
  path: string;
  sha256: string;
  viewportWidth: number;
}
export interface CorpusSource {
  id: string;
  snapshots: Record<string, SnapshotRef>;
}
export interface CorpusCase {
  id: string;
  genre: string;
  layoutSystem: string;
  breakpoints: string[];
  sources: CorpusSource[];
  directiveInventory: DirectiveClaim[];
  conflict: { axis: string; winningSource: string; losingSource: string } | null;
  degenerate: string | null;
  skip: { reason: string; target: string } | null;
  sealed: boolean;
  irPath: string;
  irSha256: string;
  // F2 (deliverable-review fix round 2, item 7): brief binding. Optional --
  // sealed cases and any pre-v4 manifest entry predate this field.
  briefPath?: string;
  briefSha256?: string;
}
export interface CorpusManifest {
  version: number;
  sealedFraction: number;
  cases: CorpusCase[];
}

export interface CapturedNode {
  nodeId: string;
  domPath: string;
  breakpoint: string;
  state: string;
  computedStyle: Record<string, string>;
}

// The subset of the IR shape resolve-conflicts.ts needs. loadCaseIR() only
// ever reads NON-SEALED, plaintext IR files (same constraint as
// buildSnapshotsBySource below) -- scoreComposition is never exercised
// against sealed cases.
export interface CaseIR {
  directives: Array<{ axis: string; source: string; scope: string; strength: number; breakpoint?: string }>;
  conflictResolution: Array<{ axis: string; winningSource: string; losingSource?: string }>;
}

export function loadCaseIR(c: CorpusCase): CaseIR {
  if (c.sealed) throw new Error(`refusing to read IR for sealed case ${c.id}: no plaintext, no seal key`);
  const abs = path.join(REPO_ROOT, c.irPath);
  return JSON.parse(fs.readFileSync(abs, 'utf8')) as CaseIR;
}

let cachedManifest: CorpusManifest | null = null;

export function loadManifest(): CorpusManifest {
  if (cachedManifest) return cachedManifest;
  const text = fs.readFileSync(MANIFEST_PATH, 'utf8');
  cachedManifest = JSON.parse(text) as CorpusManifest;
  return cachedManifest;
}

export function loadCase(caseId: string): CorpusCase {
  const manifest = loadManifest();
  const found = manifest.cases.find((c) => c.id === caseId);
  if (!found) throw new Error(`unknown corpus case id: ${caseId}`);
  return found;
}

interface SnapshotDoc {
  nodes?: Array<{ nodeId: string; domPath: string; state?: string; computedStyle?: Record<string, string> }>;
}

// Nodes captured for EVERY source in the case, across ALL of that case's
// breakpoints, keyed by source id. Throws if the case is sealed (no
// plaintext to read) or a snapshot file is missing/unparseable -- callers
// are expected to only invoke this for non-sealed cases.
export function buildSnapshotsBySource(c: CorpusCase): Record<string, CapturedNode[]> {
  if (c.sealed) throw new Error(`refusing to read snapshots for sealed case ${c.id}: no plaintext, no seal key`);
  const bySource: Record<string, CapturedNode[]> = {};
  for (const source of c.sources) {
    const nodes: CapturedNode[] = [];
    for (const [bp, ref] of Object.entries(source.snapshots)) {
      const abs = path.join(REPO_ROOT, ref.path);
      const doc = JSON.parse(fs.readFileSync(abs, 'utf8')) as SnapshotDoc;
      for (const n of doc.nodes ?? []) {
        nodes.push({ nodeId: n.nodeId, domPath: n.domPath, breakpoint: bp, state: n.state ?? 'default', computedStyle: n.computedStyle ?? {} });
      }
    }
    bySource[source.id] = nodes;
  }
  return bySource;
}
