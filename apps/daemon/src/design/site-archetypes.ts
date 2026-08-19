/**
 * @module design/site-archetypes
 *
 * Domain knowledge layer for the conversational template advisor (F001 R3).
 * An `Archetype` captures what a category of small-business site needs --
 * required sections, reading-comfort/typesetting constraints, named visual
 * directions with their own palettes and disqualifying conditions -- content
 * a keyword matcher alone cannot reason about. F001 R4/R5 (out of scope
 * here) will match a brief onto one of these and score
 * design-templates/index.json's catalogue against it; this module only
 * defines the schema and ships the one archetype F001 R3 asks for: `poetry`.
 *
 * P0 scope is deliberately `poetry` only -- see F001 R3/R16. Each additional
 * archetype needs the same order of real design content Addendum A.3 gives
 * poetry (real palettes, real typesetting constraints, real disqualifiers),
 * which is a design-judgment task for a human, not something to fabricate
 * here to hit a headcount.
 */

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** A single named visual direction within an archetype (F001 Addendum A.1/A.3). */
export interface ArchetypeDirection {
  id: string;
  name: string;
  character: string;
  goodIf: string;
  /** Honest downside -- "harder to keep looking professional", not marketing copy. Omitted when the source names none. */
  caution?: string;
  /** Page sections this direction is described as including, taken verbatim from its Character text -- Archetype.requiredSections is derived from these. */
  sections: string[];
  palette: ArchetypePalette;
}

/**
 * Role-labeled palette (F001 Addendum A.2 vocabulary: background, text,
 * muted, rule, accent). `muted`/`rule` are optional -- Addendum A.3's `riso`
 * palette does not define them. `accent` is a two-element tuple when the
 * source gives alternatives with "ONE only, used loud" guidance instead of a
 * single hex.
 */
export interface ArchetypePalette {
  id: string;
  background: string;
  text: string;
  muted?: string;
  rule?: string;
  accent: string | [string, string];
  /** Free-text discipline note carried alongside the palette, e.g. "one accent, used for links and a single button." */
  discipline?: string;
}

/** One row of the archetype's typography pairing table (F001 Addendum A.3). `families` holds every alternative the source names for that role -- e.g. body lists both EB Garamond and Crimson Pro. */
export interface ArchetypeTypographyChoice {
  role: 'body' | 'body_alt' | 'headings' | 'ui';
  families: string[];
  rationale: string;
}

/** Typesetting rules F001 R5 (out of scope here) scores candidates against -- "not prose advice ... scored ranking inputs" per Addendum A.3. */
export interface ArchetypeTypesettingConstraints {
  bodySizePx: [number, number];
  lineHeight: [number, number];
  measureCh: number;
  measureCss: string;
  poemAlignment: 'left';
  disallowedAlignment: ('center' | 'justify')[];
  preserveLineBreaks: boolean;
  hangingIndentOnWrap: boolean;
}

/** A scoreable condition F001 R5 (out of scope here) uses to score a candidate DOWN even when other fields look good -- Addendum A.3: "a template whose body measure runs 80ch or that centers long text blocks must score down ... even if its palette is perfect." */
export interface ArchetypeDisqualifier {
  id: string;
  description: string;
}

export interface Archetype {
  id: string;
  name: string;
  directions: ArchetypeDirection[];
  /** Union of every direction's `sections`, deduplicated -- F001 R7b: "the section axis comes from the archetype's required-section list (R3)." Computed, not hand-authored -- see POETRY_ARCHETYPE's construction below. */
  requiredSections: string[];
  typography: ArchetypeTypographyChoice[];
  typesetting: ArchetypeTypesettingConstraints;
  /** Upper bound on design-templates/index.json's `motion_level` (F001 R1) a candidate may carry before scoring down. */
  motionCeiling: 'low' | 'medium' | 'high';
  disqualifiers: ArchetypeDisqualifier[];
}

// ---------------------------------------------------------------------------
// poetry archetype (F001 R3 / Addendum A.3) -- P0's only archetype
// ---------------------------------------------------------------------------

