// @vitest-environment jsdom

// W8D / F-03 — the per-browser actor identity store.
//
// D-2: "stored per-browser". This is deliberately NOT app config
// (`state/config.ts:998`, which the daemon syncs); it is one localStorage key
// owned by this module, so two teammates on the same shared daemon keep
// separate names.
//
// Disclosed red shape (same as 7B's helper test, `briefs/w7/7B.md` item 4):
// this file is red on base only because the module does not exist yet. Its job
// is to pin the storage key, the trim/cap normalization, and the
// never-throw-on-a-hostile-storage contract so a later refactor cannot quietly
// change any of them.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MODULE = '../../src/runtime/actor-identity';

async function load() {
  return (await import(MODULE)) as {
    ACTOR_NAME_STORAGE_KEY: string;
    getStoredActorName: () => string | null;
    setStoredActorName: (name: string | null) => void;
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('W8D: actor identity is per-browser', () => {
  it('round-trips a name through its own localStorage key', async () => {
    const mod = await load();
    expect(mod.getStoredActorName()).toBeNull();
    mod.setStoredActorName('Devin');
    expect(mod.getStoredActorName()).toBe('Devin');
    expect(window.localStorage.getItem(mod.ACTOR_NAME_STORAGE_KEY)).toBe('Devin');
  });

  it('does not use the daemon-synced app config key', async () => {
    const mod = await load();
    expect(mod.ACTOR_NAME_STORAGE_KEY).not.toBe('open-design-config');
    expect(mod.ACTOR_NAME_STORAGE_KEY).toContain('actor');
  });

  it('trims and caps the stored value', async () => {
    const mod = await load();
    mod.setStoredActorName('   Devin   ');
    expect(mod.getStoredActorName()).toBe('Devin');
    mod.setStoredActorName('D'.repeat(200));
    expect((mod.getStoredActorName() ?? '').length).toBeLessThanOrEqual(60);
  });

  it('treats an empty or whitespace name as clearing the value', async () => {
    const mod = await load();
    mod.setStoredActorName('Devin');
    mod.setStoredActorName('   ');
    expect(mod.getStoredActorName()).toBeNull();
    mod.setStoredActorName('Devin');
    mod.setStoredActorName(null);
    expect(mod.getStoredActorName()).toBeNull();
  });

  it('returns null instead of throwing when storage is unavailable', async () => {
    const mod = await load();
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(mod.getStoredActorName()).toBeNull();
    spy.mockRestore();

    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => mod.setStoredActorName('Devin')).not.toThrow();
    setSpy.mockRestore();
  });
});
