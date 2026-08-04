// Aggregate process-tree RSS sampling for the renderer's memory ceiling
// (C4-5). A hostile project can allocate memory far faster than V8/Chromium
// itself will ever surface a JS-level OOM signal, so the daemon actively
// polls the RENDER JOB'S OWN browser process tree from the OUTSIDE (via
// `ps`, the same mechanism scripts/waves/verify-w4.ts's C4-5 probe uses to
// grade this) and kills it once aggregate RSS crosses a real ceiling --
// never a generic timeout-as-memory-proxy.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface PsRow {
  pid: number;
  ppid: number;
  rssKb: number;
}

// Async on purpose (Sol/security-review finding, MEDIUM): this poll runs
// every MEMORY_POLL_INTERVAL_MS per in-flight render job (up to
// RENDER_CONCURRENCY concurrently), sharing the daemon's single event loop
// with SSE streams and agent orchestration -- a synchronous execFileSync
// here blocks ALL of that for however long `ps` takes to run.
async function psSnapshot(): Promise<PsRow[]> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('ps', ['-A', '-o', 'pid=,ppid=,rss=']));
  } catch {
    return [];
  }
  const rows: PsRow[] = [];
  for (const line of stdout.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/);
    if (match?.[1] && match[2] && match[3]) {
      rows.push({ pid: Number(match[1]), ppid: Number(match[2]), rssKb: Number(match[3]) });
    }
  }
  return rows;
}

function descendantsOf(rootPid: number, rows: PsRow[]): Set<number> {
  const byParent = new Map<number, number[]>();
  for (const row of rows) {
    const list = byParent.get(row.ppid) ?? [];
    list.push(row.pid);
    byParent.set(row.ppid, list);
  }
  const out = new Set<number>();
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift();
    if (pid === undefined) continue;
    for (const child of byParent.get(pid) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        queue.push(child);
      }
    }
  }
  return out;
}

/** Aggregate RSS (in KB) of `rootPid` itself plus every descendant. `null`
 * when `ps` itself failed (never conflated with a genuine zero). */
export async function aggregateProcessTreeRssKb(rootPid: number): Promise<number | null> {
  const snapshot = await psSnapshot();
  if (snapshot.length === 0) return null;
  const tree = descendantsOf(rootPid, snapshot);
  tree.add(rootPid);
  return snapshot.filter((row) => tree.has(row.pid)).reduce((sum, row) => sum + row.rssKb, 0);
}
