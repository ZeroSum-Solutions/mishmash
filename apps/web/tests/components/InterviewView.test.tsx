// @vitest-environment jsdom

// F002 — client discovery interview web surface: tier picker → turn loop
// (rendered through the real QuestionFormView) → completion screen with the
// REQUIRED-gate confirmation. Route-level daemon behavior (the REQUIRED
// gate itself, tier derivation, the R6 mapping function) is covered by
// packages/contracts/tests/interviews.test.ts and
// apps/daemon/tests/interview-*.test.ts; this suite only exercises the
// component's own state machine and rendering against a mocked API.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock('../../src/router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/router')>();
  return { ...actual, navigate: navigateMock };
});

import { InterviewView } from '../../src/components/interview/InterviewView';

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  navigateMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('InterviewView — tier picker', () => {
  it('renders all three tiers with their duration bands', () => {
    render(<InterviewView />);
    expect(screen.getByTestId('interview-tier-quick')).toBeTruthy();
    expect(screen.getByTestId('interview-tier-standard')).toBeTruthy();
    expect(screen.getByTestId('interview-tier-full')).toBeTruthy();
    expect(screen.getByText('5-10 minutes')).toBeTruthy();
    expect(screen.getByText('15-20 minutes')).toBeTruthy();
    expect(screen.getByText('25-30 minutes')).toBeTruthy();
  });

  it('starting a tier POSTs /api/interviews and renders the first turn, never a "Section N of M" announcement', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/interviews' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ tier: 'quick' });
        return jsonResponse({
          session: { id: 's1', tier: 'quick', archetype: 'local-trade', status: 'in-progress', stepIndex: 0, totalSteps: 1 },
          turn: {
            message: "Hi! Let's get your site sorted — first, tell me a little about the business.",
            questions: [{ id: 'hqLocation', header: 'serviceArea', label: 'City and state?', type: 'text', required: true }],
          },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    render(<InterviewView />);
    fireEvent.click(screen.getByTestId('interview-tier-quick'));

    await waitFor(() => screen.getByTestId('interview-turn'));
    expect(screen.getByText('City and state?')).toBeTruthy();
    expect(screen.queryByText(/section\s+\d+\s+of\s+\d+/i)).toBeNull();
  });
});

describe('InterviewView — turn submission and push-back', () => {
  async function startSingleQuestionInterview() {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/interviews') {
        return jsonResponse({
          session: { id: 's1', tier: 'quick', archetype: 'local-trade', status: 'in-progress', stepIndex: 0, totalSteps: 1 },
          turn: {
            message: 'Hi!',
            questions: [{ id: 'phone', header: 'contactAndCallToAction', label: 'Exact phone number?', type: 'text', required: true }],
          },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    render(<InterviewView />);
    fireEvent.click(screen.getByTestId('interview-tier-quick'));
    await waitFor(() => screen.getByTestId('interview-turn'));
  }

  it('shows a push-back message and does not advance when the daemon rejects a vague REQUIRED answer', async () => {
    await startSingleQuestionInterview();

    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/interviews/s1/turns') {
        return jsonResponse({
          session: { id: 's1', tier: 'quick', archetype: 'local-trade', status: 'in-progress', stepIndex: 0, totalSteps: 1 },
          turn: {
            message: 'Hi!',
            questions: [{ id: 'phone', header: 'contactAndCallToAction', label: 'Exact phone number?', type: 'text', required: true }],
          },
          pushBack: { fieldId: 'phone', message: 'I need something more specific for "Exact phone number?".' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my main line' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));

    await waitFor(() => screen.getByTestId('interview-pushback'));
    expect(screen.getByTestId('interview-pushback').textContent).toContain('I need something more specific');
    // Still on the same turn, not a completion screen.
    expect(screen.queryByTestId('interview-terminal')).toBeNull();
  });

  it('reaches the terminal screen on a "complete" brief and enables Start project without extra confirmation', async () => {
    await startSingleQuestionInterview();

    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/interviews/s1/turns') {
        return jsonResponse({
          session: { id: 's1', tier: 'quick', archetype: 'local-trade', status: 'complete', stepIndex: 1, totalSteps: 1 },
          result: {
            clientBrief: {
              businessOverview: {}, serviceArea: {}, certificationsAndCredentials: {}, services: {},
              targetCustomer: {}, visualDirection: {}, existingAssets: {},
              contactAndCallToAction: { phone: { value: '(813) 555-0100', confidence: 'high' } },
              faqContent: {}, siteStructureAndLogistics: {}, additionalNotes: {},
              openItems: [],
              status: 'complete',
            },
            guidedBrief: { product: 'Structured cabling' },
          },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '(813) 555-0100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));

    await waitFor(() => screen.getByTestId('interview-terminal'));
    expect(screen.getByTestId('interview-status').textContent).toContain('All required information collected');
    const startBtn = screen.getByTestId('interview-start-project') as HTMLButtonElement;
    expect(startBtn.disabled).toBe(false);
    expect(screen.queryByTestId('interview-force-incomplete')).toBeNull();
  });

  it('gates Start project on the force-incomplete confirmation for a "needs-info" brief', async () => {
    await startSingleQuestionInterview();

    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/interviews/s1/turns') {
        return jsonResponse({
          session: { id: 's1', tier: 'quick', archetype: 'local-trade', status: 'needs-info', stepIndex: 1, totalSteps: 1 },
          result: {
            clientBrief: {
              businessOverview: {}, serviceArea: {}, certificationsAndCredentials: {}, services: {},
              targetCustomer: {}, visualDirection: {}, existingAssets: {},
              contactAndCallToAction: { phone: { value: "I don't know", confidence: 'low' } },
              faqContent: {}, siteStructureAndLogistics: {}, additionalNotes: {},
              openItems: [{ fieldId: 'phone', label: 'Exact phone number?', reason: 'unknown' }],
              status: 'needs-info',
            },
            guidedBrief: {},
          },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    // A client can't submit a blank REQUIRED field through the form's own
    // client-side presence check (QuestionForm.tsx) — an explicit
    // "I don't know" is how a real client reaches `needs-info` for a
    // REQUIRED field without being pushed back (R1's executable definition).
    fireEvent.change(screen.getByRole('textbox'), { target: { value: "I don't know" } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));

    await waitFor(() => screen.getByTestId('interview-terminal'));
    const startBtn = screen.getByTestId('interview-start-project') as HTMLButtonElement;
    expect(startBtn.disabled).toBe(true);

    fireEvent.click(screen.getByTestId('interview-force-incomplete'));
    expect(startBtn.disabled).toBe(false);
  });
});

describe('InterviewView — starting a project from a completed brief', () => {
  it('POSTs the mapped guidedBrief with skipDiscoveryBrief and navigates to the new project', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/interviews') {
        return jsonResponse({
          session: { id: 's1', tier: 'quick', archetype: 'local-trade', status: 'in-progress', stepIndex: 0, totalSteps: 1 },
          turn: { message: 'Hi!', questions: [{ id: 'phone', header: 'contactAndCallToAction', label: 'Phone?', type: 'text', required: true }] },
        });
      }
      if (url === '/api/interviews/s1/turns') {
        return jsonResponse({
          session: { id: 's1', tier: 'quick', archetype: 'local-trade', status: 'complete', stepIndex: 1, totalSteps: 1 },
          result: {
            clientBrief: {
              businessOverview: {}, serviceArea: {}, certificationsAndCredentials: {}, services: {},
              targetCustomer: {}, visualDirection: {}, existingAssets: {},
              contactAndCallToAction: { phone: { value: '(813) 555-0100', confidence: 'high' } },
              faqContent: {}, siteStructureAndLogistics: {}, additionalNotes: {},
              openItems: [], status: 'complete',
            },
            guidedBrief: { product: 'Structured cabling' },
          },
        });
      }
      if (url === '/api/projects' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        expect(body.brief).toEqual({ product: 'Structured cabling' });
        expect(body.skipDiscoveryBrief).toBe(true);
        return jsonResponse({ project: { id: 'proj-1', name: body.name }, conversationId: 'conv-1' });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    render(<InterviewView />);
    fireEvent.click(screen.getByTestId('interview-tier-quick'));
    await waitFor(() => screen.getByTestId('interview-turn'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '(813) 555-0100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
    await waitFor(() => screen.getByTestId('interview-terminal'));

    fireEvent.click(screen.getByTestId('interview-start-project'));

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith(
        { kind: 'project', projectId: 'proj-1', conversationId: 'conv-1', fileName: null },
      ),
    );
  });
});

describe('InterviewView — a second 2-question turn does not inherit the first turn\'s pagination state', () => {
  // Regression test: every turn's synthetic QuestionForm shares the same
  // `form.id` ('interview-turn', not a real <question-form> artifact id).
  // QuestionFormView only resets its internal step index on [form.id]
  // changing, so without a fresh `key` per turn, a session's second 2-
  // question turn would render starting from the FIRST turn's leftover
  // `activeQuestionIndex` (1) — silently skipping straight to its second
  // question instead of showing its first.
  it('shows the second turn\'s FIRST question, not its second', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/interviews') {
        return jsonResponse({
          session: { id: 's1', tier: 'quick', archetype: 'local-trade', status: 'in-progress', stepIndex: 0, totalSteps: 2 },
          turn: {
            message: 'Hi!',
            questions: [
              { id: 'hqLocation', header: 'serviceArea', label: 'City and state?', type: 'text', required: true },
              { id: 'serviceArea', header: 'serviceArea', label: 'Every city you service?', type: 'textarea', required: true },
            ],
          },
        });
      }
      if (url === '/api/interviews/s1/turns') {
        const body = JSON.parse(String(init?.body));
        if (body.answers.serviceArea) {
          return jsonResponse({
            session: { id: 's1', tier: 'quick', archetype: 'local-trade', status: 'in-progress', stepIndex: 1, totalSteps: 2 },
            turn: {
              message: 'Got it.',
              questions: [
                { id: 'certifications', header: 'certificationsAndCredentials', label: 'Any certifications?', type: 'textarea', required: true },
                { id: 'services', header: 'services', label: 'Full list of services?', type: 'textarea', required: false },
              ],
            },
          });
        }
        throw new Error(`unexpected turn body ${String(init?.body)}`);
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    render(<InterviewView />);
    fireEvent.click(screen.getByTestId('interview-tier-quick'));
    await waitFor(() => screen.getByText('City and state?'));

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Tampa, FL' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    await waitFor(() => screen.getByText('Every city you service?'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Tampa, Clearwater' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));

    // The second turn must open on ITS first question, not skip to its second.
    await waitFor(() => screen.getByText('Any certifications?'));
    expect(screen.queryByText('Full list of services?')).toBeNull();
  });
});
