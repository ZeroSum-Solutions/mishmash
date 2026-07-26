// @vitest-environment jsdom
//
// Regression: `pickChip()`'s apply-scenario / apply-figma-migration branch
// looks up the clicked chip's bound plugin in `plugins` without first
// checking `pluginsLoading`, unlike its sibling guards at ~1182, ~1643, and
// ~1830 in HomeView.tsx (`if (... || pluginsLoading) return;`). While the
// plugin list is still loading, `plugins` is `[]`, so any plugin-bound chip
// click incorrectly surfaced "Bundled scenario ... is not installed.
// Reinstall the daemon to restore the default plugin set." even though the
// plugin is genuinely installed and the list simply hasn't loaded yet
// (reproduced for real when the daemon was briefly slow to answer
// `/api/plugins`).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import { HomeView } from '../../src/components/HomeView';
import { I18nProvider } from '../../src/i18n';
import { writeHomeGuideStage } from '../../src/components/home-hero/firstRunGuide';

function stubPluginsPending() {
  // `/api/plugins` never resolves during the test, so `pluginsLoading` stays
  // true and `plugins` stays `[]` for the whole test — the exact "still
  // loading" state the bug mishandles.
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href === '/api/plugins') {
        return new Promise<Response>(() => {});
      }
      return Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
}

function renderHome() {
  return render(
    <I18nProvider initial="en">
      <HomeView
        projects={[]}
        onSubmit={() => undefined}
        onOpenProject={() => undefined}
        onViewAllProjects={() => undefined}
      />
    </I18nProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  window.localStorage.clear();
});

// The rail correctly disables `home-hero-rail-prototype` while
// `pluginsLoading` is true (see HomeHero.tsx `RailGroup`), and a real
// `<button disabled>` never receives a `click` in any browser — so a real
// user cannot reach `pickChip` through this control during the loading
// window. That disabling is a separate, already-correct concern from
// `pickChip` itself: the file's own sibling guards at ~1182/1643/1830 defend
// the *shared handler*, not any one button, precisely because nothing
// guarantees every future or alternate caller will route through a
// disabled control first. This helper invokes the exact `onClick` handler
// React attached to the button for this render — the same closure a real
// click would call — bypassing only the native `disabled` short-circuit, so
// the test proves `pickChip`'s own logic (not the rail's disabling) ignores
// a still-loading plugin list.
function clickThroughDisabledRail(el: HTMLButtonElement) {
  const propsKey = Object.keys(el).find((key) => key.startsWith('__reactProps$'));
  if (!propsKey) throw new Error('Expected React to attach fiber props to the rail button.');
  const props = (el as unknown as Record<string, { onClick: (event: unknown) => void }>)[propsKey];
  if (!props) throw new Error('Expected fiber props to be present under the found key.');
  act(() => {
    props.onClick({ preventDefault() {}, stopPropagation() {} });
  });
}

describe('HomeView pickChip plugins-loading guard', () => {
  it('does not surface the "not installed" error when plugins are still loading', async () => {
    writeHomeGuideStage('done');
    stubPluginsPending();
    renderHome();

    const prototypeChip = await screen.findByTestId<HTMLButtonElement>('home-hero-rail-prototype');
    expect(prototypeChip.disabled).toBe(true);

    clickThroughDisabledRail(prototypeChip);

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
