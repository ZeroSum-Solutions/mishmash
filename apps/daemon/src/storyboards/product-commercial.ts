import type { Storyboard, StoryboardCommercialBrief, StoryboardShot } from '@open-design/contracts';

export interface CreateHeroProductCommercialInput {
  id: string;
  now: string;
  model: string;
  resolution?: StoryboardShot['resolution'];
  ratio: string;
  brief: StoryboardCommercialBrief;
  shotId?: (index: number) => string;
}

const SHOT_SEEDS: ReadonlyArray<{ title: string; motionPrompt: string }> = [
  {
    title: 'Product reveal',
    motionPrompt: 'the camera slowly pushes in while soft light moves across the product surface',
  },
  {
    title: 'Benefit in action',
    motionPrompt: 'the product moves naturally into use as the camera follows with a steady lateral glide',
  },
  {
    title: 'Proof and detail',
    motionPrompt: 'the camera makes a slow controlled orbit and settles on the most important detail',
  },
  {
    title: 'Closing frame',
    motionPrompt: 'the camera eases back to a clean centered composition and comes to a gentle stop',
  },
];

/** Deterministic recipe seeding; provider calls happen only when the user renders a shot. */
export function createHeroProductCommercial(input: CreateHeroProductCommercialInput): Storyboard {
  const shots: StoryboardShot[] = SHOT_SEEDS.map((seed, index) => ({
    id: input.shotId?.(index) ?? `${input.id}-shot-${index + 1}`,
    order: index,
    title: seed.title,
    motionPrompt: seed.motionPrompt,
    model: input.model,
    resolution: input.resolution ?? '1080p',
    durationSec: 5,
    status: 'draft',
  }));

  return {
    id: input.id,
    title: `${input.brief.productName} — Hero product commercial`,
    createdAt: input.now,
    updatedAt: input.now,
    ratio: input.ratio,
    moodDrafts: [],
    shots,
    recipe: 'hero-product-commercial',
    commercialBrief: { ...input.brief },
  };
}
