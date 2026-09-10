// W8C item 3: `od --version` is a new, small CLI surface (no `--version`/
// `-v`/`version` branch existed anywhere in `cli.ts`'s dispatcher on base).
// RED on base confirmed by actually running the command (not asserted from
// memory, per the brief): exit code 2, stderr `unknown option: --version`.
import { describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli-stub.js';

describe('od --version', () => {
  it('exits 0 and prints version/channel/commit/builtAt', async () => {
    const result = await runCli(['--version']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('commit');
    expect(result.stdout).toContain('builtAt');
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it('prints a JSON object with version/channel/commit/builtAt string keys under --json', async () => {
    const result = await runCli(['--version', '--json']);

    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(typeof parsed.version).toBe('string');
    expect(typeof parsed.channel).toBe('string');
    expect(typeof parsed.commit).toBe('string');
    expect(typeof parsed.builtAt).toBe('string');
  });
});
