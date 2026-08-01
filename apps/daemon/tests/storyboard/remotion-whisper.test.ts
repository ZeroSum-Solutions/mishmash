// Fast, hermetic unit tests for storyboards/remotion/whisper.ts's install
// serialization and half-installed-directory detection (review finding F2)
// plus the path-free error message it surfaces (review finding T2).
// @remotion/install-whisper-cpp and node:fs are mocked so these run without
// a real git clone/cmake build or network call.

import { afterEach, describe, expect, it, vi } from 'vitest';

const installWhisperCppMock = vi.fn();
const existsSyncMock = vi.fn();

vi.mock('@remotion/install-whisper-cpp', () => ({
  installWhisperCpp: (...args: unknown[]) => installWhisperCppMock(...args),
  downloadWhisperModel: vi.fn(),
  transcribe: vi.fn(),
  toCaptions: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: (...args: unknown[]) => existsSyncMock(...args) };
});

const { ensureWhisperCppInstalled } = await import('../../src/storyboards/remotion/whisper.js');

describe('ensureWhisperCppInstalled', () => {
  afterEach(() => {
    installWhisperCppMock.mockReset();
    existsSyncMock.mockReset();
  });

  it('serializes concurrent installs for the same whisperDir into a single installWhisperCpp call', async () => {
    installWhisperCppMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ alreadyExisted: false }), 20)),
    );
    existsSyncMock.mockReturnValue(true);

    const dir = '/tmp/od-whisper-test-concurrent';
    await Promise.all([ensureWhisperCppInstalled(dir), ensureWhisperCppInstalled(dir), ensureWhisperCppInstalled(dir)]);

    expect(installWhisperCppMock).toHaveBeenCalledTimes(1);
  });

  it('does not share in-flight installs across different whisperDir values', async () => {
    installWhisperCppMock.mockResolvedValue({ alreadyExisted: false });
    existsSyncMock.mockReturnValue(true);

    await Promise.all([
      ensureWhisperCppInstalled('/tmp/od-whisper-test-a'),
      ensureWhisperCppInstalled('/tmp/od-whisper-test-b'),
    ]);

    expect(installWhisperCppMock).toHaveBeenCalledTimes(2);
  });

  it('throws a stable, path-free error when the executable is missing after install, logging the detail server-side', async () => {
    // Reproduces @remotion/install-whisper-cpp's own silent-failure mode:
    // installWhisperCpp() with printOutput:false resolves normally even when
    // the target dir exists but the whisper-cli binary under it doesn't (a
    // half-finished install).
    installWhisperCppMock.mockResolvedValue({ alreadyExisted: false });
    existsSyncMock.mockReturnValue(false);
    // vi.spyOn(console, 'error') does not reliably capture calls under this
    // vitest setup's own console interception (verified empirically) — a
    // direct reassignment does.
    const originalConsoleError = console.error;
    const consoleErrorCalls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      consoleErrorCalls.push(args);
    };

    const dir = '/tmp/od-whisper-test-half-installed';
    let caught: unknown;
    try {
      await ensureWhisperCppInstalled(dir);
    } catch (err) {
      caught = err;
    } finally {
      console.error = originalConsoleError;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    // Review finding T2: the daemon-data cache dir must never leak into a
    // message that can reach an HTTP error response body.
    expect(message).not.toContain(dir);
    expect(message.toLowerCase()).toContain('whisper');
    expect(message.toLowerCase()).toContain('cache');

    // The detailed diagnostic (including the path an operator would need to
    // actually go delete) still reaches the server log.
    expect(consoleErrorCalls.length).toBeGreaterThan(0);
    const loggedArgs = consoleErrorCalls.flat().join(' ');
    expect(loggedArgs).toContain(dir);
  });

  it('forwards an AbortSignal into installWhisperCpp (review finding T1 — real process cancellation on deadline expiry)', async () => {
    installWhisperCppMock.mockResolvedValue({ alreadyExisted: false });
    existsSyncMock.mockReturnValue(true);

    const controller = new AbortController();
    await ensureWhisperCppInstalled('/tmp/od-whisper-test-signal', controller.signal);

    expect(installWhisperCppMock).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
  });
});
