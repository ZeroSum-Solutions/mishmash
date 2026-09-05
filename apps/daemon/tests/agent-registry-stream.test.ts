// Red spec for W3B (PRD 3.3, items B-22 / INV-3.4 / INV-3.5, daemon half).
//
// Three claims about `GET /api/agents?stream=1` and the probes behind it:
//
//   1. The stream's frames are a CONTRACT, not an ad-hoc wire. Every frame the
//      daemon really emits must decode through a `packages/contracts` decoder
//      (`parseAgentRegistrySseEvent`). The fixture is a golden recording taken
//      off a real daemon, not a hand-written body — see
//      `tests/fixtures/golden/agent-registry-sse.jsonl` and its capture header.
//   2. INV-3.4: exactly one terminal `done` frame closes a stream, and every
//      other frame is an `agent` frame carrying one AgentInfo.
//   3. B-22: a probe child that ignores SIGTERM must not outlive its timeout.
//      `execAgentFile` bounds each probe with a timeout, but the kill it sends
//      reaches only the direct child and only as SIGTERM, so a CLI that traps
//      or ignores SIGTERM (and any grandchild it spawned) keeps running. 29
//      orphaned `cursor-agent` probes accumulated this way and tripped the
//      fan-out guard.
//   4. INV-3.5 (daemon half): a second caller arriving on a warm cache spawns
//      no new probe.
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRegistrySseEvent } from '@open-design/contracts';

const { detectAgentsMock, detectAgentsStreamMock } = vi.hoisted(() => ({
  detectAgentsMock: vi.fn(),
  detectAgentsStreamMock: vi.fn(),
}));

vi.mock('../src/agents.js', () => ({
  detectAgents: detectAgentsMock,
  detectAgentsStream: detectAgentsStreamMock,
}));

import { execAgentFile } from '../src/runtimes/invocation.js';
import { isLocalSameOrigin } from '../src/origin-validation.js';
import { registerStaticResourceRoutes } from '../src/routes/static-resource.js';

const GOLDEN_PATH = fileURLToPath(
  new URL('./fixtures/golden/agent-registry-sse.jsonl', import.meta.url),
);

interface RecordedFrame {
  event: string;
  data: unknown;
}

function readGoldenFrames(): RecordedFrame[] {
  return fs
    .readFileSync(GOLDEN_PATH, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RecordedFrame)
    .filter((frame) => frame.event !== '_capture');
}

/**
 * Load the contracts decoder without a static import, so a missing export
 * fails as an assertion about the symptom ("the registry stream has no
 * contract-owned frame type") instead of a module resolution error.
 */
async function loadRegistrySseDecoder(): Promise<unknown> {
  const contracts = (await import('@open-design/contracts')) as Record<string, unknown>;
  return contracts.parseAgentRegistrySseEvent;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilGone(pids: number[], timeoutMs: number): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  let alive = pids.filter(isAlive);
  while (alive.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    alive = pids.filter(isAlive);
  }
  return alive;
}

describe('agent registry stream frames', () => {
  it('decodes every recorded frame through the contracts registry-stream decoder', async () => {
    const frames = readGoldenFrames();
    expect(frames.length).toBeGreaterThan(1);

    const decode = await loadRegistrySseDecoder();
    // Red on base: `packages/contracts` owns no registry SSE event union, so
    // the web client hand-parses `event:`/`data:` into an untyped shape.
    expect(typeof decode).toBe('function');

    const parse = decode as (event: string, data: string) => AgentRegistrySseEvent | null;
    for (const frame of frames) {
      const decoded = parse(frame.event, JSON.stringify(frame.data));
      expect(decoded).not.toBeNull();
      expect(decoded).toEqual({ event: frame.event, data: frame.data });
    }
  });

  it('rejects a frame the daemon never emits', async () => {
    const decode = await loadRegistrySseDecoder();
    expect(typeof decode).toBe('function');

    const parse = decode as (event: string, data: string) => AgentRegistrySseEvent | null;
    expect(parse('agent', 'not json')).toBeNull();
    expect(parse('heartbeat', '{}')).toBeNull();
  });

  it('closes the recorded stream with exactly one terminal done frame', () => {
    const frames = readGoldenFrames();
    const doneFrames = frames.filter((frame) => frame.event === 'done');
    const agentFrames = frames.filter((frame) => frame.event === 'agent');

    expect(doneFrames).toHaveLength(1);
    expect(frames.at(-1)?.event).toBe('done');
    expect(agentFrames.length).toBe(frames.length - 1);
    for (const frame of agentFrames) {
      expect(typeof (frame.data as { id?: unknown }).id).toBe('string');
      expect(typeof (frame.data as { available?: unknown }).available).toBe('boolean');
    }
  });
});

