# Sealed held-out split — access control (W7 / S7-2)

**ORCHESTRATOR: commit this file LAST**, after every `.enc` blob listed in `MANIFEST.txt` has
already landed on `main` (or this branch). `scripts/waves/verify-w7.ts` resolves "the seal commit"
as the latest commit touching this exact path, and requires every sealed `.enc` payload's defining
commit to **precede** that seal commit, with **zero** commits after it touching any sealed path
(the frozen-path invariant — see `MANIFEST.txt`'s header for the required commit order). Committing
this file before the `.enc` blobs, or touching a sealed path again after committing this file, both
fail the gate (`verify-w7.ts` C7-2 / C7-11, F18).

## Sealed cases

This corpus's held-out split is 2 of 10 cases (`manifest.sealedFraction = 0.2`):

- **`sealed-marketing-alt`** — IR plaintext sha256: `f39a253d9cd69f1fde160ad269a8277e8dde174c10ab960fb7bbfa8812c1ada5`
- **`sealed-docs-widget`** — IR plaintext sha256: `d74bc0368ef786e770357792c52250ebca1c4bd1916db4c769478bab130e86b3`

**This is the SECOND version of this handoff bundle**, replacing an earlier one that was already
sealed and committed (blobs `0c459cde6`, seal record `d294c2b98`). Three bugs were found in the
FIRST version after it was sealed, all fixed in the regenerated plaintext below — see the milestone
message to the orchestrator for the full story:

1. Every IR's `provenance[].breakpoint` was hardcoded to `"desktop"` and every node's `nodeId`/
   `domPath` were shared verbatim across both breakpoints, so `verify-w7.ts` C7-4's breakpoint-only
   field-derangement control was mechanically unconstructible / never actually broke resolution.
   Fixed: `nodeId` is now breakpoint-specific and provenance breakpoints alternate.
2. `sealed-docs-b` and `mkt-grid-a` (a non-sealed source) shared the same style preset index,
   producing byte-identical `computedStyle` blocks that tripped `verify-w7.ts` C7-11's leak
   scanner. Fixed: every one of the 19 sources now has a unique preset.
3. Pretty-printed JSON plus long, near-identical boilerplate prose (`constraints`, `variantAxes`,
   `conflictResolution` rationale) produced >64-byte spans byte-identical across every case,
   including this sealed one — more C7-11 false positives. Fixed: compact JSON, short
   case/axis/source-tagged tokens instead of prose, and decorative CSS properties dropped from
   `computedStyle` (kept only `display`/`position`, the two the layout-evidence check reads).

**If a prior version of `sealed-marketing-alt`/`sealed-docs-widget` is already sealed in this repo,
it must be replaced by this corrected version** — the previously-sealed ciphertext no longer
matches the corrected, non-sealed half of the corpus and will fail C7-4/C7-11 permanently
otherwise. Per the frozen-path rule this requires a NEW seal commit (a fresh touch of this file)
and, per `verify-w7.ts`'s own comments, a founder decision record authorizing the re-seal.

## Access control

Sealed case plaintext (IR and snapshot payloads for `sealed-marketing-alt` and
`sealed-docs-widget`) **must not** be exposed to W8's implementing agent's context, sandbox, or
working tree at any point before W8 is scored against this held-out split at gate time. The only
form these cases may take in-repo is AES-256-CBC ciphertext (`.enc`) — decryptable only by
`scripts/waves/verify-w7.ts` at verification time, using a key that lives outside this repository
and outside any agent's normal read scope. **Access to the sealed plaintext is forbidden** to any
agent other than the orchestrator process performing the seal, and to `verify-w7.ts` itself at
score time. This is a mechanically-enforceable claim only in part — see
`scripts/waves/verify-w7.ts`'s own `SEAL_ACCESS_BOUNDARY` comment for the honest boundary between
what is checked mechanically (in-repo plaintext leakage, `.enc` content-binding, key file
permissions) and what remains an orchestration invariant (same-user, out-of-repo access to the key
or the proof directory cannot be prevented by file permissions alone).
