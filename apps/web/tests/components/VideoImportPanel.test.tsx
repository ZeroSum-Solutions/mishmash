// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Project } from '../../src/types';
import type { VideoImportJob } from '@open-design/contracts';

const { listProjectsMock, createVideoImportMock, getVideoImportJobMock } = vi.hoisted(() => ({
  listProjectsMock: vi.fn(),
  createVideoImportMock: vi.fn(),
  getVideoImportJobMock: vi.fn(),
}));

vi.mock('../../src/state/projects', () => ({
  listProjects: listProjectsMock,
}));

vi.mock('../../src/providers/registry', () => ({
  createVideoImport: createVideoImportMock,
  getVideoImportJob: getVideoImportJobMock,
}));

import { VideoImportPanel } from '../../src/components/VideoImportPanel';

const PROJECTS: Project[] = [
  { id: 'proj-1', name: 'Landing page', skillId: null, designSystemId: null, createdAt: 0, updatedAt: 0 },
  { id: 'proj-2', name: 'Marketing deck', skillId: null, designSystemId: null, createdAt: 0, updatedAt: 0 },
];

function runningJob(overrides: Partial<VideoImportJob> = {}): VideoImportJob {
  return {
    jobId: 'task-1',
    taskId: 'task-1',
    provider: 'vimeo',
    status: 'running',
    progress: ['resolved "Fixture Clip" (1024 bytes)'],
    fraction: 0.5,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  listProjectsMock.mockResolvedValue(PROJECTS);
});

describe('VideoImportPanel', () => {
  it('loads the project list and lists YouTube as a disabled option', async () => {
    render(<VideoImportPanel vimeoConnected />);
    await waitFor(() => expect(listProjectsMock).toHaveBeenCalled());

    expect(await screen.findByRole('option', { name: 'Landing page' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Marketing deck' })).toBeTruthy();
    const youtubeOption = screen.getByRole('option', { name: /YouTube/ }) as HTMLOptionElement;
    expect(youtubeOption.disabled).toBe(true);
  });

  it('disables submit and shows a hint when Vimeo is not connected', async () => {
    render(<VideoImportPanel vimeoConnected={false} />);
    await waitFor(() => expect(listProjectsMock).toHaveBeenCalled());
    expect(screen.getByText('Connect a Vimeo account above before importing.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('requires a project and a url before submitting', async () => {
    render(<VideoImportPanel vimeoConnected />);
    await waitFor(() => expect(listProjectsMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Choose a project first.')).toBeTruthy();
    expect(createVideoImportMock).not.toHaveBeenCalled();
  });

  it('submits the form, polls the job, and shows progress with a fraction percent', async () => {
    createVideoImportMock.mockResolvedValue({ ok: true, job: runningJob() });
    let resolvePoll!: (value: { ok: true; job: VideoImportJob }) => void;
    getVideoImportJobMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePoll = resolve;
      }),
    );

    render(<VideoImportPanel vimeoConnected />);
    await waitFor(() => expect(listProjectsMock).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/Project/), { target: { value: 'proj-1' } });
    fireEvent.change(screen.getByLabelText(/Vimeo link/), { target: { value: 'https://vimeo.com/123456789' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    });

    // The job set from `createVideoImport`'s own response renders immediately
    // (running, 50%) -- the poll's own first tick is still in flight because
    // `resolvePoll` has not been called yet.
    expect(createVideoImportMock).toHaveBeenCalledWith('proj-1', 'vimeo', 'https://vimeo.com/123456789', undefined);
    expect(screen.getByText(/Downloading — 50%/)).toBeTruthy();
    expect(getVideoImportJobMock).toHaveBeenCalledWith('proj-1', 'task-1');

    await act(async () => {
      resolvePoll({
        ok: true,
        job: runningJob({
          status: 'done',
          fraction: 1,
          file: { name: 'clip.mp4', path: 'clip.mp4', size: 10, mtime: 0, kind: 'video', mime: 'video/mp4' },
        }),
      });
    });

    expect(screen.getByText('Saved as clip.mp4.')).toBeTruthy();
  });

  it('shows the job error text on a failed import', async () => {
    createVideoImportMock.mockResolvedValue({
      ok: true,
      job: runningJob({ status: 'failed', fraction: undefined, error: { code: 'LIMIT_EXCEEDED', message: 'exceeded OD_VIDEO_IMPORT_MAX_BYTES' } }),
    });

    render(<VideoImportPanel vimeoConnected />);
    await waitFor(() => expect(listProjectsMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/Project/), { target: { value: 'proj-1' } });
    fireEvent.change(screen.getByLabelText(/Vimeo link/), { target: { value: 'https://vimeo.com/123456789' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    });

    expect(await screen.findByText('exceeded OD_VIDEO_IMPORT_MAX_BYTES')).toBeTruthy();
    expect(getVideoImportJobMock).not.toHaveBeenCalled();
  });

  it('surfaces a create error inline without submitting a poll', async () => {
    createVideoImportMock.mockResolvedValue({ ok: false, error: 'Vimeo is not connected' });

    render(<VideoImportPanel vimeoConnected />);
    await waitFor(() => expect(listProjectsMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/Project/), { target: { value: 'proj-1' } });
    fireEvent.change(screen.getByLabelText(/Vimeo link/), { target: { value: 'https://vimeo.com/123456789' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    });

    expect(await screen.findByText('Vimeo is not connected')).toBeTruthy();
    expect(getVideoImportJobMock).not.toHaveBeenCalled();
  });
});
