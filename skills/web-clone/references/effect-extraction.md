# Evidence discipline + baseline gate for effect extraction (WebGL/Canvas reverse-engineering branch)

`reverse-engineering.md` covers "how to read a rendering architecture"; this doc covers
**how not to fool yourself while reverse-engineering an effect**, and the fallback route
when real source can't be found. Three pieces: **grade the evidence -> no-compensation ->
baseline-first gate**.

> The discipline pattern is inspired by [lixiaolin94/skills · web-shader-extractor](https://github.com/lixiaolin94/skills)
> (that repo has no LICENSE, so all rights are reserved by default — this doc **only borrows the
> method concepts, entirely rewritten in this skill's own words; none of its code or text is
> copied**). It shares the same spirit as web-clone's rule #1, "real source above all" — it
> just upgrades "cite the line number" into a systematic evidence regime.

## 1. Grade the evidence (tag every conclusion)

When writing a TEARDOWN, tag every key fact about the render pipeline with a level,
**defaulting to the lowest level when unsure**:

| Tag | Meaning | Examples |
|---|---|---|
| `SOURCE` | Direct, hard evidence tied to the target | Public real source lines, a module restored from a source-map, a runtime object dump, captured shader/WGSL text, frame captures, a hashed network response body |
| `PARTIAL` | A lead for the next probe, not yet conclusive | Class/function/field names, a minified bundle slice, a framework object, a shader obtained but missing uniforms/pass/input state |
| `GUESS` | A reconstructed value with no direct evidence | Visual fitting, name-based inference, falling back to defaults, hand-tuned magic numbers, any "looks right" reconstruction |

- **Untagged = treat as GUESS.** Don't let unevidenced claims blend into "known facts".
- This institutionalizes the marbles lesson ("AI fabricated an analytic intersection solve into ray-marching"): **any GUESS-level implementation must be upgraded to SOURCE before you copy it.**

## 2. No-compensation (don't tune parameters to mask not understanding something)

> **Never** adjust brightness / speed / position / noise values just to make the picture "look right", masking a real bug in timing, color, FBO, resources, coordinate system, or state model.

- If a fitted constant makes the output look closer -> **it's still GUESS**, and you must note what evidence would upgrade it.
- Wiring-level facts (pass order, coordinate transforms, time units, input coupling) **don't become correct just because the picture looks similar** — track them down to real evidence independently.
- Consistent with web-clone's existing rule: write down what you couldn't verify, honestly — **don't fake "the drag worked".**

## 3. Baseline-first gate (reproduce first, then refactor)

The **easiest mistake** when reverse-engineering an effect is extracting, rewriting, and
polishing all at once, ending up with something that neither looks right nor can be explained
step by step. Split it into gated stages instead:

```
Locate the render surface -> capture the minimal ground truth -> RAW REPLAY (minimal, as-is reproduction) -> BASELINE frame-by-frame comparison passes
                                                                                   |
                                                                    only allowed to proceed after passing
                                                                                   v
                                                        PROJECTIZE (refactor into an editable project) -> PACKAGE
```

- **RAW REPLAY**: using the captured real draw calls / shaders / uniforms / vertex data, build a runnable reproduction that is **as minimal and as close to the original as possible** — no optimizing, no framework swap, no parameter tweaking.
- **BASELINE gate**: the RAW REPLAY must match the original frame-by-frame (or via multi-frame sampling) visually, or it doesn't pass. **Refactoring is not allowed until this gate is passed.**
- Only after passing the gate do you PROJECTIZE: switch to a maintainable implementation (raw WebGL / Three.js TSL / Babylon, etc.), still tagging every piece with its evidence level.
- Tag the final state honestly with one of three outcomes: `DONE_BASELINE_VERIFIED` (reproduced and verified), `DONE_PROJECTIZED` (already engineered), or `DONE_BASELINE_WITH_GAPS` (reproduced but with documented gaps).

## 4. When real source can't be found — runtime-capture fallback

web-clone's first move is always "go find the real source on GitHub / via source-map". But
**effect-heavy sites are often sourceless and fully minified.** In that case, don't fall back
to "write it to look similar" (that's GUESS) — instead **capture runtime ground truth at the
render boundary**:

- Intercept at the WebGL/WebGPU context: the actual draw calls, bound programs, compiled shader source, uniform values, FBO/texture sizes, blend/depth state.
- Tooling directions: spector.js-style frame capture, patching the `WebGLRenderingContext` prototype to log calls, `getShaderSource` to get compiled shader text, a preload script injecting hooks before page scripts run.
- Anything captured this way counts as `SOURCE` level — it is the new "real source", fed into the baseline-first flow.

## 5. When to delegate to web-shader-extractor

If you already have `web-shader-extractor` installed (the skill from `npx skills add lixiaolin94/skills`),
**delegate the effect-extraction portion to it directly in the following situations, with web-clone
staying only the overall entry point**:

- The site is a WebGL/WebGPU/heavy-canvas effect, and neither GitHub nor source-map yields real source;
- You need runtime frame capture, frame-by-frame comparison, or shader/uniform-level extraction;
- You want the full gated flow of "reproduce a baseline first, then engineer it independently".

Once you get the delegated output back (a minimal reproducible baseline plus an evidence
package), **merge it into `<current-project-dir>/`**, fill in NOTES/TEARDOWN per web-clone's
deliverable spec, and continue with Step 5 verification + Step 6 replacement.

Not having it installed doesn't matter either: the discipline in the four sections above can
be followed by hand — web-shader-extractor just packages the capture machinery from section 4
into a ready-made tool.

## Tying into existing deliverables

- Tag every line of TEARDOWN.md's "A. Real technical teardown" with an evidence label (`SOURCE`/`PARTIAL`/`GUESS`).
- "B. Secondhand-analysis verification table" is already about catching GUESS masquerading as SOURCE — same standard.
- Keep baseline reproductions in `<site-name>-clone/RECON/baseline/`, alongside the original screenshots, as hard proof of "verified".
