// @vitest-environment jsdom
//
// PRD C4 outcome 2: "template/empty-state entry point... create from
// template / from brief / blank". The "blank" path is StoryboardEditor's own
// pre-existing addShot/add-shots-from-images controls (unchanged, passed in
// as children) — this file only covers the two NEW paths ShotStartOptions
// itself owns.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShotStartOptions } from '../../src/components/storyboard/ShotStartOptions';

afterEach(() => {
  cleanup();
});

describe('ShotStartOptions', () => {
  it('calls onSelectTemplate with the preset motion prompt when a template tile is clicked', () => {
    const onSelectTemplate = vi.fn();
    render(<ShotStartOptions onSelectTemplate={onSelectTemplate} onCreateFromBrief={vi.fn()} onDraftStoryboard={vi.fn()} />);
    fireEvent.click(screen.getByTestId('shot-template-pan-left'));
    expect(onSelectTemplate).toHaveBeenCalledTimes(1);
    expect(onSelectTemplate.mock.calls[0]![0]).toEqual(expect.stringContaining('pans left'));
  });

  it('calls onCreateFromBrief with the typed brief and clears the textarea', () => {
    const onCreateFromBrief = vi.fn();
    render(<ShotStartOptions onSelectTemplate={vi.fn()} onCreateFromBrief={onCreateFromBrief} onDraftStoryboard={vi.fn()} />);
    const textarea = screen.getByTestId('shot-brief-input') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'a product hero shot that slowly rotates' } });
    fireEvent.click(screen.getByTestId('shot-brief-submit'));
    expect(onCreateFromBrief).toHaveBeenCalledWith('a product hero shot that slowly rotates');
    expect(textarea.value).toBe('');
  });

  it('disables the brief submit button until non-whitespace text is entered', () => {
    render(<ShotStartOptions onSelectTemplate={vi.fn()} onCreateFromBrief={vi.fn()} onDraftStoryboard={vi.fn()} />);
    const submit = screen.getByTestId('shot-brief-submit');
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId('shot-brief-input'), { target: { value: '   ' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId('shot-brief-input'), { target: { value: 'ok' } });
    expect(submit).not.toBeDisabled();
  });

  // React review R1: the brief Textarea had no accessible name at all.
  it('gives the brief Textarea an accessible name via aria-labelledby (react review R1)', () => {
    render(<ShotStartOptions onSelectTemplate={vi.fn()} onCreateFromBrief={vi.fn()} onDraftStoryboard={vi.fn()} />);
    const textarea = screen.getByTestId('shot-brief-input');
    const labelledBy = textarea.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe('Start from a brief');
    expect(screen.getByRole('textbox', { name: 'Start from a brief' })).toBe(textarea);
  });

  it('renders the blank/children column only when children are passed', () => {
    const { rerender } = render(<ShotStartOptions onSelectTemplate={vi.fn()} onCreateFromBrief={vi.fn()} onDraftStoryboard={vi.fn()} />);
    expect(screen.queryByText('Start blank')).toBeNull();

    rerender(
      <ShotStartOptions onSelectTemplate={vi.fn()} onCreateFromBrief={vi.fn()} onDraftStoryboard={vi.fn()}>
        <button type="button">blank control</button>
      </ShotStartOptions>,
    );
    expect(screen.getByText('Start blank')).toBeTruthy();
    expect(screen.getByText('blank control')).toBeTruthy();
  });

  // FIX 1: onDraftStoryboard now returns a Promise<boolean> (true on
  // success) so the component only clears the brief once the daemon call
  // actually succeeded — see the "survives a failed draft" test below for
  // the failure half.
  it('calls onDraftStoryboard with the typed brief and the default shot count, and clears the textarea once it resolves true', async () => {
    const onDraftStoryboard = vi.fn().mockResolvedValue(true);
    render(<ShotStartOptions onSelectTemplate={vi.fn()} onCreateFromBrief={vi.fn()} onDraftStoryboard={onDraftStoryboard} />);
    const textarea = screen.getByTestId('shot-brief-input') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'a 4-shot product launch teaser' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('shot-draft-submit'));
    });
    expect(onDraftStoryboard).toHaveBeenCalledWith('a 4-shot product launch teaser', 4);
    expect(textarea.value).toBe('');
  });

  // FIX 1 (HIGH): the user's typed brief must survive a failed draft call —
  // previously setBrief('') ran synchronously on click, before the async
  // daemon call resolved, so a NO_TEXT_PROVIDER/UPSTREAM_UNAVAILABLE/409/
  // network error wiped up to 4000 chars AND left the submit button
  // disabled (empty field), with no way to retry.
  it('keeps the typed brief in the textarea (and the submit button enabled) when the draft call fails', async () => {
    const onDraftStoryboard = vi.fn().mockResolvedValue(false);
    render(
      <ShotStartOptions
        onSelectTemplate={vi.fn()}
        onCreateFromBrief={vi.fn()}
        onDraftStoryboard={onDraftStoryboard}
        draftError="Add a text-capable provider under Settings to draft a storyboard."
      />,
    );
    const textarea = screen.getByTestId('shot-brief-input') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'a product hero shot that slowly rotates' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('shot-draft-submit'));
    });
    expect(onDraftStoryboard).toHaveBeenCalledWith('a product hero shot that slowly rotates', 4);
    expect(textarea.value).toBe('a product hero shot that slowly rotates');
    expect(screen.getByTestId('shot-draft-submit')).not.toBeDisabled();
  });

  it('sends an updated shot count when the count input is changed before submitting', () => {
    const onDraftStoryboard = vi.fn();
    render(<ShotStartOptions onSelectTemplate={vi.fn()} onCreateFromBrief={vi.fn()} onDraftStoryboard={onDraftStoryboard} />);
    fireEvent.change(screen.getByTestId('shot-brief-input'), { target: { value: 'a travel montage' } });
    fireEvent.change(screen.getByTestId('shot-draft-count'), { target: { value: '8' } });
    fireEvent.click(screen.getByTestId('shot-draft-submit'));
    expect(onDraftStoryboard).toHaveBeenCalledWith('a travel montage', 8);
  });

  it('clamps the shot count field to the allowed min/max range (1-12)', () => {
    render(<ShotStartOptions onSelectTemplate={vi.fn()} onCreateFromBrief={vi.fn()} onDraftStoryboard={vi.fn()} />);
    const countInput = screen.getByTestId('shot-draft-count') as HTMLInputElement;
    fireEvent.change(countInput, { target: { value: '99' } });
    expect(countInput.value).toBe('12');
    fireEvent.change(countInput, { target: { value: '0' } });
    expect(countInput.value).toBe('1');
  });

  it('disables the draft submit button until non-whitespace brief text is entered', () => {
    render(<ShotStartOptions onSelectTemplate={vi.fn()} onCreateFromBrief={vi.fn()} onDraftStoryboard={vi.fn()} />);
    const submit = screen.getByTestId('shot-draft-submit');
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId('shot-brief-input'), { target: { value: '   ' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId('shot-brief-input'), { target: { value: 'ok' } });
    expect(submit).not.toBeDisabled();
  });

  it('shows a busy label and disables the draft submit button while draftBusy is true', () => {
    render(
      <ShotStartOptions
        onSelectTemplate={vi.fn()}
        onCreateFromBrief={vi.fn()}
        onDraftStoryboard={vi.fn()}
        draftBusy
      />,
    );
    fireEvent.change(screen.getByTestId('shot-brief-input'), { target: { value: 'a travel montage' } });
    const submit = screen.getByTestId('shot-draft-submit');
    expect(submit).toBeDisabled();
    expect(submit).toHaveTextContent('Drafting…');
  });

  // FIX 2 (CRITICAL, client half): the "Create shot" button and the
  // template tiles both mutate the same storyboard as an in-flight draft
  // (POST .../draft-shots). Previously only `!brief.trim()` gated
  // shot-brief-submit, so a click mid-draft raced the draft response and
  // silently dropped the shot the user just added.
  it('disables the single-shot brief button and the template tiles while a draft is in flight (FIX 2)', () => {
    render(
      <ShotStartOptions
        onSelectTemplate={vi.fn()}
        onCreateFromBrief={vi.fn()}
        onDraftStoryboard={vi.fn()}
        draftBusy
      />,
    );
    fireEvent.change(screen.getByTestId('shot-brief-input'), { target: { value: 'a travel montage' } });
    expect(screen.getByTestId('shot-brief-submit')).toBeDisabled();
    expect(screen.getByTestId('shot-template-pan-left')).toBeDisabled();
    expect(screen.getByTestId('shot-template-slow-zoom-in')).toBeDisabled();
  });

  it('leaves the single-shot brief button and the template tiles enabled when no draft is in flight', () => {
    render(<ShotStartOptions onSelectTemplate={vi.fn()} onCreateFromBrief={vi.fn()} onDraftStoryboard={vi.fn()} />);
    fireEvent.change(screen.getByTestId('shot-brief-input'), { target: { value: 'a travel montage' } });
    expect(screen.getByTestId('shot-brief-submit')).not.toBeDisabled();
    expect(screen.getByTestId('shot-template-pan-left')).not.toBeDisabled();
  });

  it('renders draftError text when present, e.g. the NO_TEXT_PROVIDER message', () => {
    render(
      <ShotStartOptions
        onSelectTemplate={vi.fn()}
        onCreateFromBrief={vi.fn()}
        onDraftStoryboard={vi.fn()}
        draftError="Add a text-capable provider under Settings to draft a storyboard."
      />,
    );
    expect(screen.getByText('Add a text-capable provider under Settings to draft a storyboard.')).toBeTruthy();
  });

  // FIX 4 (MEDIUM): draftError rendered with no role at all, so a screen
  // reader user never learned the draft failed. Match BrandReferencePicker's
  // established pattern (role="alert" for errors, role="status" for status).
  it('gives the draft error role="alert" so it is announced to screen readers (FIX 4)', () => {
    render(
      <ShotStartOptions
        onSelectTemplate={vi.fn()}
        onCreateFromBrief={vi.fn()}
        onDraftStoryboard={vi.fn()}
        draftError="Add a text-capable provider under Settings to draft a storyboard."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Add a text-capable provider under Settings to draft a storyboard.',
    );
  });

  it('conveys the busy state accessibly via aria-busy and a role="status" message (FIX 4)', () => {
    render(
      <ShotStartOptions
        onSelectTemplate={vi.fn()}
        onCreateFromBrief={vi.fn()}
        onDraftStoryboard={vi.fn()}
        draftBusy
      />,
    );
    expect(screen.getByTestId('shot-draft-submit')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Drafting…');
  });
});
