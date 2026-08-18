import { describe, expect, it } from 'vitest';

import {
  mergeRunContextSelections,
  normalizeRunContextSelection,
  normalizeWorkspaceContextItems,
  projectMetadataContextSelection,
  renderRunContextPrompt,
} from '../../src/runtimes/chat-run-context.js';

describe('chat run context helpers', () => {
  it('normalizes workspace context items and dedupes by kind/id', () => {
    expect(normalizeWorkspaceContextItems([
      { kind: 'browser', id: ' tab-1 ', label: ' Docs ', url: ' https://example.com/docs ' },
      { kind: 'browser', id: 'tab-1', label: 'Duplicate' },
      { kind: 'unknown', id: 'x', label: 'Ignored' },
      { kind: 'file', id: 'file-1', label: 'App', path: 'src/app.ts' },
      null,
    ])).toEqual([
      {
        kind: 'browser',
        id: 'tab-1',
        label: 'Docs',
        url: 'https://example.com/docs',
      },
      {
        kind: 'file',
        id: 'file-1',
        label: 'App',
        path: 'src/app.ts',
      },
    ]);
  });

  it('merges project metadata context before per-run context without duplicate ids', () => {
    expect(mergeRunContextSelections(
      { pluginIds: ['brand-kit'], connectorIds: ['figma'] },
      { pluginIds: ['brand-kit', 'motion'], mcpServerIds: ['browser'] },
    )).toEqual({
      pluginIds: ['brand-kit', 'motion'],
      mcpServerIds: ['browser'],
      connectorIds: ['figma'],
    });
  });

  it('renders selected workspace and connector context for the agent prompt', () => {
    const prompt = renderRunContextPrompt(
      {
        workspaceItems: [
          {
            kind: 'terminal',
            id: 'term-1',
            label: 'Dev server',
            tabId: 'terminal-tab',
          },
        ],
        connectorIds: ['figma'],
      },
      {
        contextConnectors: [
          {
            id: 'figma',
            name: 'Figma',
            provider: 'figma',
            status: 'connected',
          },
        ],
      },
    );

    expect(prompt).toContain('## Selected run context');
    expect(prompt).toContain('terminal: Dev server (`term-1`)');
    expect(prompt).toContain('Selected connectors');
    expect(prompt).toContain('- Figma (`figma`)');
  });
});

// connector-mention-context: proves the @-mention -> per-turn context pipeline
// for connectors specifically (insertConnectorMention in ChatComposer.tsx
// stages a connector, currentRunContextMeta() serializes it into
// connectorIds, and this module renders it into the agent prompt). The web
// side is covered separately in
// apps/web/tests/components/ChatComposer.context-pickers.test.tsx.
describe('connector-mention-context', () => {
  it('normalizeRunContextSelection dedupes connector ids and drops blank/non-string entries', () => {
    expect(
      normalizeRunContextSelection({
        connectorIds: [' figma ', 'figma', '', '   ', 42, null, 'slack'],
      }),
    ).toEqual({
      skillIds: [],
      pluginIds: [],
      mcpServerIds: [],
      connectorIds: ['figma', 'slack'],
      workspaceItems: [],
    });
  });

  it('mergeRunContextSelections unions connector ids across sources without duplicating the id already selected', () => {
    expect(
      mergeRunContextSelections(
        { connectorIds: ['figma'] },
        { connectorIds: ['figma', 'slack'] },
        { connectorIds: ['notion'] },
      ),
    ).toEqual({ connectorIds: ['figma', 'slack', 'notion'] });
  });

  it('projectMetadataContextSelection reads connector ids from contextConnectors refs and ignores malformed entries', () => {
    expect(
      projectMetadataContextSelection({
        contextConnectors: [
          { id: 'figma', name: 'Figma' },
          { name: 'no id, skipped' },
          'a bare string, skipped',
          null,
          { id: 42, name: 'non-string id, skipped' },
        ],
      }),
    ).toEqual({
      pluginIds: [],
      mcpServerIds: [],
      connectorIds: ['figma'],
    });
  });

  it('renders a selected connector by raw id when no matching metadata ref is present (unresolved/invalid selection degrades gracefully, it does not throw or drop the section)', () => {
    const prompt = renderRunContextPrompt({ connectorIds: ['ghost-connector'] }, {});

    expect(prompt).toContain('### Selected connectors');
    // No `contextConnectors` ref for this id, so the raw id is used as the
    // label and no ` — provider · status` suffix is appended.
    expect(prompt).toContain('- ghost-connector (`ghost-connector`)');
    expect(prompt).not.toContain(' — ');
  });

  it('renders the provider/status/accountLabel suffix only for the fields that are actually present on the ref', () => {
    const prompt = renderRunContextPrompt(
      { connectorIds: ['figma', 'slack'] },
      {
        contextConnectors: [
          { id: 'figma', name: 'Figma', provider: 'figma', status: 'connected' },
          // slack ref has no provider/status/accountLabel at all.
          { id: 'slack', name: 'Slack' },
        ],
      },
    );

    expect(prompt).toContain('- Figma (`figma`) — figma · connected');
    expect(prompt).toContain('- Slack (`slack`)');
    expect(prompt).not.toContain('Slack (`slack`) —');
  });

  it('omits the "Selected connectors" section entirely when connectorIds is empty, even with other context present', () => {
    const prompt = renderRunContextPrompt(
      { mcpServerIds: ['browser'] },
      { contextMcpServers: [{ id: 'browser', label: 'Browser' }] },
    );

    expect(prompt).toContain('### Selected MCP servers');
    expect(prompt).not.toContain('Selected connectors');
  });
});

