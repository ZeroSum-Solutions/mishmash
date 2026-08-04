// Unit specs for the pure prompt-steering helper behind the storyboard
// style-reference capability (see style-reference.test.ts for the HTTP-level
// invariant). The helper's contract: the raw user prompt always leads
// unchanged; a set style reference appends one deterministic style clause
// built from the extracted brand; empty brand fields never leave dangling
// separators or empty segments.

import { describe, expect, it } from 'vitest';
import { brandFromDesignMd } from '../../src/brands/design-md-input.js';
import {
  composeStyledMediaPrompt,
  styleReferenceFromDesignMd,
} from '../../src/storyboards/style-reference.js';

const DESIGN_MD = `---
name: Heritage
colors:
  background: "#f6f1e7"
  foreground: "#1c1a17"
  accent: "#8a5a2b"
typography:
  display: "Fraunces"
  body: "Source Serif Pro"
---

# Heritage

## Overview
A warm editorial identity for a heritage furniture maker. Calm, tactile, confident.
`;

describe('styleReferenceFromDesignMd', () => {
  it('extracts a design-md style reference through the brand engine', () => {
    const ref = styleReferenceFromDesignMd(DESIGN_MD);
    expect(ref).toBeTruthy();
    expect(ref!.source).toBe('design-md');
    expect(ref!.brand.name).toBe('Heritage');
    expect(ref!.brand.colors.map((c) => c.hex)).toContain('#8a5a2b');
    expect(ref!.brand.typography.display.family).toBe('Fraunces');
    expect(typeof ref!.updatedAt).toBe('string');
  });

  it('returns null for empty or whitespace-only markdown', () => {
    expect(styleReferenceFromDesignMd('')).toBeNull();
    expect(styleReferenceFromDesignMd('   \n\t ')).toBeNull();
  });
});

describe('composeStyledMediaPrompt', () => {
  it('returns the raw prompt unchanged when no style reference is set', () => {
    expect(composeStyledMediaPrompt('A lighthouse at dusk', undefined)).toBe(
      'A lighthouse at dusk',
    );
  });

  it('appends a style clause after the raw prompt, which always leads', () => {
    const ref = styleReferenceFromDesignMd(DESIGN_MD)!;
    const composed = composeStyledMediaPrompt('A lighthouse at dusk', ref);
    expect(composed.startsWith('A lighthouse at dusk')).toBe(true);
    expect(composed).toContain('Heritage');
    expect(composed).toContain('#8a5a2b');
    expect(composed).toContain('Fraunces');
    // The design-md extraction yields no imagery style/treatment — the clause
    // must not carry an empty imagery segment for it.
    expect(composed).not.toMatch(/imagery:\s*[;.]/);
  });

  it('composes deterministically for the same inputs', () => {
    const ref = styleReferenceFromDesignMd(DESIGN_MD)!;
    expect(composeStyledMediaPrompt('prompt', ref)).toBe(composeStyledMediaPrompt('prompt', ref));
  });

  it('skips empty brand fields instead of emitting empty segments', () => {
    const brand = brandFromDesignMd({
      markdown: '# Bare\n\nJust a name and nothing else.',
      sourceUrl: 'designmd://bare',
    })!;
    const composed = composeStyledMediaPrompt('raw prompt', {
      source: 'design-md',
      brand,
      updatedAt: new Date(0).toISOString(),
    });
    expect(composed.startsWith('raw prompt')).toBe(true);
    // Whatever segments survive, none may be empty-valued.
    expect(composed).not.toMatch(/:\s*;/);
    expect(composed).not.toMatch(/:\s*\.$/);
  });
});
