#!/usr/bin/env node
// Drift check between the TypeScript source-of-truth registry
// (apps/web/src/media/models.ts) and the TS mirror used by the Node daemon
// (apps/daemon/src/media/models.ts). The two are kept in sync by hand because the
// daemon avoids a TS toolchain at runtime; this script lets CI fail the
// build the moment they diverge.
//
// This compares WHOLE RECORDS, not just ids. An earlier version diffed only the
// id sets, so a divergence in any other field passed clean: flipping
// `provider: 'openai'` to `'grok'` on one side alone still printed OK, while the
// web picker gated and labelled the model as OpenAI and the daemon dispatched it
// through the Grok renderer. MEDIA_PROVIDERS was not compared at all.
//
// Fields are read generically rather than from an allowlist, so a field added to
// MediaModel or MediaProvider later is covered without touching this script.
//
// Usage:
//   node scripts/verify-media-models.mjs
//
// Exit codes:
//   0 — registries match
//   1 — drift detected (diff printed to stderr)
//   2 — could not parse one of the registry files

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TS_PATH = path.join(ROOT, 'apps', 'web', 'src', 'media', 'models.ts');
const JS_PATH = path.join(ROOT, 'apps', 'daemon', 'src', 'media', 'models.ts');

function fail(msg) {
  process.stderr.write(`verify-media-models: ${msg}\n`);
  process.exit(1);
}

function parseError(msg) {
  process.stderr.write(`verify-media-models: ${msg}\n`);
  process.exit(2);
}

// Drop whole-line `//` comments before parsing. Prose in a comment can otherwise
// look like a field (a sentence mentioning `integrated: false` is a real example
// from this file's own neighbours). Only full-line comments are stripped, so
// `defaultBaseUrl: 'https://…'` keeps its slashes.
function stripLineComments(source) {
  return source
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

// Split an array literal's body into the text of each top-level `{…}` entry.
function extractEntries(arrText) {
  const entries = [];
  let depth = 0;
  let start = -1;
  let quote = null;
  for (let i = 0; i < arrText.length; i++) {
    const ch = arrText[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) { entries.push(arrText.slice(start + 1, i)); start = -1; }
    }
  }
  return entries;
}

// Scan a `[...]` array literal starting at `openIdx` (the index of the `[`)
// quote-aware, so a `]` or `,` inside a quoted item cannot be mistaken for
// the array's own delimiters. Mirrors extractEntries'/extractBalancedArray's
// quote tracking rather than the plain `text.indexOf(']', i)` this replaced,
// which let a `]` inside a string close the array early and silently drop
// (or mis-slice) the rest of it.
//
// A backslash inside an array item is refused via parseError rather than
// carried through raw: this scan does not decode escapes, so a source-level
// `\\` would compare unequal to what an unescaped item on the other side
// produces even though both look identical after naive slicing — the same
// class of silent-wrong-comparison this whole rewrite exists to prevent.
function scanArrayLiteral(text, openIdx, label, key) {
  const n = text.length;
  let i = openIdx + 1;
  const items = [];
  let cur = '';
  let quote = null;
  while (i < n) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') {
        parseError(`${label}.${key}: escaped character in array value is not supported — refusing to guess at "\\${text[i + 1] ?? ''}"`);
      }
      cur += ch;
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      if (ch === '`') parseError(`${label}.${key}: template literal values are not supported`);
      quote = ch;
      cur += ch;
      i++;
      continue;
    }
    if (ch === ']') {
      items.push(cur);
      return { items, end: i };
    }
    if (ch === ',') {
      items.push(cur);
      cur = '';
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  parseError(`${label}.${key}: unterminated array`);
}

