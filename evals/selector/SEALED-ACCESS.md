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

- **`sealed-marketing-alt`** — IR plaintext sha256: `101eee4a6943bbdc784613985308e971b5eb310eaf6457cd7200c939de860928`
- **`sealed-docs-widget`** — IR plaintext sha256: `087cf656b0613a149a3007b9b91f7b0d0ebc84c2c36caea1751f46666d79116f`

Both cases' plaintext (IR + every source's per-breakpoint snapshot) was authored by the W7
implementing agent and handed off out-of-band for encryption — it was **never** committed to this
repository in plaintext, and the implementing agent never held (and did not seek) the seal key at
`~/.claude/goal-state/mishmash-w7-selector-foundations/seal.key`.

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
