// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { analyticsTrack } = vi.hoisted(() => ({ analyticsTrack: vi.fn() }));

vi.mock('../../src/analytics/provider', () => ({
  useAnalytics: () => ({ track: analyticsTrack }),
}));

import { PreviewRunStatusBar } from '../../src/components/PreviewRunStatusBar';
import { I18nProvider } from '../../src/i18n';
import type { ChatMessage } from '../../src/types';

const STARTED_AT = 1_700_000_000_000;

function deliveredMessage(): ChatMessage {
  return {
    id: 'delivered-message',
    role: 'assistant',
    content: '',
    sessionMode: 'design',
    runStatus: 'succeeded',
    resultDeliveryState: 'delivered',
    createdAt: STARTED_AT,
    startedAt: STARTED_AT,
    endedAt: STARTED_AT,
  };
}

function failedMessage(): ChatMessage {
  return {
    id: 'failed-message',
    role: 'assistant',
    content: '',
    sessionMode: 'design',
    runStatus: 'succeeded',
    resultDeliveryState: 'delivery_failed',
    createdAt: STARTED_AT,
    startedAt: STARTED_AT,
    endedAt: STARTED_AT + 32_000,
  };
}

function renderStatus(messages: ChatMessage[], previewUpdating = false) {
  return render(
    <I18nProvider initial="en">
      <PreviewRunStatusBar
        projectId="project-1"
        conversationId="conversation-1"
        messages={messages}
        previewUpdating={previewUpdating}
      />
    </I18nProvider>,
  );
}

describe('PreviewRunStatusBar', () => {
  afterEach(() => {
    cleanup();
    analyticsTrack.mockReset();
    vi.useRealTimers();
  });

  it('does not flash or track an already-expired delivered turn after an idle rerender', () => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED_AT);
    const { rerender } = renderStatus([]);

    vi.advanceTimersByTime(6_000);
    rerender(
      <I18nProvider initial="en">
        <PreviewRunStatusBar
          projectId="project-1"
          conversationId="conversation-2"
          messages={[deliveredMessage()]}
        />
      </I18nProvider>,
    );

    expect(screen.queryByTestId('preview-run-status')).toBeNull();
    expect(analyticsTrack).not.toHaveBeenCalled();
  });

  // A delivery failure is deliberately sticky — `previewRunStatusVisibleAt`
  // never expires it, so the canvas hint survives reloads until a later Design
  // turn supersedes it. That is correct for a user who intends to retry, but it
  // left the only escape hatch as "run something else": a user who read the
  // notice had no way to clear it and reported the label as a stuck string
  // welded over the preview. Keep the no-auto-expire contract; add an explicit
  // dismissal instead.
  it('lets the user dismiss a stuck delivery-failure notice', () => {
    renderStatus([failedMessage()]);

    expect(screen.getByTestId('preview-run-status')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(screen.queryByTestId('preview-run-status')).toBeNull();
  });

  it('keeps a dismissed failure hidden when the same turn rerenders', () => {
    const messages = [failedMessage()];
    const { rerender } = renderStatus(messages);

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    rerender(
      <I18nProvider initial="en">
        <PreviewRunStatusBar
          projectId="project-1"
          conversationId="conversation-1"
          messages={messages}
        />
      </I18nProvider>,
    );

    expect(screen.queryByTestId('preview-run-status')).toBeNull();
  });

  it('shows a newer failure after an older one was dismissed', () => {
    const first = failedMessage();
    const { rerender } = renderStatus([first]);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    const second: ChatMessage = { ...failedMessage(), id: 'failed-message-2' };
    rerender(
      <I18nProvider initial="en">
        <PreviewRunStatusBar
          projectId="project-1"
          conversationId="conversation-1"
          messages={[first, second]}
        />
      </I18nProvider>,
    );

    expect(screen.getByTestId('preview-run-status')).toBeTruthy();
  });

  it('shows a progress hint while a settling agent write is being applied', () => {
    renderStatus([], true);

    expect(screen.getByTestId('preview-update-status')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Updating preview\u2026');
  });

  it('leaves the canvas alone when no write is landing', () => {
    renderStatus([], false);

    expect(screen.queryByTestId('preview-update-status')).toBeNull();
  });

  it('lets the live run status speak for the work instead of the preview hint', () => {
    renderStatus(
      [
        {
          id: 'running-message',
          role: 'assistant',
          content: '',
          sessionMode: 'design',
          runStatus: 'running',
          createdAt: STARTED_AT,
          startedAt: STARTED_AT,
        },
      ],
      true,
    );

    expect(screen.getByTestId('preview-run-status')).toBeTruthy();
    expect(screen.queryByTestId('preview-update-status')).toBeNull();
  });

  it('does not offer dismissal while a run is still in flight', () => {
    renderStatus([
      {
        id: 'running-message',
        role: 'assistant',
        content: '',
        sessionMode: 'design',
        runStatus: 'running',
        createdAt: STARTED_AT,
        startedAt: STARTED_AT,
      },
    ]);

    expect(screen.getByTestId('preview-run-status')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
  });
});
