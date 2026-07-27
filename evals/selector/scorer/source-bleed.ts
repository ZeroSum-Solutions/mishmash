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

    // Sol-N2: no free pass for omitting the fingerprint. styleOk requires a
    // NON-EMPTY fingerprint that matches one of the claimed source's real
    // captured clusters -- a missing fingerprint is unverifiable, not clean.
    const claimedFingerprints = input.sourceStyleFingerprints[el.sourceId] ?? [];
    const styleOk = isNonEmpty(el.styleFingerprint) && claimedFingerprints.includes(el.styleFingerprint);

    if (!domPathOk || !styleOk) violatingElementIds.push(el.elementId);
  }
  return { bleedCount: violatingElementIds.length, violatingElementIds };
}

function isNonEmpty(v: string | undefined): v is string {
  return typeof v === 'string' && v.length > 0;
}
