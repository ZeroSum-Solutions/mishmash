import { describe, expect, it } from 'vitest';

import { isMediaModelPickerReady, isMediaProviderPickerReady } from '../../src/media/provider-readiness';

// Higgsfield (issue #25) has no pasted API key at all — the daemon reports
// readiness via source 'higgsfield-mcp-oauth' once the MCP connection under
// Settings -> MCP servers is live (see apps/daemon/src/media/config.ts
// resolveHiggsfieldMcpCredential). Unlike codex (credentialsRequired: false,
// always "ready"), higgsfield genuinely needs that connection, so it goes
// through the generic isStoredMediaProviderEntryPresent(entry) gate — the
// daemon's `configured` boolean flows straight through to
// entry.apiKeyConfigured (apps/web/src/state/config.ts
// fetchMediaProvidersFromDaemon), with no higgsfield-specific branch needed.
describe('higgsfield MCP OAuth readiness', () => {
  it('is ready once the daemon reports a higgsfield-mcp-oauth configured entry', () => {
    const configured = {
      higgsfield: {
        apiKey: '',
        baseUrl: '',
        apiKeyConfigured: true,
        apiKeyTail: '',
        source: 'higgsfield-mcp-oauth',
      },
    };

    expect(isMediaProviderPickerReady('higgsfield', configured)).toBe(true);
    expect(isMediaModelPickerReady('higgsfield/seedance_2_0_mini', configured)).toBe(true);
    expect(isMediaModelPickerReady('higgsfield/soul_2', configured)).toBe(true);
  });

  it('is NOT ready when higgsfield has no configured entry (MCP not connected yet)', () => {
    expect(isMediaProviderPickerReady('higgsfield', {})).toBe(false);
    expect(isMediaModelPickerReady('higgsfield/seedance_2_0_mini', {})).toBe(false);
  });

  it('is NOT ready when mediaProviders has loaded but higgsfield is absent from the response', () => {
    const configured = {
      openai: { apiKey: '', baseUrl: '', apiKeyConfigured: true, apiKeyTail: '-key' },
    };

    expect(isMediaProviderPickerReady('higgsfield', configured)).toBe(false);
  });
});
