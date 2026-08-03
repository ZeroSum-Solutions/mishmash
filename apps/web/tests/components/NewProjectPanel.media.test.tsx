// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewProjectPanel } from '../../src/components/NewProjectPanel';

describe('NewProjectPanel media provider badges', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
      unobserve() {}
    });
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('treats daemon-restored apiKeyConfigured providers as configured', () => {
    render(
      <NewProjectPanel
        skills={[]}
        designSystems={[]}
        defaultDesignSystemId={null}
        templates={[]}
        onDeleteTemplate={vi.fn()}
        promptTemplates={[]}
        onCreate={vi.fn()}
        mediaProviders={{
          openai: {
            apiKey: '',
            apiKeyConfigured: true,
            apiKeyTail: '1234',
            baseUrl: '',
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Media' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Image' }));
    // Model picker is now a combobox — open the popover so the
    // provider group + status badge become visible in the DOM.
    fireEvent.click(screen.getByTestId('model-picker-trigger'));

    const openaiGroup = screen.getByText('OpenAI').closest('.ds-picker-group');
    expect(openaiGroup?.textContent).toContain('Configured');
    expect(openaiGroup?.textContent).not.toContain('Integrated');
  });

  // BUG-3 changed the listing rule: an integrated provider without usable
  // credentials stays VISIBLE, badged "Needs API key", instead of vanishing.
  // What must still hold is that it never reads as configured and never wins
  // the automatic default (covered by the Codex fallback spec below).
  it('lists a keyless provider with a Needs API key badge instead of hiding it', () => {
    render(
      <NewProjectPanel
        skills={[]}
        designSystems={[]}
        defaultDesignSystemId={null}
        templates={[]}
        onDeleteTemplate={vi.fn()}
        promptTemplates={[]}
        onCreate={vi.fn()}
        mediaProviders={{}}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Media' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Image' }));
    fireEvent.click(screen.getByTestId('model-picker-trigger'));

    const openaiGroup = screen.getByText('OpenAI').closest('.ds-picker-group');
    expect(openaiGroup?.textContent).toContain('Needs API key');
    expect(openaiGroup?.textContent).not.toContain('Configured');
    expect(screen.getByTestId('model-picker-option-gpt-image-2')).toBeTruthy();
  });

  it('shows Codex subscription image models without media API credentials', () => {
    render(
      <NewProjectPanel
        skills={[]}
        designSystems={[]}
        defaultDesignSystemId={null}
        templates={[]}
        onDeleteTemplate={vi.fn()}
        promptTemplates={[]}
        onCreate={vi.fn()}
        mediaProviders={{}}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Media' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Image' }));
    fireEvent.click(screen.getByTestId('model-picker-trigger'));

    const codexGroup = screen.getByText('Codex Subscription').closest('.ds-picker-group');
    // credentialsRequired: false — must NOT be badged "Needs API key".
    expect(codexGroup?.textContent).toContain('No key needed');
    expect(screen.getByTestId('model-picker-option-codex-gpt-image-2')).toBeTruthy();
  });

  it('uses Codex subscription as the no-key image fallback', async () => {
    const onCreate = vi.fn();
    render(
      <NewProjectPanel
        skills={[]}
        designSystems={[]}
        defaultDesignSystemId={null}
        templates={[]}
        onDeleteTemplate={vi.fn()}
        promptTemplates={[]}
        onCreate={onCreate}
        mediaProviders={{}}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Media' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Image' }));
    await waitFor(() => {
      expect(screen.getByTestId('model-picker-trigger').textContent).toContain('gpt-image-2 (Codex)');
    });
    fireEvent.change(screen.getByTestId('new-project-name'), {
      target: { value: 'Codex fallback image' },
    });
    fireEvent.click(screen.getByTestId('create-project'));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          kind: 'image',
          imageModel: 'codex-gpt-image-2',
          imageAspect: '1:1',
        }),
      }),
    );
  });

  it('does not treat OpenAI OAuth-only markers as usable image credentials', () => {
    render(
      <NewProjectPanel
        skills={[]}
        designSystems={[]}
        defaultDesignSystemId={null}
        templates={[]}
        onDeleteTemplate={vi.fn()}
        promptTemplates={[]}
        onCreate={vi.fn()}
        mediaProviders={{
          // 'codex-auth' is the real source string
          // resolveOpenAIAuthFileCredential (apps/daemon/src/media/config.ts)
          // emits for a borrowed Codex auth-file token that isn't proof the
          // Images API can be called.
          openai: {
            apiKey: '',
            apiKeyConfigured: true,
            apiKeyTail: '',
            source: 'codex-auth',
            baseUrl: '',
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Media' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Image' }));
    fireEvent.click(screen.getByTestId('model-picker-trigger'));

    // The invariant: a borrowed codex-auth token is not proof the Images API
    // can be called, so OpenAI must not read as configured. Post-BUG-3 the
    // group is listed (that's the new rule) — badged as still needing a key.
    const openaiGroup = screen.getByText('OpenAI').closest('.ds-picker-group');
    expect(openaiGroup?.textContent).toContain('Needs API key');
    expect(openaiGroup?.textContent).not.toContain('Configured');
  });

  it('keeps a model the user picked by hand even when its provider has no key', async () => {
    // The auto-default steers an *unpicked* not-ready selection onto a ready
    // model — but an explicit pick must stick: the user may be about to go
    // configure that provider. Regression guard on the userPickedRef branch.
    render(
      <NewProjectPanel
        skills={[]}
        designSystems={[]}
        defaultDesignSystemId={null}
        templates={[]}
        onDeleteTemplate={vi.fn()}
        promptTemplates={[]}
        onCreate={vi.fn()}
        mediaProviders={{}}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Media' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Image' }));
    // Auto-default settles on the no-key Codex lane first.
    await waitFor(() => {
      expect(screen.getByTestId('model-picker-trigger').textContent).toContain('gpt-image-2 (Codex)');
    });
    // Hand-pick a keyless OpenAI model from the popover.
    fireEvent.click(screen.getByTestId('model-picker-trigger'));
    fireEvent.click(screen.getByTestId('model-picker-option-gpt-image-2'));
    // The effect must not steer the selection back to a ready model.
    await waitFor(() => {
      expect(screen.getByTestId('model-picker-trigger').textContent).toContain('gpt-image-2');
      expect(screen.getByTestId('model-picker-trigger').textContent).not.toContain('(Codex)');
    });
  });

  // BUG-3 follow-up: the video allowlist (volcengine/hyperframes/grok/
  // openrouter/imagerouter/aihubmix) that used to hide kie/higgsfield/fal/
  // sdcpp/leonardo models is gone — supportedModels() now trusts the
  // catalog's own integrated flag. This is a regression guard on that,
  // pinned to the exact model the QA report named as missing.
  it('lists a kie video model even though it is absent from the old hardcoded surface allowlist', () => {
    render(
      <NewProjectPanel
        skills={[]}
        designSystems={[]}
        defaultDesignSystemId={null}
        templates={[]}
        onDeleteTemplate={vi.fn()}
        promptTemplates={[]}
        onCreate={vi.fn()}
        mediaProviders={{}}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Media' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Video' }));
    fireEvent.click(screen.getByTestId('model-picker-trigger'));

    expect(screen.getByTestId('model-picker-option-bytedance/seedance-2')).toBeTruthy();
  });

  // The product decision on BUG-3: unify on the storyboard shot/mood
  // pickers' own idiom for an integrated-but-unconfigured model — append
  // the shared `storyboard.needsApiKey` hint to the model's label instead
  // of only badging the provider group. Red on main (the option only ever
  // rendered model.label), green once MediaModelCards' option row also
  // checks group.ready.
  it('annotates an unconfigured provider\'s model option with the storyboard "(needs API key)" hint', () => {
    render(
      <NewProjectPanel
        skills={[]}
        designSystems={[]}
        defaultDesignSystemId={null}
        templates={[]}
        onDeleteTemplate={vi.fn()}
        promptTemplates={[]}
        onCreate={vi.fn()}
        mediaProviders={{}}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Media' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Video' }));
    fireEvent.click(screen.getByTestId('model-picker-trigger'));

    const option = screen.getByTestId('model-picker-option-bytedance/seedance-2');
    expect(option.textContent).toContain('(needs API key)');
  });

  it('omits the "(needs API key)" hint from a model option once its provider is configured', () => {
    render(
      <NewProjectPanel
        skills={[]}
        designSystems={[]}
        defaultDesignSystemId={null}
        templates={[]}
        onDeleteTemplate={vi.fn()}
        promptTemplates={[]}
        onCreate={vi.fn()}
        mediaProviders={{
          kie: {
            apiKey: '',
            apiKeyConfigured: true,
            apiKeyTail: '9012',
            baseUrl: '',
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Media' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Video' }));
    fireEvent.click(screen.getByTestId('model-picker-trigger'));

    const option = screen.getByTestId('model-picker-option-bytedance/seedance-2');
    expect(option.textContent).not.toContain('(needs API key)');
  });

  it('switches away from the default OpenAI model when only another provider is configured', () => {
    const onCreate = vi.fn();
    render(
      <NewProjectPanel
        skills={[]}
        designSystems={[]}
        defaultDesignSystemId={null}
        templates={[]}
        onDeleteTemplate={vi.fn()}
        promptTemplates={[]}
        onCreate={onCreate}
        mediaProviders={{
          volcengine: {
            apiKey: '',
            apiKeyConfigured: true,
            apiKeyTail: '5678',
            baseUrl: '',
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Media' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Image' }));
    fireEvent.change(screen.getByTestId('new-project-name'), {
      target: { value: 'Configured provider image' },
    });
    fireEvent.click(screen.getByTestId('create-project'));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          imageModel: 'doubao-seedream-3-0-t2i-250415',
        }),
      }),
    );
  });
});
