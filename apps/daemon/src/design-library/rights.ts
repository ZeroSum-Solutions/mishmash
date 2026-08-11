import { createHash, type Hash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, readlink, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { DesignLibraryAllowedUse, DesignLibraryGroup, DesignLibraryItem } from '@open-design/contracts';
import { isDesignLibraryJunkFileName, isDesignLibraryPrivateMetadataName } from './private-metadata.js';

const RIGHTS_LEDGER = /<!-- OD_RIGHTS_SOURCE_LEDGER_V1\n(?<json>.*?)\nOD_RIGHTS_SOURCE_LEDGER_V1 -->/s;
const ALLOWED_USES = new Set<DesignLibraryAllowedUse>([
  'own-code',
  'licensed-source-review',
  'human-local-only',
  'blocked-pending-license',
]);
const RIGHTS_RECORD_FIELDS = new Set([
  'tree_sha256',
  'allowed_use',
  'licence_ref',
  'source_url',
  'captured_at',
  'notes',
]);
const ITEM_FIELDS = new Set([
  'id',
  'label',
  'rel',
  'thumb',
  'kind',
  'files',
  'size',
  'category',
  'domains',
  'allowed_use',
  'duplicate_of',
  'description',
  'aspects',
  'stacks',
  'reference',
]);

type RightsRecord = {
  tree_sha256: string;
  allowed_use: DesignLibraryAllowedUse;
  licence_ref: string | null;
  source_url: string | null;
  captured_at: string | null;
  notes: string | null;
};

type RightsLedger = {
  prefixes: Record<string, DesignLibraryAllowedUse>;
  items: Record<string, DesignLibraryAllowedUse>;
};

type RightsContext = {
  records: Record<string, unknown>;
  ledger: RightsLedger;
  rootReal: string;
  sourceFingerprint: string;
};

export type DesignLibraryRightsSnapshot = {
  allowedUse: DesignLibraryAllowedUse;
  treeSha256: string;
};

export type DesignLibraryTreeHashOptions = {
  excludedDirNames?: ReadonlySet<string>;
  excludedFileNames?: ReadonlySet<string>;
};

function framed(hash: Hash, value: string | Buffer): void {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length).update(bytes);
}

/**
 * Hashes the complete item tree, excluding private Design Library metadata
 * and OS-generated junk files (`.DS_Store`; MM-014). The framing matches the
 * external catalog builder exactly.
 */
export async function designLibraryTreeSha256(
  root: string,
  options: DesignLibraryTreeHashOptions = {},
): Promise<string> {
  const hash = createHash('sha256');
  const excluded = (names: ReadonlySet<string> | undefined, name: string): boolean => {
    const normalized = name.toLowerCase();
    return names ? [...names].some((candidate) => candidate.toLowerCase() === normalized) : false;
  };
  const visit = async (directory: string, relative: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    for (const entry of entries) {
      if (isDesignLibraryPrivateMetadataName(entry.name)) continue;
      if (isDesignLibraryJunkFileName(entry.name)) continue;
      if (entry.isDirectory() && excluded(options.excludedDirNames, entry.name)) continue;
      if (!entry.isDirectory() && excluded(options.excludedFileNames, entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const rel = relative ? path.posix.join(relative, entry.name) : entry.name;
      const info = await lstat(absolute);
      if (info.isDirectory() && !info.isSymbolicLink()) {
        framed(hash, 'D');
        framed(hash, rel);
        await visit(absolute, rel);
      } else if (info.isFile()) {
        framed(hash, 'F');
        framed(hash, rel);
        framed(hash, String(info.size));
        for await (const chunk of createReadStream(absolute)) hash.update(chunk as Buffer);
      } else if (info.isSymbolicLink()) {
        framed(hash, 'L');
        framed(hash, rel);
        framed(hash, await readlink(absolute));
      } else {
        framed(hash, 'S');
        framed(hash, rel);
        framed(hash, String(info.mode & 0o170000));
      }
    }
  };
  await visit(root, '');
  return hash.digest('hex');
}

function exactObject(value: unknown, fields: Set<string>): value is Record<string, unknown> {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value as object).length === fields.size
    && Object.keys(value as object).every((key) => fields.has(key));
}

async function readRightsSources(targetRoot: string): Promise<{
  records: Record<string, unknown>;
  ledger: RightsLedger;
  sourceFingerprint: string;
}> {
  try {
    const [rightsRaw, ledgerRaw] = await Promise.all([
      readFile(path.join(targetRoot, '.catalog', 'rights.json'), 'utf8'),
      readFile(path.join(targetRoot, 'RIGHTS.md'), 'utf8'),
    ]);
    const rightsValue: unknown = JSON.parse(rightsRaw);
    if (!exactObject(rightsValue, new Set(['version', 'records'])) || rightsValue.version !== 1
      || !rightsValue.records || typeof rightsValue.records !== 'object' || Array.isArray(rightsValue.records)) {
      throw new Error('invalid private rights records');
    }

    const match = RIGHTS_LEDGER.exec(ledgerRaw);
    const ledgerValue: unknown = match?.groups?.json ? JSON.parse(match.groups.json) : null;
    if (!exactObject(ledgerValue, new Set(['version', 'prefixes', 'items'])) || ledgerValue.version !== 1) {
      throw new Error('invalid public rights ceiling');
    }
    const prefixes = ledgerValue.prefixes;
    const items = ledgerValue.items;
    if (!prefixes || typeof prefixes !== 'object' || Array.isArray(prefixes)
      || !items || typeof items !== 'object' || Array.isArray(items)) {
      throw new Error('invalid public rights ceiling');
    }
    const validMapping = (mapping: Record<string, unknown>, prefix: boolean): boolean =>
      Object.entries(mapping).every(
        ([key, allowed]) => key.length > 0
          && (!prefix || key.endsWith('/'))
          && ALLOWED_USES.has(allowed as DesignLibraryAllowedUse),
      );
    if (!validMapping(prefixes as Record<string, unknown>, true)
      || !validMapping(items as Record<string, unknown>, false)) {
      throw new Error('invalid public rights ceiling');
    }

    return {
      records: rightsValue.records as Record<string, unknown>,
      ledger: { prefixes, items } as RightsLedger,
      sourceFingerprint: createHash('sha256').update(rightsRaw).update('\0').update(ledgerRaw).digest('hex'),
    };
  } catch {
    return {
      records: {},
      ledger: { prefixes: {}, items: {} },
      sourceFingerprint: 'invalid',
    };
  }
}

async function loadRightsContext(targetRoot: string): Promise<RightsContext> {
  const [{ records, ledger, sourceFingerprint }, rootReal] = await Promise.all([
    readRightsSources(targetRoot),
    realpath(targetRoot),
  ]);
  return { records, ledger, rootReal, sourceFingerprint };
}

function ledgerAllowedUse(rel: string, ledger: RightsLedger): DesignLibraryAllowedUse | null {
  if (ledger.items[rel]) return ledger.items[rel];
  const matches = Object.entries(ledger.prefixes).filter(([prefix]) => rel.startsWith(prefix));
  matches.sort(([left], [right]) => right.length - left.length);
  return matches[0]?.[1] ?? null;
}

function validRightsRecord(value: unknown, rel: string, ledger: RightsLedger): RightsRecord | null {
  if (!exactObject(value, RIGHTS_RECORD_FIELDS)) return null;
  if (typeof value.tree_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.tree_sha256)) return null;
  if (!ALLOWED_USES.has(value.allowed_use as DesignLibraryAllowedUse)) return null;
  // A private blocked record is always a safe downgrade. Non-blocked records
  // still require an exact public source-ledger ceiling.
  if (value.allowed_use !== 'blocked-pending-license'
    && ledgerAllowedUse(rel, ledger) !== value.allowed_use) return null;
  if (['licence_ref', 'source_url', 'captured_at', 'notes'].some(
    (field) => value[field] !== null && typeof value[field] !== 'string',
  )) return null;
  return value as RightsRecord;
}

