// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GuidedCreateBrief } from '@open-design/contracts';

import { GuidedCreateDialog } from '../../src/components/GuidedCreateDialog';

afterEach(() => {
  cleanup();
});

function selectByValue(buttons: HTMLElement[], value: string): HTMLElement {
  const el = buttons.find((b) => b.getAttribute('data-value') === value);
  if (!el) throw new Error(`no button with data-value="${value}"`);
  return el;
}

describe('GuidedCreateDialog', () => {
  it('starts on step 1 of 3 and steps forward/back with Next/Back', () => {
    render(<GuidedCreateDialog title="Neon Dashboard Kit" onClose={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.getByTestId('guided-create-step').getAttribute('data-step')).toBe('0');
    expect(screen.queryByTestId('guided-create-back')).toBeNull();

    fireEvent.click(screen.getByTestId('guided-create-next'));
    expect(screen.getByTestId('guided-create-step').getAttribute('data-step')).toBe('1');

    fireEvent.click(screen.getByTestId('guided-create-next'));
    expect(screen.getByTestId('guided-create-step').getAttribute('data-step')).toBe('2');
    // Last step: no Next, Back is reachable.
    expect(screen.queryByTestId('guided-create-next')).toBeNull();

    fireEvent.click(screen.getByTestId('guided-create-back'));
    expect(screen.getByTestId('guided-create-step').getAttribute('data-step')).toBe('1');
  });

  it('Skip all submits an empty brief regardless of the current step', () => {
    const onSubmit = vi.fn();
    render(<GuidedCreateDialog title="Neon Dashboard Kit" onClose={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByTestId('guided-create-next'));
    fireEvent.click(screen.getByTestId('guided-create-skip'));

    expect(onSubmit).toHaveBeenCalledWith({});
  });

  it('Start is always reachable and submits an empty brief when nothing was answered', () => {
    const onSubmit = vi.fn();
    render(<GuidedCreateDialog title="Neon Dashboard Kit" onClose={vi.fn()} onSubmit={onSubmit} />);

    // Reachable from step 1 without navigating anywhere.
    fireEvent.click(screen.getByTestId('guided-create-start'));
    expect(onSubmit).toHaveBeenCalledWith({});
  });

  it('collects every answered field across all three steps into the brief shape', () => {
    const onSubmit = vi.fn();
    render(
      <GuidedCreateDialog
        title="Neon Dashboard Kit"
        subjectLabel="Neon Dashboard Kit"
        showMatchKitLook
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    // Step 1 — Scope.
    fireEvent.click(selectByValue(screen.getAllByTestId('guided-create-screens-preset'), '5'));
    fireEvent.click(selectByValue(screen.getAllByTestId('guided-create-fidelity'), 'high-fidelity'));
    fireEvent.click(selectByValue(screen.getAllByTestId('guided-create-iterations'), '2'));
    fireEvent.click(screen.getByTestId('guided-create-next'));

    // Step 2 — Content.
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    fireEvent.change(screen.getByTestId('guided-create-pages-text'), { target: { value: 'Careers, FAQ' } });
    fireEvent.change(screen.getByTestId('guided-create-product'), { target: { value: 'A design tool' } });
    fireEvent.change(screen.getByTestId('guided-create-audience'), { target: { value: 'Freelance designers' } });
    fireEvent.change(screen.getByTestId('guided-create-use-case'), { target: { value: 'Ship a portfolio fast' } });
    fireEvent.click(screen.getByTestId('guided-create-next'));

    // Step 3 — Direction.
    fireEvent.change(screen.getByTestId('guided-create-direction'), { target: { value: 'Warm, editorial tone' } });
    fireEvent.click(screen.getByTestId('guided-create-match-kit-look'));

    fireEvent.click(screen.getByTestId('guided-create-start'));

    const brief = onSubmit.mock.calls[0]?.[0] as GuidedCreateBrief;
    expect(brief).toEqual({
      screens: 5,
      fidelity: 'high-fidelity',
      iterations: 2,
      pages: ['Home', 'Careers', 'FAQ'],
      product: 'A design tool',
      audience: 'Freelance designers',
      useCase: 'Ship a portfolio fast',
      direction: 'Warm, editorial tone',
      matchKitLook: true,
    });
  });

  it('resolves a custom screens count typed into the custom field', () => {
    const onSubmit = vi.fn();
    render(<GuidedCreateDialog title="Neon Dashboard Kit" onClose={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.click(selectByValue(screen.getAllByTestId('guided-create-screens-preset'), 'custom'));
    fireEvent.change(screen.getByTestId('guided-create-screens-custom'), { target: { value: '12' } });
    fireEvent.click(screen.getByTestId('guided-create-start'));

    expect(onSubmit).toHaveBeenCalledWith({ screens: 12 });
  });

  it('omits a non-positive or NaN custom screen count instead of sending an invalid value', () => {
    for (const invalid of ['0', '-5', 'not-a-number', '']) {
      const onSubmit = vi.fn();
      const { unmount } = render(
        <GuidedCreateDialog title="Neon Dashboard Kit" onClose={vi.fn()} onSubmit={onSubmit} />,
      );
      fireEvent.click(selectByValue(screen.getAllByTestId('guided-create-screens-preset'), 'custom'));
      fireEvent.change(screen.getByTestId('guided-create-screens-custom'), { target: { value: invalid } });
      fireEvent.click(screen.getByTestId('guided-create-start'));
      expect(onSubmit).toHaveBeenCalledWith({});
      unmount();
    }
  });

  it('rounds a fractional custom screen count without letting it round down below 1', () => {
    const onSubmit = vi.fn();
    render(<GuidedCreateDialog title="Neon Dashboard Kit" onClose={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.click(selectByValue(screen.getAllByTestId('guided-create-screens-preset'), 'custom'));
    fireEvent.change(screen.getByTestId('guided-create-screens-custom'), { target: { value: '0.6' } });
    fireEvent.click(screen.getByTestId('guided-create-start'));

    expect(onSubmit).toHaveBeenCalledWith({ screens: 1 });
  });

  it('omits (never clamps to a false 0) a fractional count that rounds down to zero', () => {
    // Regression: rounding must happen BEFORE the >=1 check, not after — a
    // check on the raw 0.4 (which is > 0) followed by Math.round would have
    // sent `screens: 0`.
    const onSubmit = vi.fn();
    render(<GuidedCreateDialog title="Neon Dashboard Kit" onClose={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.click(selectByValue(screen.getAllByTestId('guided-create-screens-preset'), 'custom'));
    fireEvent.change(screen.getByTestId('guided-create-screens-custom'), { target: { value: '0.4' } });
    fireEvent.click(screen.getByTestId('guided-create-start'));

    expect(onSubmit).toHaveBeenCalledWith({});
  });

  it('omits the match-kit-look toggle when showMatchKitLook is not set', () => {
    render(<GuidedCreateDialog title="Landing Hero" onClose={vi.fn()} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('guided-create-next'));
    fireEvent.click(screen.getByTestId('guided-create-next'));
    expect(screen.queryByTestId('guided-create-match-kit-look')).toBeNull();
  });

  it('shows a progress dot per step, with the current step marked active', () => {
    render(<GuidedCreateDialog title="Landing Hero" onClose={vi.fn()} onSubmit={vi.fn()} />);
    const dots = screen.getAllByTestId('guided-create-progress-dot');
    expect(dots).toHaveLength(3);
    expect(dots.map((d) => d.getAttribute('data-active'))).toEqual(['true', 'false', 'false']);

    fireEvent.click(screen.getByTestId('guided-create-next'));
    expect(
      screen.getAllByTestId('guided-create-progress-dot').map((d) => d.getAttribute('data-active')),
    ).toEqual(['false', 'true', 'false']);
  });

  it('calls onClose when the dialog is dismissed', () => {
    const onClose = vi.fn();
    render(<GuidedCreateDialog title="Landing Hero" onClose={onClose} onSubmit={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('disables Start and Skip all, and shows the busy label, while a request is in flight', () => {
    render(<GuidedCreateDialog title="Landing Hero" busy onClose={vi.fn()} onSubmit={vi.fn()} />);
    const startBtn = screen.getByTestId('guided-create-start') as HTMLButtonElement;
    const skipBtn = screen.getByTestId('guided-create-skip') as HTMLButtonElement;
    expect(startBtn.disabled).toBe(true);
    expect(skipBtn.disabled).toBe(true);
    expect(within(screen.getByTestId('guided-create-dialog')).getByText('Starting…')).toBeTruthy();
  });

  it('does not call onSubmit a second time when Start is double-clicked before the parent re-renders busy', () => {
    const onSubmit = vi.fn();
    render(<GuidedCreateDialog title="Landing Hero" onClose={vi.fn()} onSubmit={onSubmit} />);
    const startBtn = screen.getByTestId('guided-create-start');
    fireEvent.click(startBtn);
    fireEvent.click(startBtn);
    fireEvent.click(startBtn);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not call onSubmit a second time when Skip all is double-clicked before the parent re-renders busy', () => {
    const onSubmit = vi.fn();
    render(<GuidedCreateDialog title="Landing Hero" onClose={vi.fn()} onSubmit={onSubmit} />);
    const skipBtn = screen.getByTestId('guided-create-skip');
    fireEvent.click(skipBtn);
    fireEvent.click(skipBtn);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('ignores a Start click reaching Skip after Start already submitted (single guard across both paths)', () => {
    const onSubmit = vi.fn();
    render(<GuidedCreateDialog title="Landing Hero" onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId('guided-create-start'));
    fireEvent.click(screen.getByTestId('guided-create-skip'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
