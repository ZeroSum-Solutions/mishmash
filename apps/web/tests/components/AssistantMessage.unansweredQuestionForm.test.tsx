// @vitest-environment jsdom

/**
 * Red spec for issue #155 (B-05).
 *
 * The chat host locked an inline `<question-form>` as soon as a newer
 * assistant message existed, and labelled the locked card "answered" even
 * though nobody had submitted it. The lock must key on the form's own answer
 * message instead: a never-submitted form stays answerable however many turns
 * have passed, and it is never labelled as answered.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssistantMessage } from '../../src/components/AssistantMessage';
import type { ChatMessage } from '../../src/types';

beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => store.delete(key),
      setItem: (key: string, value: string) => store.set(key, value),
    },
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

const PENDING_FORM = [
  '<question-form id="iteration-2" title="Quick brief">',
  JSON.stringify({
    questions: [{ id: 'audience', label: 'Who is this for?', type: 'text' }],
  }),
  '</question-form>',
].join('\n');

function formMessage(): ChatMessage {
  return {
    id: 'msg-form',
    role: 'assistant',
    content: PENDING_FORM,
    runStatus: 'succeeded',
    startedAt: 1700000000,
    endedAt: 1700000005,
    events: [{ kind: 'text', text: PENDING_FORM } as ChatMessage['events'][number]],
    producedFiles: [],
  } as ChatMessage;
}

/**
 * `isLast={false}` is the reported situation: the user sent an unrelated
 * message, the agent replied, and the form is no longer the latest assistant
 * message — but it was never submitted, so `nextUserContent` carries no
 * `[form answers — …]` block.
 */
function renderOvertakenForm(onSubmitQuestionForm = vi.fn()) {
  const view = render(
    <AssistantMessage
      message={formMessage()}
      streaming={false}
      projectId="proj-1"
      conversationId="conv-1"
      isLast={false}
      nextUserContent="Actually, one more thought about the footer."
      onSubmitQuestionForm={onSubmitQuestionForm}
    />,
  );
  return { ...view, onSubmitQuestionForm };
}

function audienceInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('.qf-input');
  if (!(input instanceof HTMLInputElement)) throw new Error('expected the audience input');
  return input;
}

describe('AssistantMessage — a never-submitted question form (#155)', () => {
  it('keeps its controls live after a newer assistant message exists', () => {
    const { container } = renderOvertakenForm();
    expect(audienceInput(container).disabled).toBe(false);
  });

  it('is not rendered in the locked visual state', () => {
    const { container } = renderOvertakenForm();
    expect(container.querySelector('.question-form-locked')).toBeNull();
  });

  it('is never labelled as answered', () => {
    const { container } = renderOvertakenForm();
    const pill = container.querySelector('.question-form-pill');
    expect(pill?.textContent ?? null).toBeNull();
    expect(container.textContent ?? '').not.toMatch(/answered/i);
  });

  it('offers an "Answer now" affordance that reaches the open questions', () => {
    const { container } = renderOvertakenForm();
    const answerNow = screen.queryByRole('button', { name: 'Answer now' });
    expect(answerNow).not.toBeNull();
    fireEvent.click(answerNow!);
    expect(document.activeElement).toBe(audienceInput(container));
  });

  it('can still be submitted', () => {
    const { container, onSubmitQuestionForm } = renderOvertakenForm();
    fireEvent.change(audienceInput(container), { target: { value: 'Product evaluators' } });
    const submit = screen.queryByRole('button', { name: 'Send answers' });
    expect(submit).not.toBeNull();
    fireEvent.click(submit!);
    expect(onSubmitQuestionForm).toHaveBeenCalledWith(
      expect.stringContaining('- Who is this for?: Product evaluators'),
    );
  });

  it('still collapses to the answered summary once its answers come back', () => {
    const { container } = render(
      <AssistantMessage
        message={formMessage()}
        streaming={false}
        projectId="proj-1"
        conversationId="conv-1"
        isLast={false}
        nextUserContent={'[form answers — iteration-2]\n- Who is this for?: Product evaluators'}
        onSubmitQuestionForm={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-testid="question-form-summary"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Answer now' })).toBeNull();
  });
});
