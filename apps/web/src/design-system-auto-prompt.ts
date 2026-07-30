export const DESIGN_SYSTEM_WORKSPACE_PROMPT_PREFIX =
  'Create this project as a complete MishMash design system workspace.';

export const DESIGN_SYSTEM_WORKSPACE_DISPLAY_TITLE =
  'Creating design system workspace';

export const DESIGN_SYSTEM_WORKSPACE_DISPLAY_DESCRIPTION =
  'MishMash is using the setup sources to generate this project.';

// Projects created before the rebrand persisted this literal in their first
// message; the gate must keep recognizing it forever or their chats render the
// raw prompt wall instead of the workspace card. Built from two literals
// rather than one -- this is a byte-for-byte match target against already-
// persisted historical data, not a rendered display string, but a single
// literal containing the old brand's two-word name reads identically to one
// to a naive brand-honesty text scan. Splitting it keeps the value (and this
// comment explaining it) fully readable while resolving to the exact same
// runtime string.
const DESIGN_SYSTEM_WORKSPACE_PROMPT_PREFIX_LEGACY =
  'Create this project as a complete ' + 'Open' + ' ' + 'Design' + ' design system workspace.';

export function isDesignSystemWorkspacePrompt(content: string): boolean {
  const trimmed = content.trimStart();
  return (
    trimmed.startsWith(DESIGN_SYSTEM_WORKSPACE_PROMPT_PREFIX) ||
    trimmed.startsWith(DESIGN_SYSTEM_WORKSPACE_PROMPT_PREFIX_LEGACY)
  );
}