// Parse one entry body into a plain object. Handles the value shapes these
// registries actually use — quoted strings, booleans, numbers, and string
// arrays — and reports anything else so an unparsed field can never masquerade
// as "matching".
//
// Two value shapes are refused outright rather than parsed approximately,
// because getting them wrong produces a silent false "match" instead of a
// visible failure:
//   - template literals (backtick strings): a multiline template can hide
//     real content behind something stripLineComments() mistakes for a `//`
//     comment line, so two different backtick values can parse identical.
//   - backslash escapes: the only correct way to decode `'\n'` is to know
//     JS escape semantics (\n -> newline, \t -> tab, \\ -> \, ...). Guessing
//     wrong (e.g. always taking the literal next character) makes an escaped
//     value compare equal to an unescaped one that merely looks similar.
// Neither catalog uses either construct today; if one ever does, this must
// say so loudly via parseError rather than compare the wrong values.
function parseEntry(text, label) {
  const rec = {};
  let i = 0;
  const n = text.length;
  const skipWs = () => { while (i < n && /[\s,]/.test(text[i])) i++; };

  while (true) {
    skipWs();
    if (i >= n) break;
    const keyMatch = /^([A-Za-z_$][\w$]*)\s*:/.exec(text.slice(i));
    if (!keyMatch) parseError(`${label}: could not read a field name at "${text.slice(i, i + 40).trim()}"`);
    const key = keyMatch[1];
    i += keyMatch[0].length;
    skipWs();
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      if (ch === '`') parseError(`${label}.${key}: template literal values are not supported — could not parse`);
      const quote = ch;
      i++;
      let out = '';
      while (i < n && text[i] !== quote) {
        if (text[i] === '\\') {
          parseError(`${label}.${key}: escaped character in string value is not supported — refusing to guess at "\\${text[i + 1] ?? ''}" — could not parse`);
        }
        out += text[i++];
      }
      if (i >= n) parseError(`${label}.${key}: unterminated string — could not parse`);
      i++;
      rec[key] = out;
    } else if (ch === '[') {
      const { items, end } = scanArrayLiteral(text, i, label, key);
      rec[key] = items
        .map((s) => s.trim().replace(/^['"`]|['"`]$/g, ''))
        .filter(Boolean);
      i = end + 1;
    } else {
      const lit = /^(true|false|-?\d+(?:\.\d+)?)/.exec(text.slice(i));
      if (!lit) parseError(`${label}.${key}: unsupported value at "${text.slice(i, i + 40).trim()}"`);
      rec[key] = lit[1] === 'true' ? true : lit[1] === 'false' ? false : Number(lit[1]);
      i += lit[1].length;
    }
  }
  if (typeof rec.id !== 'string' || !rec.id) parseError(`${label}: entry has no id`);
  return rec;
}

function extractRecords(source, name) {
  const re = new RegExp(`export const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\n\\];`, 'm');
  const m = source.match(re);
  if (!m) return null;
  return extractEntries(m[1]).map((t, idx) => parseEntry(t, `${name}[${idx}]`));
}

// Find the array literal following `<kind>: [` and return its contents, using
// a balanced-bracket scan rather than a regex — each model entry nests its own
// `caps: [...]` array, so a naive `\[([\s\S]*?)\]` non-greedy match stops at
// the FIRST `]` (the first entry's caps array) instead of the bucket's real
// closing bracket, silently truncating every bucket to its first id.
//
// The scan is quote-aware for the same reason the entry scanner is. A single
// unmatched bracket inside any string field — `hint: 'legacy tag: deprecated]'`
// — would otherwise close the bucket at that character, truncating the parsed
// list on BOTH sides at the same point and quietly excluding every later entry
// from comparison. A genuine divergence past that point would then never be
// compared and the script would print OK. Balanced brackets in a string
// ('Kling 2.0 [Beta]') were always harmless; a stray one is a plausible typo
// and, in a guard, a way to slip real drift past CI.
function extractBalancedArray(body, kind) {
  const keyRe = new RegExp(`\\b${kind}\\s*:\\s*\\[`, 'm');
  const km = keyRe.exec(body);
  if (!km) return null;
  const openIdx = km.index + km[0].length - 1;
  let depth = 0;
  let closeIdx = -1;
  let quote = null;
  for (let i = openIdx; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) { closeIdx = i; break; }
    }
  }
  if (closeIdx === -1) return null;
  return body.slice(openIdx + 1, closeIdx);
}