// project-reference-context: proves the persisted-reference -> every-turn
// prompt pipeline for B2-borrow's "reference another project + say what I
// want from it" capability. POST /api/projects/:id/reference (UI and `od
// project reference` both call it) writes metadata.projectReferences;
// projectMetadataContextSelection folds those into workspaceItems on every
// turn — not only the turn the reference was staged on — the same way
// contextPlugins/etc. already do above. Covered end to end (HTTP) in
// apps/daemon/tests/project-reference.test.ts.
describe('project-reference-context', () => {
  it('projectMetadataContextSelection turns persisted projectReferences into workspace items carrying intent', () => {
    expect(
      projectMetadataContextSelection({
        projectReferences: [
          {
            id: 'project:other-project',
            targetProjectId: 'other-project',
            label: 'Other Project',
            absolutePath: '/tmp/open-design/other-project',
            intent: 'the bento cards',
          },
          // Malformed entries (no absolutePath / no targetProjectId) drop
          // silently rather than throwing or emitting a broken item.
          { id: 'project:missing-path', targetProjectId: 'missing-path' },
          { absolutePath: '/tmp/open-design/no-id' },
        ],
      }),
    ).toEqual({
      pluginIds: [],
      mcpServerIds: [],
      connectorIds: [],
      workspaceItems: [
        {
          id: 'project:other-project',
          kind: 'project',
          label: 'Other Project',
          title: 'Other Project',
          path: 'other-project',
          absolutePath: '/tmp/open-design/other-project',
          intent: 'the bento cards',
        },
      ],
    });
  });

  it('projectMetadataContextSelection omits workspaceItems entirely when there are no project references (unchanged shape)', () => {
    expect(
      projectMetadataContextSelection({ contextConnectors: [{ id: 'figma', name: 'Figma' }] }),
    ).toEqual({
      pluginIds: [],
      mcpServerIds: [],
      connectorIds: ['figma'],
    });
  });

  it('renders a persisted project reference on every turn, without the composer resending it, including its intent', () => {
    // No per-turn `selection.workspaceItems` at all — this simulates a run
    // started by `od run start` / a CLI-driven turn with no live composer.
    const prompt = renderRunContextPrompt(
      {},
      {
        projectReferences: [
          {
            id: 'project:bento-source',
            targetProjectId: 'bento-source',
            label: 'Bento Source',
            absolutePath: '/tmp/open-design/bento-source',
            intent: 'the bento cards',
          },
        ],
      },
    );

    expect(prompt).toContain('## Selected run context');
    expect(prompt).toContain('project: Bento Source (`project:bento-source`)');
    expect(prompt).toContain('intent: "the bento cards"');
    // The pointer-plus-instruction hint: scope to the intent, don't import
    // the whole referenced project.
    expect(prompt).toContain('Referenced projects:');
    expect(prompt).toContain('scope your search and what you reuse to that');
  });

  it('per-turn ephemeral workspaceItems and the persisted metadata record dedupe by id instead of double-listing', () => {
    const prompt = renderRunContextPrompt(
      {
        workspaceItems: [
          {
            kind: 'project',
            id: 'project:bento-source',
            label: 'Bento Source',
            absolutePath: '/tmp/open-design/bento-source',
            intent: 'the bento cards',
          },
        ],
      },
      {
        projectReferences: [
          {
            id: 'project:bento-source',
            targetProjectId: 'bento-source',
            label: 'Bento Source',
            absolutePath: '/tmp/open-design/bento-source',
            intent: 'the bento cards',
          },
        ],
      },
    );

    expect(prompt.match(/project: Bento Source/g)).toHaveLength(1);
  });

  it('a reference with no intent stays valid — the item renders with no intent detail', () => {
    const prompt = renderRunContextPrompt(
      {},
      {
        projectReferences: [
          {
            id: 'project:plain-source',
            targetProjectId: 'plain-source',
            label: 'Plain Source',
            absolutePath: '/tmp/open-design/plain-source',
          },
        ],
      },
    );

    expect(prompt).toContain('project: Plain Source (`project:plain-source`)');
    expect(prompt).not.toContain('intent:');
  });
});
