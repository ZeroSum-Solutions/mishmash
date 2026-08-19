#!/usr/bin/env node
// Enforcement spine for the design-library standardization effort.
//
// Checks two surfaces against the canonical taxonomy in design-taxonomy.ts:
//   1. design-templates/*/SKILL.md   — `od.category` + `description`
//   2. <library-dir>/catalog.json    — every item's `category`, `description`,
//      cover (`thumb`), and a cheap metadata fingerprint for duplicates.
//
// No npm dependencies: only node:fs, node:crypto, node:path, node:url, plus a
// hand-rolled parser for the small frontmatter subset SKILL.md actually uses
// (top-level `description` as a block/folded/quoted/plain scalar, and simple
// scalar children directly under `od:`).
//
// Usage:
//   node scripts/validate-design-catalog.ts [--library-dir <path>]
//   node scripts/validate-design-catalog.ts --report-categories <name...> [--library-dir <path>]

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATEGORIES } from './design-taxonomy.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES_DIR = path.join(ROOT, 'design-templates');
const DEFAULT_LIBRARY_DIR = '/Users/zero-suminc./projects/mishmash-assets';
const MIN_DESCRIPTION_LENGTH = 40;

// ---------------------------------------------------------------------------
// Minimal frontmatter parsing
// ---------------------------------------------------------------------------

function unquote(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

// Extracts a top-level (column-0) `key: value` scalar, including block-literal
// (`|`) and folded (`>`) styles, and plain (unquoted, no block indicator)
// scalars that continue onto indented lines below the key — YAML folds those
// continuation lines onto the first line with a space, same as `>`. Returns
// undefined if the key is absent.
function extractTopLevelScalar(lines: string[], key: string): string | undefined {
  const re = new RegExp(`^${key}:\\s*(.*)$`);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^\s/.test(line)) continue; // indented — not a top-level key
    const m = line.match(re);
    if (!m) continue;
    const rest = (m[1] ?? '').trim();
    if (/^[|>][+-]?$/.test(rest)) {
      const folded = rest.startsWith('>');
      const bodyLines: string[] = [];
      let j = i + 1;
      let baseIndent: number | null = null;
      while (j < lines.length) {
        const l = lines[j] ?? '';
        if (l.trim() === '') {
          bodyLines.push('');
          j += 1;
          continue;
        }
        const indent = (l.match(/^\s*/)?.[0] ?? '').length;
        if (indent === 0) break;
        if (baseIndent === null) baseIndent = indent;
        if (indent < baseIndent) break;
        bodyLines.push(l.slice(baseIndent));
        j += 1;
      }
      while (bodyLines.length && bodyLines[bodyLines.length - 1] === '') bodyLines.pop();
      return folded ? bodyLines.join(' ').replace(/\s+/g, ' ').trim() : bodyLines.join('\n');
    }
    if (rest.startsWith('"') || rest.startsWith("'")) {
      return unquote(rest); // quoted scalars stay single-line in this repo
    }
    // Plain scalar — YAML allows it to continue on following indented lines
    // (folded onto the first line with a space) until a blank line or the
    // next top-level key.
    const parts = rest === '' ? [] : [rest];
    let j = i + 1;
    while (j < lines.length) {
      const l = lines[j] ?? '';
      if (l.trim() === '') break;
      const indent = (l.match(/^\s*/)?.[0] ?? '').length;
      if (indent === 0) break;
      parts.push(l.trim());
      j += 1;
    }
    return parts.join(' ').trim();
  }
  return undefined;
}

// Parses the inside of a flow mapping (`{ a: 1, b: "two", ... }`, braces
// already stripped) into flat scalar key/values. Good enough for our case —
// no nested flow collections inside `od: { ... }` occur in this repo.
function parseFlowMapBody(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of body.split(',')) {
    const m = pair.match(/^\s*([\w.-]+)\s*:\s*(.*?)\s*$/);
    if (!m || m[2] === '') continue;
    const key = m[1];
    const value = m[2];
    if (key === undefined || value === undefined) continue;
    result[key] = unquote(value);
  }
  return result;
}

