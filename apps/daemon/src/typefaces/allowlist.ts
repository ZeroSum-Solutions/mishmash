// Redistribution allowlist for the typeface catalogue (see
// `apps/daemon/src/typefaces/catalogue.ts`). This is the licence gate: a
// family that scans off disk under `design-templates/*/fonts/fonts.css` is
// only ever offered through `/api/typefaces` if it appears here.
//
// ---- How this list was built --------------------------------------------
//
// `scripts/vendor-fonts.ts` is the tool that put every woff2 in
// `design-templates/` there in the first place. Reading it (not the
// destination `fonts.css` files, which no longer carry a source URL once
// vendored) shows exactly three upstream providers ever get fetched:
//
//   - fonts.googleapis.com (Google Fonts) — the default request path for
//     every family that isn't in `familyFallbacks`. Google Fonts ships every
//     family under SIL OFL 1.1 or Apache-2.0 and explicitly documents both
//     licences as permitting embedding/redistribution in software and
//     websites — that is the catalogue's entire purpose.
//   - rsms.me (Inter's own site, run by Inter's author) — used only for
//     `InterVariable` / `Inter var`. Inter itself is SIL OFL 1.1; rsms.me is
//     Inter's official self-hosting distribution, not a third party, so its
//     other family names (`Inter`, `InterDisplay`, `Inter Tight`) carry the
//     same licence regardless of which of the two hosts actually served the
//     bytes for a given template.
//   - api.fontshare.com (Fontshare, an Indian Type Foundry product) — used
//     for `Clash Display`, `Clash Grotesk`, `General Sans`, `Satoshi`,
//     `Switzer`, `Gambarino`, `PP Mondwest`. Fontshare's free tier licenses
//     personal/commercial USE of the rendered typeface freely, but its terms
//     are about shipping a *document or product that uses the font* — not
//     about handing the raw font files to unrelated downstream projects
//     through a general-purpose "install this typeface anywhere" tool, which
//     is what this feature is. That distinction was never independently
//     confirmed, so every Fontshare-sourced family is excluded below.
//
// A handful of names on disk are neither of those: `Helvetica Now Display
// Bold`, `Helvetica Regular`, `HelveticaNowDisplay-Medium`,
// `HelveticaNowDisplayW01-Rg`, and `TT Norms Pro`. `scripts/vendor-fonts.ts`'s
// own `familyFallbacks` comment explains these: the *source* template
// declared a locally-licensed commercial face, and the importer substituted
// Inter's bytes under that alias rather than leave a permanently broken font
// request. Offering these names here would misrepresent what is actually
// installed (Inter, not Helvetica or TT Norms Pro) and trade on font names
// this project has no rights to — excluded outright. The real "Inter" entry
// already covers the bytes honestly.
//
// A few more names are ambiguous aliases of a family that IS included under
// its canonical spelling (`Bricolage` vs `Bricolage Grotesque`, `InterTight`
// vs `Inter Tight`, `Playfair` vs `Playfair Display`, `JetMono` vs
// `JetBrains Mono`, `Geist Sans` vs `Geist`) or unrecognized one-off names
// this review could not independently place (`Iosevka Charon`, `Stack Sans
// Notch`) — both classes are excluded rather than guessed at, per "prefer
// excluding a doubtful family over shipping it."
//
// Icon/glyph faces (`Material Icons Round`, `Material Symbols Outlined`,
// `Material Symbols Rounded`) are excluded for a different reason: they are
// out of scope for a *typography* catalogue regardless of licence, matching
// the existing `ICON_FAMILY_RE` filter in `apps/daemon/src/brands/fonts.ts`.
//
// This list only covers the ~117 distinct family names actually declared in
// this repository's `design-templates/*/fonts/fonts.css` files today (see
// `apps/daemon/tests/typefaces-catalogue.test.ts` for the full-catalogue
// coverage check). A name that never appears on disk is simply never looked
// up here; it does not need an entry.

