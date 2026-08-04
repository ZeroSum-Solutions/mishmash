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
let telemetryStatus = 202;
let persistenceStatus = 200;

const assistantMessage = {
  id: 'assistant-message-123',
  role: 'assistant',
  content: 'Original assistant response',
  createdAt: 123,
  runId: 'run-123',
};

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  requests = [];
  telemetryStatus = 202;
  persistenceStatus = 200;
});

async function startStubServer() {
  requests = [];
  server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', body });
      if (req.method === 'GET' && req.url?.endsWith('/messages')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ messages: [assistantMessage] }));
        return;
      }
      if (req.method === 'PUT') {
        res.writeHead(persistenceStatus, { 'content-type': 'application/json' });
        res.end(JSON.stringify(persistenceStatus < 400
          ? { message: JSON.parse(body) }
          : { error: 'persistence failed' }));
        return;
      }
      if (req.method === 'POST' && req.url?.includes('/feedback')) {
        res.writeHead(telemetryStatus, { 'content-type': 'application/json' });
        res.end(JSON.stringify(telemetryStatus < 400
          ? { status: 'enqueued', scoreId: 'score-1' }
          : { error: 'telemetry failed' }));
        return;
      }
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
  it('persists the UI-equivalent message write before posting telemetry', async () => {
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
    expect(JSON.parse(result.stdout)).toMatchObject({ message: { id: 'assistant-message-123' } });
    expect(requests).toHaveLength(3);
    expect(requests[0]).toMatchObject({
      method: 'GET',
      url: '/api/projects/project-123/conversations/conversation-123/messages',
    });
    expect(requests[1]).toMatchObject({
      method: 'PUT',
      url: '/api/projects/project-123/conversations/conversation-123/messages/assistant-message-123',
    });
    expect(JSON.parse(requests[1]!.body)).toMatchObject({
      ...assistantMessage,
      feedback: {
        rating: 'negative',
        reasonCodes: ['missed_request', 'hard_to_use', 'other'],
        customReason: 'The requested flow was missing.',
        reasonsSubmittedAt: expect.any(Number),
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
      },
    });
    expect(requests[2]).toEqual({
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
    });
  });

  it('reads the custom reason from stdin with --prompt-file -', async () => {
    await startStubServer();

    const result = await runCli([
      'feedback', 'run-456',
      '--project', 'project-456',
      '--conversation', 'conversation-456',
      '--message', 'assistant-message-123',
      '--rating', 'positive',
      '--reason', 'matched_request,other',
      '--prompt-file', '-',
      '--daemon-url', baseUrl,
    ], 'The response was exactly what I needed.\n');

    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(requests[1]!.body)).toMatchObject({
      feedback: {
        customReason: 'The response was exactly what I needed.',
      },
    });
  });

  it('keeps durable success successful when telemetry fails', async () => {
    telemetryStatus = 500;
    await startStubServer();

    const result = await runCli([
      'feedback', 'run-123', '--project', 'project-123', '--conversation', 'conversation-123',
      '--message', 'assistant-message-123', '--rating', 'positive', '--daemon-url', baseUrl,
    ]);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('Feedback persisted for message assistant-message-123.');
    expect(requests.map((request) => request.method)).toEqual(['GET', 'PUT', 'POST']);
  });

  it('surfaces a durable persistence failure and does not send telemetry', async () => {
    persistenceStatus = 500;
    await startStubServer();

    const result = await runCli([
      'feedback', 'run-123', '--project', 'project-123', '--conversation', 'conversation-123',
      '--message', 'assistant-message-123', '--rating', 'positive', '--daemon-url', baseUrl,
    ]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('persistence failed');
    expect(requests.map((request) => request.method)).toEqual(['GET', 'PUT']);
  });

  it('clears persisted feedback without emitting append-only telemetry', async () => {
    await startStubServer();

    const result = await runCli([
      'feedback', '--clear', '--project', 'project-123', '--conversation', 'conversation-123',
      '--message', 'assistant-message-123', '--daemon-url', baseUrl,
    ]);

    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(requests[1]!.body)).not.toHaveProperty('feedback');
    expect(requests.map((request) => request.method)).toEqual(['GET', 'PUT']);
  });
});