const POETRY_DIRECTIONS: ArchetypeDirection[] = [
  {
    id: 'literary-journal',
    name: 'Literary journal',
    character: 'Wide serif column, generous line height, almost no imagery. Poems live in the layout itself.',
    goodIf: 'The writing is the product.',
    caution: 'Safest, most credible look.',
    sections: ['hero', 'poem-layout'],
    palette: {
      id: 'paper-and-ink',
      background: '#FAF7F2',
      text: '#1A1A18',
      muted: '#6B6862',
      rule: '#E0DAD0',
      accent: '#8A3324', // burnt sienna -- links only
      discipline: 'One accent, used for links and a single button.',
    },
  },
  {
    id: 'small-press-bookshop',
    name: 'Small press / bookshop',
    character: 'A hero with one book cover, a shop grid, an about page, a mailing list.',
    goodIf: 'You sell physical or digital books.',
    sections: ['hero', 'shop-grid', 'about', 'mailing-list'],
    palette: {
      id: 'paper-and-ink',
      background: '#FAF7F2',
      text: '#1A1A18',
      muted: '#6B6862',
      rule: '#E0DAD0',
      accent: '#8A3324',
    },
  },
  {
    id: 'poet-portfolio',
    name: 'Poet portfolio',
    character: 'Big name, short bio, a few featured poems, readings calendar, contact.',
    goodIf: 'Bookings and workshops.',
    sections: ['hero', 'bio', 'featured-poems', 'readings-calendar', 'contact'],
    palette: {
      id: 'dusk',
      background: '#14161A',
      text: '#EDE8E0',
      muted: '#8C8F95',
      rule: '#282C33',
      accent: '#C8A55B', // aged brass
      discipline: 'One accent, used for links and a single button.',
    },
  },
  {
    id: 'zine-risograph',
    name: 'Zine / risograph',
    character: 'Off-white paper, one loud ink color, tight type.',
    goodIf: 'The poetry is playful or political.',
    caution: 'Fun and memorable, but harder to keep looking professional.',
    sections: [],
    palette: {
      id: 'riso',
      background: '#F2EFE6',
      text: '#111111',
      accent: ['#FF4A1C', '#2B44FF'], // ONE only, used loud
      discipline: 'Exactly one accent from this pair, used loud.',
    },
  },
];

export const POETRY_ARCHETYPE: Archetype = {
  id: 'poetry',
  name: 'Poetry',
  directions: POETRY_DIRECTIONS,
  requiredSections: Array.from(new Set(POETRY_DIRECTIONS.flatMap((direction) => direction.sections))),
  typography: [
    { role: 'body', families: ['EB Garamond', 'Crimson Pro'], rationale: 'Old-style, warm, holds long stanzas.' },
    { role: 'body_alt', families: ['Newsreader', 'Source Serif 4'], rationale: 'More modern, screen-tuned.' },
    { role: 'headings', families: ['Fraunces', 'Playfair Display'], rationale: 'Character without shouting.' },
    { role: 'ui', families: ['Inter', 'system-ui'], rationale: 'Stays out of the way.' },
  ],
  typesetting: {
    bodySizePx: [19, 21],
    lineHeight: [1.65, 1.75],
    measureCh: 62,
    measureCss: 'max-width: 34rem',
    poemAlignment: 'left',
    disallowedAlignment: ['center', 'justify'],
    preserveLineBreaks: true,
    hangingIndentOnWrap: true,
  },
  // DERIVED, not sourced. Addendum A.3 specifies this archetype's palettes,
  // typography and typesetting literally, but names no motion ceiling. 'medium'
  // is a judgement call from the directions' own character ("hushed",
  // "letterpress", "quiet"), and so is the `motion-above-ceiling` disqualifier
  // built on it below. Both are the kind of thing an owner may want to set
  // rather than inherit -- they are marked here so nobody reads them as
  // sourced content.
  motionCeiling: 'medium',
  disqualifiers: [
    {
      id: 'measure-too-wide',
      description:
        'Body measure reaches ~80ch or more (archetype target is ~62ch / max-width: 34rem per Addendum A.3) -- the disqualifying width F001 R5 names explicitly.',
    },
    {
      id: 'centered-long-text',
      description:
        'Centers a whole poem or other long text block -- poem alignment must be left, never centered or justified.',
    },
    {
      // Derived along with motionCeiling above -- see that comment.
      id: 'motion-above-ceiling',
      description:
        "design-templates/index.json motion_level exceeds this archetype's motionCeiling (medium) -- undermines the hushed, literary character poetry needs.",
    },
  ],
};

export const ARCHETYPES: Record<string, Archetype> = {
  poetry: POETRY_ARCHETYPE,
};
