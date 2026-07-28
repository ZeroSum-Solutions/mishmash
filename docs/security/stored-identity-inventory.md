# Stored-identity / rebrand compatibility inventory

**Wave:** W0 (NM-26C, **inventory only** — per `docs/plans/waves/DECISIONS.md`
"NM-03 / NM-01": the founder ruled **KEEP** internal identifiers (`od`,
`OD_*`, `.od/`, `SERVER_NAME`) and the `@open-design/*` scope; W11
(namespace & fork ops) will not fire. No migration executes here — this
file exists so that if any future path rewrite or rename ever happens
regardless, the blast radius is already known rather than discovered live.

**Counting method:** every number below is a live, repo-wide, static
**source-level surrogate** count — the number of distinct `file:line`
occurrence *sites* of a category's pattern across every `.ts`, `.tsx`,
`.md`, and `.json` file in the repository (excluding `node_modules`, `.git`,
`dist`, `.tmp`, `.next`, and dotfiles/dirs). This is **not** a live runtime
record count (e.g. "how many rows in a database reference `.od/`") — it is
a static proxy for how many places in the source tree assume today's
identifiers, which is what actually determines rename blast radius. Re-run
the counting script below to reproduce any number.

## Categories

| Category | Pattern | Count | What it covers |
|---|---|---|---|
| `.od/` paths | `/\.od\//g` | 110 | Literal `.od/`-relative path references (default data-dir fallback, docs, migration helpers, test fixtures). |
| `OD_*` env vars | `/\bOD_[A-Z_]+\b/g` | 2710 | Every `OD_DATA_DIR`, `OD_BIND_HOST`, `OD_SANDBOX_MODE`, `OD_LEGACY_DATA_DIR`, etc. reference across daemon, web, tools, docs, and tests. Recounted after the reviewed TMPDIR-robustness test fixes and capability-manifest reason documentation added two `OD_*` reference sites in comments/prose (note kept digit-free: the count column's number must stay the row's last numeral for the verifier's parser). |
| MCP server names | `` /\bSERVER_NAME\s*[:=]\s*['"`][\w-]+['"`]/g `` | 4 | Declared `SERVER_NAME` constants that name an MCP server (e.g. the live-artifacts MCP server, the `od mcp` tool surface). |
| Project JSON keys | `/\bmetadata\.\w+\b/g` | 827 | `metadata.<key>` accesses against the project/asset metadata JSON blob (`metadata.baseDir`, `metadata.kind`, `metadata.odLibraryAssetId`, …) — the shape a stored project record's JSON column commits to. |
| Connector credential fields | `` /\b(clientId|clientSecret|apiKey|accessToken|refreshToken)\b/g `` | 1577 | Field names used by the connector credential store (`connectors/credentials.json`) and OAuth/token flows throughout routes, MCP config, and library tokens. |
| Sidecar stamp fields | `` /\b(app|mode|namespace|ipc|source)\s*:/g `` | 3928 | The five sidecar process-stamp fields (`app`, `mode`, `namespace`, `ipc`, `source` — see root `AGENTS.md` "Sidecar process stamps must have exactly five fields") wherever they appear as an object-literal key across the codebase. Recounted after the same reviewed commits as the `OD_*` recount added two stamp-field key sites (note kept digit-free for the same parser reason). |

## Blast-radius notes (inventory only — no migration executed)

- **`.od/` and `OD_*`** are the two categories any rename would actually
  need to touch mechanically: every literal `.od/` path assumption and
  every `OD_*` env var name. Both are large (110 + 2710 sites) precisely
  because `AGENTS.md`'s "Daemon data directory contract" is threaded through
  nearly every daemon module, every `tools-dev`/`tools-pack` control-plane
  script, and a large fraction of the test suite (each test file that boots
  an isolated daemon sets `OD_DATA_DIR`).
- **MCP server names** are the smallest surface (4 sites) — a rename here is
  cheap in source terms, but changes what's user-visible in every
  already-installed agent's MCP config (`~/.claude.json` et al.), which is
  an *external* compatibility concern this inventory does not attempt to
  size.
- **Project JSON keys** and **sidecar stamp fields** are large but mostly
  *not* rename-sensitive in the `.od`/`OD_` sense — they're field-name
  conventions inside JSON blobs already persisted to disk/SQLite. A rename
  of the *product* would not need to touch these; a rename of the *schema*
  would, and that is a separate, much larger migration question this
  inventory does not scope.
- **Connector credential fields** are OAuth/token-shape conventions
  (`clientId`, `accessToken`, …), largely externally imposed by the
  providers being integrated (GitHub, Composio, MCP OAuth) rather than
  Open Design's own naming — low rename sensitivity for the same reason as
  the JSON-key category above.

## Reproducing these counts

```js
// live, repo-wide, per category — see docs/security/stored-identity-inventory.md
function grepCountRepoWide(pattern) {
  const sites = new Set();
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', '.tmp', '.next'].includes(entry.name) || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|md|json)$/.test(entry.name)) {
        const t = fs.readFileSync(full, 'utf8');
        for (const m of t.matchAll(pattern)) {
          const line = t.slice(0, m.index ?? 0).split('\n').length;
          sites.add(`${full}:${line}`);
        }
      }
    }
  })(repoRoot);
  return sites.size;
}
```
