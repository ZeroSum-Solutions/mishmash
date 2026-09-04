export interface CliFlagOptions {
  string?: ReadonlySet<string>;
  boolean?: ReadonlySet<string>;
}

export type ParsedCliFlags = Record<string, string | boolean>;

/**
 * INVARIANT: a rejected argument list names the option it rejected.
 *
 * `parseFlags` refuses an undeclared option and a declared string option with
 * no value after it. A caller that reports the refusal to a machine needs the
 * offending option itself, and re-reading it out of the message would make the
 * prose a parsing surface. Carrying it on the error keeps the message the only
 * thing a human path prints: this class overrides nothing else, so `message`,
 * `name`, and `String(err)` are what a plain `Error` produced before.
 */
export class CliFlagParseError extends Error {
  /** The offending option in `--key` form; a `--key=value` spelling reports `--key`. */
  readonly flag: string;

  constructor(message: string, flag: string) {
    super(message);
    this.flag = flag;
  }
}

export function parseFlags(
  argv: readonly string[],
  opts: CliFlagOptions = {},
): ParsedCliFlags {
  const stringFlags = opts.string ?? new Set<string>();
  const booleanFlags = opts.boolean ?? new Set<string>();
  const knownFlags = new Set([...stringFlags, ...booleanFlags]);
  // Positionals are intentionally ignored here. Callers that accept `<id>`
  // style arguments collect them with positionalArgs(), while this routine
  // enforces only the declared `--flag` contract.
  const out: ParsedCliFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;

    const equalsAt = arg.indexOf('=');
    const key = equalsAt >= 0 ? arg.slice(2, equalsAt) : arg.slice(2);
    if (knownFlags.size > 0 && !knownFlags.has(key)) {
      throw new CliFlagParseError(
        `unknown flag: --${key}. Run with --help for the list of accepted flags.`,
        `--${key}`,
      );
    }
    if (equalsAt >= 0) {
      out[key] = arg.slice(equalsAt + 1);
      continue;
    }
    if (booleanFlags.has(key)) {
      out[key] = true;
      continue;
    }
    if (stringFlags.has(key)) {
      const next = argv[i + 1];
      if (next == null || next.startsWith('--')) {
        throw new CliFlagParseError(`flag --${key} requires a value`, `--${key}`);
      }
      out[key] = next;
      i += 1;
      continue;
    }
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

export function positionalArgs(
  argv: readonly string[],
  stringFlags: ReadonlySet<string> = new Set<string>(),
): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (!arg.startsWith('--')) {
      out.push(arg);
      continue;
    }
    const equalsAt = arg.indexOf('=');
    const key = equalsAt >= 0 ? arg.slice(2, equalsAt) : arg.slice(2);
    if (equalsAt < 0 && stringFlags.has(key)) i += 1;
  }
  return out;
}