// Extracts the direct scalar children of a nested `key:` mapping block (e.g.
// `od:`), supporting both block style (`od:\n  category: x`) and flow style
// (`od: { category: x, mode: y }`, single- or multi-line). Deeper-nested
// block mappings (like `od.preview.type`) are skipped — we only need the
// flat scalars (`category`, `mode`, ...).
function extractNestedScalars(lines: string[], key: string): Record<string, string> {
  const flowHeaderRe = new RegExp(`^${key}:\\s*\\{(.*)$`);
  const blockHeaderRe = new RegExp(`^${key}:\\s*$`);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^\s/.test(line)) continue; // indented — not a top-level key
    const flowMatch = line.match(flowHeaderRe);
    if (flowMatch) {
      let body = flowMatch[1] ?? '';
      let j = i;
      while (!body.includes('}') && j + 1 < lines.length) {
        j += 1;
        body += ` ${lines[j] ?? ''}`;
      }
      const closeIdx = body.lastIndexOf('}');
      return parseFlowMapBody(closeIdx >= 0 ? body.slice(0, closeIdx) : body);
    }
    if (blockHeaderRe.test(line)) {
      const result: Record<string, string> = {};
      let blockIndent: number | null = null;
      for (let j = i + 1; j < lines.length; j += 1) {
        const l = lines[j] ?? '';
        if (l.trim() === '') continue;
        const indent = (l.match(/^\s*/)?.[0] ?? '').length;
        if (indent === 0) break; // next top-level key ends the block
        if (blockIndent === null) blockIndent = indent;
        if (indent !== blockIndent) continue; // deeper-nested mapping — skip
        const m = l.slice(indent).match(/^([\w.-]+):\s*(.*)$/);
        if (!m) continue;
        const mKey = m[1];
        const value = (m[2] ?? '').trim();
        if (mKey === undefined || value === '' || /^[|>][+-]?$/.test(value)) continue; // nested/complex — skip
        result[mKey] = unquote(value);
      }
      return result;
    }
  }
  return {};
}

type SkillFrontmatter = { description: string | undefined; category: string | undefined };

// Returns { description, category } for a SKILL.md file, or null if the file
// has no `---` frontmatter block at all.
function parseSkillFrontmatter(text: string): SkillFrontmatter | null {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return null;
  const yaml = lines.slice(1, end);
  const description = extractTopLevelScalar(yaml, 'description');
  const od = extractNestedScalars(yaml, 'od');
  return { description, category: od.category };
}

// ---------------------------------------------------------------------------
// Violations
// ---------------------------------------------------------------------------

type Violation = { subject: string; detail: string };

type Report = {
  'template-category-missing': Violation[];
  'template-category-invalid': Violation[];
  'template-description-missing': Violation[];
  'template-description-short': Violation[];
  'catalog-category-missing': Violation[];
  'catalog-category-invalid': Violation[];
  'catalog-description-missing': Violation[];
  'catalog-description-short': Violation[];
  'catalog-cover-missing': Violation[];
  'catalog-duplicate': Violation[];
  'catalog-blocked-pending-license': Violation[];
};

// checkType -> array of { subject, detail }
function newReport(): Report {
  return {
    'template-category-missing': [],
    'template-category-invalid': [],
    'template-description-missing': [],
    'template-description-short': [],
    'catalog-category-missing': [],
    'catalog-category-invalid': [],
    'catalog-description-missing': [],
    'catalog-description-short': [],
    'catalog-cover-missing': [],
    'catalog-duplicate': [],
    'catalog-blocked-pending-license': [],
  };
}

function relToRoot(p: string): string {
  return path.relative(ROOT, p);
}

