// od storyboard style-reference CLI — POST/DELETE
// /api/storyboards/:id/style-reference (see style-reference.test.ts for the
// route half).
//
// AGENTS.md (Capability exposure / UI-CLI dual-track): the style-reference
// capability needs a CLI leg alongside the web control, in the same PR, with
// long-form input accepted from a file or stdin (`--design-md <path|->`) so a
// DESIGN.md can be piped in via heredoc.
//
// Live end-to-end: spawn the real src/cli.ts against a fake daemon recording
// the exact request it received — same fake-daemon pattern as
// draft-cli.test.ts, including its stdin plumbing.

import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const daemonRoot = fileURLToPath(new URL('../..', import.meta.url));
const cliEntry = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));

const DESIGN_MD = '---\nname: Heritage\ncolors:\n  accent: "#8a5a2b"\n---\n# Heritage\n';

const STYLE_RESPONSE = {
  storyboard: {
    id: 'sb-1',
    title: 'Test storyboard',
    createdAt: 't0',
    updatedAt: 't1',
    ratio: '16:9',
    moodDrafts: [],
    shots: [],
    styleReference: {
      source: 'design-md',
      updatedAt: 't1',
      brand: { name: 'Heritage' },
    },
  },
};

let server: http.Server | undefined;
let baseUrl = '';
let seenRequests: Array<{ method: string; url: string; body: string }> = [];

beforeEach(async () => {
  seenRequests = [];
  server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      seenRequests.push({ method: req.method ?? '', url: req.url ?? '', body });
      if (req.url === '/api/storyboards/sb-1/style-reference' && (req.method === 'POST' || req.method === 'DELETE')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(STYLE_RESPONSE));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

async function runCli(args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', cliEntry, ...args], {
      cwd: daemonRoot,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ code: exitCode ?? -1, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

describe('od storyboard style-reference CLI', () => {
  it('reads DESIGN.md from a file and POSTs it to style-reference', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'od-style-ref-cli-'));
    const file = path.join(dir, 'DESIGN.md');
    await writeFile(file, DESIGN_MD, 'utf8');
    try {
      const { code, stdout, stderr } = await runCli([
        'storyboard', 'style-reference', 'sb-1',
        '--design-md', file,
        '--daemon-url', baseUrl,
        '--json',
      ]);

      expect(code, `exited ${code}; stderr:\n${stderr}`).toBe(0);
      expect(seenRequests).toHaveLength(1);
      expect(seenRequests[0]?.method).toBe('POST');
      expect(seenRequests[0]?.url).toBe('/api/storyboards/sb-1/style-reference');
      expect(JSON.parse(seenRequests[0]?.body ?? '')).toEqual({ designMd: DESIGN_MD });
      expect(JSON.parse(stdout)).toEqual(STYLE_RESPONSE);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reads DESIGN.md from stdin when --design-md is -', async () => {
    const { code, stdout, stderr } = await runCli(
      [
        'storyboard', 'style-reference', 'sb-1',
        '--design-md', '-',
        '--daemon-url', baseUrl,
        '--json',
      ],
      DESIGN_MD,
    );

    expect(code, `exited ${code}; stderr:\n${stderr}`).toBe(0);
    expect(seenRequests).toHaveLength(1);
    expect(seenRequests[0]?.method).toBe('POST');
    expect(JSON.parse(seenRequests[0]?.body ?? '')).toEqual({ designMd: DESIGN_MD });
    expect(JSON.parse(stdout)).toEqual(STYLE_RESPONSE);
  });

  it('sends DELETE for --clear', async () => {
    const { code, stdout, stderr } = await runCli([
      'storyboard', 'style-reference', 'sb-1',
      '--clear',
      '--daemon-url', baseUrl,
      '--json',
    ]);

    expect(code, `exited ${code}; stderr:\n${stderr}`).toBe(0);
    expect(seenRequests).toHaveLength(1);
    expect(seenRequests[0]?.method).toBe('DELETE');
    expect(seenRequests[0]?.url).toBe('/api/storyboards/sb-1/style-reference');
    expect(JSON.parse(stdout)).toEqual(STYLE_RESPONSE);
  });

  it('reports an unreadable --design-md file as a file error, not a daemon failure', async () => {
    const { code, stderr } = await runCli([
      'storyboard', 'style-reference', 'sb-1',
      '--design-md', '/nonexistent/DESIGN.md',
      '--daemon-url', baseUrl,
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain('failed to read --design-md /nonexistent/DESIGN.md');
    expect(stderr).not.toContain('failed to reach daemon');
    expect(seenRequests).toHaveLength(0);
  });

  it('exits 2 with usage when neither --design-md nor --clear is given', async () => {
    const { code, stderr } = await runCli([
      'storyboard', 'style-reference', 'sb-1',
      '--daemon-url', baseUrl,
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain('--design-md');
    expect(seenRequests).toHaveLength(0);
  });
});
