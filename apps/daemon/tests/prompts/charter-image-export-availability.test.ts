// W2.6 / T-10 — the composed system prompt must never tell an agent to run a
// command the running daemon answers 501 for.
//
// `POST /api/projects/:id/export/image` rasterizes through a desktop renderer;
// with neither renderer wired `handleScreenshotExport` answers 501
// UPSTREAM_UNAVAILABLE "screenshot export is only available in the desktop
// runtime" (apps/daemon/src/import-export-routes.ts). This fork ships no
// desktop app (`apps/desktop` / `apps/packaged` are removed, root AGENTS.md),
// so a plain daemon boot — every web runtime — is exactly that case, and
// `apps/daemon/src/export-cli-routing.ts:13` maps `od export --format image`
// straight onto that route. The slim charter's optional-preview line named it
// unconditionally, which is what put a `request-failed` 501 row in the anomaly
// log for ordinary use.
//
// The charter must be fail-closed: it names the image export only when the
// caller proves the runtime can serve it.

import { describe, expect, it } from 'vitest';

import { composeSystemPrompt as composeContractsSystemPrompt } from '@open-design/contracts';

import { composeSystemPrompt } from '../../src/prompts/system.js';

/** The optional-preview command as the charter spells it. */
const IMAGE_EXPORT_COMMAND = /\bexport <file> --project .* --format image\b/;

// The composed prompts are ~130 KB. Assert on the boolean so a failure
// reports the rule instead of dumping a whole system prompt.
function advertisesImageExport(prompt: string): boolean {
  return IMAGE_EXPORT_COMMAND.test(prompt);
}

describe('W2.6 / T-10 — the charter never advertises an export the runtime 501s on', () => {
  it('omits the image-export preview command when the runtime does not prove it can serve it', () => {
    expect(advertisesImageExport(composeSystemPrompt({ promptCoreVariant: 'slim' }))).toBe(false);
  });

  it('omits it for the text-artifact (BYOK/API) profile too', () => {
    expect(
      advertisesImageExport(
        composeSystemPrompt({ promptCoreVariant: 'slim', executionProfile: 'text_artifact' }),
      ),
    ).toBe(false);
  });

  it('names it again when the caller reports a screenshot renderer is wired', () => {
    expect(
      advertisesImageExport(
        composeSystemPrompt({ promptCoreVariant: 'slim', screenshotExportAvailable: true }),
      ),
    ).toBe(true);
  });

  /**
   * Drift alarm, in the shape of `pending-question-form-reemit.test.ts`: the
   * contracts API/BYOK composer carries no copy of this line today, so there
   * is no mirror to keep in step. If contracts ever grows one, this fails and
   * the author has to decide where the rule belongs.
   */
  it('has no contracts mirror advertising the same command', () => {
    expect(advertisesImageExport(composeContractsSystemPrompt({}))).toBe(false);
  });
});