function checkTemplates(report: Report): number {
  const entries = readdirSync(TEMPLATES_DIR, { withFileTypes: true }).filter((e) => e.isDirectory());
  let count = 0;
  for (const entry of entries) {
    const skillPath = path.join(TEMPLATES_DIR, entry.name, 'SKILL.md');
    if (!existsSync(skillPath)) continue;
    count += 1;
    const text = readFileSync(skillPath, 'utf8');
    const parsed = parseSkillFrontmatter(text);
    const rel = relToRoot(skillPath);
    const category = parsed?.category;
    if (!category) {
      report['template-category-missing'].push({ subject: rel, detail: 'no od.category' });
    } else if (!CATEGORIES.includes(category)) {
      report['template-category-invalid'].push({
        subject: rel,
        detail: `category "${category}" not in enum`,
      });
    }
    const description = parsed?.description;
    if (!description || description.trim() === '') {
      report['template-description-missing'].push({ subject: rel, detail: 'no description' });
    } else if (description.trim().length < MIN_DESCRIPTION_LENGTH) {
      report['template-description-short'].push({
        subject: rel,
        detail: `${description.trim().length} chars (< ${MIN_DESCRIPTION_LENGTH})`,
      });
    }
  }
  return count;
}

// The catalog schema is external (mishmash-assets/catalog.json) and only
// loosely structured; fields are read defensively throughout rather than
// trusted from a strict interface.
type CatalogItem = Record<string, unknown>;
type CatalogGroup = { items?: CatalogItem[] };
type CatalogData = { groups?: CatalogGroup[] };

function loadCatalog(libraryDir: string): CatalogItem[] {
  const catalogPath = path.join(libraryDir, 'catalog.json');
  const data = JSON.parse(readFileSync(catalogPath, 'utf8')) as CatalogData;
  const items: CatalogItem[] = [];
  for (const group of data.groups ?? []) {
    for (const item of group.items ?? []) {
      items.push(item);
    }
  }
  return items;
}

// Normalizes the fields the fingerprint hashes so `JSON.stringify` never
// silently drops an `undefined` key (which previously collapsed every item
// with missing/non-array `files` AND missing `size` onto the same `"{}"`
// hash — a false-duplicate magnet). `files` is a sorted array when the
// catalog actually models it as a list of filenames; this repo's schema
// instead uses a plain file *count*, which is real per-item signal and is
// kept as-is rather than flattened to `[]`. `size` is passed through
// unchanged (this catalog stores it as a formatted string, e.g. "194 MB")
// but defaults to `null` instead of `undefined` when absent. `label`,
// normalized (trimmed + lowercased), is included as a third signal: `files`
// count and rounded `size` string are coarse enough that dozens of
// distinct, unrelated items (different NeuForm templates, different site
// screenshots) land on the same tuple by coincidence — confirmed 2026-08-09
// (t9) by diffing actual on-disk byte sizes for all 38 flagged groups: every
// item differed. `label` is real per-item identity that a true duplicate
// (the same asset catalogued twice) would carry unchanged or near-unchanged,
// so folding it in disambiguates coincidental matches without adding schema.
function normalizeFingerprintFields(item: CatalogItem): {
  files: unknown;
  size: unknown;
  label: string;
  noSignal: boolean;
} {
  let files: unknown;
  if (Array.isArray(item.files)) {
    files = [...item.files].sort();
  } else if (item.files === undefined || item.files === null) {
    files = [];
  } else {
    files = item.files; // e.g. a numeric file count — real signal, not "empty"
  }
  const size = item.size === undefined ? null : item.size;
  const label = typeof item.label === 'string' ? item.label.trim().toLowerCase() : '';
  const noSignal = (Array.isArray(files) ? files.length === 0 : false) && size === null;
  return { files, size, label, noSignal };
}