export interface TypefaceLicenseEntry {
  /** Canonical display spelling — the catalogue always reports this, not whatever casing was on disk. */
  canonicalName: string;
  spdx: string;
  sourceLabel: string;
}

const GOOGLE_FONTS = (canonicalName: string, spdx: 'OFL-1.1' | 'Apache-2.0' = 'OFL-1.1'): TypefaceLicenseEntry => ({
  canonicalName,
  spdx,
  sourceLabel: 'Google Fonts',
});

const INTER_PROJECT = (canonicalName: string): TypefaceLicenseEntry => ({
  canonicalName,
  spdx: 'OFL-1.1',
  sourceLabel: 'Inter project (rsms.me)',
});

function normalizeFamilyKey(family: string): string {
  return family.trim().toLowerCase();
}

/** Exact declared family name (as it appears in fonts.css) -> licence entry. Keyed lowercase. */
const ENTRIES: ReadonlyArray<[string, TypefaceLicenseEntry]> = [
  ['albert sans', GOOGLE_FONTS('Albert Sans')],
  ['alfa slab one', GOOGLE_FONTS('Alfa Slab One')],
  ['anton', GOOGLE_FONTS('Anton')],
  ['archivo', GOOGLE_FONTS('Archivo')],
  ['archivo black', GOOGLE_FONTS('Archivo Black')],
  ['archivo narrow', GOOGLE_FONTS('Archivo Narrow')],
  ['barlow', GOOGLE_FONTS('Barlow')],
  ['barlow condensed', GOOGLE_FONTS('Barlow Condensed')],
  ['bebas neue', GOOGLE_FONTS('Bebas Neue')],
  ['big shoulders display', GOOGLE_FONTS('Big Shoulders Display')],
  ['bodoni moda', GOOGLE_FONTS('Bodoni Moda')],
  ['bowlby one', GOOGLE_FONTS('Bowlby One')],
  ['bricolage grotesque', GOOGLE_FONTS('Bricolage Grotesque')],
  ['cabin', GOOGLE_FONTS('Cabin')],
  ['caveat', GOOGLE_FONTS('Caveat')],
  ['caveat brush', GOOGLE_FONTS('Caveat Brush')],
  ['chakra petch', GOOGLE_FONTS('Chakra Petch')],
  ['condiment', GOOGLE_FONTS('Condiment')],
  ['cormorant', GOOGLE_FONTS('Cormorant')],
  ['cormorant garamond', GOOGLE_FONTS('Cormorant Garamond')],
  ['courier prime', GOOGLE_FONTS('Courier Prime')],
  ['dm mono', GOOGLE_FONTS('DM Mono')],
  ['dm sans', GOOGLE_FONTS('DM Sans')],
  ['dm serif display', GOOGLE_FONTS('DM Serif Display')],
  ['dm serif text', GOOGLE_FONTS('DM Serif Text')],
  ['eb garamond', GOOGLE_FONTS('EB Garamond')],
  ['familjen grotesk', GOOGLE_FONTS('Familjen Grotesk')],
  ['figtree', GOOGLE_FONTS('Figtree')],
  ['forum', GOOGLE_FONTS('Forum')],
  ['fraunces', GOOGLE_FONTS('Fraunces')],
  ['fredoka one', GOOGLE_FONTS('Fredoka One')],
  ['fustat', GOOGLE_FONTS('Fustat')],
  ['geist', GOOGLE_FONTS('Geist')],
  ['geist mono', GOOGLE_FONTS('Geist Mono')],
  ['gloock', GOOGLE_FONTS('Gloock')],
  ['halant', GOOGLE_FONTS('Halant')],
  ['hanken grotesk', GOOGLE_FONTS('Hanken Grotesk')],
  ['hedvig letters serif', GOOGLE_FONTS('Hedvig Letters Serif')],
  ['host grotesk', GOOGLE_FONTS('Host Grotesk')],
  ['ibm plex mono', GOOGLE_FONTS('IBM Plex Mono')],
  ['ibm plex sans', GOOGLE_FONTS('IBM Plex Sans')],
  ['imprima', GOOGLE_FONTS('Imprima')],
  ['instrument sans', GOOGLE_FONTS('Instrument Sans')],
  ['instrument serif', GOOGLE_FONTS('Instrument Serif')],
  ['inter', INTER_PROJECT('Inter')],
  ['inter tight', GOOGLE_FONTS('Inter Tight')],
  ['inter var', INTER_PROJECT('Inter')],
  ['interdisplay', INTER_PROJECT('Inter Display')],
  ['intervariable', INTER_PROJECT('Inter')],
  ['italiana', GOOGLE_FONTS('Italiana')],
  ['jetbrains mono', GOOGLE_FONTS('JetBrains Mono', 'Apache-2.0')],
  ['josefin sans', GOOGLE_FONTS('Josefin Sans')],
  ['jost', GOOGLE_FONTS('Jost')],
  ['kanit', GOOGLE_FONTS('Kanit')],
  ['libre baskerville', GOOGLE_FONTS('Libre Baskerville')],
  ['lora', GOOGLE_FONTS('Lora')],
  ['love ya like a sister', GOOGLE_FONTS('Love Ya Like A Sister')],
  ['manrope', GOOGLE_FONTS('Manrope')],
  ['marck script', GOOGLE_FONTS('Marck Script')],
  ['newsreader', GOOGLE_FONTS('Newsreader')],
  ['noto sans', GOOGLE_FONTS('Noto Sans')],
  ['noto sans jp', GOOGLE_FONTS('Noto Sans JP')],
  ['noto sans sc', GOOGLE_FONTS('Noto Sans SC')],
  ['noto serif', GOOGLE_FONTS('Noto Serif')],
  ['noto serif display', GOOGLE_FONTS('Noto Serif Display')],
  ['noto serif jp', GOOGLE_FONTS('Noto Serif JP')],
  ['noto serif sc', GOOGLE_FONTS('Noto Serif SC')],
  ['onest', GOOGLE_FONTS('Onest')],
  ['oswald', GOOGLE_FONTS('Oswald')],
  ['outfit', GOOGLE_FONTS('Outfit')],
  ['playfair display', GOOGLE_FONTS('Playfair Display')],
  ['plus jakarta sans', GOOGLE_FONTS('Plus Jakarta Sans')],
  ['poppins', GOOGLE_FONTS('Poppins')],
  ['press start 2p', GOOGLE_FONTS('Press Start 2P')],
  ['questrial', GOOGLE_FONTS('Questrial')],
  ['quicksand', GOOGLE_FONTS('Quicksand')],
  ['readex pro', GOOGLE_FONTS('Readex Pro')],
  ['sacramento', GOOGLE_FONTS('Sacramento')],
  ['schibsted grotesk', GOOGLE_FONTS('Schibsted Grotesk')],
  ['shrikhand', GOOGLE_FONTS('Shrikhand')],
  ['sora', GOOGLE_FONTS('Sora')],
  ['source sans 3', GOOGLE_FONTS('Source Sans 3')],
  ['source serif 4', GOOGLE_FONTS('Source Serif 4')],
  ['space grotesk', GOOGLE_FONTS('Space Grotesk')],
  ['space mono', GOOGLE_FONTS('Space Mono')],
  ['stardos stencil', GOOGLE_FONTS('Stardos Stencil')],
  ['stix two text', GOOGLE_FONTS('STIX Two Text')],
  ['syne', GOOGLE_FONTS('Syne')],
  ['tektur', GOOGLE_FONTS('Tektur')],
  ['titillium web', GOOGLE_FONTS('Titillium Web')],
  ['unbounded', GOOGLE_FONTS('Unbounded')],
  ['viaoda libre', GOOGLE_FONTS('Viaoda Libre')],
  ['vt323', GOOGLE_FONTS('VT323')],
  ['work sans', GOOGLE_FONTS('Work Sans')],
  ['zilla slab', GOOGLE_FONTS('Zilla Slab')],
];