describe('agent probe timeout kill', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'od-probe-kill-'));
  });

  afterEach(() => {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = '';
    }
  });

  it.skipIf(process.platform === 'win32')(
    'kills a probe that ignores SIGTERM, and the grandchild it spawned',
    async () => {
      const pidFile = path.join(tempRoot, 'pids');
      const script = path.join(tempRoot, 'stubborn-probe.sh');
      fs.writeFileSync(
        script,
        [
          '#!/bin/sh',
          "trap '' TERM",
          'sleep 30 &',
          'child=$!',
          'echo "$$ $child" > "$1"',
          'wait "$child"',
          '',
        ].join('\n'),
      );
      fs.chmodSync(script, 0o755);

      const settled = execAgentFile(script, [pidFile], { timeout: 500 }).then(
        () => 'settled' as const,
        () => 'settled' as const,
      );
      const outcome = await Promise.race([
        settled,
        new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 5_000)),
      ]);

      const pids = fs
        .readFileSync(pidFile, 'utf8')
        .trim()
        .split(/\s+/)
        .map((value) => Number(value));
      expect(pids).toHaveLength(2);
      expect(pids.every((pid) => Number.isInteger(pid) && pid > 0)).toBe(true);

      const survivors = await waitUntilGone(pids, 3_000);
      // Leave no orphan behind even when the assertion below fails.
      for (const pid of survivors) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          /* not a group leader, or already gone */
        }
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }

      // Red on base: `execFile`'s own timeout sends one SIGTERM to the direct
      // child, which ignores it. There is no process group and no SIGKILL
      // escalation, so the probe call never settles and both the probe and its
      // `sleep` grandchild outlive the budget.
      expect({ outcome, survivors }).toEqual({ outcome: 'settled', survivors: [] });
    },
    20_000,
  );
});

describe('GET /api/agents?stream=1 probe sharing', () => {
  let server: http.Server | null = null;
  let tempRoot = '';

  const detectedAgent = {
    id: 'codex',
    name: 'Codex CLI',
    bin: 'codex',
    available: true,
    models: [{ id: 'default', label: 'Default' }],
  };

  beforeEach(() => {
    detectAgentsMock.mockReset();
    detectAgentsStreamMock.mockReset();
    detectAgentsMock.mockResolvedValue([detectedAgent]);
    detectAgentsStreamMock.mockImplementation(async function* () {
      yield detectedAgent;
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    }
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = '';
    }
  });

  async function startServer(): Promise<string> {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'od-agent-registry-stream-'));
    const app = express();
    app.use(express.json());
    registerStaticResourceRoutes(app, {
      http: {
        createSseResponse: () => undefined,
        isLocalSameOrigin,
        requireLocalDaemonRequest: (_req: unknown, _res: unknown, next: () => void) => next(),
        resolvedPortRef: {
          get current() {
            const address = server?.address();
            return typeof address === 'object' && address ? address.port : 0;
          },
        },
        sendApiError: (res: express.Response, status: number, code: string, message: string) =>
          res.status(status).json({ error: message, code }),
        sendLiveArtifactRouteError: () => undefined,
        sendMulterError: () => undefined,
      },
      paths: {
        ARTIFACTS_DIR: path.join(tempRoot, 'artifacts'),
        BRANDS_DIR: path.join(tempRoot, 'brands'),
        BUNDLED_PETS_DIR: path.join(tempRoot, 'pets'),
        CRAFT_DIR: path.join(tempRoot, 'craft'),
        DESIGN_SYSTEMS_DIR: path.join(tempRoot, 'design-systems'),
        DESIGN_TEMPLATES_DIR: path.join(tempRoot, 'design-templates'),
        LIBRARY_DIR: path.join(tempRoot, 'library'),
        OD_BIN: path.join(tempRoot, 'od'),
        PROJECT_ROOT: tempRoot,
        PROJECTS_DIR: path.join(tempRoot, 'projects'),
        PROMPT_TEMPLATES_DIR: path.join(tempRoot, 'prompt-templates'),
        RUNTIME_DATA_DIR: path.join(tempRoot, 'data'),
        RUNTIME_DATA_DIR_CANONICAL: path.join(tempRoot, 'data'),
        SKILLS_DIR: path.join(tempRoot, 'skills'),
        USER_DESIGN_SYSTEMS_DIR: path.join(tempRoot, 'user-design-systems'),
        USER_DESIGN_TEMPLATES_DIR: path.join(tempRoot, 'user-design-templates'),
        USER_SKILLS_DIR: path.join(tempRoot, 'user-skills'),
      },
      resources: {
        listAllDesignSystems: async () => [],
        listAllSkills: async () => [],
        listAllDesignTemplates: async () => [],
        listAllSkillLikeEntries: async () => [],
        mimeFor: () => 'application/octet-stream',
      },
    });

    server = await new Promise<http.Server>((resolve) => {
      const started = app.listen(0, '127.0.0.1', () => resolve(started));
    });
    const address = server.address() as { port: number };
    return `http://127.0.0.1:${address.port}`;
  }

  it('emits one done per stream and spawns no new probe for a warm second caller', async () => {
    const baseUrl = await startServer();

    const first = await (await fetch(`${baseUrl}/api/agents?stream=1`)).text();
    const second = await (await fetch(`${baseUrl}/api/agents?stream=1`)).text();

    for (const body of [first, second]) {
      expect(body.match(/^event: done$/gm)).toHaveLength(1);
      expect(body).toContain('"id":"codex"');
    }
    expect(detectAgentsStreamMock).toHaveBeenCalledTimes(1);
  });
});
