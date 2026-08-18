// Typeface catalogue — makes the webfonts already vendored under
// `design-templates/*/fonts/` reachable from a run that started with no
// template and no design system attached.
//
// The gap this closes: `design-templates/` ships thousands of self-hosted
// woff2 files (one per template, per weight, per subset), but nothing reads
// them back out as a reusable pool. A plain-brief run therefore falls back to
// the browser's default UI stack (`-apple-system`, `"Iowan Old Style"`, …),
// which is both a typographic-authority problem (system fonts read as
// unstyled) and a correctness bug (`"Iowan Old Style"` is Apple-only, so the
// same page renders differently on Windows/Linux).
//
// Only families that survive the redistribution-license gate
// (`apps/daemon/src/typefaces/allowlist.ts`) are ever listed here — the
// catalogue on disk also contains templates whose upstream font license is
// unclear (fonts fetched from Fontshare's free tier) or actively mislabeled
// (a commercial family name aliased onto substitute bytes), and those never
// appear in this API. See the allowlist module for the reasoning per family.

/** Normal or italic — the two styles a @font-face rule can declare. */
export type TypefaceFontStyle = 'normal' | 'italic';

/**
 * One physical @font-face rule available for a family: a specific
 * weight/style/subset cut backed by one woff2 file already on disk under
 * `design-templates/`.
 */
export interface TypefaceFace {
  /** Raw CSS font-weight — a single value ("400") or a variable range ("200 700"). */
  weight: string;
  style: TypefaceFontStyle;
  /** woff2 filename, relative to the family's source fonts/ directory. */
  file: string;
  /** Always "woff2" today — the catalogue only vendors that format. */
  format: string;
  /** Present when the source stylesheet subsetted the face (e.g. "latin", "latin-ext"). */
  unicodeRange?: string;
}

/**
 * Purely observational signals about a family's name and the faces actually
 * available — never a ranking or a "this one is good for X" recommendation.
 * AGENTS.md's Design authority section forbids this catalogue from encoding
 * taste, so the API reports facts (what weights exist, what words are
 * literally in the published family name) and leaves interpretation to
 * whoever is choosing a typeface for a specific brief.
 */
export interface TypefaceClassification {
  /** Distinct numeric weights this family ships as fixed cuts, ascending. */
  weights: number[];
  /** Present when at least one face is a variable font (a "lo hi" weight range). */
  variableWeightRange?: [number, number];
  styles: TypefaceFontStyle[];
  /** "Mono" appears in the published family name. */
  monospace: boolean;
  /**
   * Industry-standard width/weight words found verbatim in the published
   * family name (e.g. "Condensed", "Narrow", "Display", "Black", "Slab",
   * "Stencil", "Script"). Reported as-is; the catalogue does not decide
   * whether that makes a family a "display face" — it hands over the same
   * signal a human would get from reading the name.
   */
  nameHints: string[];
}

export interface TypefaceLicense {
  /** SPDX identifier, e.g. "OFL-1.1" or "Apache-2.0". */
  spdx: string;
  /** Where the redistribution right comes from, for a human reading the listing. */
  sourceLabel: string;
}

/** Light entry for the listing endpoint — no per-face detail, kept prompt-cheap. */
export interface TypefaceSummary {
  /** URL-safe id, e.g. "instrument-serif". */
  id: string;
  /** Canonical published family name, e.g. "Instrument Serif". */
  family: string;
  classification: TypefaceClassification;
  license: TypefaceLicense;
  /** How many distinct @font-face rules (weight × style × subset) this family has. */
  faceCount: number;
}

/** Full entry for the detail/install endpoints — carries every installable face. */
export interface TypefaceDetail extends TypefaceSummary {
  faces: TypefaceFace[];
}

export interface ListTypefacesQuery {
  /** Case-insensitive substring match against the family name. */
  q?: string;
  /** Only families with `classification.monospace === true`. */
  monospace?: boolean;
  /** Only families whose `nameHints` includes "Condensed" or "Narrow". */
  condensed?: boolean;
}

export interface ListTypefacesResponse {
  typefaces: TypefaceSummary[];
  /** Total distinct families found on disk before the license gate — for transparency. */
  scannedFamilies: number;
}

export interface GetTypefaceResponse {
  typeface: TypefaceDetail;
}

export interface InstallTypefaceRequest {
  projectId: string;
  /**
   * Destination directory, relative to the project root. Defaults to
   * `assets/fonts/<id>/` so multiple installed families never collide.
   */
  dir?: string;
}

export interface InstallTypefaceResponse {
  family: string;
  /** Destination directory the files were written into, relative to the project root. */
  dir: string;
  /** `fonts.css` path, relative to the project root. */
  cssFile: string;
  /** woff2 filenames written, relative to `dir`. */
  files: string[];
  /** The exact @font-face CSS written to `cssFile`, for a caller that wants to inline it. */
  css: string;
}
