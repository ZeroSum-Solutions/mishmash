# Wave C — Web-clone pipeline close-out

**Slug:** `mishmash-wc-clone-closeout`
**Gates on:** nothing (start immediately)
**Parallel with:** W0, W7 — lease: `skills/web-clone/**` + `apps/daemon/tests/web-clone-*.test.ts`
(verified against the branch diff; **W0 owns `pnpm guard` and the rest of the daemon test tree**)
**Lands:** *after* W0. Rebase onto post-W0 `main` and re-run the verifier before merging — a green
verifier on a stale base is not a green verifier.
**Blocks:** any future reuse of the capture substrate (W6b's remote capture explicitly may NOT
reuse it until this wave passes independent review)
**Loop:** `loop:red-green-review`, **2 fix rounds** — the program-wide cap from
`VERIFICATION-CONTRACT.md` §6. Revision 2 removed this wave's special "max 1 round," which
conflicted with the global stop rule and with this file's own "if verification fails twice."

## Why this wave exists

Three commits on `feat/web-clone-capture-hardening` (`8e3afa16b` → `357e3314d` → `371daca15`)
took the clone pipeline through three GPT-5.6 adversarial rounds. Every user-facing symptom the
founder reported is confirmed fixed: whole-site capture, query-bearing refs, recursive-fetch
fidelity, deterministic width, cleanup paths, bot-wall detection, origin classification.

Round 3 still returned REJECT with 6 new HIGH findings. **This wave exists to draw a deliberate
scope boundary instead of looping a fourth time** — three consecutive rounds surfacing new HIGHs
in new places is the signal that the remaining findings are a different class of work, not the
same bug.

## Scope — class (A) only: bugs reachable from benign, real-world sites

1. **False-green completion.** Recursive discovery that exhausts with no progress still prints
   "Mirror complete" and exits 0 (only the safety-cap path sets `mirrorIncomplete`). The existing
   test uses an eagerly-requested `<link>`, so it misses this path entirely — fix the fixture to
   an unused CSS URL.
2. **Origin leak on a failed request passes the gate.** `verify-mirror.mjs` moves failed requests
   into ignored `crossOriginFailures`, so a mirror still calling its original origin passes when
   that origin is offline. Record `origin-leak` regardless of response status.
3. **Malformed baseline silently disables gates.** A baseline with `origin: "not a url"` and
   `frameworks: {}` validates `ok: true`. Parse the origin, require HTTP(S), validate the writer's
   exact `frameworks` schema.
4. **Fragment refs duplicate assets.** `/sprite.svg` captured, `/sprite.svg#icon` referenced →
   treated as uncaptured, second file created. Strip fragments for manifest identity; preserve
   them only when emitting rewritten references.
5. **Filesystem-equivalent collisions.** `Images/Logo.png` vs `images/logo.png`, NFC vs NFD
   `café.png` — distinct in the manifest, identical on APFS. Use a filesystem-canonical collision
   key, or fold a source-URL hash into every generated filename.
6. **`ENAMETOOLONG`.** A 300-char pathname yields a 303-byte component. Cap component length,
   replacing the excess with a stable hash.
7. **Missing standard URL attributes.** `object[data]`, `link[imagesrcset]`, `form[action]`,
   `button[formaction]`, `xlink:href` are never discovered; unquoted `srcset=a.png,b.png` returns
   one string. Use an explicit URL-bearing attribute set and the same tokenizer for both forms.

## Scope — class (B): document, do not build

These are hostile-input hardening on a **local tool the operator points at sites they choose**.
Fixing them is gold-plating; hiding them is dishonest. Record each in
`skills/web-clone/SKILL.md` under a "Known limitations" heading, stating the precondition:

- `containedPath()` follows an in-root symlink, so a pre-existing symlinked `assets/` directory
  could redirect a write outside the mirror root.
- `claim()` is not injective against a *crafted* adversarial URL set (the disambiguation widens
  8→16 hex chars without re-checking).
- A hand-edited `mirror-manifest.json` can carry duplicate or unsafe entries; `restore()` trusts it.

