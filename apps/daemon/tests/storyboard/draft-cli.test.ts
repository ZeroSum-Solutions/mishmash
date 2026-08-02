// od storyboard draft CLI — POST /api/storyboards/:id/draft-shots
//
// AGENTS.md (Capability exposure / UI-CLI dual-track): every capability
// needs a CLI leg alongside the UI, landed in the same PR, and the CLI form
// must accept long-form prompts via --prompt-file <path|-> so a brief can be
// piped in via heredoc/stdin.
//
// Live end-to-end: spawn the real src/cli.ts against a fake daemon that
// records the exact POST it received (method, url, parsed JSON body), and
// assert the CLI's --json stdout — same fake-daemon integration pattern as
// apps/daemon/tests/brands-cli.test.ts, extended with stdin plumbing (as
// apps/daemon/tests/media-generate-prompt-file.test.ts does) for the
// --prompt-file - case.

import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const daemonRoot = fileURLToPath(new URL('../..', import.meta.url));
const cliEntry = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));

const DRAFT_RESPONSE = {
  storyboard: {
    id: 'sb-1',
    title: 'Test storyboard',
    createdAt: 't0',
    updatedAt: 't1',
    ratio: '16:9',
    moodDrafts: [],
    shots: [],
  },
  drafted: 3,
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
      if (req.method === 'POST' && req.url === '/api/storyboards/sb-1/draft-shots') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(DRAFT_RESPONSE));
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

describe('od storyboard draft CLI', () => {
  it('sends the brief and shot count to draft-shots and prints the --json result', async () => {
    const { code, stdout, stderr } = await runCli([
      'storyboard', 'draft', 'sb-1',
      '--brief', 'A calm ad for a ceramic mug, warm morning light.',
      '--shot-count', '3',
      '--daemon-url', baseUrl,
      '--json',
    ]);

    expect(code, `od storyboard draft exited ${code}; stderr:\n${stderr}`).toBe(0);
    expect(seenRequests).toHaveLength(1);
    expect(seenRequests[0]?.method).toBe('POST');
    expect(seenRequests[0]?.url).toBe('/api/storyboards/sb-1/draft-shots');
    expect(JSON.parse(seenRequests[0]?.body ?? '')).toEqual({
      brief: 'A calm ad for a ceramic mug, warm morning light.',
      shotCount: 3,
    });
    expect(JSON.parse(stdout)).toEqual(DRAFT_RESPONSE);
  });

  it('reads the brief from stdin when --prompt-file is -', async () => {
    const BRIEF = 'A slow dolly through a rain-lit alley, neon reflections.';

    const { code, stdout, stderr } = await runCli(
      [
        'storyboard', 'draft', 'sb-1',
        '--prompt-file', '-',
        '--daemon-url', baseUrl,
        '--json',
      ],
      BRIEF,
    );

    expect(code, `od storyboard draft exited ${code}; stderr:\n${stderr}`).toBe(0);
    expect(seenRequests).toHaveLength(1);
    expect(seenRequests[0]?.method).toBe('POST');
    expect(seenRequests[0]?.url).toBe('/api/storyboards/sb-1/draft-shots');
    expect(JSON.parse(seenRequests[0]?.body ?? '')).toEqual({ brief: BRIEF });
    expect(JSON.parse(stdout)).toEqual(DRAFT_RESPONSE);
  });
});
