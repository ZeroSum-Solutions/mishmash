import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ANOMALY_LOG_MAX_BYTES, createAnomalyLog } from '../src/anomaly-log.js';

let dataDir = '';

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'od-anomaly-log-'));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe('anomaly log', () => {
  it('derives its path from the data root it is given', () => {
    const log = createAnomalyLog({ dataDir });

    // The daemon data-directory contract: every daemon-owned path descends from
    // the resolved data root, never from cwd or an env read of its own.
    expect(log.path.startsWith(dataDir)).toBe(true);
  });

  it('stamps id, timestamp, and source rather than trusting the caller', async () => {
    const log = createAnomalyLog({ dataDir });

    const id = await log.append(
      {
        kind: 'request-failed',
        severity: 'error',
        summary: 'POST /api/runs answered 500',
        // A client trying to pass these through must not be able to.
        ...({ id: 'client-chosen', at: '1999-01-01T00:00:00.000Z', source: 'daemon' } as object),
      },
      'web',
    );

    const { anomalies } = await log.list({});
    expect(anomalies).toHaveLength(1);
    const [record] = anomalies;
    if (!record) throw new Error('no record was written');
    expect(record.id).toBe(id);
    expect(record.id).not.toBe('client-chosen');
    expect(record.source).toBe('web');
    expect(Date.parse(record.at)).toBeGreaterThan(Date.parse('2020-01-01T00:00:00.000Z'));
  });

  it('returns records newest first', async () => {
    const log = createAnomalyLog({ dataDir });

    await log.append({ kind: 'ui-lag', severity: 'warn', summary: 'first' }, 'web');
    await log.append({ kind: 'ui-lag', severity: 'warn', summary: 'second' }, 'web');
    await log.append({ kind: 'ui-lag', severity: 'warn', summary: 'third' }, 'web');

    const { anomalies, total } = await log.list({});
    expect(total).toBe(3);
    expect(anomalies.map((a) => a.summary)).toEqual(['third', 'second', 'first']);
  });

  it('reports the unfiltered total alongside a limited page', async () => {
    const log = createAnomalyLog({ dataDir });
    for (let i = 0; i < 5; i += 1) {
      await log.append({ kind: 'ui-lag', severity: 'warn', summary: `n${i}` }, 'web');
    }

    const { anomalies, total } = await log.list({ limit: 2 });
    expect(anomalies).toHaveLength(2);
    // Otherwise a reader cannot tell "that is everything" from "that is a page".
    expect(total).toBe(5);
    expect(anomalies.map((a) => a.summary)).toEqual(['n4', 'n3']);
  });

  it('filters by kind, severity, and time', async () => {
    const log = createAnomalyLog({ dataDir });
    await log.append({ kind: 'ui-lag', severity: 'warn', summary: 'lag' }, 'web');
    await log.append({ kind: 'request-failed', severity: 'error', summary: 'failed' }, 'daemon');
    await log.append({ kind: 'request-slow', severity: 'warn', summary: 'slow' }, 'daemon');

    expect((await log.list({ kind: 'request-failed' })).anomalies.map((a) => a.summary)).toEqual([
      'failed',
    ]);
    expect((await log.list({ severity: 'error' })).anomalies.map((a) => a.summary)).toEqual([
      'failed',
    ]);
    const future = new Date(Date.now() + 60_000).toISOString();
    expect((await log.list({ since: future })).anomalies).toEqual([]);
    // `total` counts what the filter matched, not the whole file, so a filtered
    // read cannot report a page smaller than its own total.
    expect((await log.list({ severity: 'error' })).total).toBe(1);
  });

  it('reads an empty log without creating noise or throwing', async () => {
    const log = createAnomalyLog({ dataDir });

    const result = await log.list({});
    expect(result.anomalies).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('skips corrupt lines instead of failing the whole read', async () => {
    const log = createAnomalyLog({ dataDir });
    await log.append({ kind: 'ui-lag', severity: 'warn', summary: 'good' }, 'web');
    // A truncated final write (killed process, full disk) must not make every
    // earlier record unreadable.
    await writeFile(log.path, `${await readFile(log.path, 'utf8')}{"kind":"ui-l\n`, 'utf8');

    const { anomalies } = await log.list({});
    expect(anomalies.map((a) => a.summary)).toEqual(['good']);
  });

  it('redacts secrets out of the summary and detail before they reach disk', async () => {
    const log = createAnomalyLog({ dataDir });

    await log.append(
      {
        kind: 'request-failed',
        severity: 'error',
        summary: 'call refused with authorization: Bearer sk-ant-api03-SUPERSECRETVALUE12345',
        detail: { header: 'authorization: Bearer sk-ant-api03-SUPERSECRETVALUE12345' },
      },
      'daemon',
    );

    const onDisk = await readFile(log.path, 'utf8');
    expect(onDisk).not.toContain('SUPERSECRETVALUE12345');
  });

  it('bounds an oversized detail payload so one record cannot dominate the log', async () => {
    const log = createAnomalyLog({ dataDir });

    await log.append(
      {
        kind: 'preview-error',
        severity: 'warn',
        summary: 'huge',
        detail: { blob: 'x'.repeat(200_000) },
      },
      'web',
    );

    const onDisk = await readFile(log.path, 'utf8');
    expect(onDisk.length).toBeLessThan(20_000);
    const { anomalies } = await log.list({});
    expect(anomalies).toHaveLength(1);
  });

  it('rotates once the log passes its size cap, keeping the newest records readable', async () => {
    const log = createAnomalyLog({ dataDir });
    // Pre-fill past the cap so the next append has to rotate.
    await mkdir(dirname(log.path), { recursive: true });
    await writeFile(log.path, 'x'.repeat(ANOMALY_LOG_MAX_BYTES + 1), 'utf8');

    await log.append({ kind: 'ui-lag', severity: 'warn', summary: 'after rotate' }, 'web');

    const { anomalies } = await log.list({});
    expect(anomalies.map((a) => a.summary)).toEqual(['after rotate']);
    // The previous generation is kept rather than deleted, so a rotation in the
    // middle of a testing session does not destroy what was already caught.
    expect(await readFile(`${log.path}.1`, 'utf8')).toContain('x');
  });

  // A rotation is the one event that removes records nobody deleted. The 24 h
  // capture behind INV-3.10 polls this log for a whole day, which is long enough
  // to roll it, so a reader has to be able to tell a quiet window from a rolled
  // one. The cases below pin what makes that possible: a number on every
  // record, a read that covers both generations, and an envelope that says so.

  /** Pushes the current generation past its cap so the next append has to rotate. */
  async function fillPastCap(path: string): Promise<void> {
    // Padding the reader skips, so the rotated generation still holds only real
    // records — the point is what survives the roll, not what pads it.
    await appendFile(path, `${' '.repeat(ANOMALY_LOG_MAX_BYTES)}\n`, 'utf8');
  }

  it('stamps a monotonic sequence that keeps counting across a rotation', async () => {
    const log = createAnomalyLog({ dataDir });
    await log.append({ kind: 'ui-lag', severity: 'warn', summary: 'one' }, 'web');
    await log.append({ kind: 'ui-lag', severity: 'warn', summary: 'two' }, 'web');
    await fillPastCap(log.path);
    await log.append({ kind: 'ui-lag', severity: 'warn', summary: 'three' }, 'web');

    const { anomalies, firstSeq, lastSeq } = await log.list({});

    // Ids are random and timestamps repeat, so only an ordered number lets a
    // reader count the records a rotation took away.
    expect(anomalies.map((a) => a.seq)).toEqual([3, 2, 1]);
    expect(firstSeq).toBe(1);
    expect(lastSeq).toBe(3);
  });

  it('recovers the sequence from disk so a restart does not reuse a number', async () => {
    const first = createAnomalyLog({ dataDir });
    await first.append({ kind: 'ui-lag', severity: 'warn', summary: 'one' }, 'web');
    await first.append({ kind: 'ui-lag', severity: 'warn', summary: 'two' }, 'web');

    // A new daemon process reading the same data root continues the count; a
    // sequence that restarted at one would look to a poller like a rotation.
    const restarted = createAnomalyLog({ dataDir });
    await restarted.append({ kind: 'ui-lag', severity: 'warn', summary: 'three' }, 'web');

    expect((await restarted.list({})).anomalies.map((a) => a.seq)).toEqual([3, 2, 1]);
  });

  it('reads the retained generation, so a rotation does not censor an interval export', async () => {
    const log = createAnomalyLog({ dataDir });
    const before = new Date(Date.now() - 60_000).toISOString();
    await log.append({ kind: 'ui-lag', severity: 'warn', summary: 'before the roll' }, 'web');
    await fillPastCap(log.path);
    await log.append({ kind: 'ui-lag', severity: 'warn', summary: 'after the roll' }, 'web');

    const result = await log.list({ since: before });

    // Both records are still on disk. A read that covers only the current file
    // returns the newer one and says nothing about the older, which is data loss
    // no field of the answer reveals.
    expect(result.anomalies.map((a) => a.summary)).toEqual(['after the roll', 'before the roll']);
    expect(result.total).toBe(2);
    expect(result.generations).toBe(2);
  });

  it('reports one generation and a one-record range after the first append', async () => {
    const log = createAnomalyLog({ dataDir });
    await log.append({ kind: 'ui-lag', severity: 'warn', summary: 'only one' }, 'web');

    const result = await log.list({});

    expect(result.generations).toBe(1);
    expect(result.firstSeq).toBe(1);
    expect(result.lastSeq).toBe(1);
  });

  it('reports zero generations and no sequence range for a log that has never been written', async () => {
    const log = createAnomalyLog({ dataDir });

    const result = await log.list({});

    expect(result.generations).toBe(0);
    expect(result.firstSeq).toBe(null);
    expect(result.lastSeq).toBe(null);
    expect(result.total).toBe(0);
    expect(result.anomalies).toEqual([]);
  });

  it('restarts the sequence after a clear, so an empty log always means seq 1 next', async () => {
    const log = createAnomalyLog({ dataDir });
    await log.append({ kind: 'ui-lag', severity: 'warn', summary: 'one' }, 'web');
    await log.append({ kind: 'ui-lag', severity: 'warn', summary: 'two' }, 'web');

    await log.clear();
    await log.append({ kind: 'ui-lag', severity: 'warn', summary: 'after the clear' }, 'web');

    // Nothing survives a clear for the next record to be monotonic against, and
    // a reader needs "the log is empty" and "the next record is seq 1" to be the
    // same statement: it is what lets a later answer starting above 1 be read as
    // records that were written and lost.
    const { anomalies, firstSeq, lastSeq } = await log.list({});
    expect(anomalies.map((a) => a.seq)).toEqual([1]);
    expect(firstSeq).toBe(1);
    expect(lastSeq).toBe(1);
  });

  it('clears the log and reports how many records went away', async () => {
    const log = createAnomalyLog({ dataDir });
    await log.append({ kind: 'ui-lag', severity: 'warn', summary: 'a' }, 'web');
    await fillPastCap(log.path);
    await log.append({ kind: 'ui-lag', severity: 'warn', summary: 'b' }, 'web');

    // The cleared count must include the retained generation (.1), which
    // readRetainedHistory() provides, and clearing removes both generations.
    expect(await log.clear()).toBe(2);
    expect((await log.list({})).total).toBe(0);
    // Clearing an already-empty log is not an error.
    expect(await log.clear()).toBe(0);
  });

  it('keeps concurrent appends from interleaving into corrupt lines', async () => {
    const log = createAnomalyLog({ dataDir });

    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        log.append(
          { kind: 'ui-lag', severity: 'warn', summary: `concurrent-${i}`, detail: { i } },
          'web',
        ),
      ),
    );

    const { anomalies, total } = await log.list({});
    expect(total).toBe(40);
    expect(new Set(anomalies.map((a) => a.summary)).size).toBe(40);
  });
});
