// diversity.ts -- structural_variant_diversity, scored against the FOUR
// pre-registered axes frozen in evals/selector/diversity-axes.json:
//
//   layout-skeleton     -- the SET of domPath values (order-independent).
//   section-order       -- the SEQUENCE of domPath values, position-aligned
//                           (order-dependent -- this is what catches "same
//                           elements, different arrangement").
//   motion-timeline      -- the SEQUENCE of motionSignature values,
//                           position-aligned.
//   breakpoint-behavior  -- the SEQUENCE of breakpoint values,
//                           position-aligned.
//
// Deliberately absent: color, background, font, class names. Those fields
// do not exist anywhere on a composition element (see CompositionElement in
// scorer/index.ts) -- a recolor-only or class-name-only trio has NOTHING to
// move any of the four tracked axes, so it scores 0 by construction, not by
// a special case. That is the PRD's own bar: "a scorer testing only 'any
// change'... fails" and "Without pre-registration... an agent sets distance
// = tree-edit over class names."
//
// A trio's score is: for each axis, the MINIMUM pairwise distance across
// every pair in the trio (so a change visible in only one pair of the three
// cannot inflate the score), then the MAXIMUM across the four axes (any ONE
// axis showing genuine, uniform variation is sufficient -- the four axes are
// not required to move in lockstep, since a real generator run would
// typically vary one or two axes per directive, not all four at once).
//
// Sol-N4/F8 (deliverable-review fix round 2): motion-timeline previously
// compared raw motionSignature STRINGS for inequality -- two arbitrary,
// unverifiable labels ("timeline-a" vs "timeline-b") counted as fully
// distinct even though neither encodes any real transition evidence (Sol's
// repro: "arbitrary motion labels a/b/c score 1.0"). This corpus's own
// convention (see scorer/index.ts's motionEvidenceFactor) is that a REAL
// motionSignature has the shape `transition:<ms>ms`, tied to a captured
// node's actual computedStyle.transitionDuration. verifiedMotionDiffFraction
// only counts a position as genuinely distinct when BOTH values parse in
// that shape AND their numeric durations differ -- an unparseable/arbitrary
// label (on either side of the pair) contributes ZERO distinctness for that
// position, same as if the values were equal. This is the standard the
// scorer defines; the sealed gate's own C7-8 fixtures (which currently use
// synthetic timeline-a/b/c labels) are being amended separately to supply
// real evidence-backed trios.

export interface DiversityElement {
  elementId: string;
  domPath: string;
  breakpoint: string;
  motionSignature?: string;
}

export interface DiversityResult {
  score: number;
}

function jaccardDissimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersectionSize = 0;
  for (const x of a) if (b.has(x)) intersectionSize++;
  const unionSize = new Set([...a, ...b]).size;
  return unionSize === 0 ? 0 : 1 - intersectionSize / unionSize;
}

function positionDiffFraction(a: readonly string[], b: readonly string[]): number {
  const n = Math.max(a.length, b.length);
  if (n === 0) return 0;
  let diff = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) diff++;
  }
  return diff / n;
}

// `transition:<digits>ms` -- the real-evidence motionSignature convention
// (see scorer/index.ts). Returns the parsed millisecond value, or null for
// anything else (an arbitrary/unverifiable label).
function parsedTransitionMs(motionSignature: string): number | null {
  const m = /^transition:(\d+)ms$/.exec(motionSignature);
  return m ? Number(m[1]) : null;
}

// Sol-N4/F8: like positionDiffFraction, but a position only counts as
// distinct when BOTH values parse as real transition evidence AND their
// durations differ -- two arbitrary labels (or one arbitrary, one real) are
// UNVERIFIABLE, not distinct, and contribute 0 regardless of whether the raw
// strings happen to differ.
function verifiedMotionDiffFraction(a: readonly string[], b: readonly string[]): number {
  const n = Math.max(a.length, b.length);
  if (n === 0) return 0;
  let diff = 0;
  for (let i = 0; i < n; i++) {
    const msA = a[i] !== undefined ? parsedTransitionMs(a[i]!) : null;
    const msB = b[i] !== undefined ? parsedTransitionMs(b[i]!) : null;
    if (msA !== null && msB !== null && msA !== msB) diff++;
  }
  return diff / n;
}

function allPairs<T>(arr: readonly T[]): Array<[T, T]> {
  const pairs: Array<[T, T]> = [];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      pairs.push([arr[i]!, arr[j]!]);
    }
  }
  return pairs;
}

function minOf(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.min(...values);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function scoreDiversity(compositions: DiversityElement[][]): DiversityResult {
  if (compositions.length < 2) return { score: 0 };
  const pairs = allPairs(compositions);

  const skeleton = minOf(pairs.map(([a, b]) => jaccardDissimilarity(new Set(a.map((e) => e.domPath)), new Set(b.map((e) => e.domPath)))));
  const order = minOf(pairs.map(([a, b]) => positionDiffFraction(a.map((e) => e.domPath), b.map((e) => e.domPath))));
  const motion = minOf(pairs.map(([a, b]) => verifiedMotionDiffFraction(a.map((e) => e.motionSignature ?? ''), b.map((e) => e.motionSignature ?? ''))));
  const breakpoint = minOf(pairs.map(([a, b]) => positionDiffFraction(a.map((e) => e.breakpoint), b.map((e) => e.breakpoint))));

  return { score: clamp01(Math.max(skeleton, order, motion, breakpoint)) };
}
