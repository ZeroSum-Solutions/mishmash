import type {
  StoryboardTakeCostDisclosure,
  StoryboardTakeReceipt,
} from '@open-design/contracts';

const USAGE_RIGHTS_NOTE = 'Verify the selected model and provider terms before client delivery.';

function safeFileSegment(value: string): string {
  const safe = value.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'unknown';
}

export function storyboardShotOutputName(shotId: string, takeId: string): string {
  return `shot-${safeFileSegment(shotId)}-${safeFileSegment(takeId)}.mp4`;
}

export function costDisclosureForProvider(providerId: string): StoryboardTakeCostDisclosure {
  if (providerId === 'higgsfield') {
    return {
      status: 'subscription-credits',
      note: 'Uses Higgsfield subscription credits; dollar cost was not reported.',
    };
  }
  if (providerId === 'hyperframes') {
    return {
      status: 'local-render',
      note: 'Rendered locally; no external generation charge was reported.',
    };
  }
  return {
    status: 'not-reported',
    note: 'This provider did not report a per-render dollar cost.',
  };
}

export async function publishTerminalAfterReceipt(input: {
  persistReceipt: () => Promise<void>;
  publishTerminal: () => void | Promise<void>;
  onReceiptError: (error: unknown) => void;
}): Promise<boolean> {
  try {
    await input.persistReceipt();
  } catch (error) {
    input.onReceiptError(error);
    return false;
  }
  await input.publishTerminal();
  return true;
}

export interface BuildStoryboardTakeReceiptInput {
  taskId: string;
  status: 'done' | 'failed';
  startedAt: number;
  endedAt: number;
  providerId: string;
  modelId: string;
  motionPrompt: string;
  effectivePrompt: string;
  startFrame?: string;
  endFrame?: string;
  aspect: string;
  durationSec: number;
  output?: string;
  providerNote?: string;
  warnings?: string[];
  error?: string;
}

export function buildStoryboardTakeReceipt(
  input: BuildStoryboardTakeReceiptInput,
): StoryboardTakeReceipt {
  return {
    id: input.taskId,
    taskId: input.taskId,
    status: input.status,
    startedAt: new Date(input.startedAt).toISOString(),
    completedAt: new Date(input.endedAt).toISOString(),
    renderDurationMs: Math.max(0, input.endedAt - input.startedAt),
    providerId: input.providerId,
    modelId: input.modelId,
    motionPrompt: input.motionPrompt,
    effectivePrompt: input.effectivePrompt,
    inputs: {
      ...(input.startFrame ? { startFrame: input.startFrame } : {}),
      ...(input.endFrame ? { endFrame: input.endFrame } : {}),
      aspect: input.aspect,
      durationSec: input.durationSec,
    },
    ...(input.output ? { output: input.output } : {}),
    ...(input.providerNote ? { providerNote: input.providerNote } : {}),
    ...(input.warnings?.length ? { warnings: [...input.warnings] } : {}),
    ...(input.error ? { error: input.error } : {}),
    cost: costDisclosureForProvider(input.providerId),
    usageRights: {
      status: 'unverified',
      note: USAGE_RIGHTS_NOTE,
    },
  };
}
