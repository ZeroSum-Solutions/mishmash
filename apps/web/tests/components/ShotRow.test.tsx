// @vitest-environment jsdom
//
// ShotRow.tsx is the compact per-shot summary introduced by the storyboard
// redesign (PRD C4 outcome 1: compact rows + a details drawer opened per
// shot; outcome 3: at-a-glance generation state with a retry affordance on
// failure). Shot editing itself lives in ShotCard.tsx (rendered inside
// ShotDetailsDrawer) and is covered by ShotCard.test.tsx — this file only
// covers what the row itself renders and wires up.
//
// Every callback prop takes a shotId (react review R3 — see ShotRow.tsx's
// module doc comment on why), so handler assertions below check the id
// argument, not just call count.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoryboardShot } from '@open-design/contracts';
import { ShotRow } from '../../src/components/storyboard/ShotRow';
import type { MediaModel } from '../../src/media/models';

const VIDEO_MODELS: MediaModel[] = [
  {
    id: 'openrouter/bytedance/seedance-2.0:1080p',
    label: 'seedance-2.0 1080p (OR)',
    hint: '',
    provider: 'openrouter',
    caps: ['t2v', 'i2v', 'kf'],
    default: true,
  },
];

function baseShot(overrides: Partial<StoryboardShot> = {}): StoryboardShot {
  return {
    id: 'shot-1',
    order: 0,
    motionPrompt: '',
    model: 'openrouter/bytedance/seedance-2.0:1080p',
    resolution: '1080p',
    durationSec: 5,
    status: 'draft',
    ...overrides,
  };
}

