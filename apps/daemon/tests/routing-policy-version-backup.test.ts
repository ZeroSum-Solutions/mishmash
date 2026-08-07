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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
