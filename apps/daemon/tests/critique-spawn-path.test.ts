/**
 * End-to-end tests for the Critique Theater spawn path inside server.ts.
 *
 * `critique-spawn-wiring.test.ts` covers the orchestrator seam by *simulating*
 * what the spawn branch does ("Simulate what the spawn branch does: check
 * cfg.enabled before calling orchestrator"). That shape can never catch a
 * defect in the branch itself, because the test re-implements the logic it is
 * meant to verify. These tests drive a real server, a real spawned child and a
 * real stdin/stdout pipe, so they fail when server.ts's own wiring is wrong.
 *
 * Adapter choice matters: `qwen` is the shipped runtime that is BOTH
 * `promptViaStdin: true` and `streamFormat: 'plain'`
 * (`src/runtimes/defs/qwen.ts`). Plain-stream is what routes a run into
 * `runOrchestrator`, and stdin is how that runtime receives its prompt, so it
 * is the intersection where the critique branch and the stdin write path have
 * to agree. `antigravity` and `deepseek` share the same pair.
 */
import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * `server.ts` builds its CritiqueConfig at module scope
 * (`const critiqueCfg = loadCritiqueConfigFromEnv()`, server.ts:1148), so
 * OD_CRITIQUE_* values are frozen the moment the module is first imported.
 * A static import would therefore capture the defaults no matter what
 * beforeAll sets. Import dynamically, after the env is in place.
 */
type StartServer = (typeof import('../src/server.js'))['startServer'];
let startServer: StartServer;

/** Single-round ship frame — the smallest transcript the parser accepts. */
function shipTranscript(): string {
  return [
    '<CRITIQUE_RUN version="1" maxRounds="3" threshold="8.0" scale="10">',
    '  <ROUND n="1">',
    '    <PANELIST role="designer">',
    '      <NOTES>Design intent v1.</NOTES>',
    '    </PANELIST>',
    '    <PANELIST role="critic" score="9.0"><DIM name="hierarchy" score="9">Good.</DIM></PANELIST>',
    '    <PANELIST role="brand" score="9.0"><DIM name="voice" score="9">Strong.</DIM></PANELIST>',
    '    <PANELIST role="a11y" score="9.0"><DIM name="contrast" score="9">Passes AA.</DIM></PANELIST>',
    '    <PANELIST role="copy" score="9.0"><DIM name="clarity" score="9">Clear.</DIM></PANELIST>',
    '    <ROUND_END n="1" composite="9.0" must_fix="0" decision="ship">',
    '      <REASON>Threshold met.</REASON>',
    '    </ROUND_END>',
    '  </ROUND>',
    '  <SHIP round="1" composite="9.0" status="shipped">',
    '    <ARTIFACT mime="text/html"><![CDATA[<html><body>final</body></html>]]></ARTIFACT>',
    '    <SUMMARY>Converged in one round.</SUMMARY>',
    '  </SHIP>',
    '</CRITIQUE_RUN>',
  ].join('\n');
}

function killProcessesUsingPath(pathFragment: string): void {
  if (process.platform === 'win32') return;
  let output = '';
  try {
    output = execFileSync('pgrep', ['-f', pathFragment], { encoding: 'utf8' });
  } catch {
    return;
  }
  for (const line of output.split('\n')) {
    const pid = Number(line.trim());
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  }
}

