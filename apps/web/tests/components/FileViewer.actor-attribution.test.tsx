// @vitest-environment jsdom

// W8D / F-03 — attribution where records are listed.
//
// Behavioural red on base d7ff39a36: both label helpers below already render a
// version's SOURCE and a message's AGENT; neither reads who the PERSON was,
// because the field does not exist. This pins the two rendered strings and the
// defined fallback for a pre-migration row whose `actor_name IS NULL` — the
// case that must never render `undefined` or crash.
//
// Extra gate file (not in the orchestrator's frozen own-test list): run
// targeted and recorded in the proof.

import { describe, expect, it } from 'vitest';

import { fileVersionActorLabel } from '../../src/components/FileViewer';
import { assistantActorCaption } from '../../src/components/AssistantMessage';
import { en } from '../../src/i18n/locales/en';

type Key = keyof typeof en;
const t = ((key: Key, vars?: Record<string, unknown>) => {
  const raw = String(en[key] ?? key);
  return raw.replace(/\{(\w+)\}/g, (_m, name: string) => String(vars?.[name] ?? ''));
}) as never;

describe('W8D: the version panel shows who wrote a version', () => {
  it('renders the actor name next to the source label', () => {
    expect(fileVersionActorLabel({ actorName: 'Devin' } as never, t)).toContain('Devin');
  });

  it('renders a defined fallback for a pre-migration version with no actor', () => {
    const label = fileVersionActorLabel({} as never, t);
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
    expect(label).not.toContain('undefined');
  });

  it('renders a defined fallback for an explicitly null actor', () => {
    const label = fileVersionActorLabel({ actorName: null } as never, t);
    expect(label).not.toContain('undefined');
    expect(label).not.toContain('null');
  });
});

describe('W8D: the chat transcript shows who asked for a turn', () => {
  it('captions a message that carries an actor', () => {
    expect(assistantActorCaption({ actorName: 'Devin' } as never, t)).toContain('Devin');
  });

  it('captions nothing for a message with no actor', () => {
    expect(assistantActorCaption({} as never, t)).toBeNull();
    expect(assistantActorCaption({ actorName: null } as never, t)).toBeNull();
  });
});
