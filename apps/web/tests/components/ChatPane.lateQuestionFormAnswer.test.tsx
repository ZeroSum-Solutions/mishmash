// @vitest-environment jsdom

/**
 * Red spec for W1F.5 — a late answer must find its form by form id.
 *
 * The system prompt tells the model to re-emit a still-pending
 * `<question-form>` verbatim in its next reply, so ONE form id can sit in
 * several assistant messages at once. The chat then associated an assistant
 * message only with the user message immediately after it, so an answer sent
 * after newer turns was never recognised as that form's answer: the older
 * copies kept rendering live, forever, and each one still offered its own
 * submit button — the same question could be answered again.
 *
 * The invariant this spec pins: a form is answered when an answer for THAT
 * form id exists anywhere later in the conversation. Every copy of the id
 * collapses to the answered summary and no copy stays submittable.
 *
 * The sequence below is the real one: an original form, an intervening turn,
 * a re-emitted copy, and a late answer.
 */

import { cleanup, render } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatPane } from '../../src/components/ChatPane';
import type { ChatMessage } from '../../src/types';

vi.mock('../../src/components/ChatComposer', () => ({
  ChatComposer: forwardRef((_props, _ref) => <div data-testid="composer" />),
}));

vi.mock('../../src/analytics/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/analytics/events')>();
  return {
    ...actual,
    trackChatPanelClick: vi.fn(),
    trackRunFailedToastSurfaceView: vi.fn(),
  };
});

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

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

const FORM_ID = 'brief';

const PENDING_FORM = [
  `<question-form id="${FORM_ID}" title="Quick brief">`,
  JSON.stringify({
    questions: [{ id: 'audience', label: 'Who is this for?', type: 'text' }],
  }),
  '</question-form>',
].join('\n');

/** What the chat posts when the user submits the form (`formatFormAnswers`). */
const LATE_ANSWER = ['[form answers — brief]', '- Who is this for?: Product evaluators'].join('\n');

function userMessage(id: string, content: string): ChatMessage {
  return { id, role: 'user', content, createdAt: 1 } as ChatMessage;
}

function assistantMessage(id: string, content: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content,
    runStatus: 'succeeded',
    createdAt: 1,
    startedAt: 1700000000,
    endedAt: 1700000005,
    events: [{ kind: 'text', text: content } as NonNullable<ChatMessage['events']>[number]],
    producedFiles: [],
  } as ChatMessage;
}

/**
 * Original form → intervening turn → re-emitted copy → the late answer.
 * Both assistant messages carry the same form id, exactly as the re-emit
 * prompt rule produces.
 */
function conversationWithLateAnswer(): ChatMessage[] {
  return [
    userMessage('u-1', 'Build me a landing page.'),
    assistantMessage('a-1', `Before I start:\n\n${PENDING_FORM}`),
    userMessage('u-2', 'Actually, make the hero taller.'),
    assistantMessage('a-2', `Raised the hero. Still waiting on:\n\n${PENDING_FORM}`),
    userMessage('u-3', LATE_ANSWER),
    assistantMessage('a-3', 'Got it — building for product evaluators.'),
  ];
}

/** The same conversation with the answer never sent. */
function conversationWithoutAnswer(): ChatMessage[] {
  return [
    userMessage('u-1', 'Build me a landing page.'),
    assistantMessage('a-1', `Before I start:\n\n${PENDING_FORM}`),
    userMessage('u-2', 'Actually, make the hero taller.'),
    assistantMessage('a-2', `Raised the hero. Still waiting on:\n\n${PENDING_FORM}`),
  ];
}

function renderChat(messages: ChatMessage[]) {
  return render(
    <ChatPane
      messages={messages}
      streaming={false}
      error={null}
      projectId="project-1"
      projectFiles={[]}
      onEnsureProject={async () => 'project-1'}
      onSend={vi.fn()}
      onStop={vi.fn()}
      conversations={[]}
      activeConversationId="conv-1"
      onSelectConversation={vi.fn()}
      onDeleteConversation={vi.fn()}
      onSubmitQuestionForm={vi.fn()}
    />,
  );
}

function liveForms(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`.question-form[data-form-id="${FORM_ID}"]`));
}

function answeredSummaries(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      `[data-testid="question-form-summary"][data-form-id="${FORM_ID}"]`,
    ),
  );
}

describe('ChatPane — a late answer to a re-emitted question form', () => {
  it('collapses every copy of that form id to the answered summary', () => {
    const { container } = renderChat(conversationWithLateAnswer());
    // Two assistant messages carry the form; both must show the answer.
    expect(answeredSummaries(container)).toHaveLength(2);
  });

  it('leaves no answerable copy of that form id on screen', () => {
    const { container } = renderChat(conversationWithLateAnswer());
    expect(liveForms(container)).toHaveLength(0);
  });

  it('offers no second submit for a form that was already answered', () => {
    const { container } = renderChat(conversationWithLateAnswer());
    const submitButtons = container.querySelectorAll(
      `.question-form[data-form-id="${FORM_ID}"] .qf-submit-actions button`,
    );
    expect(submitButtons).toHaveLength(0);
  });

  // Guards the W1.5 invariant this fix must not undo: with no answer anywhere
  // later in the conversation, every copy stays answerable.
  it('keeps every copy answerable while no answer for that form id exists', () => {
    const { container } = renderChat(conversationWithoutAnswer());
    expect(answeredSummaries(container)).toHaveLength(0);
    expect(liveForms(container)).toHaveLength(2);
  });
});
