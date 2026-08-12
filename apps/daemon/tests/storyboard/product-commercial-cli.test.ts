import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const daemonRoot = fileURLToPath(new URL('../..', import.meta.url));
const cliEntry = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));

let server: http.Server | undefined;
let baseUrl = '';
let seenRequests: Array<{ method: string; url: string; body: string }> = [];

beforeEach(async () => {
  seenRequests = [];
  server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seenRequests.push({ method: req.method ?? '', url: req.url ?? '', body });
      res.writeHead(req.method === 'POST' ? 201 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ storyboard: { id: 'sb-1', title: 'Luma Bottle' } }));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', cliEntry, ...args], {
      cwd: daemonRoot,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

describe('od storyboard product commercial parity', () => {
  it('creates the guided recipe with the same structured brief as the web UI', async () => {
    const result = await runCli([
      'storyboard', 'create',
      '--recipe', 'hero-product-commercial',
      '--product', 'Luma Bottle',
      '--audience', 'Busy commuters',
      '--promise', 'Cold water all day',
      '--direction', 'Clean daylight with tactile close-ups',
      '--cta', 'Take cold water anywhere',
      '--ratio', '9:16',
      '--daemon-url', baseUrl,
      '--json',
    ]);

    expect(result.code, result.stderr).toBe(0);
    expect(seenRequests).toHaveLength(1);
    expect(JSON.parse(seenRequests[0]!.body)).toEqual({
      recipe: 'hero-product-commercial',
      ratio: '9:16',
      commercialBrief: {
        productName: 'Luma Bottle',
        audience: 'Busy commuters',
        promise: 'Cold water all day',
        visualDirection: 'Clean daylight with tactile close-ups',
        callToAction: 'Take cold water anywhere',
      },
    });
  });

  it('approves a take with optional notes and comparison scores', async () => {
    const result = await runCli([
      'storyboard', 'review-take', 'sb-1', 'shot-1', 'task-1',
      '--approve',
      '--note', 'Clean silhouette',
      '--brand-fit', '5',
      '--motion-quality', '4',
      '--artifact-control', '5',
      '--revision-ease', '4',
      '--daemon-url', baseUrl,
      '--json',
    ]);

    expect(result.code, result.stderr).toBe(0);
    expect(seenRequests[0]).toMatchObject({
      method: 'PUT',
      url: '/api/storyboards/sb-1/shots/shot-1/takes/task-1/review',
    });
    expect(JSON.parse(seenRequests[0]!.body)).toEqual({
      decision: 'approved',
      note: 'Clean silhouette',
      scores: { brandFit: 5, motionQuality: 4, artifactControl: 5, revisionEase: 4 },
    });
  });
});