function renderRow(shot: StoryboardShot, overrides: Partial<React.ComponentProps<typeof ShotRow>> = {}) {
  const handlers = {
    onToggleDetails: vi.fn(),
    onRender: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
  };
  render(
    <ShotRow
      shot={shot}
      index={0}
      previousShot={null}
      videoModels={VIDEO_MODELS}
      configured={{ openrouter: { apiKey: '', baseUrl: '', apiKeyConfigured: true } }}
      frameUrl={(p) => `/frame/${p}`}
      busy={false}
      detailsOpen={false}
      canMoveUp={false}
      canMoveDown={false}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

afterEach(() => {
  cleanup();
});

describe('ShotRow at-a-glance status (PRD C4 outcome 3)', () => {
  it('shows a placeholder when the shot has no motion prompt yet', () => {
    renderRow(baseShot());
    expect(screen.getByText('No motion prompt yet')).toBeTruthy();
  });

  it('shows the actual prompt text once one is set', () => {
    renderRow(baseShot({ motionPrompt: 'camera pans left' }));
    expect(screen.getByText('camera pans left')).toBeTruthy();
  });

  it('keeps a planned shot name visible beside its motion summary', () => {
    renderRow(baseShot({ title: 'Product reveal', motionPrompt: 'camera pans left' }));
    expect(screen.getByText('Product reveal')).toBeTruthy();
    expect(screen.getByText('camera pans left')).toBeTruthy();
  });

  it('shows no status badge for an untouched draft shot', () => {
    renderRow(baseShot());
    expect(screen.queryByTestId('shot-status-badge')).toBeNull();
  });

  // Grok design critique G2: Render must stay gated (disabled, with a
  // reason exposed) until the shot actually has what it needs, not read as
  // ready the moment a shot exists.
  it('gates the row Render button (disabled + a reason) until a start frame and motion prompt both exist', () => {
    renderRow(baseShot());
    const button = screen.getByTestId('row-render-button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Add a start frame first.');
  });

  it('still gates Render on the motion prompt once a start frame exists', () => {
    renderRow(baseShot({ startFrame: { path: 's.png', origin: 'generated' } }));
    const button = screen.getByTestId('row-render-button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Describe the motion first.');
  });

  it('enables Render once both a start frame and a motion prompt exist', () => {
    renderRow(baseShot({ startFrame: { path: 's.png', origin: 'generated' }, motionPrompt: 'pans left' }));
    expect(screen.getByTestId('row-render-button')).not.toBeDisabled();
  });

  it('shows a queued badge while a request is in flight but not yet rendering', () => {
    renderRow(baseShot({ startFrame: { path: 's.png', origin: 'generated' }, motionPrompt: 'x' }), { busy: true });
    expect(screen.getByTestId('shot-status-badge')).toHaveAttribute('data-status', 'queued');
  });

  // Grok design critique G7 (partial): while rendering, the action slot
  // becomes an indeterminate progress pattern instead of a button — there's
  // no button to be "disabled" anymore for this state.
  it('shows a generating badge and an indeterminate progress pattern (no button) while rendering', () => {
    renderRow(
      baseShot({ status: 'rendering', startFrame: { path: 's.png', origin: 'generated' }, motionPrompt: 'x' }),
    );
    expect(screen.getByTestId('shot-status-badge')).toHaveAttribute('data-status', 'generating');
    expect(screen.queryByTestId('row-render-button')).toBeNull();
    expect(screen.getByRole('status', { name: 'Rendering…' })).toBeTruthy();
  });

  it('shows a done badge for a completed shot', () => {
    renderRow(baseShot({ status: 'done', output: 'out.mp4' }));
    expect(screen.getByTestId('shot-status-badge')).toHaveAttribute('data-status', 'done');
  });

  it('shows the error and an enabled Retry on a failed shot that still has everything it needs, wired to onRender(shotId)', () => {
    const handlers = renderRow(
      baseShot({
        status: 'failed',
        error: 'daemon rejected the prompt',
        startFrame: { path: 's.png', origin: 'generated' },
        motionPrompt: 'x',
      }),
    );
    const badge = screen.getByTestId('shot-status-badge');
    expect(badge).toHaveAttribute('data-status', 'failed');
    expect(badge.textContent).toContain('daemon rejected the prompt');

    const retryButton = screen.getByTestId('row-render-button');
    expect(retryButton.textContent).toContain('Retry');
    expect(retryButton).not.toBeDisabled();
    fireEvent.click(retryButton);
    expect(handlers.onRender).toHaveBeenCalledWith('shot-1');
  });

  // React review R4: never show a disabled Retry — a failed shot missing a
  // prerequisite gets an enabled "Fix in details" CTA instead, which opens
  // the drawer rather than attempting (and failing) another render.
  it('shows an enabled "Fix in details" CTA instead of a disabled Retry when a prerequisite is missing', () => {
    const handlers = renderRow(baseShot({ status: 'failed', error: 'no start frame' }));
    expect(screen.queryByTestId('row-render-button')).toBeNull();
    const fixButton = screen.getByTestId('row-fix-in-details-button');
    expect(fixButton).not.toBeDisabled();
    fireEvent.click(fixButton);
    expect(handlers.onToggleDetails).toHaveBeenCalledWith('shot-1');
  });
});

describe('ShotRow Edit button (grok design critique G4: renamed from "Details ▾")', () => {
  it('calls onToggleDetails(shotId) and reflects detailsOpen via aria-expanded', () => {
    const handlers = renderRow(baseShot(), { detailsOpen: true });
    const toggle = screen.getByTestId('shot-details-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle.textContent).toBe('Edit');
    fireEvent.click(toggle);
    expect(handlers.onToggleDetails).toHaveBeenCalledWith('shot-1');
  });

  it('has aria-controls pointing at the shot-specific drawer id (react review R12)', () => {
    renderRow(baseShot());
    expect(screen.getByTestId('shot-details-toggle')).toHaveAttribute('aria-controls', 'shot-details-drawer-shot-1');
  });
});

describe('ShotRow steady kebab menu (grok design critique G4)', () => {
  it('is closed by default and opens the move/duplicate/delete menu on click', () => {
    renderRow(baseShot());
    expect(screen.queryByTestId('row-actions-menu')).toBeNull();
    fireEvent.click(screen.getByTestId('row-actions-trigger'));
    expect(screen.getByTestId('row-actions-menu')).toBeTruthy();
  });

  it('wires move/duplicate/delete to their handlers with the shotId, and respects canMoveUp/canMoveDown', () => {
    const handlers = renderRow(baseShot(), { canMoveUp: true, canMoveDown: false });
    fireEvent.click(screen.getByTestId('row-actions-trigger'));
    const menu = screen.getByTestId('row-actions-menu');
    fireEvent.click(within(menu).getByText('Move shot earlier'));
    expect(handlers.onMoveUp).toHaveBeenCalledWith('shot-1');

    fireEvent.click(screen.getByTestId('row-actions-trigger'));
    fireEvent.click(within(screen.getByTestId('row-actions-menu')).getByText('Duplicate shot'));
    expect(handlers.onDuplicate).toHaveBeenCalledWith('shot-1');

    fireEvent.click(screen.getByTestId('row-actions-trigger'));
    fireEvent.click(within(screen.getByTestId('row-actions-menu')).getByText('Delete shot'));
    expect(handlers.onDelete).toHaveBeenCalledWith('shot-1');

    fireEvent.click(screen.getByTestId('row-actions-trigger'));
    expect(within(screen.getByTestId('row-actions-menu')).getByText('Move shot later').closest('button')).toBeDisabled();
  });

  it('closes the menu after choosing an action', () => {
    renderRow(baseShot(), { canMoveUp: true });
    fireEvent.click(screen.getByTestId('row-actions-trigger'));
    fireEvent.click(within(screen.getByTestId('row-actions-menu')).getByText('Move shot earlier'));
    expect(screen.queryByTestId('row-actions-menu')).toBeNull();
  });

  it('closes the menu on an outside click', () => {
    render(
      <div>
        <button type="button">outside</button>
        <ShotRow
          shot={baseShot()}
          index={0}
          previousShot={null}
          videoModels={VIDEO_MODELS}
          configured={{}}
          frameUrl={(p) => `/frame/${p}`}
          busy={false}
          detailsOpen={false}
          canMoveUp={false}
          canMoveDown={false}
          onToggleDetails={vi.fn()}
          onRender={vi.fn()}
          onDuplicate={vi.fn()}
          onDelete={vi.fn()}
          onMoveUp={vi.fn()}
          onMoveDown={vi.fn()}
        />
      </div>,
    );
    fireEvent.click(screen.getByTestId('row-actions-trigger'));
    expect(screen.getByTestId('row-actions-menu')).toBeTruthy();
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByTestId('row-actions-menu')).toBeNull();
  });
});

describe('ShotRow empty frame slots (grok design critique G2)', () => {
  it('renders clickable "+ Start" / "+ End" affordances that open the drawer', () => {
    const handlers = renderRow(baseShot());
    expect(screen.getByText('+ Start')).toBeTruthy();
    expect(screen.getByText('+ End')).toBeTruthy();
    fireEvent.click(screen.getByText('+ Start'));
    expect(handlers.onToggleDetails).toHaveBeenCalledWith('shot-1');
  });
});
