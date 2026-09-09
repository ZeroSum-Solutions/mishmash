// @vitest-environment jsdom

// Red spec for the F-01 progress card: it renders per-file byte progress and
// the terminal success/failure state ONLY from contract-typed
// `ProjectUploadSseEvent`s — never an inferred percentage. Every fixture
// event below is a literal `ProjectUploadSseEvent` union member, so a shape
// this component cannot actually receive from the daemon would fail to
// typecheck here (D-18).

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ProjectUploadSseEvent } from '@open-design/contracts';

import { deriveUploadProgressState, UploadProgressCard } from '../../src/components/UploadProgressCard';

afterEach(() => {
  cleanup();
});

describe('UploadProgressCard', () => {
  it('renders nothing before any event has arrived', () => {
    const { container } = render(<UploadProgressCard events={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders monotonic byte progress for a single in-flight file', () => {
    const events: ProjectUploadSseEvent[] = [
      { type: 'upload-started', uploadId: 'u1', files: [{ index: 0, name: 'hero.png', size: 1000 }] },
      { type: 'upload-progress', uploadId: 'u1', index: 0, name: 'hero.png', bytesReceived: 250, totalBytes: 1000 },
      { type: 'upload-progress', uploadId: 'u1', index: 0, name: 'hero.png', bytesReceived: 700, totalBytes: 1000 },
    ];

    render(<UploadProgressCard events={events} />);

    const row = screen.getByTestId('upload-progress-row-0');
    expect(row).toHaveAttribute('data-status', 'uploading');
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '700');
    expect(bar).toHaveAttribute('aria-valuemax', '1000');
    expect(screen.getByText('hero.png')).toBeInTheDocument();
  });

  it('renders the completed state from the terminal upload-completed event, not an inferred percentage', () => {
    const events: ProjectUploadSseEvent[] = [
      { type: 'upload-started', uploadId: 'u1', files: [{ index: 0, name: 'a.txt', size: 500 }] },
      { type: 'upload-progress', uploadId: 'u1', index: 0, name: 'a.txt', bytesReceived: 200, totalBytes: 500 },
      {
        type: 'upload-completed',
        uploadId: 'u1',
        files: [{ name: 'a.txt', path: 'a.txt', size: 500, mtime: 1700000000, originalName: 'a.txt' }],
      },
    ];

    render(<UploadProgressCard events={events} />);

    const row = screen.getByTestId('upload-progress-row-0');
    expect(row).toHaveAttribute('data-status', 'done');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('a.txt uploaded')).toBeInTheDocument();
  });

  it('renders the failed state and the daemon-provided message for a terminal upload-failed event', () => {
    const events: ProjectUploadSseEvent[] = [
      { type: 'upload-started', uploadId: 'u1', files: [{ index: 0, name: 'big.bin', size: 999_999_999 }] },
      {
        type: 'upload-failed',
        uploadId: 'u1',
        code: 'PAYLOAD_TOO_LARGE',
        message: '"big.bin" (999999999 bytes) exceeds the 209715200 byte limit',
        limitBytes: 209715200,
        file: 'big.bin',
      },
    ];

    render(<UploadProgressCard events={events} />);

    const row = screen.getByTestId('upload-progress-row-0');
    expect(row).toHaveAttribute('data-status', 'failed');
    expect(screen.getByText(/exceeds the 209715200 byte limit/)).toBeInTheDocument();
  });

  it('renders one row per file and keeps them ordered by index', () => {
    const events: ProjectUploadSseEvent[] = [
      {
        type: 'upload-started',
        uploadId: 'u1',
        files: [
          { index: 0, name: 'first.txt', size: 100 },
          { index: 1, name: 'second.txt', size: 200 },
        ],
      },
      { type: 'upload-progress', uploadId: 'u1', index: 1, name: 'second.txt', bytesReceived: 50, totalBytes: 200 },
    ];

    render(<UploadProgressCard events={events} />);

    const names = screen.getAllByTestId(/upload-progress-row-/).map((row) => row.querySelector('span')?.textContent);
    expect(names).toEqual(['first.txt', 'second.txt']);
  });
});

describe('deriveUploadProgressState', () => {
  it('marks exactly one terminal outcome regardless of trailing events', () => {
    const events: ProjectUploadSseEvent[] = [
      { type: 'upload-started', uploadId: 'u1', files: [{ index: 0, name: 'a.txt', size: 10 }] },
      { type: 'upload-progress', uploadId: 'u1', index: 0, name: 'a.txt', bytesReceived: 10, totalBytes: 10 },
      { type: 'upload-completed', uploadId: 'u1', files: [{ name: 'a.txt', path: 'a.txt', size: 10, mtime: 1, originalName: 'a.txt' }] },
    ];
    const { outcome, rows } = deriveUploadProgressState(events);
    expect(outcome).toEqual({ type: 'completed' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'done', bytesReceived: 10, totalBytes: 10 });
  });
});
