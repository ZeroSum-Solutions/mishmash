import { describe, expect, it } from 'vitest';

import { CliFlagParseError, parseFlags, positionalArgs } from '../src/cli-args.js';

function rejection(run: () => unknown): CliFlagParseError {
  try {
    run();
  } catch (err) {
    return err as CliFlagParseError;
  }
  throw new Error('expected parseFlags to reject the argument list');
}

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

  // Every `od` subcommand that catches a parse failure prints `err.message`,
  // and several print it as the whole of their output. The rejection carries
  // the offending option for a machine-readable caller, so what a human path
  // reads has to stay exactly what a plain `Error` gave it: same message, same
  // `name`, same `String(err)`.
  it('names the rejected option without changing what a plain Error printed', () => {
    const unknown = rejection(() => parseFlags(['--wat'], { string: stringFlags }));
    expect(unknown.message).toBe(
      'unknown flag: --wat. Run with --help for the list of accepted flags.',
    );
    expect(unknown.flag).toBe('--wat');
    expect(unknown.name).toBe('Error');
    expect(String(unknown)).toBe(
      'Error: unknown flag: --wat. Run with --help for the list of accepted flags.',
    );

    const missingValue = rejection(() => parseFlags(['--name', '--force'], {
      string: stringFlags,
      boolean: booleanFlags,
    }));
    expect(missingValue.message).toBe('flag --name requires a value');
    expect(missingValue.flag).toBe('--name');
    expect(missingValue.name).toBe('Error');
    expect(String(missingValue)).toBe('Error: flag --name requires a value');
  });

  it('reports an --unknown=value spelling by its key', () => {
    expect(rejection(() => parseFlags(['--wat=1'], { string: stringFlags })).flag).toBe('--wat');
  });

  it('collects positionals without mistaking string-flag values for them', () => {
    expect(positionalArgs(
      ['project-id', '--name', 'Display Name', '--force', 'artifact.html'],
      stringFlags,
    )).toEqual(['project-id', 'artifact.html']);
  });
});
