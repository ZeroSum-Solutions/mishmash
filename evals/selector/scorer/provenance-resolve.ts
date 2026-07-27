// provenance-resolve.ts -- checks whether every IR provenance pointer names a
// node that was actually captured. "Resolves" means the SAME thing here as
// verify-w7.ts's own resolves() helper: an exact match on the full
// (sourceId, nodeId, domPath, breakpoint) tuple against that source's real
// captured snapshot data. Attaching a real-looking-but-wrong sourceId to
// otherwise-correct coordinates does not resolve -- and neither does getting
// any ONE of nodeId/domPath/breakpoint wrong while the others stay correct
// (checked independently by verify-w7.ts's per-field derangement controls).

export interface ProvenanceEntry {
  elementId: string;
  sourceId: string;
  nodeId: string;
  domPath: string;
  breakpoint: string;
}

export interface CompositionIRForProvenance {
  provenance: ProvenanceEntry[];
}

export interface CapturedNode {
  nodeId: string;
  domPath: string;
  breakpoint: string;
}

export type SnapshotsBySource = Record<string, CapturedNode[]>;

export interface ProvenanceResolution {
  total: number;
  resolved: number;
  unresolvedPointers: ProvenanceEntry[];
}

export function resolveProvenance(ir: CompositionIRForProvenance, snapshotsBySource: SnapshotsBySource): ProvenanceResolution {
  const total = ir.provenance.length;
  const unresolvedPointers: ProvenanceEntry[] = [];
  let resolved = 0;
  for (const p of ir.provenance) {
    const nodes = snapshotsBySource[p.sourceId] ?? [];
    const found = nodes.some((n) => n.nodeId === p.nodeId && n.domPath === p.domPath && n.breakpoint === p.breakpoint);
    if (found) resolved++;
    else unresolvedPointers.push(p);
  }
  return { total, resolved, unresolvedPointers };
}