export const OPEN_TYPEFACE_ALLOWLIST: ReadonlyMap<string, TypefaceLicenseEntry> = new Map(ENTRIES);

/** Explicit, human-readable reasons for names known to be excluded — surfaced by the 404 detail message. */
const EXCLUSION_REASONS: ReadonlyMap<string, string> = new Map([
  ['clash display', 'sourced from Fontshare; the free-tier licence does not clearly cover redistributing the font files themselves through a general install tool'],
  ['clash grotesk', 'sourced from Fontshare; the free-tier licence does not clearly cover redistributing the font files themselves through a general install tool'],
  ['general sans', 'sourced from Fontshare; the free-tier licence does not clearly cover redistributing the font files themselves through a general install tool'],
  ['satoshi', 'sourced from Fontshare; the free-tier licence does not clearly cover redistributing the font files themselves through a general install tool'],
  ['switzer', 'sourced from Fontshare; the free-tier licence does not clearly cover redistributing the font files themselves through a general install tool'],
  ['gambarino', 'sourced from Fontshare; the free-tier licence does not clearly cover redistributing the font files themselves through a general install tool'],
  ['pp mondwest', 'sourced from Fontshare; the free-tier licence does not clearly cover redistributing the font files themselves through a general install tool'],
  ['helvetica now display bold', 'the underlying bytes are actually Inter, aliased by the importer under a commercial name it has no rights to — install "Inter" instead'],
  ['helvetica regular', 'the underlying bytes are actually Inter, aliased by the importer under a commercial name it has no rights to — install "Inter" instead'],
  ['helveticanowdisplay-medium', 'the underlying bytes are actually Inter, aliased by the importer under a commercial name it has no rights to — install "Inter" instead'],
  ['helveticanowdisplayw01-rg', 'the underlying bytes are actually Inter, aliased by the importer under a commercial name it has no rights to — install "Inter" instead'],
  ['tt norms pro', 'the underlying bytes are actually Inter, aliased by the importer under a commercial name it has no rights to — install "Inter" instead'],
  ['iosevka charon', 'a themed variant this review could not independently trace to a licensed upstream build'],
  ['stack sans notch', 'not a recognized family in any of the catalogue\'s known providers'],
  ['bricolage', 'ambiguous alias — install "Bricolage Grotesque" instead'],
  ['intertight', 'ambiguous alias — install "Inter Tight" instead'],
  ['playfair', 'not a distinct Google Fonts family — install "Playfair Display" instead'],
  ['jetmono', 'ambiguous alias — install "JetBrains Mono" instead'],
  ['geist sans', 'not the published Google Fonts family name — install "Geist" instead'],
  ['material icons round', 'an icon/glyph font, out of scope for the typography catalogue'],
  ['material symbols outlined', 'an icon/glyph font, out of scope for the typography catalogue'],
  ['material symbols rounded', 'an icon/glyph font, out of scope for the typography catalogue'],
]);

const DEFAULT_EXCLUSION_REASON = 'not on the verified open-license allowlist';

export interface TypefaceLicenseDecision {
  allowed: boolean;
  entry?: TypefaceLicenseEntry;
  reason?: string;
}

/** The single gate every family goes through before it can appear in the catalogue. */
export function classifyTypefaceLicense(rawFamily: string): TypefaceLicenseDecision {
  const key = normalizeFamilyKey(rawFamily);
  const entry = OPEN_TYPEFACE_ALLOWLIST.get(key);
  if (entry) return { allowed: true, entry };
  return { allowed: false, reason: EXCLUSION_REASONS.get(key) ?? DEFAULT_EXCLUSION_REASON };
}
