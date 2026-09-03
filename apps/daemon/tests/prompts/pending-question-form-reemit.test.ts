import { describe, expect, it } from 'vitest';

import { composeSystemPrompt as composeContractsSystemPrompt } from '@open-design/contracts';

import { composeSystemPrompt } from '../../src/prompts/system.js';

/**
 * Red spec for issue #155 (B-05), prompt half.
 *
 * The host renders a `<question-form>` inline in the assistant message that
 * emitted it. When the user replies without submitting, the open question
 * scrolls behind newer turns. The prompt must tell the model to re-emit the
 * pending form in its next reply so the latest assistant message always
 * carries the open question.
 *
 * The daemon composer (`apps/daemon/src/prompts/system.ts`) and the API/BYOK
 * mirror (`packages/contracts/src/prompts/system.ts`) each own a copy of the
 * "Clarifying questions mid-conversation" section. They must stay identical,
 * or a daemon chat and a BYOK chat drift apart.
 */

const RE_EMIT_RULE = /re-emit (?:that|the) pending .*form/i;

/** The mid-conversation clarification section, as composed into a prompt. */
function clarifyingQuestionsSection(prompt: string): string {
  const heading = '## Clarifying questions mid-conversation';
  const start = prompt.indexOf(heading);
  if (start === -1) throw new Error(`prompt has no "${heading}" section`);
  const rest = prompt.slice(start + heading.length);
  // Stop at the next section heading, with or without its `---` rule: the two
  // composers place different sections after this one.
  const next = rest.search(/\n\n(?:---\n\n)?## /);
  return heading + (next === -1 ? rest : rest.slice(0, next));
}

// The composed prompts are ~130 KB. Assert on the boolean so a failure
// reports the missing rule instead of dumping a whole system prompt.
function instructsReEmission(prompt: string): boolean {
  return RE_EMIT_RULE.test(prompt);
}

describe('pending question-form re-emission (#155)', () => {
  it('is instructed by the daemon composer (classic core)', () => {
    expect(instructsReEmission(composeSystemPrompt({}))).toBe(true);
  });

  it('is instructed by the daemon composer (slim core, the daemon default)', () => {
    expect(instructsReEmission(composeSystemPrompt({ promptCoreVariant: 'slim' }))).toBe(true);
  });

  it('is instructed by the contracts API/BYOK composer', () => {
    expect(instructsReEmission(composeContractsSystemPrompt({}))).toBe(true);
  });

  it('keeps the daemon and contracts clarification sections identical', () => {
    expect(clarifyingQuestionsSection(composeSystemPrompt({}))).toBe(
      clarifyingQuestionsSection(composeContractsSystemPrompt({})),
    );
  });
});
