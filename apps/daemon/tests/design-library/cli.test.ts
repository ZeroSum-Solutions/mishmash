import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type http from 'node:http';

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
});
