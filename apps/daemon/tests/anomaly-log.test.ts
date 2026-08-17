import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

  it('clears the log and reports how many records went away', async () => {
    const log = createAnomalyLog({ dataDir });
    await log.append({ kind: 'ui-lag', severity: 'warn', summary: 'a' }, 'web');
    await log.append({ kind: 'ui-lag', severity: 'warn', summary: 'b' }, 'web');

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