async function resolveFromContext(context: RightsContext, rel: string): Promise<DesignLibraryRightsSnapshot> {
  const blocked: DesignLibraryRightsSnapshot = {
    allowedUse: 'blocked-pending-license',
    treeSha256: '',
  };
  const record = validRightsRecord(context.records[rel], rel, context.ledger);
  if (!record || path.isAbsolute(rel)) return blocked;
  const lexical = path.resolve(context.rootReal, rel);
  if (lexical === context.rootReal || !lexical.startsWith(`${context.rootReal}${path.sep}`)) return blocked;
  const candidate = await realpath(lexical).catch(() => null);
  if (!candidate || (candidate !== context.rootReal && !candidate.startsWith(`${context.rootReal}${path.sep}`))) {
    return blocked;
  }
  const info = await stat(candidate).catch(() => null);
  if (!info?.isDirectory()) return blocked;
  const treeSha256 = await designLibraryTreeSha256(candidate).catch(() => '');
  if (treeSha256 !== record.tree_sha256) return blocked;
  return { allowedUse: record.allowed_use, treeSha256 };
}

/**
 * Resolves one item against the current private record, public ceiling, and
 * complete source tree. Reading the metadata again after hashing makes an
 * in-flight catalog reconciliation fail closed instead of combining two
 * generations into an authorization decision.
 */
export async function resolveCurrentDesignLibraryRights(
  targetRoot: string,
  rel: string,
): Promise<DesignLibraryRightsSnapshot> {
  try {
    const before = await loadRightsContext(targetRoot);
    const snapshot = await resolveFromContext(before, rel);
    const after = await loadRightsContext(targetRoot);
    if (before.rootReal !== after.rootReal || before.sourceFingerprint !== after.sourceFingerprint) {
      return { allowedUse: 'blocked-pending-license', treeSha256: '' };
    }
    return snapshot;
  } catch {
    return { allowedUse: 'blocked-pending-license', treeSha256: '' };
  }
}

/** Publishes catalog groups from the same fail-closed resolver used at action time. */
export async function resolvePublishedDesignLibraryGroups(
  targetRoot: string,
  groups: DesignLibraryGroup[],
): Promise<DesignLibraryGroup[]> {
  const context = await loadRightsContext(targetRoot);
  const resolved: DesignLibraryGroup[] = [];
  for (const group of groups) {
    const items: DesignLibraryItem[] = [];
    for (const rawItem of group.items) {
      const rights = await resolveFromContext(context, rawItem.rel);
      const item = Object.fromEntries(
        Object.entries(rawItem).filter(([key]) => ITEM_FIELDS.has(key)),
      ) as unknown as DesignLibraryItem;
      item.allowed_use = rights.allowedUse;
      items.push(item);
    }
    resolved.push({ ...group, items });
  }
  const completedContext = await loadRightsContext(targetRoot);
  if (context.rootReal !== completedContext.rootReal
    || context.sourceFingerprint !== completedContext.sourceFingerprint) {
    // Never publish a batch assembled across private-record / public-ceiling
    // generations. The caller holds the catalog writer lock, so drift here
    // means an out-of-protocol writer changed rights metadata mid-build.
    // Blocking the complete batch is safer than emitting mixed permissions.
    return resolved.map((group) => ({
      ...group,
      items: group.items.map((item) => ({ ...item, allowed_use: 'blocked-pending-license' })),
    }));
  }
  return resolved;
}
