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

    const claimedFingerprints = input.sourceStyleFingerprints[el.sourceId] ?? [];
    const styleOk = el.styleFingerprint === undefined || el.styleFingerprint.length === 0 || claimedFingerprints.includes(el.styleFingerprint);

    if (!domPathOk || !styleOk) violatingElementIds.push(el.elementId);
  }
  return { bleedCount: violatingElementIds.length, violatingElementIds };
}
