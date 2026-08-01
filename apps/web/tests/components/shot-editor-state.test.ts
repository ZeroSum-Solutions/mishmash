import { describe, expect, it } from 'vitest';
import { computeRenderButtonMode, computeShotDisplayStatus } from '../../src/components/storyboard/shot-editor-state';

// PRD C4 outcome 3: "visible generation states (queued/generating/failed/done
// readable at a glance on every shot row)". The contract's
// StoryboardShotStatus has no 'queued' value, so 'queued' is inferred from
// the caller's own busy flag rather than a status the server tracks — see
// the doc comment on computeShotDisplayStatus itself.
describe('computeShotDisplayStatus', () => {
  it('is idle for an untouched draft shot that is not busy', () => {
    expect(computeShotDisplayStatus({ status: 'draft' }, false)).toBe('idle');
  });

  it('is queued for a draft shot with a request in flight (busy, status not yet updated)', () => {
    expect(computeShotDisplayStatus({ status: 'draft' }, true)).toBe('queued');
  });

  it('is generating once the status flips to rendering, regardless of busy', () => {
    expect(computeShotDisplayStatus({ status: 'rendering' }, true)).toBe('generating');
    expect(computeShotDisplayStatus({ status: 'rendering' }, false)).toBe('generating');
  });

  it('is done for a completed shot, regardless of busy', () => {
    expect(computeShotDisplayStatus({ status: 'done' }, false)).toBe('done');
    expect(computeShotDisplayStatus({ status: 'done' }, true)).toBe('done');
  });

  it('is failed for a failed shot, regardless of busy (failed outranks a stale busy flag)', () => {
    expect(computeShotDisplayStatus({ status: 'failed' }, false)).toBe('failed');
    expect(computeShotDisplayStatus({ status: 'failed' }, true)).toBe('failed');
  });
});

// React review R5: the Render/Retry label logic shared by ShotRow.tsx and
// ShotCard.tsx must be a single helper so the two never disagree.
describe('computeRenderButtonMode', () => {
  it('is "render" for an untouched shot', () => {
    expect(computeRenderButtonMode({ canRender: false, isRendering: false }, 'idle')).toBe('render');
  });

  it('is "rendering" whenever isRendering is true, regardless of displayStatus', () => {
    expect(computeRenderButtonMode({ canRender: true, isRendering: true }, 'generating')).toBe('rendering');
  });

  it('is "retry" for a failed shot that still has everything it needs to re-render', () => {
    expect(computeRenderButtonMode({ canRender: true, isRendering: false }, 'failed')).toBe('retry');
  });

  it('is "render" (never a disabled "retry") for a failed shot missing a prerequisite — react review R4', () => {
    expect(computeRenderButtonMode({ canRender: false, isRendering: false }, 'failed')).toBe('render');
  });
});