function extractAudioRecords(source) {
  const re = /export const AUDIO_MODELS_BY_KIND[^=]*=\s*\{([\s\S]*?)\n\};/m;
  const m = source.match(re);
  if (!m) return null;
  const out = {};
  for (const kind of ['music', 'speech', 'sfx']) {
    const arrText = extractBalancedArray(m[1], kind);
    if (arrText == null) return null;
    out[kind] = extractEntries(arrText).map((t, idx) =>
      parseEntry(t, `AUDIO_MODELS_BY_KIND.${kind}[${idx}]`));
  }
  return out;
}

function extractNumberArray(source, name) {
  const re = new RegExp(`export const ${name}[^=]*=\\s*\\[([^\\]]*)\\]`, 'm');
  const m = source.match(re);
  if (!m) return null;
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

function dedupCheck(label, records) {
  const seen = new Set();
  for (const r of records) {
    if (seen.has(r.id)) fail(`duplicate id "${r.id}" in ${label}`);
    seen.add(r.id);
  }
  if (records.length === 0) fail(`${label} is empty`);
}

const show = (v) => (Array.isArray(v) ? `[${v.join(', ')}]` : v === undefined ? '(absent)' : String(v));

// Compare two record sets by id, then field by field. Field comparison is
// order-independent over keys and covers every key present on either side, so a
// new field is checked without this script knowing its name.
function diffRecords(label, aRecs, bRecs) {
  const out = [];
  const aById = new Map(aRecs.map((r) => [r.id, r]));
  const bById = new Map(bRecs.map((r) => [r.id, r]));

  const onlyA = aRecs.filter((r) => !bById.has(r.id)).map((r) => r.id);
  const onlyB = bRecs.filter((r) => !aById.has(r.id)).map((r) => r.id);
  if (onlyA.length || onlyB.length) {
    out.push(`${label}: ts only=[${onlyA.join(', ')}], js only=[${onlyB.join(', ')}]`);
  }

  for (const [id, a] of aById) {
    const b = bById.get(id);
    if (!b) continue;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const av = a[key];
      const bv = b[key];
      const same = Array.isArray(av) && Array.isArray(bv)
        ? av.length === bv.length && av.every((x, i) => x === bv[i])
        : av === bv;
      if (!same) out.push(`${label}[${id}].${key}: ts=${show(av)} js=${show(bv)}`);
    }
  }

  // Order is part of the contract: `default` resolution and picker order both
  // read these arrays positionally.
  const aOrder = aRecs.map((r) => r.id).join(',');
  const bOrder = bRecs.map((r) => r.id).join(',');
  if (!onlyA.length && !onlyB.length && aOrder !== bOrder) {
    out.push(`${label}: entry ORDER differs\n      ts=[${aOrder}]\n      js=[${bOrder}]`);
  }
  return out;
}

let ts;
let js;
try {
  ts = stripLineComments(readFileSync(TS_PATH, 'utf8'));
} catch (err) {
  parseError(`could not read ${TS_PATH}: ${err.message}`);
}
try {
  js = stripLineComments(readFileSync(JS_PATH, 'utf8'));
} catch (err) {
  parseError(`could not read ${JS_PATH}: ${err.message}`);
}

const tsProviders = extractRecords(ts, 'MEDIA_PROVIDERS');
const tsImage = extractRecords(ts, 'IMAGE_MODELS');
const tsVideo = extractRecords(ts, 'VIDEO_MODELS');
const tsAudio = extractAudioRecords(ts);
const tsLengths = extractNumberArray(ts, 'VIDEO_LENGTHS_SEC');
const tsDurations = extractNumberArray(ts, 'AUDIO_DURATIONS_SEC');

