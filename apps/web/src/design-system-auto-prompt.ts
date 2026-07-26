export const DESIGN_SYSTEM_WORKSPACE_PROMPT_PREFIX =
  'Create this project as a complete MishMash design system workspace.';

export const DESIGN_SYSTEM_WORKSPACE_DISPLAY_TITLE =
  'Creating design system workspace';

export const DESIGN_SYSTEM_WORKSPACE_DISPLAY_DESCRIPTION =
  'MishMash is using the setup sources to generate this project.';

// Projects created before the rebrand persisted this literal in their first
// message; the gate must keep recognizing it forever or their chats render the
// raw prompt wall instead of the workspace card.
const DESIGN_SYSTEM_WORKSPACE_PROMPT_PREFIX_LEGACY =
  'Create this project as a complete Open Design design system workspace.';

export function isDesignSystemWorkspacePrompt(content: string): boolean {
  const trimmed = content.trimStart();
  return (
    trimmed.startsWith(DESIGN_SYSTEM_WORKSPACE_PROMPT_PREFIX) ||
    trimmed.startsWith(DESIGN_SYSTEM_WORKSPACE_PROMPT_PREFIX_LEGACY)
  );
}