// Returns null when the item carries no usable metadata signal (both `files`
// and `size` absent/empty) — such items must NOT be hashed together, or they
// would form one giant false-duplicate group.
function fingerprint(item: CatalogItem): string | null {
  const { files, size, label, noSignal } = normalizeFingerprintFields(item);
  if (noSignal) return null;
  return createHash('sha256').update(JSON.stringify({ files, size, label })).digest('hex');
}

function checkCatalog(report: Report, libraryDir: string, items: CatalogItem[]): number {
  const fingerprintGroups = new Map<string, CatalogItem[]>();

  for (const item of items) {
    const id = typeof item.id === 'string' ? item.id : '(no id)';
    const category = item.category;
    if (!category || String(category).trim() === '') {
      report['catalog-category-missing'].push({ subject: id, detail: 'no category' });
    } else if (!CATEGORIES.includes(String(category))) {
      report['catalog-category-invalid'].push({
        subject: id,
        detail: `category "${String(category)}" not in enum`,
      });
    }

    const description = item.description;
    if (!description || String(description).trim() === '') {
      report['catalog-description-missing'].push({ subject: id, detail: 'no description' });
    } else if (String(description).trim().length < MIN_DESCRIPTION_LENGTH) {
      report['catalog-description-short'].push({
        subject: id,
        detail: `${String(description).trim().length} chars (< ${MIN_DESCRIPTION_LENGTH})`,
      });
    }

    if (!item.cover_policy) {
      if (!item.thumb) {
        report['catalog-cover-missing'].push({ subject: id, detail: 'no thumb field' });
      } else if (!existsSync(path.join(libraryDir, String(item.thumb)))) {
        report['catalog-cover-missing'].push({
          subject: id,
          detail: `thumb file not found: ${String(item.thumb)}`,
        });
      }
    }

    // Zero-blockers policy (F009): fail loudly on any item still resolving
    // to blocked-pending-license instead of letting it sit unnoticed. This
    // is an on-demand check, not a pnpm guard/CI gate — libraryDir defaults
    // to a machine-local path that does not exist in CI (see DEFAULT_LIBRARY_DIR).
    if (item.allowed_use === 'blocked-pending-license') {
      report['catalog-blocked-pending-license'].push({
        subject: id,
        detail: typeof item.rel === 'string' ? item.rel : '(no rel)',
      });
    }

    const fp = fingerprint(item);
    if (fp === null) continue; // no metadata signal — excluded from duplicate detection
    const group = fingerprintGroups.get(fp);
    if (group) {
      group.push(item);
    } else {
      fingerprintGroups.set(fp, [item]);
    }
  }

  for (const [fp, groupItems] of fingerprintGroups) {
    if (groupItems.length < 2) continue;
    // One canonical item plus any number of items explicitly marked
    // `duplicate_of` is fine. Two or more UNMARKED items sharing a
    // fingerprint is still a violation — flag those, not the whole group.
    const unmarked = groupItems.filter((it) => !it.duplicate_of);
    if (unmarked.length < 2) continue;
    report['catalog-duplicate'].push({
      subject: unmarked.map((it) => String(it.id)).join(', '),
      detail:
        `${unmarked.length} of ${groupItems.length} items in this fingerprint group ` +
        `lack duplicate_of (fingerprint ${fp.slice(0, 12)})`,
    });
  }

  return items.length;
}

// ---------------------------------------------------------------------------
// Report printing
// ---------------------------------------------------------------------------

const SECTION_TITLES: Record<keyof Report, string> = {
  'template-category-missing': 'Templates — category missing',
  'template-category-invalid': 'Templates — category not in enum',
  'template-description-missing': 'Templates — description missing',
  'template-description-short': `Templates — description under ${MIN_DESCRIPTION_LENGTH} chars`,
  'catalog-category-missing': 'Catalog — category missing',
  'catalog-category-invalid': 'Catalog — category not in enum',
  'catalog-description-missing': 'Catalog — description missing',
  'catalog-description-short': `Catalog — description under ${MIN_DESCRIPTION_LENGTH} chars`,
  'catalog-cover-missing': 'Catalog — cover (thumb) missing or file not found',
  'catalog-duplicate': 'Catalog — duplicate fingerprint (no duplicate_of)',
  'catalog-blocked-pending-license': 'Catalog — items blocked-pending-license (zero-blockers policy)',
};

