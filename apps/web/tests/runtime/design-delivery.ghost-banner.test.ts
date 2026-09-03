import { describe, expect, it } from 'vitest';
import { resolveDesignDeliveryOutcome } from '../../src/runtime/design-delivery';
import type { AgentEvent } from '../../src/types';

/**
 * Red spec for the "Delivery needs attention · Retry in Chat" ghost banner
 * (issue #159 section B, issue #158 cause 3).
 *
 * Each case below is a reduction of a real assistant row in the team daemon's
 * `app.sqlite` that carries `result_delivery_state = 'no_result'` even though
 * the turn delivered work. The classifier only ever saw NEW project-file names
 * and Write/Edit tool paths, so a turn that rewrote a file through Bash was
 * invisible to it, and any `rm` in a Bash command counted as an attempted
 * mutation that had to produce a file.
 */

const okBash = (id: string, command: string): AgentEvent[] => [
  { kind: 'tool_use', id, name: 'Bash', input: { command } },
  { kind: 'tool_result', toolUseId: id, content: 'ok', isError: false },
];

/**
 * Built as a variable rather than inline so the extra `modifiedFileCount`
 * field stays assignable to `DesignDeliveryInput` on both the base commit and
 * the fix branch: the assertion, not a type error, is what has to go red.
 */
function deliveryInput(overrides: {
  content: string;
  events: AgentEvent[];
  modifiedFileCount?: number;
}) {
  return {
    sessionMode: 'design' as const,
    runStatus: 'succeeded' as const,
    producedFileCount: 0,
    traceObjectFileCount: 0,
    ...overrides,
  };
}

describe('design delivery — ghost banner for a turn that delivered work', () => {
  it('counts a project file the turn rewrote through Bash as delivery', () => {
    // Row 4b02a794 (2026-08-28): `magick … assets/headshot-tee-crossed.jpg &&
    // rm -f assets/headshot-tee-arms-down.jpg`. Nothing new appeared in the
    // file list, so the classifier declared a missing deliverable.
    expect(
      resolveDesignDeliveryOutcome(
        deliveryInput({
          content: 'Swapped in the crossed-arms headshot and dropped the old one.',
          events: okBash(
            'bash-1',
            'magick /tmp/crossed.png -quality 92 assets/headshot-tee-crossed.jpg'
              + ' && rm -f assets/headshot-tee-arms-down.jpg',
          ),
          modifiedFileCount: 1,
        }),
      ),
    ).toBe('delivered');
  });

  it('counts a Bash copy over an existing project asset as delivery', () => {
    // Row 9a8aff8e (2026-08-27): `cp /tmp/hs-r5/fitness-v3-lift.jpg
    // …/assets/fitness-black-tee.jpg`. An overwrite changes no file name.
    expect(
      resolveDesignDeliveryOutcome(
        deliveryInput({
          content: 'Installed the warmer fitness headshot.',
          events: okBash('bash-2', 'cp /tmp/hs-r5/fitness-v3-lift.jpg assets/fitness-black-tee.jpg'),
          modifiedFileCount: 1,
        }),
      ),
    ).toBe('delivered');
  });

  it('does not treat a shell cleanup as an attempted deliverable', () => {
    // Row 3b19f8f9 (2026-08-26): the whole turn was `rm` of two rejected
    // drafts plus a written explanation. Deleting a file is not an attempt to
    // produce one, so the answer is a report, not a missing deliverable.
    expect(
      resolveDesignDeliveryOutcome(
        deliveryInput({
          content: 'Removed the two rejected drafts; the approved hero stays as it is.',
          events: okBash('bash-3', 'rm assets/flam-hero-DRAFT.jpg assets/flam-hero-DRAFT-2.jpg'),
        }),
      ),
    ).toBe('report_only');
  });

  it('treats a started preview server as the turn deliverable', () => {
    expect(
      resolveDesignDeliveryOutcome(
        deliveryInput({
          content: 'The site is live at http://127.0.0.1:3000.',
          events: okBash(
            'bash-4',
            '"$OD_NODE_BIN" "$OD_BIN" preview start --project "$OD_PROJECT_ID"'
              + ' --port 3000 --dir . -- npm run dev',
          ),
        }),
      ),
    ).toBe('delivered');
  });

  it('treats a preview server started alongside a cache cleanup as delivery', () => {
    expect(
      resolveDesignDeliveryOutcome(
        deliveryInput({
          content: 'Cleared the stale build cache and restarted the preview.',
          events: [
            ...okBash('bash-5', 'rm -rf .next/cache'),
            ...okBash(
              'bash-6',
              '"$OD_NODE_BIN" "$OD_BIN" preview start --project "$OD_PROJECT_ID"'
                + ' --port 3000 --dir . -- npm run dev',
            ),
          ],
        }),
      ),
    ).toBe('delivered');
  });

  it('does not accept a preview server that never came up as delivery', () => {
    // `od preview start` exits non-zero until the port answers HTTP, so an
    // errored result is proof the server is NOT up.
    expect(
      resolveDesignDeliveryOutcome(
        deliveryInput({
          content: 'I tried to start the preview.',
          events: [
            {
              kind: 'tool_use',
              id: 'bash-fail',
              name: 'Bash',
              input: {
                command:
                  '"$OD_NODE_BIN" "$OD_BIN" preview start --project p --port 3000 -- npm run dev',
              },
            },
            { kind: 'tool_result', toolUseId: 'bash-fail', content: 'EADDRINUSE', isError: true },
          ],
        }),
      ),
    ).toBe('report_only');
  });

  it('does not accept prose that merely names the preview command as delivery', () => {
    // `--project` is required by `od preview start`, so a command without it
    // never started a server.
    expect(
      resolveDesignDeliveryOutcome(
        deliveryInput({
          content: 'Run the preview yourself when you are ready.',
          events: okBash('bash-prose', 'echo "next step: preview start then open the URL"'),
        }),
      ),
    ).toBe('report_only');
  });

  it('never labels a turn that delivered work as a retryable delivery failure', () => {
    for (const outcome of [
      // Row 8e3977d6: regenerate an asset, then clear the scratch directory.
      resolveDesignDeliveryOutcome(
        deliveryInput({
          content: 'Regenerated the hero asset.',
          events: okBash(
            'bash-7',
            'magick /tmp/hs-r7/hero.png -quality 92 assets/hero.jpg && rm -rf /tmp/hs-r7',
          ),
          modifiedFileCount: 1,
        }),
      ),
      // Row 9542abf9: no project file changed; the turn cleaned up scratch
      // space and reported what it had already generated.
      resolveDesignDeliveryOutcome(
        deliveryInput({
          content: 'Both looks are on the review page; the scratch copies are gone.',
          events: okBash('bash-8', 'rm -rf /tmp/hs-r3'),
        }),
      ),
    ]) {
      expect(outcome).not.toBe('no_result');
      expect(outcome).not.toBe('delivery_failed');
    }
  });
});
