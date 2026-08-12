import { describe, expect, it, vi } from 'vitest';

import {
  buildStoryboardTakeReceipt,
  costDisclosureForProvider,
  publishTerminalAfterReceipt,
  storyboardShotOutputName,
} from '../../src/storyboards/provenance.js';
import { createHeroProductCommercial } from '../../src/storyboards/product-commercial.js';

describe('hero product commercial recipe', () => {
  it('stores the guided brief and seeds four plain-language shots', () => {
    const storyboard = createHeroProductCommercial({
      id: 'sb-1',
      now: '2026-08-11T12:00:00.000Z',
      model: 'higgsfield/seedance_2_0',
      ratio: '9:16',
      brief: {
        productName: 'Luma Bottle',
        audience: 'Busy commuters',
        promise: 'Cold water all day',
        visualDirection: 'Clean daylight with tactile close-ups',
        callToAction: 'Take cold water anywhere',
      },
    });

    expect(storyboard.title).toBe('Luma Bottle — Hero product commercial');
    expect(storyboard.recipe).toBe('hero-product-commercial');
    expect(storyboard.commercialBrief?.audience).toBe('Busy commuters');
    expect(storyboard.ratio).toBe('9:16');
    expect(storyboard.shots.map((shot) => shot.title)).toEqual([
      'Product reveal',
      'Benefit in action',
      'Proof and detail',
      'Closing frame',
    ]);
    expect(storyboard.shots).toHaveLength(4);
    expect(storyboard.shots.every((shot) => shot.status === 'draft')).toBe(true);
  });
});

describe('storyboard render provenance', () => {
  it('uses a unique output name per take instead of overwriting a shot file', () => {
    expect(storyboardShotOutputName('shot-1', 'take-a')).toBe('shot-shot-1-take-a.mp4');
    expect(storyboardShotOutputName('shot-1', 'take-b')).not.toBe(
      storyboardShotOutputName('shot-1', 'take-a'),
    );
  });

  it('does not invent dollar costs when a provider only reports credits or no price', () => {
    expect(costDisclosureForProvider('higgsfield')).toEqual({
      status: 'subscription-credits',
      note: 'Uses Higgsfield subscription credits; dollar cost was not reported.',
    });
    expect(costDisclosureForProvider('hyperframes')).toEqual({
      status: 'local-render',
      note: 'Rendered locally; no external generation charge was reported.',
    });
    expect(costDisclosureForProvider('openrouter').status).toBe('not-reported');
  });

  it('snapshots the exact render inputs and marks usage rights as unverified', () => {
    const receipt = buildStoryboardTakeReceipt({
      taskId: 'task-1',
      status: 'done',
      startedAt: 1_000,
      endedAt: 4_250,
      providerId: 'higgsfield',
      modelId: 'higgsfield/seedance_2_0',
      motionPrompt: 'camera slowly pushes in',
      effectivePrompt: 'camera slowly pushes in\n\nBrand palette: cobalt',
      startFrame: 'upload-a.png',
      endFrame: 'frame-b.png',
      aspect: '16:9',
      durationSec: 5,
      output: 'shot-shot-1-task-1.mp4',
      providerNote: 'higgsfield/seedance',
      warnings: ['duration clamped'],
    });

    expect(receipt.id).toBe('task-1');
    expect(receipt.renderDurationMs).toBe(3_250);
    expect(receipt.inputs).toEqual({
      startFrame: 'upload-a.png',
      endFrame: 'frame-b.png',
      aspect: '16:9',
      durationSec: 5,
    });
    expect(receipt.motionPrompt).toBe('camera slowly pushes in');
    expect(receipt.effectivePrompt).toContain('Brand palette');
    expect(receipt.usageRights.status).toBe('unverified');
    expect(receipt.cost.status).toBe('subscription-credits');
  });

  it('refuses to publish a terminal task when its receipt is not durable', async () => {
    const publishTerminal = vi.fn();
    const onReceiptError = vi.fn();

    const published = await publishTerminalAfterReceipt({
      persistReceipt: async () => { throw new Error('disk is read-only'); },
      publishTerminal,
      onReceiptError,
    });

    expect(published).toBe(false);
    expect(publishTerminal).not.toHaveBeenCalled();
    expect(onReceiptError).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk is read-only' }));
  });

  it('publishes only after receipt persistence completes', async () => {
    const events: string[] = [];
    const published = await publishTerminalAfterReceipt({
      persistReceipt: async () => { events.push('receipt'); },
      publishTerminal: () => { events.push('terminal'); },
      onReceiptError: () => { events.push('error'); },
    });

    expect(published).toBe(true);
    expect(events).toEqual(['receipt', 'terminal']);
  });
});
