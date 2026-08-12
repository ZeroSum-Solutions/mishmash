# Storyboards

**Parent:** [`spec.md`](spec.md) · **Architecture:** [`architecture.md`](architecture.md)

Storyboards turn product images into a sequence of short video shots and then
assemble the selected shots into one video. The normal workflow is designed
for a marketer, founder, or designer; choosing providers and editing raw model
settings is optional.

## Hero product commercial

Open **Storyboard → New storyboard** and keep the recommended **Hero product
commercial** start selected. The guided form asks for five decisions in
ordinary creative language: the product, its audience, one promise, the visual
feel, and the call to action. MishMash creates a four-shot plan — product
reveal, benefit in action, proof/detail, and closing frame — without requiring
the user to choose a model or write a generation prompt first. **Start blank
instead** preserves the existing freeform workflow.

The commercial workflow is:

1. Add or generate a product image for each shot.
2. Generate one or more takes. A ready provider is selected when one is
   configured; video-engine and duration controls remain available in the shot
   inspector.
3. Compare takes in the shot inspector and choose **Use this take** or **Reject
   take**. Optional 1–5 scores cover brand fit, motion quality, visual
   cleanliness, and revision ease.
4. Choose one completed take for every shot, then assemble the final video.

For guided commercials, **Assemble video** stays disabled until every shot has
an explicitly chosen completed take. Blank and older storyboards keep their
existing behavior and can assemble any completed shots.

Each assembly uses its own scratch list and output filename, so overlapping
requests cannot overwrite one another. MishMash retains the current assembled
video plus the four newest earlier outputs for that storyboard; older outputs
are removed automatically. If the stored current-output file is removed
outside MishMash, the next storyboard read clears that stale reference.

## Take history and disclosures

Every render attempt is retained instead of overwriting the previous clip.
Each take shows its provider, render time, provider cost disclosure, warnings,
and review decision. The receipt also snapshots the model, prompts, and input
assets for later inspection. Failed attempts are retained too.

MishMash does not invent a dollar amount when a provider reports only
subscription credits or no per-render price. Usage rights are deliberately
shown as **not verified**; confirm the selected model and provider terms before
client delivery. An approval records which take should enter the final video;
it is not a legal clearance.

## Agent and CLI access

The web UI and `od storyboard` commands use the same local daemon contract.
Agents can create the guided recipe, upload images, render shots, inspect the
storyboard JSON, approve or reject a take, and assemble the selected result.
The daemon, not the UI or CLI, creates and appends render receipts.
