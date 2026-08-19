import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { detectAgentsMock, detectAgentsStreamMock } = vi.hoisted(() => ({
  detectAgentsMock: vi.fn(),
  detectAgentsStreamMock: vi.fn(),
}));

vi.mock('../src/agents.js', () => ({
  detectAgents: detectAgentsMock,
  detectAgentsStream: detectAgentsStreamMock,
}));

import { isLocalSameOrigin } from '../src/origin-validation.js';
import { registerStaticResourceRoutes } from '../src/routes/static-resource.js';

const detectedAgent = {
  id: 'codex',
  name: 'Codex CLI',
  bin: 'codex',
  available: true,
  models: [{ id: 'default', label: 'Default' }],
};

describe('GET /api/agents detection cache', () => {
  let server: http.Server | null = null;
  let tempRoot = '';

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
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'od-agent-cache-route-'));
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

  it('reuses a completed detection for an immediate second stream request', async () => {
    const baseUrl = await startServer();

    const first = await fetch(`${baseUrl}/api/agents?stream=1`);
    const second = await fetch(`${baseUrl}/api/agents?stream=1`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(first.text()).resolves.toContain('"id":"codex"');
    await expect(second.text()).resolves.toContain('"id":"codex"');
    expect(detectAgentsStreamMock).toHaveBeenCalledTimes(1);
  });

  it('shares an in-flight detection between concurrent stream requests', async () => {
    let releaseDetection!: () => void;
    const detectionGate = new Promise<void>((resolve) => {
      releaseDetection = resolve;
    });
    detectAgentsStreamMock.mockImplementation(async function* () {
      await detectionGate;
      yield detectedAgent;
    });
    const baseUrl = await startServer();

    const firstResponse = fetch(`${baseUrl}/api/agents?stream=1`);
    await vi.waitFor(() => expect(detectAgentsStreamMock).toHaveBeenCalledTimes(1));
    const secondResponse = fetch(`${baseUrl}/api/agents?stream=1`);
    await new Promise((resolve) => setTimeout(resolve, 25));
    releaseDetection();

    const [first, second] = await Promise.all([firstResponse, secondResponse]);
    await Promise.all([first.text(), second.text()]);
    expect(detectAgentsStreamMock).toHaveBeenCalledTimes(1);
  });

  it('reuses a completed stream detection for a batch request', async () => {
    const baseUrl = await startServer();

    const streamResponse = await fetch(`${baseUrl}/api/agents?stream=1`);
    await streamResponse.text();
    const batchResponse = await fetch(`${baseUrl}/api/agents`);

    expect(batchResponse.status).toBe(200);
    await expect(batchResponse.json()).resolves.toEqual({ agents: [detectedAgent] });
    expect(detectAgentsMock).not.toHaveBeenCalled();
    expect(detectAgentsStreamMock).toHaveBeenCalledTimes(1);
  });

  it('bypasses a completed detection when an explicit refresh is requested', async () => {
    const baseUrl = await startServer();

    const first = await fetch(`${baseUrl}/api/agents?stream=1`);
    await first.text();
    const refreshed = await fetch(`${baseUrl}/api/agents?stream=1&refresh=1`);
    await refreshed.text();

    expect(detectAgentsStreamMock).toHaveBeenCalledTimes(2);
  });
});