async function withFakeAgent<T>(binName: string, script: string, run: () => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'od-critique-spawn-bin-'));
  const oldPath = process.env.PATH;
  try {
    if (process.platform === 'win32') {
      const runner = join(dir, `${binName}-test-runner.cjs`);
      await fsp.writeFile(runner, script);
      await fsp.writeFile(join(dir, `${binName}.cmd`), `@echo off\r\nnode "${runner}" %*\r\n`);
    } else {
      const bin = join(dir, binName);
      await fsp.writeFile(bin, `#!/usr/bin/env node\n${script}`);
      await fsp.chmod(bin, 0o755);
    }
    process.env.PATH = `${dir}${delimiter}${oldPath ?? ''}`;
    return await run();
  } finally {
    process.env.PATH = oldPath;
    killProcessesUsingPath(dir);
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

describe('critique spawn path (real child, real pipe)', () => {
  let server: http.Server;
  let baseUrl: string;
  const tempDirs: string[] = [];
  const originalPath = process.env.PATH;
  const originalEnv: Record<string, string | undefined> = {};

  function setEnv(key: string, value: string): void {
    if (!(key in originalEnv)) originalEnv[key] = process.env[key];
    process.env[key] = value;
  }

  beforeAll(async () => {
    if (!process.env.OD_DATA_DIR) {
      throw new Error('OD_DATA_DIR is required for critique spawn-path tests');
    }
    // Read once at boot by loadCritiqueConfigFromEnv, so it must be set before
    // startServer. A short total timeout keeps a regression (child waiting on
    // stdin that never arrives) failing in seconds instead of the 10-minute
    // production default.
    setEnv('OD_CRITIQUE_TOTAL_TIMEOUT_MS', '20000');
    // Cap of 1 is what makes the second concurrent run land over capacity.
    setEnv('OD_CRITIQUE_MAX_CONCURRENT_RUNS', '1');
    ({ startServer } = await import('../src/server.js'));
    const started = await startServer({ port: 0, returnServer: true }) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterEach(() => {
    if (originalPath == null) delete process.env.PATH;
    else process.env.PATH = originalPath;
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    for (const dir of tempDirs.splice(0)) {
      await fsp.rm(dir, { recursive: true, force: true });
    }
    if (server) await new Promise<void>((r) => server.close(() => r()));
  });

  async function makeSkill(policy: 'opt-in' | 'opt-out' | null): Promise<string> {
    const skillId = `critique-spawn-${randomUUID()}`;
    const skillDir = resolve(process.env.OD_DATA_DIR!, 'skills', skillId);
    tempDirs.push(skillDir);
    await fsp.mkdir(skillDir, { recursive: true });
    const policyBlock = policy === null ? '' : `od:\n  critique:\n    policy: ${policy}\n`;
    await fsp.writeFile(
      resolve(skillDir, 'SKILL.md'),
      `---\nname: ${skillId}\ndescription: Critique spawn-path fixture.\n${policyBlock}---\n\n# Fixture\n`,
      'utf8',
    );
    return skillId;
  }

  it('delivers the composed prompt to a stdin-based plain adapter on the critique path', async () => {
    const skillId = await makeSkill('opt-in');
    const markerDir = await fsp.mkdtemp(join(tmpdir(), 'od-critique-stdin-'));
    tempDirs.push(markerDir);
    const promptFile = join(markerDir, 'received-prompt.txt');

    // A critique run inserts a `critique_runs` row keyed to a real project;
    // without one the insert trips a FOREIGN KEY constraint and the run fails
    // before the orchestrator is reached, which would make this test red for
    // the wrong reason.
    const projectId = `proj-${randomUUID()}`;
    const createProject = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: 'critique spawn fixture' }),
    });
    expect(createProject.ok).toBe(true);

    setEnv('OD_CRITIQUE_ENABLED', 'true');

    await withFakeAgent(
      'qwen',
      `
const fs = require('node:fs');
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { prompt += chunk; });
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(promptFile)}, prompt);
  process.stdout.write(${JSON.stringify(`${shipTranscript()}\n`)});
  process.exit(0);
});
`,
      async () => {
        const response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'qwen',
            projectId,
            designSystemId: 'default',
            message: 'draft a critique-eligible artifact',
            skillIds: [skillId],
          }),
        });
        const body = await response.text();
        if (process.env.OD_CRITIQUE_SPAWN_DEBUG) console.log('=== SSE BODY ===\n' + body.slice(0, 4000));
        expect(response.ok).toBe(true);

        // The child can only write this file after stdin reaches EOF. If the
        // critique branch returns before the shared stdin write, the file is
        // never created and the run dies on the total timeout instead.
        const received = await fsp.readFile(promptFile, 'utf8').catch(() => null);
        expect(received, 'stdin-based adapter never received its prompt on the critique path').not.toBeNull();
        expect(received).toContain('draft a critique-eligible artifact');
        // Eligible run => the panel addendum must be in the delivered prompt.
        expect(received).toContain('<CRITIQUE_RUN');
      },
    );
  }, 90_000);
  it('denies the panel addendum to a run that is over the concurrency cap', async () => {
    // The cap is 1 (set in beforeAll). Run A holds the only slot while run B
    // is composed, so B must come back ineligible.
    //
    // The defect this pins: capacity used to be checked at SPAWN, after the
    // panel addendum had already been composed into B's prompt and B's child
    // was already running. B then fell through to legacy streaming, which has
    // no critique parser — so B burned a jury-style model call and streamed
    // raw <CRITIQUE_RUN> protocol back as visible assistant text, and the cap
    // saved no cost at all. Capacity is now claimed by the same decision that
    // writes the addendum, so an over-cap run is composed as an ordinary run.
    const skillId = await makeSkill('opt-in');
    const markerDir = await fsp.mkdtemp(join(tmpdir(), 'od-critique-cap-'));
    tempDirs.push(markerDir);
    const promptA = join(markerDir, 'prompt-A.txt');
    const promptB = join(markerDir, 'prompt-B.txt');
    const releaseFile = join(markerDir, 'release-A');

    const projectId = `proj-${randomUUID()}`;
    const createProject = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: 'critique capacity fixture' }),
    });
    expect(createProject.ok).toBe(true);

    setEnv('OD_CRITIQUE_ENABLED', 'true');

    await withFakeAgent(
      'qwen',
      `
const fs = require('node:fs');
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { prompt += chunk; });
process.stdin.on('end', () => {
  const isHolder = prompt.includes('HOLD-THE-SLOT');
  fs.writeFileSync(isHolder ? ${JSON.stringify(promptA)} : ${JSON.stringify(promptB)}, prompt);
  const finish = () => {
    process.stdout.write(${JSON.stringify(`${shipTranscript()}
`)});
    process.exit(0);
  };
  if (!isHolder) return finish();
  // Hold the registry slot open until the test releases it.
  const poll = setInterval(() => {
    if (fs.existsSync(${JSON.stringify(releaseFile)})) { clearInterval(poll); finish(); }
  }, 25);
});
`,
      async () => {
        const runA = fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'qwen',
            projectId,
            designSystemId: 'default',
            message: 'HOLD-THE-SLOT draft the first artifact',
            skillIds: [skillId],
          }),
        }).then((r) => r.text());

        // A holds the slot from the moment it is composed; its prompt file
        // appears once the child has actually received that prompt.
        const deadline = Date.now() + 30_000;
        while (!(await fsp.stat(promptA).then(() => true).catch(() => false))) {
          if (Date.now() > deadline) throw new Error('run A never received its prompt');
          await new Promise((r) => setTimeout(r, 25));
        }

        const responseB = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: 'qwen',
            projectId,
            designSystemId: 'default',
            message: 'draft the second artifact',
            skillIds: [skillId],
          }),
        });
        await responseB.text();
        expect(responseB.ok).toBe(true);

        await fsp.writeFile(releaseFile, 'go', 'utf8');
        await runA;

        const deliveredA = await fsp.readFile(promptA, 'utf8');
        const deliveredB = await fsp.readFile(promptB, 'utf8').catch(() => null);

        // Anti-vacuity: if critique were simply off for both runs, B would
        // trivially have no panel and this test would pass while proving
        // nothing. A must actually have been given the panel.
        expect(deliveredA, 'run A was never given the panel — the fixture is not exercising critique').toContain('<CRITIQUE_RUN');
        expect(deliveredB, 'run B never ran').not.toBeNull();
        expect(deliveredB).toContain('draft the second artifact');
        expect(
          deliveredB,
          'over-cap run was told to emit <CRITIQUE_RUN> tags that no orchestrator would consume',
        ).not.toContain('<CRITIQUE_RUN');
      },
    );
  }, 120_000);
});
