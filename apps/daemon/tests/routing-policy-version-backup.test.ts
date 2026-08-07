// CWR-P1-3, policy-version half (WR wave, P1 tranche, Amendment 1).
//
// Companion to routing-telemetry-backup.test.ts, which covers the criterion's
// telemetry-rows half. WR-routing.md's Verifier contract states CWR-P1-3 as:
// "an `app-config` archive dump contains a `routingPolicyVersion` key matching
// the active policy's version".
//
// Two things have to hold for that marker to be worth anything, and this file
// asserts BOTH -- the second is the one a governance review (Sol round 2, P1)
// caught as a silent-drop hazard:
//
//   1. createBackupArchive() stamps the ACTIVE policy version into the
//      archived app-config.json, even when the live config never carried the
//      key (the marker describes the system that produced the archive, not a
//      user preference).
//   2. Reading that archived config back through the daemon's normal config
//      path PRESERVES the key. app-config.ts's `filterAllowedKeys` drops every
//      key absent from ALLOWED_KEYS, so without an allowlist entry the marker
//      would be written into the archive and then silently discarded the first
//      time the restored config was read or rewritten -- a marker that cannot
//      survive a restore does not actually record anything.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createBackupArchive } from '../src/backup/create.js';
import { RELPATH_BY_CLASS } from '../src/backup/manifest.js';
import { currentRoutingPolicyVersion } from '../src/routing/policy.js';
import { readAppConfig } from '../src/app-config.js';

let dataDir: string;
let archiveDir: string;

function readArchivedAppConfig(): Record<string, unknown> {
  const archived = path.join(archiveDir, RELPATH_BY_CLASS['app-config']);
  return JSON.parse(readFileSync(archived, 'utf8')) as Record<string, unknown>;
}

beforeEach(() => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'od-routing-policyver-data-'));
  archiveDir = mkdtempSync(path.join(os.tmpdir(), 'od-routing-policyver-archive-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(archiveDir, { recursive: true, force: true });
});

describe('CWR-P1-3: the active routing policy version is in the backup set', () => {
  it('stamps routingPolicyVersion into the archived app-config even when the live config never had it', async () => {
    writeFileSync(
      path.join(dataDir, 'app-config.json'),
      JSON.stringify({ onboardingCompleted: true }, null, 2),
    );

    await createBackupArchive({ dataDir, outPath: archiveDir });

    const archivedConfig = readArchivedAppConfig();
    expect(archivedConfig.routingPolicyVersion).toBe(currentRoutingPolicyVersion());
    // The pre-existing content is still archived alongside the marker.
    expect(archivedConfig.onboardingCompleted).toBe(true);
  });

  it('still strips BYOK provider-key material while adding the marker', async () => {
    writeFileSync(
      path.join(dataDir, 'app-config.json'),
      JSON.stringify({
        agentCliEnv: { claude: { ANTHROPIC_API_KEY: 'sk-must-not-be-archived' } },
        agentCliEnvIntent: { claude: 'explicit' },
        onboardingCompleted: true,
      }),
    );

    await createBackupArchive({ dataDir, outPath: archiveDir });

    const archivedConfig = readArchivedAppConfig();
    expect(archivedConfig.routingPolicyVersion).toBe(currentRoutingPolicyVersion());
    expect(archivedConfig.agentCliEnv).toBeUndefined();
    expect(archivedConfig.agentCliEnvIntent).toBeUndefined();
    expect(JSON.stringify(archivedConfig)).not.toContain('sk-must-not-be-archived');
  });

  it('survives the config read path -- filterAllowedKeys must not silently drop the restored marker', async () => {
    // Simulates a restore: the archived config becomes the live config, then
    // the daemon reads it back the way it always does.
    writeFileSync(
      path.join(dataDir, 'app-config.json'),
      JSON.stringify({ routingPolicyVersion: currentRoutingPolicyVersion(), onboardingCompleted: true }, null, 2),
    );

    const prefs = await readAppConfig(dataDir);

    expect(prefs.routingPolicyVersion).toBe(currentRoutingPolicyVersion());
  });

  it('rejects a non-numeric routingPolicyVersion rather than trusting the file', async () => {
    writeFileSync(
      path.join(dataDir, 'app-config.json'),
      JSON.stringify({ routingPolicyVersion: 'not-a-number', onboardingCompleted: true }, null, 2),
    );

    const prefs = await readAppConfig(dataDir);

    expect(prefs.routingPolicyVersion).toBeUndefined();
    expect(prefs.onboardingCompleted).toBe(true);
  });
});