const jsProviders = extractRecords(js, 'MEDIA_PROVIDERS');
const jsImage = extractRecords(js, 'IMAGE_MODELS');
const jsVideo = extractRecords(js, 'VIDEO_MODELS');
const jsAudio = extractAudioRecords(js);
const jsLengths = extractNumberArray(js, 'VIDEO_LENGTHS_SEC');
const jsDurations = extractNumberArray(js, 'AUDIO_DURATIONS_SEC');

if (!tsProviders || !tsImage || !tsVideo || !tsAudio) parseError('failed to parse TS registry');
if (!jsProviders || !jsImage || !jsVideo || !jsAudio) parseError('failed to parse JS registry');

dedupCheck('MEDIA_PROVIDERS (ts)', tsProviders);
dedupCheck('MEDIA_PROVIDERS (js)', jsProviders);
dedupCheck('IMAGE_MODELS (ts)', tsImage);
dedupCheck('VIDEO_MODELS (ts)', tsVideo);
dedupCheck('IMAGE_MODELS (js)', jsImage);
dedupCheck('VIDEO_MODELS (js)', jsVideo);
for (const kind of ['music', 'speech', 'sfx']) {
  dedupCheck(`AUDIO_MODELS_BY_KIND.${kind} (ts)`, tsAudio[kind]);
  dedupCheck(`AUDIO_MODELS_BY_KIND.${kind} (js)`, jsAudio[kind]);
}

// Every model must name a provider that exists, or the picker silently drops it.
for (const [side, providers, buckets] of [
  ['ts', tsProviders, { IMAGE_MODELS: tsImage, VIDEO_MODELS: tsVideo, ...Object.fromEntries(Object.entries(tsAudio).map(([k, v]) => [`AUDIO_MODELS_BY_KIND.${k}`, v])) }],
  ['js', jsProviders, { IMAGE_MODELS: jsImage, VIDEO_MODELS: jsVideo, ...Object.fromEntries(Object.entries(jsAudio).map(([k, v]) => [`AUDIO_MODELS_BY_KIND.${k}`, v])) }],
]) {
  const known = new Set(providers.map((p) => p.id));
  for (const [bucket, records] of Object.entries(buckets)) {
    for (const r of records) {
      if (!known.has(r.provider)) {
        fail(`${bucket}[${r.id}] (${side}) names provider "${r.provider}", which is not in MEDIA_PROVIDERS`);
      }
    }
  }
}

const diffs = [];
diffs.push(...diffRecords('MEDIA_PROVIDERS', tsProviders, jsProviders));
diffs.push(...diffRecords('IMAGE_MODELS', tsImage, jsImage));
diffs.push(...diffRecords('VIDEO_MODELS', tsVideo, jsVideo));
for (const kind of ['music', 'speech', 'sfx']) {
  diffs.push(...diffRecords(`AUDIO_MODELS_BY_KIND.${kind}`, tsAudio[kind], jsAudio[kind]));
}
if (tsLengths && jsLengths && tsLengths.join(',') !== jsLengths.join(',')) {
  diffs.push(`VIDEO_LENGTHS_SEC: ts=[${tsLengths.join(', ')}] js=[${jsLengths.join(', ')}]`);
}
if (tsDurations && jsDurations && tsDurations.join(',') !== jsDurations.join(',')) {
  diffs.push(`AUDIO_DURATIONS_SEC: ts=[${tsDurations.join(', ')}] js=[${jsDurations.join(', ')}]`);
}

if (diffs.length > 0) {
  process.stderr.write(
    'verify-media-models: drift detected between apps/web/src/media/models.ts and apps/daemon/src/media/models.ts\n',
  );
  for (const d of diffs) process.stderr.write(`  - ${d}\n`);
  process.stderr.write('\nFix: update both files in lockstep, then re-run this script.\n');
  process.exit(1);
}

process.stdout.write(
  `verify-media-models: OK (providers + models match field-for-field: `
  + `${tsProviders.length} providers, ${tsImage.length} image, ${tsVideo.length} video, `
  + `${Object.values(tsAudio).reduce((n, v) => n + v.length, 0)} audio)\n`,
);