function printReport(report: Report, templateCount: number, catalogCount: number): number {
  let total = 0;
  for (const [key, entries] of Object.entries(report) as [keyof Report, Violation[]][]) {
    total += entries.length;
    console.log(`\n== ${SECTION_TITLES[key]} (${entries.length}) ==`);
    if (entries.length === 0) continue;
    for (const { subject, detail } of entries) {
      console.log(`  - ${subject}${detail ? `  [${detail}]` : ''}`);
    }
  }
  const scanned = templateCount + catalogCount;
  console.log(
    `\nSUMMARY: ${total} violations across ${scanned} items/templates ` +
      `(${templateCount} templates, ${catalogCount} catalog items)`,
  );
  return total;
}

// ---------------------------------------------------------------------------
// --report-categories mode
// ---------------------------------------------------------------------------

function reportCategories(names: string[], libraryDir: string): boolean {
  const templateDirs = readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const catalogItems = loadCatalog(libraryDir);

  let allFound = true;

  for (const name of names) {
    const needle = name.toLowerCase();
    const matches: { source: string; subject: string; category: string | undefined }[] = [];

    for (const dir of templateDirs) {
      if (!dir.toLowerCase().includes(needle)) continue;
      const skillPath = path.join(TEMPLATES_DIR, dir, 'SKILL.md');
      if (!existsSync(skillPath)) continue;
      const parsed = parseSkillFrontmatter(readFileSync(skillPath, 'utf8'));
      matches.push({ source: 'template', subject: dir, category: parsed?.category });
    }

    for (const item of catalogItems) {
      const label = String(item.label ?? '').toLowerCase();
      const id = String(item.id ?? '').toLowerCase();
      if (!label.includes(needle) && !id.includes(needle)) continue;
      matches.push({
        source: 'catalog',
        subject: String(item.id),
        category: item.category === undefined ? undefined : String(item.category),
      });
    }

    if (matches.length === 0) {
      console.log(`${name} → NOT FOUND`);
      allFound = false;
      continue;
    }

    for (const match of matches) {
      const categoryLabel = match.category ? match.category : '(missing)';
      console.log(`${name} (${match.subject}) → ${categoryLabel} (source: ${match.source})`);
      if (!match.category || !CATEGORIES.includes(match.category)) allFound = false;
    }
  }

  return allFound;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

type Args = { libraryDir: string; reportCategories: string[] | null };

function parseArgs(argv: string[]): Args {
  const args: Args = { libraryDir: DEFAULT_LIBRARY_DIR, reportCategories: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--library-dir') {
      args.libraryDir = argv[i + 1] ?? args.libraryDir;
      i += 1;
    } else if (arg === '--report-categories') {
      const reportCategories: string[] = [];
      i += 1;
      while (i < argv.length && !(argv[i] ?? '').startsWith('--')) {
        reportCategories.push(argv[i] ?? '');
        i += 1;
      }
      i -= 1;
      args.reportCategories = reportCategories;
    }
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.reportCategories) {
    if (args.reportCategories.length === 0) {
      console.error('usage: validate-design-catalog.ts --report-categories <name...>');
      process.exitCode = 2;
      return;
    }
    const ok = reportCategories(args.reportCategories, args.libraryDir);
    process.exitCode = ok ? 0 : 1;
    return;
  }

  const report = newReport();
  const templateCount = checkTemplates(report);
  const catalogItems = loadCatalog(args.libraryDir);
  const catalogCount = checkCatalog(report, args.libraryDir, catalogItems);
  const total = printReport(report, templateCount, catalogCount);
  process.exitCode = total === 0 ? 0 : 1;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
