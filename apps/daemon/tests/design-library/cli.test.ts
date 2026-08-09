import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type http from 'node:http';
import { createServer } from 'node:http';

import { startServer } from '../../src/server.js';

const execFileP = promisify(execFile);
const daemonRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = path.resolve(daemonRoot, '../..');
const cliSource = path.join(daemonRoot, 'src', 'cli.ts');
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

describe('design-library CLI privacy', () => {
  let server: http.Server | null = null;
  let shutdown: (() => Promise<void> | void) | undefined;
  let fixtureDir: string | null = null;
  const previousRoot = process.env.OD_DESIGN_LIBRARY_DIR;

  afterEach(async () => {
    await Promise.resolve(shutdown?.());
    shutdown = undefined;
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    }
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
    fixtureDir = null;
    if (previousRoot === undefined) delete process.env.OD_DESIGN_LIBRARY_DIR;
    else process.env.OD_DESIGN_LIBRARY_DIR = previousRoot;
  });

  it('catalog --json exposes public catalog fields without private rights provenance', async () => {
    fixtureDir = mkdtempSync(path.join(tmpdir(), 'od-design-library-cli-'));
    mkdirSync(path.join(fixtureDir, '.catalog'), { recursive: true });
    writeFileSync(
      path.join(fixtureDir, 'catalog.json'),
      JSON.stringify({
        library: 'Synthetic CLI Library',
        rights_ledger: 'RIGHTS.md',
        note: 'Synthetic public catalog.',
        total_collections: 1,
        groups: [{
          title: 'Synthetic',
          folder: '01 Synthetic',
          blurb: 'Synthetic CLI fixture.',
          items: [{
            id: 'cli-safe-item',
            label: 'CLI Safe Item',
            rel: '01 Synthetic/safe-item',
            thumb: null,
            kind: 'Synthetic',
            files: 1,
            size: '1 KB',
            category: '01 Synthetic',
            domains: ['test'],
            allowed_use: 'licensed-source-review',
          }],
        }],
      }),
      'utf8',
    );
    writeFileSync(
      path.join(fixtureDir, '.catalog', 'rights.json'),
      JSON.stringify({
        version: 1,
        records: {
          '01 Synthetic/safe-item': {
            tree_sha256: '0'.repeat(64),
            allowed_use: 'licensed-source-review',
            licence_ref: 'UI8-INVOICE-PRIVATE-MARKER',
            source_url: 'https://private.example.invalid/source',
            captured_at: '2026-08-07T00:00:00.000Z',
            notes: 'PRIVATE-RIGHTS-NOTES-MARKER',
          },
        },
      }),
      'utf8',
    );
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
      shutdown?: () => Promise<void> | void;
    };
    server = started.server;
    shutdown = started.shutdown;

    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    const { stdout, stderr } = await execFileP(
      process.execPath,
      [tsxCli, cliSource, 'design-library', 'catalog', '--json', '--daemon-url', started.url],
      { cwd: daemonRoot, env, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
    );

    expect(stderr).toBe('');
    const output = JSON.parse(stdout) as { groups: Array<{ items: Array<Record<string, unknown>> }> };
    expect(output.groups[0]?.items[0]).toMatchObject({
      id: 'cli-safe-item',
      allowed_use: 'licensed-source-review',
    });
    expect(stdout).not.toContain('UI8-INVOICE-PRIVATE-MARKER');
    expect(stdout).not.toContain('private.example.invalid');
    expect(stdout).not.toContain('PRIVATE-RIGHTS-NOTES-MARKER');
    expect(stdout).not.toContain('licence_ref');
    expect(stdout).not.toContain('source_url');
    expect(stdout).not.toContain('captured_at');
  });

  it('promote and promotions use the shared HTTP contracts with JSON parity', async () => {
    const seen: Array<{ method: string; url: string; body: unknown }> = [];
    const mock = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
        seen.push({ method: req.method ?? '', url: req.url ?? '', body });
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'POST') {
          res.statusCode = 201;
          res.end(JSON.stringify({ deduped: false, promotion: { id: 'promotion-1', assetId: 'asset-1', status: 'pending' } }));
        } else {
          res.end(JSON.stringify({ promotions: [{ id: 'promotion-1', assetId: 'asset-1', status: 'pending' }] }));
        }
      });
    });
    await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
    server = mock;
    const address = mock.address();
    if (!address || typeof address === 'string') throw new Error('mock server did not bind');
    const daemonUrl = `http://127.0.0.1:${address.port}`;
    const env = { ...process.env };
    delete env.NODE_OPTIONS;

    const promoted = await execFileP(process.execPath, [
      tsxCli, cliSource, 'design-library', 'promote', '--asset', 'asset-1',
      '--group', 'app-captures', '--note', 'synthetic', '--json', '--daemon-url', daemonUrl,
    ], { cwd: daemonRoot, env, timeout: 15_000 });
    expect(JSON.parse(promoted.stdout)).toMatchObject({ deduped: false, promotion: { id: 'promotion-1' } });
    expect(seen[0]).toMatchObject({
      method: 'POST',
      url: '/api/design-library/promotions',
      body: { assetId: 'asset-1', proposedGroup: 'app-captures', requesterNote: 'synthetic' },
    });
    expect((seen[0]?.body as { idempotencyKey?: string }).idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);

    const listed = await execFileP(process.execPath, [
      tsxCli, cliSource, 'design-library', 'promotions', '--status', 'all', '--json', '--daemon-url', daemonUrl,
    ], { cwd: daemonRoot, env, timeout: 15_000 });
    expect(JSON.parse(listed.stdout)).toEqual({ promotions: [{ id: 'promotion-1', assetId: 'asset-1', status: 'pending' }] });
    expect(seen[1]).toMatchObject({ method: 'GET', url: '/api/design-library/promotions?status=all' });

    await expect(execFileP(process.execPath, [
      tsxCli, cliSource, 'design-library', 'promote', '--asset', 'one', '--asset', 'two',
      '--group', 'app-captures', '--daemon-url', daemonUrl,
    ], { cwd: daemonRoot, env, timeout: 15_000 })).rejects.toMatchObject({ code: 2 });
    await expect(execFileP(process.execPath, [
      tsxCli, cliSource, 'design-library', 'promotions', 'unexpected', '--daemon-url', daemonUrl,
    ], { cwd: daemonRoot, env, timeout: 15_000 })).rejects.toMatchObject({ code: 2 });
  });
});
