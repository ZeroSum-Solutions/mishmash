// @vitest-environment jsdom
//
// PRD C4 outcome 2: "template/empty-state entry point... create from
// template / from brief / blank". The "blank" path is StoryboardEditor's own
// pre-existing addShot/add-shots-from-images controls (unchanged, passed in
// as children) — this file only covers the two NEW paths ShotStartOptions
// itself owns.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShotStartOptions } from '../../src/components/storyboard/ShotStartOptions';

afterEach(() => {
  cleanup();
});

describe('ShotStartOptions', () => {
  it('calls onSelectTemplate with the preset motion prompt when a template tile is clicked', () => {
    const onSelectTemplate = vi.fn();
    render(<ShotStartOptions onSelectTemplate={onSelectTemplate} onCreateFromBrief={vi.fn()} />);
    fireEvent.click(screen.getByTestId('shot-template-pan-left'));
    expect(onSelectTemplate).toHaveBeenCalledTimes(1);
    expect(onSelectTemplate.mock.calls[0]![0]).toEqual(expect.stringContaining('pans left'));
  });

  it('calls onCreateFromBrief with the typed brief and clears the textarea', () => {
    const onCreateFromBrief = vi.fn();
    render(<ShotStartOptions onSelectTemplate={vi.fn()} onCreateFromBrief={onCreateFromBrief} />);
    const textarea = screen.getByTestId('shot-brief-input') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'a product hero shot that slowly rotates' } });
    fireEvent.click(screen.getByTestId('shot-brief-submit'));
    expect(onCreateFromBrief).toHaveBeenCalledWith('a product hero shot that slowly rotates');
    expect(textarea.value).toBe('');
  });

  it('disables the brief submit button until non-whitespace text is entered', () => {
    render(<ShotStartOptions onSelectTemplate={vi.fn()} onCreateFromBrief={vi.fn()} />);
    const submit = screen.getByTestId('shot-brief-submit');
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId('shot-brief-input'), { target: { value: '   ' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId('shot-brief-input'), { target: { value: 'ok' } });
    expect(submit).not.toBeDisabled();
  });

  // React review R1: the brief Textarea had no accessible name at all.
  it('gives the brief Textarea an accessible name via aria-labelledby (react review R1)', () => {
    render(<ShotStartOptions onSelectTemplate={vi.fn()} onCreateFromBrief={vi.fn()} />);
    const textarea = screen.getByTestId('shot-brief-input');
    const labelledBy = textarea.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe('Start from a brief');
    expect(screen.getByRole('textbox', { name: 'Start from a brief' })).toBe(textarea);
  });

  it('renders the blank/children column only when children are passed', () => {
    const { rerender } = render(<ShotStartOptions onSelectTemplate={vi.fn()} onCreateFromBrief={vi.fn()} />);
    expect(screen.queryByText('Start blank')).toBeNull();

    rerender(
      <ShotStartOptions onSelectTemplate={vi.fn()} onCreateFromBrief={vi.fn()}>
        <button type="button">blank control</button>
      </ShotStartOptions>,
    );
    expect(screen.getByText('Start blank')).toBeTruthy();
    expect(screen.getByText('blank control')).toBeTruthy();
  });
});