### The class-B escape hatch is sealed

Both reviewers flagged the same abuse: "findings outside class A → Known limitations" lets an
agent **reclassify a hard bug as documentation** and land. Under `VERIFICATION-CONTRACT.md` §3 R6,
severity belongs to the reviewer, not the author. Concretely:

- The class-B list above is **closed**. It is the three items named here, frozen at the start of
  the wave — not a bucket that grows during it.
- **Moving a failing red test into "Known limitations" is a severity change** and requires a
  founder token. An agent may not do it.
- A new finding that is genuinely out of scope is filed as a **follow-up with its own red spec**,
  per the repo's `Bug follow-up workflow`. It is not absorbed into this wave's docs.

## Mandatory: fix the lying documentation

Round 3 re-flagged comments and docs asserting guarantees the code does not provide —
injectivity, write containment, discovery completeness, completion state. **Fix the behavior
first, then narrow every claim to what is actually enforced.** This repo treats a false guarantee
in a comment as a hard reject, and it has now been flagged in three consecutive rounds.

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3. Verified by `scripts/waves/verify-wc.ts`.

| ID | Criterion | Verification |
|---|---|---|
| CC-1 | **All seven** class-(A) items have red specs failing on `371daca15`, passing at head | Assertion matrix enumerating all 7 by ID — not "each item" prose. A missing row is a fail, not an omission |
| CC-2 | No-progress exhaustion exits non-zero | Fixture with an unused, unreachable CSS URL → exit ≠ 0, no "Mirror complete" |
| CC-3 | Origin leak is detected **independent of response status** | Assert the mirror's **normalized outbound request origin**, not whether the request succeeded. The current gate passes when the original origin merely refuses connections |
| CC-4 | CC-3 has a **negative control** | An unrelated offline third-party CDN must **not** trip the origin-leak gate. Without this, any network failure reads as a pass while the real leak survives (§3 R4) |
| CC-5 | Malformed baseline fails closed | `origin: "not a url"` and `frameworks: {}` each produce a named diagnostic, exit ≠ 0 |
| CC-6 | URL-attribute coverage is enumerated, not sampled | Table-driven over `object[data]`, `link[imagesrcset]`, `form[action]`, `button[formaction]`, `xlink:href`, `video[poster]`, CSS `url()`, and `srcset` **with density and width descriptors**, quoted and unquoted. Passing on the listed five while `poster`/`srcset`/CSS `url()` stay broken was the gap |
| CC-7 | No comment or doc claims an unenforced guarantee | **Mechanical:** a committed claims list (`injectivity`, `containment`, `completeness`, `completion-state`) grepped against touched docblocks + `SKILL.md`; each surviving claim cites the test that enforces it. "Reviewer declares the prose accurate" is human judgment wearing a checkbox |
| CC-8 | Class-(B) limitations documented with preconditions | The three frozen items present, each with its precondition. The list may not have grown |
| CC-9 | Full web-clone suite green, **no count criterion** | Named suite passes with **zero** `skip`/`only`/`todo` markers added; `pnpm guard`, `pnpm typecheck` exit 0. "112+ tests" is banned under §3 R3 — it rewards splitting one test into three |
| CC-10 | No regression in the ~17 previously-confirmed fixes | Those fixes' tests enumerated by name and asserted green — not implied by suite success |
| CC-11 | Branch lands **after W0**, from a fresh base | Rebased onto post-W0 `main`, verifier re-run green on the rebased commit, PR with the repo template, machine-readable adversarial verdict recorded, merged by the integrating writer |

## Adversarial review

GPT-5.6 Sol, scoped **strictly** to: (a) do the 7 class-(A) fixes work, (b) did they introduce
regressions in the ~17 previously-confirmed fixes, (c) does any doc still overclaim.

Findings outside class (A) are out of scope **for this wave's implementation** — but they are
filed as follow-ups with their own red specs, **not** appended to "Known limitations." Only the
founder may reclassify a finding's severity (§3 R6). Two fix rounds, then escalate.
