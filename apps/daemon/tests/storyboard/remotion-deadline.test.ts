// Fast, hermetic unit tests for the shared Remotion finishing-pass deadline
// budget (review finding T1) — OD_REMOTION_FINISH_MAX_MS parsing/defaulting/
// floor-guard, and withDeadline's race behavior.

import { afterEach, describe, expect, it } from 'vitest';
import { createDeadline, getFinishMaxMs, RemotionFinishTimeoutError, withDeadline } from '../../src/storyboards/remotion/deadline.js';

const ENV_KEY = 'OD_REMOTION_FINISH_MAX_MS';

describe('getFinishMaxMs', () => {
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it('defaults to 15 minutes when unset', () => {
    delete process.env[ENV_KEY];
    expect(getFinishMaxMs()).toBe(15 * 60 * 1000);
  });

  it('honors a valid override', () => {
    process.env[ENV_KEY] = '120000';
    expect(getFinishMaxMs()).toBe(120_000);
  });

  it('applies the floor guard to a too-small override instead of disabling the timeout', () => {
    process.env[ENV_KEY] = '5';
    expect(getFinishMaxMs()).toBe(60 * 1000);
  });

  it('falls back to the default for non-numeric or non-positive values', () => {
    process.env[ENV_KEY] = 'not-a-number';
    expect(getFinishMaxMs()).toBe(15 * 60 * 1000);
    process.env[ENV_KEY] = '-1';
    expect(getFinishMaxMs()).toBe(15 * 60 * 1000);
    process.env[ENV_KEY] = '0';
    expect(getFinishMaxMs()).toBe(15 * 60 * 1000);
  });
});

describe('withDeadline', () => {
  it('rejects with a labeled RemotionFinishTimeoutError once the deadline elapses, without waiting on the promise', async () => {
    const deadline = createDeadline(30);
    const neverResolves = new Promise(() => {});
    let caught: unknown;
    try {
      await withDeadline(neverResolves, deadline, 'my-stage');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RemotionFinishTimeoutError);
    expect((caught as RemotionFinishTimeoutError).stage).toBe('my-stage');
  });

  it('resolves with the underlying value when it settles before the deadline', async () => {
    const deadline = createDeadline(5000);
    await expect(withDeadline(Promise.resolve('ok'), deadline, 'my-stage')).resolves.toBe('ok');
  });

  it('propagates the underlying rejection when it fails before the deadline (not a timeout)', async () => {
    const deadline = createDeadline(5000);
    await expect(withDeadline(Promise.reject(new Error('boom')), deadline, 'my-stage')).rejects.toThrow('boom');
  });

  it('throws immediately (without racing) when the deadline has already passed', async () => {
    const deadline = createDeadline(0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    let caught: unknown;
    try {
      await withDeadline(new Promise(() => {}), deadline, 'already-expired');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RemotionFinishTimeoutError);
    expect((caught as RemotionFinishTimeoutError).stage).toBe('already-expired');
  });
});
