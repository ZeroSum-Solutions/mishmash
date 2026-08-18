import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  closeDatabase,
  insertConversation,
  insertProject,
  latchConversationOpeningBrief,
  openDatabase,
} from '../src/db.js';
import {
  extractOpeningUserBriefText,
  extractUserAuthoredSignalText,
} from '../src/prompts/system.js';

// The brief a conversation opened with feeds the catalogue-match shortlist,
// which is rendered into `systemPrompt` — one third of
// `stableInstructionFingerprint` (server.ts). A brief recomputed from each
// turn's text therefore re-ranks the shortlist when turn 2 appends form
// answers, moving the hash and re-sending the whole stable instruction block
// on every resume turn. Both halves of the fix are pinned here: the extractor
// must read only the OPENING user section, and the latch must never rewrite a
// stored brief. The end-to-end cache behaviour lives in
// tests/intent-signal-stable-prompt-cache.test.ts.

const PACKED_TWO_TURNS = [
  '## user',
  'set up a new internal metrics workspace',
  '',
  '## assistant',
  'Got it — quick brief to lock the direction:',
  '',
  '## user',
  '[form answers — discovery]',
  '- What are we making?: Dashboard / tool UI',
  '- Who is this for?: internal exec review',
].join('\n');

describe('extractOpeningUserBriefText', () => {
  it('returns only the first user section of a packed transcript', () => {
    expect(extractOpeningUserBriefText(PACKED_TWO_TURNS)).toBe(
      'set up a new internal metrics workspace',
    );
  });

  it('does not grow as turns accumulate, unlike the signal-scan extractor', () => {
    const signalText = extractUserAuthoredSignalText(PACKED_TWO_TURNS);
    expect(signalText).toContain('Dashboard / tool UI');
    expect(extractOpeningUserBriefText(PACKED_TWO_TURNS)).not.toContain(
      'Dashboard / tool UI',
    );
  });

  it('keeps a multi-paragraph opening brief whole', () => {
    const message = [
      '## user',
      'first paragraph',
      '',
      'second paragraph',
      '',
      '## assistant',
      'ack',
    ].join('\n');
    expect(extractOpeningUserBriefText(message)).toBe(
      'first paragraph\n\nsecond paragraph',
    );
  });

  it('returns a plain unmarked message unchanged, and empty for no message', () => {
    expect(extractOpeningUserBriefText('just a brief')).toBe('just a brief');
    expect(extractOpeningUserBriefText('')).toBe('');
    expect(extractOpeningUserBriefText(null)).toBe('');
  });
});

describe('conversation opening-brief latch', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-opening-brief-'));
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function seed() {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    const now = Date.now();
    insertProject(db, { id: 'proj-1', name: 'P', createdAt: now, updatedAt: now });
    insertConversation(db, {
      id: 'conv-1',
      projectId: 'proj-1',
      title: 'C',
      createdAt: now,
      updatedAt: now,
    });
    return db;
  }

  it('stores the first non-blank candidate and returns it for every later turn', () => {
    const db = seed();
    expect(latchConversationOpeningBrief(db, 'conv-1', 'the opening brief')).toBe(
      'the opening brief',
    );
    expect(latchConversationOpeningBrief(db, 'conv-1', 'make the header bolder')).toBe(
      'the opening brief',
    );
  });

  it('never stores a blank candidate, so the first real turn still wins', () => {
    const db = seed();
    expect(latchConversationOpeningBrief(db, 'conv-1', '')).toBe('');
    expect(latchConversationOpeningBrief(db, 'conv-1', '   \n  ')).toBe('');
    expect(latchConversationOpeningBrief(db, 'conv-1', 'the real brief')).toBe(
      'the real brief',
    );
  });

  it('keeps each conversation independent', () => {
    const db = seed();
    const now = Date.now();
    insertConversation(db, {
      id: 'conv-2',
      projectId: 'proj-1',
      title: 'C2',
      createdAt: now,
      updatedAt: now,
    });
    latchConversationOpeningBrief(db, 'conv-1', 'brief one');
    expect(latchConversationOpeningBrief(db, 'conv-2', 'brief two')).toBe('brief two');
    expect(latchConversationOpeningBrief(db, 'conv-1', 'ignored')).toBe('brief one');
  });
});
