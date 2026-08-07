// Amendment 2, item 2 (WR wave).
//
// `routingPolicyVersion` is backup provenance: the ONLY thing that legitimately
// produces it is backup/create.ts stamping the active policy generation into an
// ARCHIVED app-config.json. It is not a user preference and no product code
// reads it.
//
// But Amendment 1 had to put it in `ALLOWED_KEYS` so that `filterAllowedKeys`
// would not drop the marker when a restored archive's config is read back
// (that survives-restore property is exactly what CWR-P1-3 verifies). Because
// `doWrite` merges any key it finds in `ALLOWED_KEYS`, that single entry also
// made the marker settable through `PUT /api/app-config` -- the route hands
// `req.body` straight to `writeAppConfig`. A local client could therefore write
// an arbitrary policy generation into the live config and any operator later
// doing forensics on it, or any future feature that starts trusting it, would
// read an attacker-chosen number.
//
// The fix keeps the key readable/restorable and removes only the write path, so
// these tests pin BOTH halves: the marker must survive a read, and must be
// unwritable by a client. Regressing either one silently breaks a different
// thing (CWR-P1-3 in one direction, the write surface in the other).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readAppConfig, writeAppConfig } from '../src/app-config.js';

let dataDir: string;

function liveConfigOnDisk(): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(dataDir, 'app-config.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'od-routing-writeprot-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('routingPolicyVersion is server-owned: readable and restorable, never client-writable', () => {
  it('ignores a client-supplied routingPolicyVersion instead of overwriting the restored marker', async () => {
    // Simulates the post-restore state: the archived marker is already on disk.
    writeFileSync(
      path.join(dataDir, 'app-config.json'),
      JSON.stringify({ routingPolicyVersion: 7, onboardingCompleted: true }, null, 2),
    );

    await writeAppConfig(dataDir, { routingPolicyVersion: 999 });

    expect(liveConfigOnDisk().routingPolicyVersion).toBe(7);
  });

  it('cannot be created by a client write when the config has no marker at all', async () => {
    writeFileSync(
      path.join(dataDir, 'app-config.json'),
      JSON.stringify({ onboardingCompleted: true }, null, 2),
    );

    await writeAppConfig(dataDir, { routingPolicyVersion: 42 });

    expect(liveConfigOnDisk().routingPolicyVersion).toBeUndefined();
  });

  it('still applies the ordinary user preferences sent in the same request', async () => {
    // The rejection must be surgical -- dropping the whole write, or silently
    // dropping neighbouring keys, would turn a hardening fix into a data-loss
    // bug for every client that PUTs a full config object.
    writeFileSync(
      path.join(dataDir, 'app-config.json'),
      JSON.stringify({ routingPolicyVersion: 7, onboardingCompleted: false }, null, 2),
    );

    await writeAppConfig(dataDir, {
      routingPolicyVersion: 999,
      onboardingCompleted: true,
      customInstructions: 'keep me',
    });

    const live = liveConfigOnDisk();
    expect(live.routingPolicyVersion).toBe(7);
    expect(live.onboardingCompleted).toBe(true);
    expect(live.customInstructions).toBe('keep me');
  });

  it('survives a full read-modify-write round trip, the way the settings UI actually writes', async () => {
    // GET /api/app-config returns the whole config INCLUDING the marker, and
    // clients PUT the object back. That round trip must neither fail nor
    // launder the marker into a client-supplied value.
    writeFileSync(
      path.join(dataDir, 'app-config.json'),
      JSON.stringify({ routingPolicyVersion: 7, onboardingCompleted: true }, null, 2),
    );

    const fetched = await readAppConfig(dataDir);
    expect(fetched.routingPolicyVersion).toBe(7);

    await writeAppConfig(dataDir, { ...fetched, customInstructions: 'edited' });

    const live = liveConfigOnDisk();
    expect(live.routingPolicyVersion).toBe(7);
    expect(live.customInstructions).toBe('edited');
  });

  it('is still preserved by the read path -- the CWR-P1-3 property must not regress', async () => {
    writeFileSync(
      path.join(dataDir, 'app-config.json'),
      JSON.stringify({ routingPolicyVersion: 11 }, null, 2),
    );

    expect((await readAppConfig(dataDir)).routingPolicyVersion).toBe(11);
  });
});
