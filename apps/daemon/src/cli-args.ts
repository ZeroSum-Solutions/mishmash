export interface CliFlagOptions {
  string?: ReadonlySet<string>;
  boolean?: ReadonlySet<string>;
}

export type ParsedCliFlags = Record<string, string | boolean>;

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
      throw new Error(
        `unknown flag: --${key}. Run with --help for the list of accepted flags.`,
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
        throw new Error(`flag --${key} requires a value`);
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
