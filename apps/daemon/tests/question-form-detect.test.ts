import { describe, expect, it } from 'vitest';
import {
  emittedRenderableQuestionForm,
  questionFormBodyIsRenderable,
} from '../src/question-form-detect.js';

// R1 (F002) requires reconciling the daemon/web `<question-form>` parser
// mismatch before the interview engine builds on the contract: the daemon
// accepted only an object with a non-empty `questions[]`, while the web
// parser (apps/web/src/artifacts/question-form.ts) also accepts a bare
// top-level JSON array — proven there by "parses the deliveryFormat/
// container array payload" (apps/web/tests/artifacts/
// question-form.test.ts:222). This suite is the daemon-side mirror of that
// same fixture shape.
describe('questionFormBodyIsRenderable — array-payload parity with the web parser', () => {
  it('accepts a bare top-level JSON array of questions (previously rejected)', () => {
    const body = JSON.stringify([
      { id: 'deliveryFormat', prompt: 'Export format?', type: 'radio', options: [{ id: 'mov', label: 'MOV' }] },
      { id: 'container', prompt: 'Shell?', type: 'radio', options: [{ id: 'a', label: 'A' }] },
    ]);
    expect(questionFormBodyIsRenderable(body)).toBe(true);
  });

  it('still accepts the canonical { questions: [...] } object shape', () => {
    const body = JSON.stringify({ questions: [{ id: 'q1', label: 'Platform', type: 'text' }] });
    expect(questionFormBodyIsRenderable(body)).toBe(true);
  });

  it('rejects an empty array', () => {
    expect(questionFormBodyIsRenderable('[]')).toBe(false);
  });

  it('rejects a non-question array (e.g. an array of strings)', () => {
    expect(questionFormBodyIsRenderable('["a", "b"]')).toBe(false);
  });

  it('rejects invalid JSON', () => {
    expect(questionFormBodyIsRenderable('not json')).toBe(false);
  });

  it('rejects an object with no questions field', () => {
    expect(questionFormBodyIsRenderable('{"id":"x"}')).toBe(false);
  });
});

describe('emittedRenderableQuestionForm — array payload inside a full tag', () => {
  it('detects a renderable form whose body is a bare array', () => {
    const text = [
      'Quick check before I continue:',
      '<question-form>',
      JSON.stringify([{ id: 'q1', prompt: 'Which one?', type: 'radio', options: [{ id: 'x', label: 'X' }] }]),
      '</question-form>',
    ].join('\n');
    expect(emittedRenderableQuestionForm(text)).toBe(true);
  });
});
