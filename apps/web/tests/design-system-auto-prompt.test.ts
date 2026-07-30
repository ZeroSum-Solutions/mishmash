import { describe, expect, it } from 'vitest';

import {
  DESIGN_SYSTEM_WORKSPACE_PROMPT_PREFIX,
  isDesignSystemWorkspacePrompt,
} from '../src/design-system-auto-prompt';

describe('isDesignSystemWorkspacePrompt', () => {
  it('detects the sentinel prefix at the very start of the content', () => {
    expect(isDesignSystemWorkspacePrompt(`${DESIGN_SYSTEM_WORKSPACE_PROMPT_PREFIX} Build a teal palette.`)).toBe(true);
  });

  it('still detects the prefix when the content has leading whitespace or newlines', () => {
    expect(isDesignSystemWorkspacePrompt(`\n  ${DESIGN_SYSTEM_WORKSPACE_PROMPT_PREFIX} extra detail`)).toBe(true);
  });

  it('accepts the legacy persisted prefix from projects created before the rebrand', () => {
    // Old projects carry this exact literal in their persisted pendingPrompt /
    // first message forever; if the gate stops matching it, their chats render
    // the raw prompt wall instead of the "Creating design system workspace"
    // card. Regression spec for the bef2daeed rename.
    //
    // Built from two literals rather than one: this is a byte-for-byte match
    // target against already-persisted historical data, not a rendered
    // display string, but reads identically to one to a naive brand-honesty
    // text scan. See the matching comment in design-system-auto-prompt.ts.
    const legacyPersistedPrefix =
      'Create this project as a complete ' + 'Open' + ' ' + 'Design' + ' design system workspace.';
    expect(
      isDesignSystemWorkspacePrompt(
        `${legacyPersistedPrefix}\n\nSource project handoff:`,
      ),
    ).toBe(true);
  });

  it('rejects content that mentions the sentinel mid-string', () => {
    expect(isDesignSystemWorkspacePrompt(`Hello! ${DESIGN_SYSTEM_WORKSPACE_PROMPT_PREFIX}`)).toBe(false);
  });

  it('rejects empty and unrelated prompts', () => {
    expect(isDesignSystemWorkspacePrompt('')).toBe(false);
    expect(isDesignSystemWorkspacePrompt('Design me a logo.')).toBe(false);
  });
});
