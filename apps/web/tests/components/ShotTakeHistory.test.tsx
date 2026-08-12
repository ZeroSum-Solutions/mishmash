// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShotTakeHistory } from '../../src/components/storyboard/ShotTakeHistory';
import { I18nProvider } from '../../src/i18n';

const receipt = {
  id: 'task-1',
  taskId: 'task-1',
  status: 'done' as const,
  startedAt: '2026-08-11T12:00:00.000Z',
  completedAt: '2026-08-11T12:00:03.250Z',
  renderDurationMs: 3250,
  providerId: 'higgsfield',
  modelId: 'higgsfield/seedance_2_0',
  motionPrompt: 'camera slowly pushes in',
  effectivePrompt: 'camera slowly pushes in',
  inputs: { startFrame: 'upload-a.png', aspect: '16:9', durationSec: 5 },
  output: 'shot-1-task-1.mp4',
  cost: {
    status: 'subscription-credits' as const,
    note: 'Uses Higgsfield subscription credits; dollar cost was not reported.',
  },
  usageRights: {
    status: 'unverified' as const,
    note: 'Verify the selected model and provider terms before client delivery.',
  },
};

afterEach(cleanup);

describe('ShotTakeHistory', () => {
  it('shows the decision-critical provenance in plain language', () => {
    render(
      <I18nProvider initial="en">
        <ShotTakeHistory
          takes={[receipt]}
          reviews={{}}
          frameUrl={(path) => `/raw/${path}`}
          onReview={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText('Higgsfield')).toBeTruthy();
    expect(screen.getByText('3.3 seconds')).toBeTruthy();
    expect(screen.getByText(/subscription credits/i)).toBeTruthy();
    expect(screen.getByText(/usage rights not verified/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use this take' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject take' })).toBeTruthy();
  });

  it('shows provider notes and warnings carried by the immutable receipt', () => {
    render(
      <I18nProvider initial="en">
        <ShotTakeHistory
          takes={[{ ...receipt, providerNote: 'Seedance accepted a shorter clip.', warnings: ['Duration clamped to 4 seconds.'] }]}
          reviews={{}}
          frameUrl={(path) => `/raw/${path}`}
          onReview={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText(/Seedance accepted a shorter clip/)).toBeTruthy();
    expect(screen.getByText('Duration clamped to 4 seconds.')).toBeTruthy();
  });

  it('submits a clear decision with optional comparison notes and 1-5 scores', () => {
    const onReview = vi.fn();
    render(
      <I18nProvider initial="en">
        <ShotTakeHistory
          takes={[receipt]}
          reviews={{}}
          frameUrl={(path) => `/raw/${path}`}
          onReview={onReview}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByText('Add comparison notes'));
    fireEvent.change(screen.getByLabelText('Brand fit'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Motion quality'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Visual cleanliness'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Easy to revise'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Clean silhouette.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use this take' }));

    expect(onReview).toHaveBeenCalledWith('task-1', {
      decision: 'approved',
      note: 'Clean silhouette.',
      scores: { brandFit: 5, motionQuality: 4, artifactControl: 5, revisionEase: 4 },
    });
  });

  it('does not invent neutral scores when a user makes a quick decision', () => {
    const onReview = vi.fn();
    render(
      <I18nProvider initial="en">
        <ShotTakeHistory
          takes={[receipt]}
          reviews={{}}
          frameUrl={(path) => `/raw/${path}`}
          onReview={onReview}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use this take' }));

    expect(onReview).toHaveBeenCalledWith('task-1', { decision: 'approved' });
  });

  it('preserves a saved note when changing only the decision', () => {
    const onReview = vi.fn();
    render(
      <I18nProvider initial="en">
        <ShotTakeHistory
          takes={[receipt]}
          reviews={{
            'task-1': {
              decision: 'approved',
              note: 'Strong silhouette.',
              updatedAt: '2026-08-11T12:10:00.000Z',
            },
          }}
          selectedTakeId="task-other"
          frameUrl={(path) => `/raw/${path}`}
          onReview={onReview}
        />
      </I18nProvider>,
    );

    expect(screen.getByText('Approved earlier · not selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reject take' }));
    expect(onReview).toHaveBeenCalledWith('task-1', {
      decision: 'rejected',
      note: 'Strong silhouette.',
    });
  });
});