// Amendment 2, item 4. `redactAppConfig` used to answer an unparseable
// app-config.json with a bare `JSON.stringify({})`: the archive then held a
// config that is indistinguishable from a legitimately empty one, and nothing
// anywhere recorded that the original had been unreadable. That is the worst
// possible place for a silent failure -- the operator only finds out during a
// restore, which is exactly when the rest of the system is already broken.
//
// The archive must therefore SAY SO in-band, because daemon logs from the
// machine that produced a months-old archive are routinely gone by the time
// anyone reads it. It must also say so without echoing the malformed source:
// V8's JSON parse errors quote the offending fragment, and app-config.json is
// precisely the file that holds BYOK provider keys.
describe('redactAppConfig: an unparseable app-config is reported, never silently emptied', () => {
  const CORRUPT_WITH_SECRET =
    '{"agentCliEnv":{"claude":{"ANTHROPIC_API_KEY":"sk-must-not-leak-into-archive"}},,,';

  it('archives a diagnostic marker instead of a bare {} and still records the policy version', async () => {
    writeFileSync(path.join(dataDir, 'app-config.json'), CORRUPT_WITH_SECRET);

    await createBackupArchive({ dataDir, outPath: archiveDir });

    const archivedConfig = readArchivedAppConfig();
    expect((archivedConfig.__mishmashBackupError as Record<string, unknown> | undefined)?.code).toBe(
      'APP_CONFIG_UNPARSEABLE',
    );
    expect(archivedConfig.routingPolicyVersion).toBe(currentRoutingPolicyVersion());
  });

  it('never copies the malformed source (or the BYOK key inside it) into the archive', async () => {
    writeFileSync(path.join(dataDir, 'app-config.json'), CORRUPT_WITH_SECRET);

    await createBackupArchive({ dataDir, outPath: archiveDir });

    const archivedRaw = readFileSync(
      path.join(archiveDir, RELPATH_BY_CLASS['app-config']),
      'utf8',
    );
    expect(archivedRaw).not.toContain('sk-must-not-leak-into-archive');
    expect(archivedRaw).not.toContain('ANTHROPIC_API_KEY');
  });

  it('logs a usable parse diagnostic rather than swallowing the failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeFileSync(path.join(dataDir, 'app-config.json'), CORRUPT_WITH_SECRET);

    await createBackupArchive({ dataDir, outPath: archiveDir });

    // Something must reach the log -- silence would leave an operator with no
    // signal at all that the file they are about to rely on was unreadable.
    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).toContain('unparseable');
    expect(logged).toMatch(/SyntaxError/);
    errorSpy.mockRestore();
  });

  it('never logs the parse error verbatim, because V8 quotes the offending source', async () => {
    // The realistic leak shape: corruption that leaves a BYOK value unquoted.
    // V8 answers with `Unexpected token 's', ..."_API_KEY":sk-live-ab"... is
    // not valid JSON` -- a window of the source that carries a credential
    // PREFIX. Logging the raw message would put that in the daemon log, which
    // is collectible via diagnostics export.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeFileSync(
      path.join(dataDir, 'app-config.json'),
      '{"agentCliEnv":{"claude":{"ANTHROPIC_API_KEY":sk-live-abc123XYZ}}}',
    );

    await createBackupArchive({ dataDir, outPath: archiveDir });

    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).not.toContain('sk-live-ab');
    expect(logged).not.toContain('ANTHROPIC_API_KEY');
    errorSpy.mockRestore();
  });

  it('does not fail the backup -- the rest of the archive still has to be recoverable', async () => {
    writeFileSync(path.join(dataDir, 'app-config.json'), CORRUPT_WITH_SECRET);

    const result = await createBackupArchive({ dataDir, outPath: archiveDir });

    expect(result.manifest.some((entry) => entry.class === 'app-config')).toBe(true);
  });

  it('leaves the diagnostic marker out of the prefs a restored config reads back', async () => {
    // The marker is deliberately not an AppConfigPrefs key, so the normal read
    // path drops it while keeping the policy-version marker beside it.
    writeFileSync(
      path.join(dataDir, 'app-config.json'),
      JSON.stringify({
        __mishmashBackupError: { code: 'APP_CONFIG_UNPARSEABLE', message: 'x' },
        routingPolicyVersion: currentRoutingPolicyVersion(),
      }),
    );

    const prefs = await readAppConfig(dataDir);

    expect((prefs as Record<string, unknown>).__mishmashBackupError).toBeUndefined();
    expect(prefs.routingPolicyVersion).toBe(currentRoutingPolicyVersion());
  });
});
