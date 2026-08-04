import { spawn } from 'node:child_process';
import http from 'node:http';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_ROOT = pathResolve(__dirname, '..');
const REPO_ROOT = pathResolve(__dirname, '../../..');
const CLI_SRC = pathResolve(__dirname, '../src/cli.ts');
const TSX_CLI = pathResolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

interface CapturedRequest {
  method: string;
  url: string;
  body: string;
}

let server: http.Server | undefined;
let baseUrl = '';
let requests: CapturedRequest[] = [];

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  requests = [];
});

async function startStubServer() {
  requests = [];
  server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', body });
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'enqueued', scoreId: 'score-1' }));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('stub server has no address');
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function runCli(
  args: string[],
  input?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, CLI_SRC, ...args], {
      cwd: DAEMON_ROOT,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
    child.stdin.end(input);
  });
}

describe('od feedback', () => {
  it('posts the web feedback payload and emits the daemon response as JSON', async () => {
    await startStubServer();

    const result = await runCli([
      'feedback', 'run-123',
      '--project', 'project-123',
      '--conversation', 'conversation-123',
      '--message', 'assistant-message-123',
      '--rating', 'negative',
      '--reason', 'missed_request,hard_to_use,other',
      '--note', 'The requested flow was missing.',
      '--json',
      '--daemon-url', baseUrl,
    ]);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({ status: 'enqueued', scoreId: 'score-1' });
    expect(requests).toEqual([{
      method: 'POST',
      url: '/api/runs/run-123/feedback',
      body: JSON.stringify({
        projectId: 'project-123',
        conversationId: 'conversation-123',
        assistantMessageId: 'assistant-message-123',
        rating: 'negative',
        reasonCodes: ['missed_request', 'hard_to_use', 'other'],
        hasCustomReason: true,
        customReason: 'The requested flow was missing.',
      }),
    }]);
  });

  it('reads the custom reason from stdin with --prompt-file -', async () => {
    await startStubServer();

    const result = await runCli([
      'feedback', 'run-456',
      '--project', 'project-456',
      '--conversation', 'conversation-456',
      '--message', 'assistant-message-456',
      '--rating', 'positive',
      '--reason', 'matched_request,other',
      '--prompt-file', '-',
      '--daemon-url', baseUrl,
    ], 'The response was exactly what I needed.\n');

    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(requests[0]!.body)).toMatchObject({
      customReason: 'The response was exactly what I needed.',
      hasCustomReason: true,
    });
  });
});
