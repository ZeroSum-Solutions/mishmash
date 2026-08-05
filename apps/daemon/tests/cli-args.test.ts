import { describe, expect, it } from 'vitest';

import { parseFlags, positionalArgs } from '../src/cli-args.js';

describe('shared CLI argument parser', () => {
  const stringFlags = new Set(['name', 'output']);
  const booleanFlags = new Set(['force']);

  it('parses declared string and boolean flags in both value forms', () => {
    expect(parseFlags(
      ['--name', 'Demo', '--output=result.html', '--force'],
      { string: stringFlags, boolean: booleanFlags },
    )).toEqual({ name: 'Demo', output: 'result.html', force: true });
  });

  it('rejects unknown flags and missing declared string values', () => {
    expect(() => parseFlags(['--wat'], { string: stringFlags })).toThrow(/unknown flag/);
    expect(() => parseFlags(['--name', '--force'], {
      string: stringFlags,
      boolean: booleanFlags,
    })).toThrow(/requires a value/);
  });

  it('collects positionals without mistaking string-flag values for them', () => {
    expect(positionalArgs(
      ['project-id', '--name', 'Display Name', '--force', 'artifact.html'],
      stringFlags,
    )).toEqual(['project-id', 'artifact.html']);
  });
});
