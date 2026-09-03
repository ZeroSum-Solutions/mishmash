import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';

type SupportedPlatform = NodeJS.Platform;

export type BrowserOpenInvocation = {
  command: string;
  args: string[];
  options: SpawnOptions;
};

type OpenBrowserDeps = {
  platform?: SupportedPlatform;
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  warn?: (message: string) => void;
  env?: NodeJS.ProcessEnv;
};

function quoteWindowsCommandArg(value: string, { force = false }: { force?: boolean } = {}): string {
  if (value.length === 0) return '""';
  if (!force && !/[\s"&<>|^%]/.test(value)) return value;
  const escaped = value.replace(/"/g, '""').replace(/%/g, '"^%"');
  return `"${escaped}"`;
}

export function createBrowserOpenInvocation(
  platform: SupportedPlatform,
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): BrowserOpenInvocation {
  if (platform === 'win32') {
    const comspec = env.ComSpec || env.COMSPEC || 'cmd.exe';
    // `start` is a cmd.exe builtin on Windows, not a real executable. The empty
    // title argument keeps cmd from treating the URL itself as the window title.
    // Match @open-design/platform's cmd.exe shim shape: Node's default Windows
    // argv quoting uses backslash escapes that cmd.exe does not understand, so
    // the inner command must be wrapped for `/s /c` and passed verbatim.
    const inner = [
      'start',
      quoteWindowsCommandArg(''),
      quoteWindowsCommandArg(url, { force: true }),
    ].join(' ');
    return {
      command: comspec,
      args: ['/d', '/s', '/c', `"${inner}"`],
      options: { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true },
    };
  }

  return {
    command: platform === 'darwin' ? 'open' : 'xdg-open',
    args: [url],
    options: { detached: true, stdio: 'ignore' },
  };
}

/**
 * Launch a URL in Google Chrome specifically, rather than the OS default
 * browser (issue #158). Some default browsers refuse loopback connections —
 * an isolated-task-space browser will report `ERR_CONNECTION_REFUSED` for a
 * preview server that is answering perfectly well — so "open in Chrome" has
 * to name the browser instead of asking the OS for whichever it prefers.
 *
 * Best-effort like `openBrowser`: a machine without Chrome fails the spawn
 * and the caller sees the warning, never a crash.
 */
export function createChromeOpenInvocation(
  platform: SupportedPlatform,
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): BrowserOpenInvocation {
  if (platform === 'win32') {
    const comspec = env.ComSpec || env.COMSPEC || 'cmd.exe';
    const inner = [
      'start',
      quoteWindowsCommandArg(''),
      'chrome',
      quoteWindowsCommandArg(url, { force: true }),
    ].join(' ');
    return {
      command: comspec,
      args: ['/d', '/s', '/c', `"${inner}"`],
      options: { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true },
    };
  }
  if (platform === 'darwin') {
    return {
      command: '/usr/bin/open',
      args: ['-a', 'Google Chrome', url],
      options: { detached: true, stdio: 'ignore' },
    };
  }
  return {
    command: 'google-chrome',
    args: [url],
    options: { detached: true, stdio: 'ignore' },
  };
}

export function openBrowser(url: string, deps: OpenBrowserDeps = {}): ChildProcess | null {
  const platform = deps.platform ?? process.platform;
  return spawnOpener(createBrowserOpenInvocation(platform, url, deps.env), deps);
}

export function openInChrome(url: string, deps: OpenBrowserDeps = {}): ChildProcess | null {
  const platform = deps.platform ?? process.platform;
  return spawnOpener(createChromeOpenInvocation(platform, url, deps.env), deps);
}

function spawnOpener(
  invocation: BrowserOpenInvocation,
  deps: OpenBrowserDeps,
): ChildProcess | null {
  const spawn = deps.spawn ?? nodeSpawn;
  const warn = deps.warn ?? ((message: string) => console.warn(message));

  try {
    const child = spawn(invocation.command, invocation.args, invocation.options);
    // Browser opening is best-effort. A missing opener must not crash the daemon
    // after the server has already started and printed its URL.
    child.on('error', (error) => {
      const detail = error instanceof Error ? error.message : String(error);
      warn(`[od] failed to open browser: ${detail}`);
    });
    child.unref();
    return child;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    warn(`[od] failed to open browser: ${detail}`);
    return null;
  }
}
