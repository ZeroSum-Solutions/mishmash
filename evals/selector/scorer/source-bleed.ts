// source-bleed.ts -- style/content fingerprints from a NON-selected source
// appearing in a region another source claims. Two independent bleed modes
// are checked, because they are genuinely different failure shapes:
//
//   1. domPath-membership bleed: an output element claims sourceId=X but its
//      (domPath) does not belong to X's captured DOM at all -- the element's
//      structural identity itself came from somewhere else.
//   2. style-fingerprint bleed: an output element's domPath legitimately
//      belongs to the claimed source, but its rendered style fingerprint
//      (color+background+font) matches a DIFFERENT source's captured style
//      cluster, not the claimed source's own -- structurally attributed
//      correctly, but visually contaminated.
//
// This is deliberately NOT implemented as "is the other source's name
// present as a string anywhere" (an HTML-comment check) -- see the PRD's own
// call-out of that exact anti-pattern. Both checks are membership tests
// against the CLAIMED source's own real captured data.
//
// Sol-N2 (deliverable review round 1): styleFingerprint is REQUIRED evidence
// on a claimed-source element -- a MISSING fingerprint no longer scores as
// clean. Previously `el.styleFingerprint === undefined` short-circuited
// styleOk to true, so an element could dodge the fingerprint check entirely
// just by omitting it (Sol's repro: "submit a claimed-source domPath with no
// styleFingerprint... source-bleed.ts explicitly treats the missing
// fingerprint as clean even if non-selected-source styling is present").
// Missing evidence is unverifiable, and unverifiable is not clean.
//
// Sol-N2 (deliverable-review fix round 2): the round-1 fingerprint check was
// SOURCE-WIDE, not region-bound -- `sourceStyleFingerprints[sourceId]` is a
// flat list of every fingerprint that source has ANYWHERE, so a fingerprint
// the claimed source genuinely has at a DIFFERENT region (a different
// domPath) passed as clean even though it does not belong at THIS domPath.
// `sourceRegionFingerprints` (NEW, optional, additive) supplies the real
// per-(source,domPath) mapping so the check can require the fingerprint to
// match the claimed source AT THE CLAIMED REGION specifically. Optional and
// additive so a caller that doesn't supply it (the sealed gate's own C7-7
// check, which is not being amended this round) keeps the exact round-1
// source-wide behavior unchanged -- this is a strictly STRONGER check
// layered on top, not a replacement, activated only when the richer mapping
// is actually supplied.

export interface BleedCompositionElement {
  elementId: string;
  sourceId: string;
  domPath: string;
  styleFingerprint?: string;
}

export interface SourceBleedInput {
  composition: BleedCompositionElement[];
  sourceDomPaths: Record<string, string[]>;
  sourceStyleFingerprints: Record<string, string[]>;
  // sourceId -> domPath -> the fingerprint THAT source genuinely renders AT
  // that specific domPath. Optional: when omitted, styleOk falls back to the
  // round-1 source-wide membership check.
  sourceRegionFingerprints?: Record<string, Record<string, string>>;
}

export interface SourceBleedResult {
  bleedCount: number;
  violatingElementIds: string[];
}

export function scoreSourceBleed(input: SourceBleedInput): SourceBleedResult {
  const violatingElementIds: string[] = [];
  for (const el of input.composition) {
    const claimedDomPaths = input.sourceDomPaths[el.sourceId] ?? [];
    const domPathOk = claimedDomPaths.includes(el.domPath);

    // Sol-N2 (round 1): no free pass for omitting the fingerprint. styleOk
    // requires a NON-EMPTY fingerprint -- a missing fingerprint is
    // unverifiable, not clean.
    const hasFingerprint = isNonEmpty(el.styleFingerprint);

    // Sol-N2 (round 2): when a region-bound mapping is supplied, require the
    // fingerprint to match AT THE CLAIMED domPath specifically -- a
    // fingerprint the source has genuinely captured at a DIFFERENT domPath
    // is bleed, even though it would pass the source-wide list check.
    // Falls back to the source-wide (round-1) check when no region mapping
    // is supplied for this source at all (backward-compatible default).
    const regionMap = input.sourceRegionFingerprints?.[el.sourceId];
    let styleOk: boolean;
    if (hasFingerprint && regionMap && Object.prototype.hasOwnProperty.call(regionMap, el.domPath)) {
      styleOk = el.styleFingerprint === regionMap[el.domPath];
    } else {
      const claimedFingerprints = input.sourceStyleFingerprints[el.sourceId] ?? [];
      styleOk = hasFingerprint && claimedFingerprints.includes(el.styleFingerprint!);
    }

    if (!domPathOk || !styleOk) violatingElementIds.push(el.elementId);
  }
  return { bleedCount: violatingElementIds.length, violatingElementIds };
}

function isNonEmpty(v: string | undefined): v is string {
  return typeof v === 'string' && v.length > 0;
}
