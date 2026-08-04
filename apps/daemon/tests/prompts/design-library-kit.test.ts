import { describe, expect, it } from 'vitest';

import { composeSystemPrompt } from '../../src/prompts/system.js';

// Projects started from a Design Library kit ("Use as Template" /
// featured templates) carry the synthetic templateId `design-library:<id>`
// with kind 'prototype'. The composed system prompt must carry a standing
// instruction to apply the kit's visual language by default: the reported
// bug was that the agent only honored the kit style when the user
// explicitly asked, and judged the style from a thumbnail instead of the
// kit's real screens. Mirrored in
// packages/contracts/tests/system-prompt-design-library-kit.test.ts —
// the two system-prompt composers are maintained copies and the bullet
// must stay byte-identical in both.
const MARKER = '- **design kit template**:';
const REFERENCE_MARKER = '- **design library reference**:';

describe('design-library kit standing style instruction', () => {
  it('adds the standing instruction for design-library template projects', () => {
    const out = composeSystemPrompt({
      metadata: {
        kind: 'prototype',
        templateId: 'design-library:crypter-v2',
        templateLabel: 'Crypter v2',
      },
    });
    expect(out).toContain(MARKER);
    expect(out).toContain('the licensed design kit "Crypter v2"');
    expect(out).toContain("the kit's style is the standing default");
  });

  it('names the kit generically when no label is present', () => {
    const out = composeSystemPrompt({
      metadata: { kind: 'prototype', templateId: 'design-library:some-kit' },
    });
    expect(out).toContain(MARKER);
    expect(out).toContain('a licensed design kit');
  });

  it('keeps selected private-reference aspects standing without claiming source files were copied', () => {
    const out = composeSystemPrompt({
      metadata: {
        kind: 'prototype',
        templateId: 'design-library-reference:particle-field',
        templateLabel: 'Particle Field',
        designLibraryReferenceAspects: ['WebGL', 'Hero'],
      },
    });
    expect(out).toContain(REFERENCE_MARKER);
    expect(out).toContain('using WebGL, Hero');
    expect(out).toContain('reference files were not copied');
    expect(out).not.toContain(MARKER);
  });

  it('stays silent for plain prototypes and non-design-library templates', () => {
    expect(composeSystemPrompt({ metadata: { kind: 'prototype' } })).not.toContain(MARKER);
    expect(
      composeSystemPrompt({
        metadata: { kind: 'template', templateId: 't1', templateLabel: 'Neon' },
      }),
    ).not.toContain(MARKER);
  });
});
