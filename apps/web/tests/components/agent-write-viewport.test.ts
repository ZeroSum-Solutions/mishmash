import { describe, expect, it } from 'vitest';

import { agentWriteMayFocusFile } from '../../src/components/agent-write-viewport';

describe('agentWriteMayFocusFile', () => {
  it('lets the first generation open its page when nothing is on screen yet', () => {
    expect(agentWriteMayFocusFile(null, 'index.html')).toBe(true);
    expect(agentWriteMayFocusFile(undefined, 'index.html')).toBe(true);
    expect(agentWriteMayFocusFile('', 'index.html')).toBe(true);
  });

  it('refuses to move a user who is already looking at another file', () => {
    expect(agentWriteMayFocusFile('gallery.html', 'brand-spec.md')).toBe(false);
  });

  it('refuses to move a user off a non-file workspace tab', () => {
    expect(agentWriteMayFocusFile('__design_files__', 'brand-spec.md')).toBe(false);
    expect(agentWriteMayFocusFile('__design_system__', 'brand-spec.md')).toBe(false);
  });

  it('allows a re-focus of the file the user is already on', () => {
    expect(agentWriteMayFocusFile('index.html', 'index.html')).toBe(true);
  });
});
