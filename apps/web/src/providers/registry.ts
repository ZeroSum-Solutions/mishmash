import type {
  ConnectorAuthConfigPrepareResponse,
  ConnectorDetail,
  ConnectorConnectResponse,
  ConnectorDiscoveryResponse,
  ConnectorDetailResponse,
  ConnectorListResponse,
  ConnectorStatusResponse,
  FigmaImportResult,
  ImportGitHubDesignSystemRequest,
  ImportGitHubDesignSystemResponse,
  ImportShadcnDesignSystemRequest,
  ImportShadcnDesignSystemResponse,
  OpenDesignGithubLatestReleaseResponse,
  ImportLocalDesignSystemRequest,
  ImportLocalDesignSystemResponse,
  ReplaceProjectWorkingDirResponse,
  ProjectFileTextPreviewResponse,
  ProjectFileVersion,
  ProjectFileVersionSource,
  ProjectFileVersionResponse,
  ProjectFileVersionsResponse,
  RestoreProjectFileVersionResponse,
  SocialShareRequest,
  SocialShareResponse,
} from '@open-design/contracts';
import type {
  AgentInfo,
  AppVersionInfo,
  AppVersionResponse,
  WhatsNewResponse,
  ChatAttachment,
  CodexPetSummary,
  CodexPetsResponse,
  InstallDesignSystemResponse,
  InstallInput,
  InstallSkillResponse,
  SyncCommunityPetsRequest,
  SyncCommunityPetsResponse,
  PreviewComment,
  PreviewCommentStatus,
  PreviewCommentUpsertRequest,
  CloudflarePagesDeploySelection,
  CloudflarePagesZonesResponse,
  DeployConfigResponse,
  DeployProjectFileResponse,
  DesignSystemDetail,
  DesignSystemFileDetail,
  DesignSystemFileSummary,
  DesignSystemGenerationJob,
  DesignSystemPackageAudit,
  DesignSystemProvenance,
  DesignSystemRevision,
  DesignSystemRevisionJobRequest,
  DesignSystemRevisionStatus,
  DesignSystemSummary,
  DesignSystemTokenContractRebuildJobRequest,
  DesignSystemTokenContractRebuildJobResponse,
  LiveArtifact,
  LiveArtifactRefreshLogEntry,
  LiveArtifactSummary,
  Project,
  ProjectDeploymentsResponse,
  PromptTemplateDetail,
  PromptTemplateSummary,
  ProjectFile,
  ProjectFolder,
  RenameProjectFileResponse,
  SkillDetail,
  SkillSummary,
  UpdateDeployConfigRequest,
} from '../types';
import type { ArtifactManifest } from '../artifacts/types';
import { GENERIC_DEPLOY_ENVELOPE_CODES } from '../analytics/deploy-error-code';
import {
  isOpenDesignHostAvailable,
  openHostExternalUrl,
} from '@open-design/host';

export const DEFAULT_DEPLOY_PROVIDER_ID = 'vercel-self';
export const CLOUDFLARE_PAGES_PROVIDER_ID = 'cloudflare-pages';
export const DEPLOY_PROVIDER_IDS = [
  DEFAULT_DEPLOY_PROVIDER_ID,
  CLOUDFLARE_PAGES_PROVIDER_ID,
] as const;

export type WebDeployProviderId = (typeof DEPLOY_PROVIDER_IDS)[number];

export type WebDeployConfigResponse = DeployConfigResponse;
export type WebUpdateDeployConfigRequest = UpdateDeployConfigRequest;
export type WebDeploymentInfo = ProjectDeploymentsResponse['deployments'][number];
export type WebDeployProjectFileResponse = DeployProjectFileResponse;
export type WebCloudflarePagesDeploySelection = CloudflarePagesDeploySelection;
export type WebCloudflarePagesZonesResponse = CloudflarePagesZonesResponse;

export function isDeployProviderId(value: unknown): value is WebDeployProviderId {
  return typeof value === 'string' && (DEPLOY_PROVIDER_IDS as readonly string[]).includes(value);
}

function deployProviderQuery(providerId?: WebDeployProviderId): string {
  return providerId ? `?providerId=${encodeURIComponent(providerId)}` : '';
}

export async function fetchAgents(options?: { throwOnError?: boolean }): Promise<AgentInfo[]> {
  try {
    const resp = await fetch('/api/agents', { cache: 'no-store' });
    if (!resp.ok) {
      if (options?.throwOnError) throw new Error(`agents ${resp.status}`);
      return [];
    }
    const json = (await resp.json()) as { agents: AgentInfo[] };
    return json.agents ?? [];
  } catch (err) {
    if (options?.throwOnError) throw err;
    return [];
  }
}

// Incremental agent detection over Server-Sent Events: `onAgent` fires once
// per agent the moment its probe settles (completion order, not registry
// order), so a caller can paint cards as they resolve instead of waiting for
// the slowest CLI. Resolves with every agent collected once the stream's
// terminal `done` event arrives. This is additive: callers that don't need
// incremental delivery keep using `fetchAgents()` (whose batch probe is now
// parallelized per-agent and so is itself faster). Pass an AbortSignal to
// cancel the underlying request.
export async function fetchAgentsStream(args: {
  onAgent: (agent: AgentInfo) => void;
  signal?: AbortSignal;
}): Promise<AgentInfo[]> {
  const { onAgent, signal } = args;
  const resp = await fetch('/api/agents?stream=1', {
    cache: 'no-store',
    headers: { Accept: 'text/event-stream' },
    ...(signal ? { signal } : {}),
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`agents stream ${resp.status}`);
  }
  const collected: AgentInfo[] = [];
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  const errorMessageFromData = (data: string): string => {
    if (!data.trim()) return 'agents stream error';
    try {
      const parsed = JSON.parse(data) as { error?: unknown; message?: unknown };
      const message = parsed.error ?? parsed.message;
      if (typeof message === 'string' && message.trim()) return message;
    } catch {
      // Fall through to the raw data string below.
    }
    return data;
  };

  const handleEvent = (rawEvent: string) => {
    // Each SSE record is `event: <name>\ndata: <json>`; we act on `agent`
    // (one AgentInfo), `error` (terminal failure), and `done` (terminal
    // success). Unknown events are ignored so the protocol can grow without
    // breaking older clients.
    let eventName = 'message';
    const dataLines: string[] = [];
    for (const line of rawEvent.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    const data = dataLines.join('\n');
    if (eventName === 'done') {
      done = true;
      return;
    }
    if (eventName === 'error') {
      throw new Error(errorMessageFromData(data));
    }
    if (eventName === 'agent' && data) {
      try {
        const agent = JSON.parse(data) as AgentInfo;
        collected.push(agent);
        onAgent(agent);
      } catch {
        // Ignore a malformed record rather than aborting the whole stream.
      }
    }
  };

  try {
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      // SSE records are separated by a blank line ("\n\n").
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (rawEvent.trim().length > 0) handleEvent(rawEvent);
        if (done) break;
      }
    }
    if (!done && buffer.trim().length > 0) {
      handleEvent(buffer);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Reader may already be closed; nothing to do.
    }
  }
  if (!done) {
    throw new Error('agents stream ended before done');
  }
  return collected;
}

export async function fetchSkills(): Promise<SkillSummary[]> {
  try {
    const resp = await fetch('/api/skills');
    if (!resp.ok) return [];
    const json = (await resp.json()) as { skills: SkillSummary[] };
    return json.skills ?? [];
  } catch {
    return [];
  }
}

// Design templates — the rendering catalogue (decks, prototypes, image/
// video/audio templates). Same SkillSummary shape as functional skills,
// fetched from a separate registry root so the EntryView Templates tab
// and Settings → Skills surface stay decoupled. See
// specs/current/skills-and-design-templates.md.
export async function fetchDesignTemplates(): Promise<SkillSummary[]> {
  try {
    const resp = await fetch('/api/design-templates');
    if (!resp.ok) return [];
    const json = (await resp.json()) as { designTemplates: SkillSummary[] };
    return json.designTemplates ?? [];
  } catch {
    return [];
  }
}

export async function fetchDesignTemplate(id: string): Promise<SkillDetail | null> {
  try {
    const resp = await fetch(`/api/design-templates/${encodeURIComponent(id)}`);
    if (!resp.ok) return null;
    return (await resp.json()) as SkillDetail;
  } catch {
    return null;
  }
}

// Pets packaged by the Codex `hatch-pet` skill — surfaced so the web
// pet settings can offer one-click adoption right after the agent run
// finishes. Returns an empty list (not an error) when the registry
// folder is missing so the "Recently hatched" UI can simply render an
// empty state.
export async function fetchCodexPets(): Promise<CodexPetsResponse> {
  try {
    const resp = await fetch('/api/codex-pets');
    if (!resp.ok) return { pets: [], rootDir: '' };
    return (await resp.json()) as CodexPetsResponse;
  } catch {
    return { pets: [], rootDir: '' };
  }
}

// One-click trigger for the daemon-side port of `sync-community-pets`.
// Always resolves with a summary (even when the daemon errored) so the
// caller can render a status line without having to wrap in try/catch
// on every keystroke.
export async function syncCommunityPets(
  input?: SyncCommunityPetsRequest,
): Promise<SyncCommunityPetsResponse & { error?: string }> {
  try {
    const resp = await fetch('/api/codex-pets/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input ?? {}),
    });
    if (!resp.ok) {
      const payload = (await resp.json().catch(() => null)) as
        | { error?: string }
        | null;
      return {
        wrote: 0,
        skipped: 0,
        failed: 0,
        total: 0,
        rootDir: '',
        errors: [],
        error: payload?.error ?? `Sync failed (${resp.status})`,
      };
    }
    return (await resp.json()) as SyncCommunityPetsResponse;
  } catch (err) {
    return {
      wrote: 0,
      skipped: 0,
      failed: 0,
      total: 0,
      rootDir: '',
      errors: [],
      error: err instanceof Error ? err.message : 'Sync request failed',
    };
  }
}

export function codexPetSpritesheetUrl(pet: CodexPetSummary): string {
  // The daemon stamps an absolute path-prefix in `spritesheetUrl`; if
  // that prefix is empty (default), it is already a same-origin path
  // we can hand to <img src> or fetch() as-is.
  return pet.spritesheetUrl;
}

// Body for POST /api/skills/import. Mirrors the contracts type but is
// repeated here so the registry module is self-describing for callers.
export interface SkillImportInput {
  name: string;
  description?: string;
  body: string;
  triggers?: string[];
}

export interface SkillImportError {
  code?: string;
  message: string;
}

export async function importSkill(
  input: SkillImportInput,
): Promise<{ skill: SkillSummary } | { error: SkillImportError }> {
  try {
    const resp = await fetch('/api/skills/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!resp.ok) {
      const payload = (await resp.json().catch(() => null)) as
        | { error?: SkillImportError }
        | null;
      return {
        error: {
          code: payload?.error?.code,
          message: payload?.error?.message ?? `Import failed (${resp.status}).`,
        },
      };
    }
    return (await resp.json()) as { skill: SkillSummary };
  } catch (err) {
    return {
      error: {
        message: err instanceof Error ? err.message : 'Import request failed.',
      },
    };
  }
}

// Update an existing skill's body. For built-in skills the daemon writes
// a "shadow" copy under the user-skills root; the next listSkills() pass
// surfaces it in place of the bundled copy. The id passed here must
// match the SKILL.md frontmatter `name` — the daemon refuses cross-id
// renames so callers can drop "edit" into the same surface they use for
// "edit my own draft".
export interface SkillUpdateInput {
  name?: string;
  description?: string;
  body: string;
  triggers?: string[];
}

export async function updateSkill(
  id: string,
  input: SkillUpdateInput,
): Promise<{ skill: SkillSummary } | { error: SkillImportError }> {
  try {
    const resp = await fetch(`/api/skills/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!resp.ok) {
      const payload = (await resp.json().catch(() => null)) as
        | { error?: SkillImportError }
        | null;
      return {
        error: {
          code: payload?.error?.code,
          message:
            payload?.error?.message ?? `Update failed (${resp.status}).`,
        },
      };
    }
    return (await resp.json()) as { skill: SkillSummary };
  } catch (err) {
    return {
      error: {
        message: err instanceof Error ? err.message : 'Update request failed.',
      },
    };
  }
}

export interface SkillFileEntry {
  path: string;
  kind: 'file' | 'directory';
  size: number | null;
}

export async function fetchSkillFiles(id: string): Promise<SkillFileEntry[]> {
  try {
    const resp = await fetch(
      `/api/skills/${encodeURIComponent(id)}/files`,
    );
    if (!resp.ok) return [];
    const json = (await resp.json()) as { files: SkillFileEntry[] };
    return json.files ?? [];
  } catch {
    return [];
  }
}

export async function deleteSkill(
  id: string,
): Promise<{ ok: true } | { error: SkillImportError }> {
  try {
    const resp = await fetch(`/api/skills/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!resp.ok) {
      const payload = (await resp.json().catch(() => null)) as
        | { error?: SkillImportError }
        | null;
      return {
        error: {
          code: payload?.error?.code,
          message: payload?.error?.message ?? `Delete failed (${resp.status}).`,
        },
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      error: {
        message: err instanceof Error ? err.message : 'Delete request failed.',
      },
    };
  }
}

export async function fetchSkill(id: string): Promise<SkillDetail | null> {
  try {
    const resp = await fetch(`/api/skills/${encodeURIComponent(id)}`);
    if (!resp.ok) return null;
    return (await resp.json()) as SkillDetail;
  } catch {
    return null;
  }
}

export async function fetchDesignSystems(): Promise<DesignSystemSummary[]> {
  const result = await fetchDesignSystemsResult();
  return result.ok ? result.designSystems : [];
}

// Discriminated-union variant: surfaces the fetch outcome instead of
// collapsing a network/HTTP failure into an empty array. The mid-chat
// design-system picker uses this so it can render a load-failure state
// instead of silently showing an empty catalog, which would otherwise
// be indistinguishable from "registry truly has no systems."
export type DesignSystemsResult =
  | { ok: true; designSystems: DesignSystemSummary[] }
  | { ok: false };

export async function fetchDesignSystemsResult(): Promise<DesignSystemsResult> {
  try {
    const resp = await fetch('/api/design-systems');
    if (!resp.ok) return { ok: false };
    const json = (await resp.json()) as { designSystems?: DesignSystemSummary[] };
    return { ok: true, designSystems: json.designSystems ?? [] };
  } catch {
    return { ok: false };
  }
}

export async function fetchDesignSystem(id: string): Promise<DesignSystemDetail | null> {
  try {
    // no-store so edits made elsewhere (the in-project Design System tab) are
    // reflected the next time the manager / a consumer re-reads the system.
    const resp = await fetch(`/api/design-systems/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!resp.ok) return null;
    return parseDesignSystemDetail(await resp.json());
  } catch {
    return null;
  }
}

export async function fetchDesignSystemFiles(
  id: string,
): Promise<DesignSystemFileSummary[]> {
  try {
    const resp = await fetch(`/api/design-systems/${encodeURIComponent(id)}/files`);
    if (!resp.ok) return [];
    const json = (await resp.json()) as { files: DesignSystemFileSummary[] };
    return json.files ?? [];
  } catch {
    return [];
  }
}

export async function fetchDesignSystemFile(
  id: string,
  filePath: string,
): Promise<DesignSystemFileDetail | null> {
  try {
    const resp = await fetch(
      `/api/design-systems/${encodeURIComponent(id)}/file?path=${encodeURIComponent(filePath)}`,
    );
    if (!resp.ok) return null;
    const json = (await resp.json()) as { file?: DesignSystemFileDetail };
    return json.file ?? null;
  } catch {
    return null;
  }
}

export async function ensureDesignSystemWorkspace(
  id: string,
): Promise<{ project: Project; files: ProjectFile[] } | null> {
  try {
    const resp = await fetch(`/api/design-systems/${encodeURIComponent(id)}/workspace`, {
      method: 'POST',
    });
    if (!resp.ok) return null;
    return (await resp.json()) as { project: Project; files: ProjectFile[] };
  } catch {
    return null;
  }
}

function parseDesignSystemDetail(json: unknown): DesignSystemDetail | null {
  if (!json || typeof json !== 'object') return null;
  const wrapper = json as { designSystem?: DesignSystemDetail };
  return wrapper.designSystem ?? (json as DesignSystemDetail);
}

export interface DesignSystemDraftInput {
  title: string;
  summary?: string;
  category?: string;
  surface?: 'web' | 'image' | 'video' | 'audio';
  status?: 'draft' | 'published';
  artifactMode?: 'generated' | 'agent-managed';
  body?: string;
  sourceNotes?: string;
  provenance?: DesignSystemProvenance;
}

export async function createDesignSystemDraft(
  input: DesignSystemDraftInput,
): Promise<DesignSystemDetail | null> {
  try {
    const resp = await fetch('/api/design-systems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!resp.ok) return null;
    return parseDesignSystemDetail(await resp.json());
  } catch {
    return null;
  }
}

export async function startDesignSystemGenerationJob(
  input: DesignSystemDraftInput,
): Promise<DesignSystemGenerationJob | null> {
  try {
    const resp = await fetch('/api/design-systems/generation-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { job?: DesignSystemGenerationJob };
    return json.job ?? null;
  } catch {
    return null;
  }
}

export async function fetchDesignSystemGenerationJob(
  id: string,
): Promise<DesignSystemGenerationJob | null> {
  try {
    const resp = await fetch(`/api/design-systems/generation-jobs/${encodeURIComponent(id)}`);
    if (!resp.ok) return null;
    const json = (await resp.json()) as { job?: DesignSystemGenerationJob };
    return json.job ?? null;
  } catch {
    return null;
  }
}

export async function fetchProjectDesignSystemPackageAudit(
  projectId: string,
): Promise<DesignSystemPackageAudit | null> {
  try {
    const resp = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/design-system-package-audit`,
      { cache: 'no-store' },
    );
    if (!resp.ok) return null;
    const json = (await resp.json()) as { audit?: DesignSystemPackageAudit };
    return json.audit ?? null;
  } catch {
    return null;
  }
}

export async function fetchDesignSystemRevisions(
  id: string,
): Promise<DesignSystemRevision[]> {
  try {
    const resp = await fetch(`/api/design-systems/${encodeURIComponent(id)}/revisions`);
    if (!resp.ok) return [];
    const json = (await resp.json()) as { revisions?: DesignSystemRevision[] };
    return json.revisions ?? [];
  } catch {
    return [];
  }
}

export async function updateDesignSystemRevisionStatus(
  id: string,
  revisionId: string,
  status: Extract<DesignSystemRevisionStatus, 'accepted' | 'rejected'>,
): Promise<DesignSystemRevision | null> {
  try {
    const resp = await fetch(
      `/api/design-systems/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      },
    );
    if (!resp.ok) return null;
    const json = (await resp.json()) as { revision?: DesignSystemRevision };
    return json.revision ?? null;
  } catch {
    return null;
  }
}

export async function startDesignSystemRevisionJob(
  id: string,
  input: DesignSystemRevisionJobRequest,
): Promise<DesignSystemGenerationJob | null> {
  try {
    const resp = await fetch(`/api/design-systems/${encodeURIComponent(id)}/revision-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { job?: DesignSystemGenerationJob };
    return json.job ?? null;
  } catch {
    return null;
  }
}

export async function startDesignSystemTokenContractRebuildJob(
  id: string,
  input: DesignSystemTokenContractRebuildJobRequest = {},
): Promise<DesignSystemTokenContractRebuildJobResponse | null> {
  try {
    const resp = await fetch(`/api/design-systems/${encodeURIComponent(id)}/token-contract/rebuild-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as DesignSystemTokenContractRebuildJobResponse;
  } catch {
    return null;
  }
}

export async function updateDesignSystemDraft(
  id: string,
  input: Partial<DesignSystemDraftInput>,
): Promise<DesignSystemDetail | null> {
  try {
    const resp = await fetch(`/api/design-systems/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!resp.ok) return null;
    return parseDesignSystemDetail(await resp.json());
  } catch {
    return null;
  }
}

export async function deleteDesignSystemDraft(id: string): Promise<boolean> {
  try {
    const resp = await fetch(`/api/design-systems/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function importLocalDesignSystem(
  input: ImportLocalDesignSystemRequest,
): Promise<ImportLocalDesignSystemResponse | { error: SkillImportError }> {
  try {
    const resp = await fetch('/api/design-systems/import/local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!resp.ok) {
      return { error: await readImportError(resp) };
    }
    return (await resp.json()) as ImportLocalDesignSystemResponse;
  } catch (err) {
    return {
      error: {
        message: err instanceof Error ? err.message : 'Import request failed.',
      },
    };
  }
}

export async function importGitHubDesignSystem(
  input: ImportGitHubDesignSystemRequest,
): Promise<ImportGitHubDesignSystemResponse | { error: SkillImportError }> {
  try {
    const resp = await fetch('/api/design-systems/import/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!resp.ok) return { error: await readImportError(resp) };
    return (await resp.json()) as ImportGitHubDesignSystemResponse;
  } catch (err) {
    return {
      error: {
        message: err instanceof Error ? err.message : 'Import request failed.',
      },
    };
  }
}

export async function importShadcnDesignSystem(
  input: ImportShadcnDesignSystemRequest,
): Promise<ImportShadcnDesignSystemResponse | { error: SkillImportError }> {
  try {
    const resp = await fetch('/api/design-systems/import/shadcn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!resp.ok) return { error: await readImportError(resp) };
    return (await resp.json()) as ImportShadcnDesignSystemResponse;
  } catch (err) {
    return {
      error: {
        message: err instanceof Error ? err.message : 'Import request failed.',
      },
    };
  }
}

async function readImportError(resp: Response): Promise<SkillImportError> {
  const payload = (await resp.json().catch(() => null)) as
    | { error?: SkillImportError | string; message?: string }
    | null;
  const error = payload?.error;
  if (typeof error === 'object' && error !== null) return error;
  return {
    message:
      typeof error === 'string'
        ? error
        : payload?.message ?? `Import failed (${resp.status}).`,
  };
}

export async function fetchPromptTemplates(): Promise<PromptTemplateSummary[]> {
  try {
    const resp = await fetch('/api/prompt-templates');
    if (!resp.ok) return [];
    const json = (await resp.json()) as { promptTemplates: PromptTemplateSummary[] };
    return json.promptTemplates ?? [];
  } catch {
    return [];
  }
}

export async function fetchPromptTemplate(
  surface: 'image' | 'video',
  id: string,
): Promise<PromptTemplateDetail | null> {
  try {
    const resp = await fetch(
      `/api/prompt-templates/${encodeURIComponent(surface)}/${encodeURIComponent(id)}`,
    );
    if (!resp.ok) return null;
    const json = (await resp.json()) as { promptTemplate: PromptTemplateDetail };
    return json.promptTemplate ?? null;
  } catch {
    return null;
  }
}

export async function daemonIsLive(): Promise<boolean> {
  try {
    const resp = await fetch('/api/health');
    return resp.ok;
  } catch {
    return false;
  }
}

export async function fetchConnectors(): Promise<ConnectorDetail[]> {
  try {
    const resp = await fetch('/api/connectors');
    if (!resp.ok) return [];
    const json = (await resp.json()) as ConnectorListResponse;
    return json.connectors ?? [];
  } catch {
    return [];
  }
}

export async function fetchConnectorStatuses(options?: {
  signal?: AbortSignal;
}): Promise<ConnectorStatusResponse['statuses']> {
  try {
    const resp = await fetch('/api/connectors/status', { signal: options?.signal });
    if (!resp.ok) return {};
    const json = (await resp.json()) as ConnectorStatusResponse;
    return json.statuses ?? {};
  } catch {
    return {};
  }
}

let connectorDiscoveryCache: ConnectorDetail[] | null = null;
let connectorDiscoveryPromise: Promise<ConnectorDetail[]> | null = null;

export async function fetchConnectorDiscovery(options: { refresh?: boolean } = {}): Promise<ConnectorDetail[]> {
  if (options.refresh) {
    connectorDiscoveryCache = null;
    connectorDiscoveryPromise = null;
  }
  if (connectorDiscoveryCache && !options.refresh) return connectorDiscoveryCache;
  if (connectorDiscoveryPromise && !options.refresh) return connectorDiscoveryPromise;

  const promise = (async () => {
    try {
      const params = options.refresh ? '?refresh=true' : '';
      const resp = await fetch(`/api/connectors/discovery${params}`);
      if (!resp.ok) return [];
      const json = (await resp.json()) as ConnectorDiscoveryResponse;
      const connectors = json.connectors ?? [];
      connectorDiscoveryCache = connectors;
      return connectors;
    } catch {
      return [];
    } finally {
      connectorDiscoveryPromise = null;
    }
  })();
  connectorDiscoveryPromise = promise;
  return promise;
}

export async function fetchConnectorDetail(
  connectorId: string,
  options: { hydrateTools?: boolean; toolsLimit?: number; toolsCursor?: string } = {},
): Promise<ConnectorDetail | null> {
  try {
    const params = new URLSearchParams();
    if (options.hydrateTools) params.set('hydrateTools', 'true');
    if (options.toolsLimit !== undefined) params.set('toolsLimit', String(options.toolsLimit));
    if (options.toolsCursor) params.set('toolsCursor', options.toolsCursor);
    const query = params.toString();
    const resp = await fetch(`/api/connectors/${encodeURIComponent(connectorId)}${query ? `?${query}` : ''}`);
    if (!resp.ok) return null;
    const json = (await resp.json()) as ConnectorDetailResponse;
    return json.connector ?? null;
  } catch {
    return null;
  }
}

export interface ConnectorActionResult {
  connector: ConnectorDetail | null;
  auth?: ConnectorConnectResponse['auth'];
  error?: string;
}

function popupBlockedMessage(): string {
  return 'Popup blocked. Allow popups for MishMash and try again.';
}

/**
 * List the project's daemon-managed preview servers (issue #38). Returns an
 * empty list on any failure — the browser start page simply omits the section.
 */
export async function listProjectPreviews(
  projectId: string,
): Promise<import('@open-design/contracts').PreviewInfo[]> {
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/previews`);
    if (!resp.ok) return [];
    const json = (await resp.json()) as import('@open-design/contracts').PreviewListResponse;
    return Array.isArray(json.previews) ? json.previews : [];
  } catch {
    return [];
  }
}

/**
 * Preflight whether an external site allows the Design Browser's iframe
 * fallback to embed it. Returns null on any transport failure so callers
 * treat "cannot check" exactly like an unknown verdict and embed as-is.
 */
export async function checkFrameEmbeddable(
  url: string,
  opts: { signal?: AbortSignal } = {},
): Promise<import('@open-design/contracts').DesignBrowserFrameCheckVerdict | null> {
  try {
    const resp = await fetch('/api/design-browser/frame-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: opts.signal,
    });
    if (!resp.ok) return null;
    return (await resp.json()) as import('@open-design/contracts').DesignBrowserFrameCheckVerdict;
  } catch {
    return null;
  }
}

export async function openExternalUrl(url: string): Promise<boolean> {
  const bridgedUrl = await bridgeFirstPartyUrl(url);
  const targetUrl = bridgedUrl ?? url;
  if (isOpenDesignHostAvailable()) {
    const opened = await openHostExternalUrl(targetUrl);
    if (opened.ok) return true;
  }
  try {
    const resp = await fetch('/api/system/open-external', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl }),
    });
    if (resp.ok) {
      const json = (await resp.json().catch(() => null)) as { ok?: unknown } | null;
      if (json?.ok === true) return true;
    }
  } catch {
    // Fall through to current-tab navigation below.
  }
  try {
    window.location.assign(targetUrl);
  } catch {
    return false;
  }
  return false;
}

// First-party marketing domains eligible for attribution bridging. Empty:
// this fork is a private, internal build with no public marketing site of
// its own (see docs/FORK-PIN.md) -- the retired `open-design.ai` family is
// upstream's, not ours, and listing it here would silently bridge outbound
// navigation through the daemon toward that old-brand host.
const FIRST_PARTY_BRIDGE_HOSTNAMES: readonly string[] = [];

async function bridgeFirstPartyUrl(url: string): Promise<string | null> {
  try {
    const target = new URL(url);
    if (!FIRST_PARTY_BRIDGE_HOSTNAMES.includes(target.hostname)) return null;
    const resp = await fetch('/api/attribution/bridge-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: target.toString() }),
    });
    if (!resp.ok) return null;
    const body = await resp.json() as { url?: unknown };
    return typeof body.url === 'string' ? body.url : null;
  } catch {
    return null;
  }
}

async function decodeConnectorError(resp: Response): Promise<string> {
  try {
    const payload = (await resp.json()) as { error?: { message?: string } } | null;
    return payload?.error?.message?.trim() || `Connector request failed (${resp.status})`;
  } catch {
    return `Connector request failed (${resp.status})`;
  }
}

export async function connectConnector(connectorId: string): Promise<ConnectorActionResult> {
  let authWindow: Window | null = null;
  const useExternalBrowser = isOpenDesignHostAvailable();
  try {
    if (!useExternalBrowser) {
      authWindow = window.open('about:blank', '_blank');
      renderConnectorAuthLoading(authWindow, {
        title: 'Initializing auth config…',
        body: 'Creating or reusing the Composio auth configuration for this app. This can take a moment the first time.',
      });
    }
    const prepare = await prepareConnectorAuthConfig(connectorId);
    if (prepare.status !== 'ready') {
      renderConnectorAuthError(authWindow, prepare.message);
      return { connector: null, error: prepare.message };
    }
    renderConnectorAuthLoading(authWindow, {
      title: 'Opening authorization…',
      body: 'The auth config is ready. Preparing the provider authorization page.',
    });
    const resp = await fetch(`/api/connectors/${encodeURIComponent(connectorId)}/connect`, {
      method: 'POST',
    });
    if (!resp.ok) {
      const error = await decodeConnectorError(resp);
      renderConnectorAuthError(authWindow, error);
      return { connector: null, error };
    }
    const json = (await resp.json()) as ConnectorConnectResponse;
    if (json.auth?.kind === 'redirect_required' && json.auth.redirectUrl) {
      if (useExternalBrowser) {
        const opened = await openHostExternalUrl(json.auth.redirectUrl);
        if (!opened.ok) {
          return {
            connector: json.connector ?? null,
            auth: json.auth,
            error: popupBlockedMessage(),
          };
        }
      } else if (authWindow) {
        openConnectorAuthRedirect(authWindow, json.auth.redirectUrl);
      } else {
        // The embedded browser can block even the synchronous placeholder
        // popup. Ask the local daemon to open the system browser; if that
        // route is unavailable, openExternalUrl falls back to current-tab
        // navigation.
        await openExternalUrl(json.auth.redirectUrl);
      }
    } else if (json.auth?.kind === 'connected') {
      renderConnectorAuthInfo(authWindow, {
        title: 'Already connected',
        body: 'This connector is already authorized. You can close this window.',
      });
    } else if (json.auth?.kind === 'pending') {
      renderConnectorAuthInfo(authWindow, {
        title: 'Authorization pending',
        body: 'Authorization is in progress but no redirect URL was returned. Watch for an email confirmation, or open the Composio dashboard to continue.',
      });
    } else {
      renderConnectorAuthInfo(authWindow, {
        title: 'No authorization URL returned',
        body: 'The connector responded without a redirect URL. If this seems wrong, retry from Settings → Connectors, and confirm your Composio API key.',
      });
    }
    return { connector: json.connector ?? null, ...(json.auth === undefined ? {} : { auth: json.auth }) };
  } catch (err) {
    renderConnectorAuthError(authWindow, err instanceof Error && err.message ? err.message : 'Could not start connector authentication.');
    return {
      connector: null,
      error: err instanceof Error && err.message ? err.message : 'Could not start connector authentication.',
    };
  }
}

async function prepareConnectorAuthConfig(connectorId: string): Promise<{ status: 'ready' } | { status: 'error'; message: string }> {
  const resp = await fetch('/api/connectors/auth-configs/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectorIds: [connectorId] }),
  });
  if (!resp.ok) {
    return { status: 'error', message: await decodeConnectorError(resp) };
  }
  const json = (await resp.json()) as ConnectorAuthConfigPrepareResponse;
  const result = json.results?.[connectorId];
  if (!result) return { status: 'error', message: 'Auth config initialization did not return a result.' };
  if (result.status === 'ready') return { status: 'ready' };
  return { status: 'error', message: result.message };
}

function openConnectorAuthRedirect(authWindow: Window | null, redirectUrl: string): void {
  if (authWindow) {
    renderConnectorAuthRedirect(authWindow, redirectUrl);
    try {
      authWindow.location.replace(redirectUrl);
      return;
    } catch {
      // Some embedded browsers block async popup navigation. Leave the
      // clickable fallback in the popup so the user can continue.
    }
  }
  const opened = window.open(redirectUrl, '_blank');
  if (!opened) window.location.assign(redirectUrl);
}

function renderConnectorAuthLoading(authWindow: Window | null, copy: { title: string; body: string }): void {
  if (!authWindow) return;
  try {
    authWindow.document.title = 'Connecting…';
    authWindow.document.body.innerHTML = `
      <main style="min-height:100vh;display:grid;place-items:center;margin:0;background:#0f1115;color:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="display:grid;gap:14px;justify-items:center;text-align:center;padding:32px;">
          <div aria-hidden="true" style="width:28px;height:28px;border-radius:999px;border:3px solid rgba(255,255,255,.22);border-top-color:#fff;animation:od-spin .8s linear infinite;"></div>
          <div style="font-size:15px;font-weight:600;">${escapeHtmlText(copy.title)}</div>
          <div style="max-width:300px;color:rgba(246,247,251,.72);font-size:13px;line-height:1.5;">${escapeHtmlText(copy.body)}</div>
        </div>
        <style>@keyframes od-spin{to{transform:rotate(360deg)}}</style>
      </main>
    `;
  } catch {
    /* Popup may be unavailable or already navigated; ignore. */
  }
}

function renderConnectorAuthInfo(authWindow: Window | null, copy: { title: string; body: string }): void {
  if (!authWindow) return;
  try {
    authWindow.document.title = copy.title;
    authWindow.document.body.innerHTML = `
      <main style="min-height:100vh;display:grid;place-items:center;margin:0;background:#0f1115;color:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="display:grid;gap:14px;justify-items:center;text-align:center;padding:32px;">
          <div style="font-size:15px;font-weight:600;">${escapeHtmlText(copy.title)}</div>
          <div style="max-width:360px;color:rgba(246,247,251,.72);font-size:13px;line-height:1.5;">${escapeHtmlText(copy.body)}</div>
        </div>
      </main>
    `;
  } catch {
    /* Popup may be unavailable or already navigated; ignore. */
  }
}

function renderConnectorAuthRedirect(authWindow: Window, redirectUrl: string): void {
  try {
    authWindow.document.title = 'Continue authorization';
    authWindow.document.body.innerHTML = `
      <main style="min-height:100vh;display:grid;place-items:center;margin:0;background:#0f1115;color:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="display:grid;gap:14px;justify-items:center;text-align:center;padding:32px;">
          <div style="font-size:15px;font-weight:600;">Continue authorization</div>
          <div style="max-width:300px;color:rgba(246,247,251,.72);font-size:13px;line-height:1.5;">If this window does not redirect automatically, use the button below.</div>
          <a href="${escapeHtmlAttribute(redirectUrl)}" style="display:inline-flex;align-items:center;justify-content:center;min-width:164px;border-radius:8px;padding:9px 14px;background:#df7b56;color:#fff;text-decoration:none;font-size:13px;font-weight:600;">Open Composio</a>
        </div>
      </main>
    `;
  } catch {
    /* Popup may already be cross-origin; navigation fallback still runs. */
  }
}

async function readConnectorApiErrorMessage(resp: Response): Promise<string> {
  try {
    const payload = await resp.json() as { error?: { message?: string }; message?: string };
    return payload.error?.message ?? payload.message ?? `Connection failed (${resp.status})`;
  } catch {
    return `Connection failed (${resp.status})`;
  }
}

function renderConnectorAuthError(authWindow: Window | null, message: string): void {
  if (!authWindow) return;
  try {
    authWindow.document.title = 'Connection failed';
    authWindow.document.body.innerHTML = `
      <main style="min-height:100vh;display:grid;place-items:center;margin:0;background:#0f1115;color:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="display:grid;gap:14px;justify-items:center;text-align:center;padding:32px;">
          <div style="font-size:15px;font-weight:600;">Connection failed</div>
          <div style="max-width:360px;color:rgba(246,247,251,.72);font-size:13px;line-height:1.5;">${escapeHtmlText(message)}</div>
        </div>
      </main>
    `;
  } catch {
    /* Popup may be unavailable or already navigated; ignore. */
  }
}

function escapeHtmlText(value: string): string {
  return value.replace(/[&<>]/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      default:
        return char;
    }
  });
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

export async function disconnectConnector(connectorId: string): Promise<ConnectorDetail | null> {
  try {
    const resp = await fetch(`/api/connectors/${encodeURIComponent(connectorId)}/connection`, {
      method: 'DELETE',
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as ConnectorDetailResponse;
    return json.connector ?? null;
  } catch {
    return null;
  }
}

export async function cancelConnectorAuthorization(connectorId: string): Promise<ConnectorDetail | null> {
  try {
    const resp = await fetch(`/api/connectors/${encodeURIComponent(connectorId)}/authorization/cancel`, {
      method: 'POST',
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as ConnectorDetailResponse;
    return json.connector ?? null;
  } catch {
    return null;
  }
}

function isAppVersionInfo(value: unknown): value is AppVersionInfo {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AppVersionInfo>;
  return (
    typeof candidate.version === 'string' &&
    typeof candidate.channel === 'string' &&
    typeof candidate.packaged === 'boolean' &&
    typeof candidate.platform === 'string' &&
    typeof candidate.arch === 'string'
  );
}

export async function fetchAppVersionInfo(): Promise<AppVersionInfo | null> {
  try {
    const resp = await fetch('/api/version');
    if (!resp.ok) return null;
    const json = (await resp.json()) as Partial<AppVersionResponse>;
    return isAppVersionInfo(json.version) ? json.version : null;
  } catch {
    return null;
  }
}

export type LatestGithubReleaseInfo = {
  tagName: string;
  htmlUrl: string;
  stale: boolean;
};

export async function fetchLatestGithubReleaseInfo(): Promise<LatestGithubReleaseInfo | null> {
  try {
    const resp = await fetch('/api/github/open-design/releases/latest');
    if (!resp.ok) return null;
    const json = (await resp.json()) as Partial<OpenDesignGithubLatestReleaseResponse>;
    if (typeof json.tag_name !== 'string' || typeof json.html_url !== 'string') return null;
    return {
      tagName: json.tag_name,
      htmlUrl: json.html_url,
      stale: json.stale === true,
    };
  } catch {
    return null;
  }
}

export async function fetchWhatsNew(): Promise<WhatsNewResponse | null> {
  try {
    const resp = await fetch('/api/whats-new');
    if (!resp.ok) return null;
    const json = (await resp.json()) as Partial<WhatsNewResponse>;
    if (typeof json.version !== 'string') {
      return null;
    }
    return {
      version: json.version,
      id: typeof json.id === 'string' ? json.id : null,
      content: json.content ?? null,
    };
  } catch {
    return null;
  }
}

export type SkillExampleResult =
  | { html: string }
  // The skill declares a non-HTML preview surface (image / markdown / …)
  // and the daemon's `/example` endpoint only ships HTML, so calling it
  // would 404 into a misleading "failed to fetch" state. The modal
  // renders a calm "no shipped preview" affordance instead. The `kind`
  // is the raw `od.preview.type` from SKILL.md so future preview kinds
  // can be picked up by name without a registry change. Issue #897.
  | { unavailable: true; kind: string }
  | { error: string };

// Returns a discriminated result so callers can distinguish a real
// failure (network error, daemon unreachable, server error) from a
// normal load or a missing shipped preview. Previously this collapsed
// every failure into `null`, which left the example preview modal stuck
// at its loading state with no recovery affordance. Issue #860.
//
// `previewType` is the skill's `od.preview.type` (defaults to `'html'`
// daemon-side). Anything other than `'html'` short-circuits to an
// `unavailable` result so we don't fire a network call against a
// daemon endpoint that only resolves HTML files. Issue #897.
export async function fetchSkillExample(
  id: string,
  previewType: string = 'html',
): Promise<SkillExampleResult> {
  if (previewType !== 'html') {
    return { unavailable: true, kind: previewType };
  }
  try {
    const resp = await fetch(`/api/skills/${encodeURIComponent(id)}/example`);
    if (!resp.ok) {
      if (resp.status === 404) {
        return { unavailable: true, kind: 'html' };
      }
      return { error: `HTTP ${resp.status}` };
    }
    return { html: await resp.text() };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error';
    return { error: message };
  }
}

export async function fetchDeployConfig(
  providerId?: WebDeployProviderId,
): Promise<WebDeployConfigResponse | null> {
  try {
    const resp = await fetch(`/api/deploy/config${deployProviderQuery(providerId)}`);
    if (!resp.ok) return null;
    return (await resp.json()) as WebDeployConfigResponse;
  } catch {
    return null;
  }
}

export async function updateDeployConfig(
  input: WebUpdateDeployConfigRequest,
): Promise<WebDeployConfigResponse | null> {
  try {
    const resp = await fetch('/api/deploy/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!resp.ok) {
      const payload = (await resp.json().catch(() => null)) as
        | { error?: { message?: string }; message?: string }
        | null;
      throw new Error(payload?.error?.message || payload?.message || `Could not save deploy config (${resp.status})`);
    }
    return (await resp.json()) as WebDeployConfigResponse;
  } catch (err) {
    if (err instanceof Error) throw err;
    return null;
  }
}

export async function fetchCloudflarePagesZones(): Promise<WebCloudflarePagesZonesResponse | null> {
  try {
    const resp = await fetch('/api/deploy/cloudflare-pages/zones');
    if (!resp.ok) {
      const payload = (await resp.json().catch(() => null)) as
        | { error?: { message?: string }; message?: string }
        | null;
      throw new Error(payload?.error?.message || payload?.message || `Could not load Cloudflare zones (${resp.status})`);
    }
    return (await resp.json()) as WebCloudflarePagesZonesResponse;
  } catch (err) {
    if (err instanceof Error) throw err;
    return null;
  }
}

export async function fetchProjectDeployments(
  projectId: string,
): Promise<WebDeploymentInfo[]> {
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/deployments`);
    if (!resp.ok) return [];
    const json = (await resp.json()) as ProjectDeploymentsResponse;
    return (json.deployments ?? []) as WebDeploymentInfo[];
  } catch {
    return [];
  }
}

export async function deployProjectFile(
  projectId: string,
  fileName: string,
  providerId: WebDeployProviderId = DEFAULT_DEPLOY_PROVIDER_ID,
  cloudflarePages?: WebCloudflarePagesDeploySelection,
  target?: 'preview' | 'production',
): Promise<WebDeployProjectFileResponse> {
  const body = {
    fileName,
    providerId,
    ...(cloudflarePages ? { cloudflarePages } : {}),
    ...(target ? { target } : {}),
  };
  const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const payload = (await resp.json().catch(() => null)) as
      | { error?: { message?: string; code?: string }; code?: string; message?: string }
      | null;
    const message = payload?.error?.message || payload?.message || `Deploy failed (${resp.status})`;
    // Preserve a queryable failure code for analytics (`deployErrorCode` reads
    // `.code` first). The daemon deploy route (apps/daemon/src/routes/deploy.ts)
    // collapses every non-404 failure's code to a generic `BAD_REQUEST` (and 404
    // to `FILE_NOT_FOUND`) while keeping the REAL provider HTTP status on the
    // response and the real message in the body — so ignore those envelope codes
    // and fall back to `HTTP_${resp.status}`, which then buckets as HTTP_403 /
    // HTTP_429 / HTTP_500 instead of collapsing every failure into one code.
    const rawCode = payload?.error?.code || payload?.code;
    const code = rawCode && !GENERIC_DEPLOY_ENVELOPE_CODES.has(rawCode) ? rawCode : `HTTP_${resp.status}`;
    throw Object.assign(new Error(message), { code });
  }
  return (await resp.json()) as WebDeployProjectFileResponse;
}

export async function checkDeploymentLink(
  projectId: string,
  deploymentId: string,
): Promise<WebDeployProjectFileResponse> {
  const resp = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deploymentId)}/check-link`,
    { method: 'POST' },
  );
  if (!resp.ok) {
    const payload = (await resp.json().catch(() => null)) as
      | { error?: { message?: string }; message?: string }
      | null;
    throw new Error(payload?.error?.message || payload?.message || `Link check failed (${resp.status})`);
  }
  return (await resp.json()) as WebDeployProjectFileResponse;
}

export async function createSocialSharePayload(
  input: SocialShareRequest,
): Promise<SocialShareResponse> {
  const resp = await fetch('/api/social-share', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!resp.ok) {
    const payload = await resp.json().catch(() => null) as {
      error?: { message?: string };
      message?: string;
    } | null;
    throw new Error(payload?.error?.message || payload?.message || `Share payload failed (${resp.status})`);
  }
  return (await resp.json()) as SocialShareResponse;
}

// Project files — all paths are scoped under .od/projects/<id>/ on disk.

export async function fetchProjectFiles(projectId: string): Promise<ProjectFile[]> {
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files`);
    if (!resp.ok) return [];
    const json = (await resp.json()) as { files: ProjectFile[] };
    return json.files ?? [];
  } catch {
    return [];
  }
}

export async function fetchProjectFolders(projectId: string): Promise<ProjectFolder[]> {
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/folders`);
    if (!resp.ok) return [];
    const json = (await resp.json()) as { folders?: ProjectFolder[] };
    return json.folders ?? [];
  } catch {
    return [];
  }
}

export async function createProjectFolder(
  projectId: string,
  name: string,
): Promise<ProjectFolder | null> {
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { folder?: ProjectFolder };
    return json.folder ?? null;
  } catch {
    return null;
  }
}

export async function deleteProjectFolder(
  projectId: string,
  folderPath: string,
): Promise<boolean> {
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/folders`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function fetchLiveArtifacts(projectId: string): Promise<LiveArtifactSummary[]> {
  try {
    const resp = await fetch(`/api/live-artifacts?projectId=${encodeURIComponent(projectId)}`);
    if (!resp.ok) return [];
    const json = (await resp.json()) as {
      artifacts?: LiveArtifactSummary[];
      liveArtifacts?: LiveArtifactSummary[];
    };
    return json.liveArtifacts ?? json.artifacts ?? [];
  } catch {
    return [];
  }
}

export async function fetchLiveArtifact(
  projectId: string,
  artifactId: string,
): Promise<LiveArtifact | null> {
  try {
    const resp = await fetch(liveArtifactDetailUrl(projectId, artifactId));
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      artifact?: LiveArtifact;
      liveArtifact?: LiveArtifact;
    };
    return json.liveArtifact ?? json.artifact ?? null;
  } catch {
    return null;
  }
}

export interface LiveArtifactRefreshResult {
  artifact: LiveArtifact;
  refresh: {
    id: string;
    status: 'succeeded';
    refreshedSourceCount: number;
  };
}

export class LiveArtifactRefreshError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'LiveArtifactRefreshError';
  }
}

export async function refreshLiveArtifact(
  projectId: string,
  artifactId: string,
): Promise<LiveArtifactRefreshResult> {
  let resp: Response;
  try {
    resp = await fetch(
      `/api/live-artifacts/${encodeURIComponent(artifactId)}/refresh?projectId=${encodeURIComponent(projectId)}`,
      { method: 'POST' },
    );
  } catch (error) {
    throw new LiveArtifactRefreshError(
      error instanceof Error ? error.message : 'Refresh request failed.',
      0,
    );
  }

  if (!resp.ok) {
    const errorBody = await readApiErrorBody(resp);
    throw new LiveArtifactRefreshError(errorBody.message, resp.status, errorBody.code);
  }

  return (await resp.json()) as LiveArtifactRefreshResult;
}

export async function fetchLiveArtifactRefreshes(
  projectId: string,
  artifactId: string,
): Promise<LiveArtifactRefreshLogEntry[]> {
  try {
    const resp = await fetch(
      `/api/live-artifacts/${encodeURIComponent(artifactId)}/refreshes?projectId=${encodeURIComponent(projectId)}`,
    );
    if (!resp.ok) return [];
    const json = (await resp.json()) as { refreshes?: LiveArtifactRefreshLogEntry[] };
    return json.refreshes ?? [];
  } catch {
    return [];
  }
}

export async function updateLiveArtifact(
  projectId: string,
  artifactId: string,
  input: Pick<LiveArtifact, 'title' | 'status' | 'pinned' | 'preview'> & {
    slug?: string;
    document?: LiveArtifact['document'];
  },
): Promise<LiveArtifact> {
  let resp: Response;
  try {
    resp = await fetch(
      `/api/live-artifacts/${encodeURIComponent(artifactId)}?projectId=${encodeURIComponent(projectId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
  } catch (error) {
    throw new LiveArtifactRefreshError(
      error instanceof Error ? error.message : 'Update request failed.',
      0,
    );
  }

  if (!resp.ok) {
    const errorBody = await readApiErrorBody(resp);
    throw new LiveArtifactRefreshError(errorBody.message, resp.status, errorBody.code);
  }

  const json = (await resp.json()) as { artifact?: LiveArtifact; liveArtifact?: LiveArtifact };
  const artifact = json.liveArtifact ?? json.artifact;
  if (!artifact) throw new LiveArtifactRefreshError('Update response did not include a live artifact.', resp.status);
  return artifact;
}

export async function deleteLiveArtifact(projectId: string, artifactId: string): Promise<boolean> {
  try {
    const resp = await fetch(
      `/api/live-artifacts/${encodeURIComponent(artifactId)}?projectId=${encodeURIComponent(projectId)}`,
      { method: 'DELETE' },
    );
    return resp.ok;
  } catch {
    return false;
  }
}

async function readApiErrorBody(resp: Response): Promise<{ message: string; code?: string }> {
  try {
    const json = (await resp.json()) as { error?: { code?: string; message?: string } | string; message?: string };
    const message = typeof json.error === 'string' ? json.error : json.error?.message ?? json.message;
    return {
      message: typeof message === 'string' && message.length > 0 ? message : `Request failed (${resp.status}).`,
      ...(typeof json.error === 'object' && typeof json.error?.code === 'string' ? { code: json.error.code } : {}),
    };
  } catch {
    return { message: `Request failed (${resp.status}).` };
  }
}

export function liveArtifactDetailUrl(projectId: string, artifactId: string): string {
  return `/api/live-artifacts/${encodeURIComponent(artifactId)}?projectId=${encodeURIComponent(projectId)}`;
}

export type LiveArtifactPreviewVariant = 'rendered' | 'template' | 'rendered-source';

export function liveArtifactPreviewUrl(projectId: string, artifactId: string, variant: LiveArtifactPreviewVariant = 'rendered'): string {
  const variantQuery = variant === 'rendered' ? '' : `&variant=${encodeURIComponent(variant)}`;
  return `/api/live-artifacts/${encodeURIComponent(artifactId)}/preview?projectId=${encodeURIComponent(projectId)}${variantQuery}`;
}

export async function fetchLiveArtifactCode(
  projectId: string,
  artifactId: string,
  variant: Exclude<LiveArtifactPreviewVariant, 'rendered'>,
): Promise<string | null> {
  try {
    const resp = await fetch(liveArtifactPreviewUrl(projectId, artifactId, variant), { cache: 'no-store' });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

export function projectFileUrl(projectId: string, name: string): string {
  return projectRawUrl(projectId, name);
}

export interface ProjectFilePreviewSection {
  title: string;
  lines: string[];
}

export interface ProjectFilePreview {
  kind: 'pdf' | 'document' | 'presentation' | 'spreadsheet';
  title: string;
  sections: ProjectFilePreviewSection[];
}

export async function fetchProjectFilePreview(
  projectId: string,
  name: string,
): Promise<ProjectFilePreview | null> {
  try {
    const resp = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(name)}/preview`,
    );
    if (!resp.ok) return null;
    return (await resp.json()) as ProjectFilePreview;
  } catch {
    return null;
  }
}

export async function fetchProjectFileText(
  projectId: string,
  name: string,
  options?: { cache?: RequestCache; cacheBustKey?: string | number },
): Promise<string | null> {
  const url = projectFileUrl(projectId, name);
  const cacheBustKey = options?.cacheBustKey;
  const requestUrl =
    cacheBustKey == null
      ? url
      : `${url}${url.includes('?') ? '&' : '?'}cacheBust=${encodeURIComponent(String(cacheBustKey))}`;
  const init: RequestInit = {};
  if (options?.cache) init.cache = options.cache;

  try {
    const resp = await fetch(requestUrl, init);
    if (!resp.ok) {
      console.warn('[fetchProjectFileText] failed:', {
        name,
        projectId,
        status: resp.status,
        statusText: resp.statusText,
        url: requestUrl,
      });
      return null;
    }
    return await resp.text();
  } catch (err) {
    console.warn('[fetchProjectFileText] failed:', {
      error: err,
      name,
      projectId,
      url: requestUrl,
    });
    return null;
  }
}

export async function fetchProjectFileTextPreview(
  projectId: string,
  name: string,
  options?: { limit?: number; cacheBustKey?: string | number },
): Promise<ProjectFileTextPreviewResponse | null> {
  const segments = name
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join('/');
  if (!segments) return null;
  const params = new URLSearchParams();
  if (options?.limit != null) params.set('limit', String(options.limit));
  if (options?.cacheBustKey != null) params.set('cacheBust', String(options.cacheBustKey));
  const query = params.toString();
  const url = `/api/projects/${encodeURIComponent(projectId)}/text-preview/${segments}${query ? `?${query}` : ''}`;

  try {
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) {
      console.warn('[fetchProjectFileTextPreview] failed:', {
        name,
        projectId,
        status: resp.status,
        statusText: resp.statusText,
        url,
      });
      return null;
    }
    return (await resp.json()) as ProjectFileTextPreviewResponse;
  } catch (err) {
    console.warn('[fetchProjectFileTextPreview] failed:', {
      error: err,
      name,
      projectId,
      url,
    });
    return null;
  }
}

function projectFileVersionsUrl(projectId: string, name: string): string {
  const safePath = name
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `/api/projects/${encodeURIComponent(projectId)}/files/${safePath}/versions`;
}

export async function fetchProjectFileVersions(
  projectId: string,
  name: string,
): Promise<ProjectFileVersionsResponse | null> {
  try {
    const resp = await fetch(projectFileVersionsUrl(projectId, name), { cache: 'no-store' });
    if (!resp.ok) return null;
    return (await resp.json()) as ProjectFileVersionsResponse;
  } catch {
    return null;
  }
}

export async function fetchProjectFileVersion(
  projectId: string,
  name: string,
  versionId: string,
): Promise<ProjectFileVersionResponse | null> {
  try {
    const resp = await fetch(
      `${projectFileVersionsUrl(projectId, name)}/${encodeURIComponent(versionId)}`,
      { cache: 'no-store' },
    );
    if (!resp.ok) return null;
    return (await resp.json()) as ProjectFileVersionResponse;
  } catch {
    return null;
  }
}

export async function restoreProjectFileVersion(
  projectId: string,
  name: string,
  version: Pick<ProjectFileVersion, 'id'>,
): Promise<RestoreProjectFileVersionResponse | null> {
  try {
    const resp = await fetch(
      `${projectFileVersionsUrl(projectId, name)}/${encodeURIComponent(version.id)}/restore`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    if (!resp.ok) return null;
    return (await resp.json()) as RestoreProjectFileVersionResponse;
  } catch {
    return null;
  }
}

export async function fetchPreviewComments(
  projectId: string,
  conversationId: string,
): Promise<PreviewComment[]> {
  try {
    const resp = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/comments`,
    );
    if (!resp.ok) return [];
    const json = (await resp.json()) as { comments: PreviewComment[] };
    return json.comments ?? [];
  } catch {
    return [];
  }
}

export async function upsertPreviewComment(
  projectId: string,
  conversationId: string,
  input: PreviewCommentUpsertRequest,
): Promise<PreviewComment | null> {
  try {
    const resp = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    if (!resp.ok) return null;
    const json = (await resp.json()) as { comment: PreviewComment };
    return json.comment ?? null;
  } catch {
    return null;
  }
}

export async function patchPreviewCommentStatus(
  projectId: string,
  conversationId: string,
  commentId: string,
  status: PreviewCommentStatus,
): Promise<PreviewComment | null> {
  try {
    const resp = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/comments/${encodeURIComponent(commentId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      },
    );
    if (!resp.ok) return null;
    const json = (await resp.json()) as { comment: PreviewComment };
    return json.comment ?? null;
  } catch {
    return null;
  }
}

export async function deletePreviewComment(
  projectId: string,
  conversationId: string,
  commentId: string,
): Promise<boolean> {
  try {
    const resp = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/comments/${encodeURIComponent(commentId)}`,
      { method: 'DELETE' },
    );
    return resp.ok;
  } catch {
    return false;
  }
}

export async function writeProjectTextFile(
  projectId: string,
  name: string,
  content: string,
  options?: {
    artifactManifest?: ArtifactManifest;
    versionSource?: ProjectFileVersionSource;
    versionLabel?: string;
    versionPrompt?: string | null;
  },
): Promise<ProjectFile | null> {
  const result = await writeProjectTextFileDetailed(projectId, name, content, options);
  return result.ok ? result.file : null;
}

export type WriteProjectTextFileResult =
  | { ok: true; file: ProjectFile }
  | { ok: false; status?: number; code?: string; message: string };

export async function writeProjectTextFileDetailed(
  projectId: string,
  name: string,
  content: string,
  options?: {
    artifactManifest?: ArtifactManifest;
    versionSource?: ProjectFileVersionSource;
    versionLabel?: string;
    versionPrompt?: string | null;
  },
): Promise<WriteProjectTextFileResult> {
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        content,
        artifactManifest: options?.artifactManifest,
        versionSource: options?.versionSource,
        versionLabel: options?.versionLabel,
        versionPrompt: options?.versionPrompt,
      }),
    });
    if (!resp.ok) {
      const body = await readApiErrorBody(resp);
      return {
        ok: false,
        status: resp.status,
        code: body.code,
        message: body.message || resp.statusText || 'Save failed',
      };
    }
    const json = (await resp.json()) as { file: ProjectFile };
    return { ok: true, file: json.file };
  } catch {
    return { ok: false, message: 'Network error while saving the file' };
  }
}

export async function writeProjectBase64File(
  projectId: string,
  name: string,
  base64: string,
): Promise<ProjectFile | null> {
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content: base64, encoding: 'base64' }),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { file: ProjectFile };
    return json.file;
  } catch {
    return null;
  }
}

export async function uploadProjectFile(
  projectId: string,
  file: File,
  desiredName?: string,
): Promise<ProjectFile | null> {
  try {
    const form = new FormData();
    form.append('file', file);
    if (desiredName) form.append('name', desiredName);
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files`, {
      method: 'POST',
      body: form,
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { file: ProjectFile };
    return json.file;
  } catch {
    return null;
  }
}

// Offline `.fig` import. Uploads the Figma file to the daemon, which decodes
// it in-process (no Figma account) and stages a `figma/` snapshot into the
// project. Returns the inventory + a ready-to-send reshape prompt, or an
// error string the caller can surface.
export async function importProjectFigma(
  projectId: string,
  file: File,
  opts?: { notes?: string; subdir?: string; page?: string },
): Promise<{ ok: true; result: FigmaImportResult } | { ok: false; error: string }> {
  try {
    const form = new FormData();
    form.append('file', file);
    if (opts?.notes && opts.notes.trim()) form.append('notes', opts.notes.trim());
    if (opts?.subdir && opts.subdir.trim()) form.append('subdir', opts.subdir.trim());
    if (opts?.page && opts.page.trim()) form.append('page', opts.page.trim());
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/figma/import`, {
      method: 'POST',
      body: form,
    });
    if (!resp.ok) {
      let message = `import failed (${resp.status})`;
      try {
        const body = (await resp.json()) as { error?: { message?: string } | string };
        const text = typeof body.error === 'string' ? body.error : body.error?.message;
        if (text) message = text;
      } catch {
        /* keep the status-only message */
      }
      return { ok: false, error: message };
    }
    const result = (await resp.json()) as FigmaImportResult;
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Multi-file project upload used by the chat composer's paste / drop /
// picker. Each file lands flat in the project folder; the response is
// reshaped into ChatAttachments so the composer can stage them without a
// follow-up listFiles round-trip.
const PROJECT_UPLOAD_BATCH_SIZE = 12;

export interface ProjectUploadFailure {
  name: string;
  code?: string;
  error?: string;
}

export interface UploadProjectFilesResult {
  uploaded: ChatAttachment[];
  failed: ProjectUploadFailure[];
  error?: string;
}

export async function uploadProjectFiles(
  projectId: string,
  files: File[],
  dir?: string,
): Promise<UploadProjectFilesResult> {
  if (files.length === 0) return { uploaded: [], failed: [] };

  const uploaded: ChatAttachment[] = [];
  const failed: ProjectUploadFailure[] = [];
  let error: string | undefined;
  const targetDir = dir?.trim() ?? '';

  for (let i = 0; i < files.length; i += PROJECT_UPLOAD_BATCH_SIZE) {
    const batch = files.slice(i, i + PROJECT_UPLOAD_BATCH_SIZE);
    const remaining = files.slice(i + PROJECT_UPLOAD_BATCH_SIZE);
    const form = new FormData();
    // The `dir` field MUST be appended before the file parts: the daemon's
    // multer destination resolver reads req.body.dir as each file streams in,
    // and busboy only exposes fields parsed earlier in the multipart body.
    if (targetDir) form.append('dir', targetDir);
    for (const f of batch) form.append('files', f);

    try {
      const resp = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/upload`,
        { method: 'POST', body: form },
      );

      if (!resp.ok) {
        const payload = (await resp.json().catch(() => null)) as
          | { code?: string; error?: string }
          | null;
        error = payload?.error ?? `upload failed (${resp.status})`;
        for (const f of batch) {
          failed.push({ name: f.name, code: payload?.code, error: error });
        }
        for (const f of remaining) {
          failed.push({ name: f.name, code: payload?.code, error: error });
        }
        break;
      }

      const json = (await resp.json()) as {
        files: { name: string; path: string; size?: number; originalName?: string }[];
      };
      const responseFiles = json.files ?? [];
      uploaded.push(
        ...responseFiles.map((f) => ({
          path: f.path,
          name: f.originalName ?? f.name,
          kind: looksLikeImage(f.name) ? ('image' as const) : ('file' as const),
          size: f.size,
        })),
      );
      // Server preserves request order; any dropped files are unmatched at the batch tail.
      if (responseFiles.length < batch.length) {
        error ??= 'some files could not be stored';
        for (const f of batch.slice(responseFiles.length)) {
          failed.push({
            name: f.name,
            error: error ?? 'some files could not be stored',
          });
        }
      }
    } catch {
      error = 'upload request failed';
      for (const f of batch) {
        failed.push({ name: f.name, error });
      }
      for (const f of remaining) {
        failed.push({ name: f.name, error });
      }
      break;
    }
  }

  return { uploaded, failed, error };
}

// Stable URL that serves a project file with its original mime — for
// thumbnails in the staged-attachment chips and for any preview iframe
// that needs to point at the live file (not a srcDoc).
export function projectRawUrl(projectId: string, filePath: string): string {
  // Encode each path segment individually so a slash inside the file
  // path stays a path separator, not %2F.
  const safePath = filePath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `/api/projects/${encodeURIComponent(projectId)}/raw/${safePath}`;
}

export function designSystemStaticUrl(designSystemId: string, filePath: string): string {
  return `/api/design-systems/${encodeURIComponent(designSystemId)}/static?path=${encodeURIComponent(filePath)}`;
}

function looksLikeImage(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(name);
}

export async function deleteProjectFile(
  projectId: string,
  name: string,
): Promise<boolean> {
  try {
    const resp = await fetch(
      projectRawUrl(projectId, name),
      { method: 'DELETE' },
    );
    return resp.ok;
  } catch {
    return false;
  }
}

export async function renameProjectFile(
  projectId: string,
  from: string,
  to: string,
): Promise<RenameProjectFileResponse> {
  const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  });
  if (!resp.ok) {
    const errorBody = await readApiErrorBody(resp);
    throw new Error(errorBody.message);
  }
  return (await resp.json()) as RenameProjectFileResponse;
}

export async function openFolderDialog(options: { throwOnError?: boolean } = {}): Promise<string | null> {
  try {
    const resp = await fetch('/api/dialog/open-folder', { method: 'POST' });
    if (!resp.ok) {
      if (options.throwOnError) {
        const errorBody = await readApiErrorBody(resp);
        throw new Error(errorBody.message);
      }
      return null;
    }
    const data = await resp.json();
    return typeof data.path === 'string' && data.path.length > 0 ? data.path : null;
  } catch (err) {
    if (options.throwOnError) {
      throw err instanceof Error ? err : new Error('Could not open folder picker');
    }
    return null;
  }
}

// Probe whether a local directory still exists on disk. Used by the composer
// to flag a working directory in red the moment its folder is deleted.
export async function dirExists(path: string): Promise<boolean> {
  try {
    const resp = await fetch('/api/dir-exists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!resp.ok) return true; // can't tell → don't false-flag
    const data = await resp.json();
    return data?.exists !== false;
  } catch {
    return true; // daemon unreachable → don't false-flag
  }
}

// Global most-recently-used working directories (the local folders the user
// grants the agent read-only awareness of). Persisted in the daemon's
// app-config so they survive browser resets and are shared across projects
// and the `od` CLI. Returns most-recent-first.
export async function fetchRecentLinkedDirs(): Promise<string[]> {
  try {
    // `/api/recent-dirs` returns the list pruned to folders that still exist
    // on disk (and persists the pruning), so deleted folders never linger.
    const resp = await fetch('/api/recent-dirs');
    if (!resp.ok) return [];
    const data = await resp.json();
    const list = data?.dirs;
    return Array.isArray(list) ? list.filter((d: unknown): d is string => typeof d === 'string') : [];
  } catch {
    return [];
  }
}

// Record `dir` as the most-recently-used working directory and return the
// updated list. PUT /api/app-config merges per-key, so sending only
// `recentLinkedDirs` leaves every other preference untouched. The daemon
// also trims/de-dupes/caps the list, but we do it client-side too so the
// optimistic UI matches what gets persisted.
export async function pushRecentLinkedDir(dir: string): Promise<string[]> {
  const existing = await fetchRecentLinkedDirs();
  const next = [dir, ...existing.filter((d) => d !== dir)].slice(0, 5);
  try {
    await fetch('/api/app-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recentLinkedDirs: next }),
    });
  } catch {
    // Daemon offline — the picked dir still applies to this project; the
    // recents list just won't persist for next time.
  }
  return next;
}

// "Replace working directory" — points an existing project at a new
// folder. Mirrors the import-folder trust gate but updates the current
// project record instead of creating a new project.
export async function replaceProjectWorkingDir(
  projectId: string,
  baseDir: string,
  desktopImportToken?: string,
): Promise<ReplaceProjectWorkingDirResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (desktopImportToken) {
    headers['x-od-desktop-import-token'] = desktopImportToken;
  }
  const resp = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/working-dir`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ baseDir }),
    },
  );
  if (!resp.ok) {
    const body = await readApiErrorBody(resp);
    throw new Error(body.message);
  }
  return (await resp.json()) as ReplaceProjectWorkingDirResponse;
}

// Hand-off (open project in local app). The daemon enumerates installed
// editors on demand (PATH probe + macOS bundle scan), and the POST
// endpoint spawns the chosen app with the project's resolvedDir.
export async function fetchHostEditors(): Promise<
  import('@open-design/contracts').HostEditorsResponse
> {
  const resp = await fetch('/api/editors');
  if (!resp.ok) throw new Error(`GET /api/editors failed: ${resp.status}`);
  return (await resp.json()) as import('@open-design/contracts').HostEditorsResponse;
}

export async function openProjectInEditor(
  projectId: string,
  editorId: import('@open-design/contracts').HostEditorId,
): Promise<import('@open-design/contracts').OpenProjectInEditorResponse> {
  const resp = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/open-in`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editorId }),
    },
  );
  if (!resp.ok) {
    const body = await readApiErrorBody(resp);
    throw new Error(body.message);
  }
  return (await resp.json()) as import('@open-design/contracts').OpenProjectInEditorResponse;
}

export async function fetchDesignSystemPreview(id: string): Promise<string | null> {
  try {
    const resp = await fetch(`/api/design-systems/${encodeURIComponent(id)}/preview`);
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

export async function fetchDesignSystemShowcase(id: string): Promise<string | null> {
  try {
    const resp = await fetch(`/api/design-systems/${encodeURIComponent(id)}/showcase`);
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

// Fetch the sandboxed HTML preview the daemon serves for a plugin.
// Mirrors fetchSkillExample's discriminated result so the modal can
// surface a Retry button instead of staying stuck at "Loading…" when
// a plugin ships no preview entry or the asset is missing on disk.
//
// 404 is mapped to `unavailable` (mirroring the skill helper's #897
// behavior) because the daemon returns 404 when the manifest's
// `preview.entry` points at a file that doesn't ship — a missing
// asset for an otherwise valid plugin is not an error the user can
// retry their way out of. Surfacing the calm "no shipped preview"
// placeholder is the truthful UX.
export async function fetchPluginPreviewHtml(
  id: string,
): Promise<SkillExampleResult> {
  try {
    const resp = await fetch(
      `/api/plugins/${encodeURIComponent(id)}/preview`,
    );
    if (!resp.ok) {
      if (resp.status === 404) return { unavailable: true, kind: 'html' };
      return { error: `HTTP ${resp.status}` };
    }
    return { html: await resp.text() };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error';
    return { error: message };
  }
}

// Fetch a single example output by stem (matches the basename of the
// `od.useCase.exampleOutputs[].path` minus its extension). 404 is
// mapped to `unavailable` for the same reason as fetchPluginPreviewHtml.
export async function fetchPluginExampleHtml(
  pluginId: string,
  stem: string,
): Promise<SkillExampleResult> {
  try {
    const resp = await fetch(
      `/api/plugins/${encodeURIComponent(pluginId)}/example/${encodeURIComponent(stem)}`,
    );
    if (!resp.ok) {
      if (resp.status === 404) return { unavailable: true, kind: 'html' };
      return { error: `HTTP ${resp.status}` };
    }
    return { html: await resp.text() };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error';
    return { error: message };
  }
}

// Fetch a raw text asset shipped inside a plugin (DESIGN.md,
// SKILL.md, README.md, etc.). Returns null on any error so the
// caller can fall back to a placeholder; callers that need a
// distinguishable failure should switch to the discriminated
// SkillExampleResult shape used by the HTML helpers above.
export async function fetchPluginAssetText(
  pluginId: string,
  relpath: string,
): Promise<string | null> {
  try {
    const resp = await fetch(
      `/api/plugins/${encodeURIComponent(pluginId)}/asset/${encodePluginAssetPath(relpath)}`,
    );
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

function encodePluginAssetPath(relpath: string): string {
  return relpath
    .replace(/^\.\//, '')
    .split(/[\\/]/)
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

export async function installSkill(
  input: InstallInput,
): Promise<{ skill: SkillSummary } | { error: string }> {
  try {
    const resp = await fetch('/api/skills/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const json = await resp.json();
    if (!resp.ok) return { error: json.error ?? 'Install failed' };
    return json as InstallSkillResponse;
  } catch {
    return { error: 'Network error' };
  }
}

export async function uninstallSkill(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    const resp = await fetch(`/api/skills/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    const json = await resp.json();
    if (!resp.ok) return { error: json.error ?? 'Uninstall failed' };
    return { ok: true };
  } catch {
    return { error: 'Network error' };
  }
}

export async function installDesignSystem(
  input: InstallInput,
): Promise<{ designSystem: DesignSystemSummary } | { error: string }> {
  try {
    const resp = await fetch('/api/design-systems/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const json = await resp.json();
    if (!resp.ok) return { error: json.error ?? 'Install failed' };
    return json as InstallDesignSystemResponse;
  } catch {
    return { error: 'Network error' };
  }
}

export async function uninstallDesignSystem(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    const resp = await fetch(`/api/design-systems/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    const json = await resp.json();
    if (!resp.ok) return { error: json.error ?? 'Uninstall failed' };
    return { ok: true };
  } catch {
    return { error: 'Network error' };
  }
}

// --- OD Library ------------------------------------------------------------

import type {
  LibraryApplyResponse,
  LibraryAsset,
  LibraryAssetListResponse,
  LibraryConnectionStatus,
  LibraryEditAsPageResponse,
  LibraryIngestResponse,
  LibraryPairingStartResponse,
  LibrarySyncResponse,
} from '@open-design/contracts';
import { LIBRARY_UPLOAD_MAX_BYTES, isLibraryUploadMimeAllowed } from '@open-design/contracts';

/** Raw bytes URL for a library asset (image src / download href). */
export function libraryAssetRawUrl(id: string): string {
  return `/api/library/assets/${encodeURIComponent(id)}/raw`;
}

/**
 * OD Figma capture download URL — only meaningful for clipper-captured `html`
 * assets whose `metadata.figmaCapture` marker is set. Importable via the OD
 * Figma plugin.
 */
export function libraryAssetFigmaUrl(id: string): string {
  return `/api/library/assets/${encodeURIComponent(id)}/figma`;
}

/**
 * Captured-element markup URL — only meaningful for element-pick screenshot
 * assets whose `metadata.element.hasHtml` is set. Returns the element's
 * `outerHTML` as `text/html`.
 */
export function libraryAssetElementUrl(id: string): string {
  return `/api/library/assets/${encodeURIComponent(id)}/element`;
}

export interface LibraryAssetQuery {
  kind?: string;
  source?: string;
  q?: string;
  date?: string;
  tag?: string;
  /** Page size. Server default 500, clamped to the 1000-row hard max. */
  limit?: number;
  /** Rows to skip before the page — how a caller pages past the cap (BUG-5). */
  offset?: number;
}

/**
 * Fetch one page of Library assets, carrying the full `{ assets, total,
 * truncated }` response so a caller can page past the daemon's per-request
 * cap instead of the page silently reading as the whole library (BUG-5).
 * Falls back to an empty, non-truncated page on any network/HTTP error so
 * callers never have to null-check.
 */
export async function fetchLibraryAssetsPage(
  query: LibraryAssetQuery = {},
): Promise<LibraryAssetListResponse> {
  const empty: LibraryAssetListResponse = { assets: [], total: 0, truncated: false };
  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value) params.set(key, String(value));
    }
    const qs = params.toString();
    const resp = await fetch(`/api/library/assets${qs ? `?${qs}` : ''}`);
    if (!resp.ok) return empty;
    const json = (await resp.json()) as LibraryAssetListResponse;
    return {
      assets: json.assets ?? [],
      total: json.total ?? (json.assets?.length ?? 0),
      truncated: json.truncated ?? false,
    };
  } catch {
    return empty;
  }
}

/**
 * Fetch a single (first) page of Library assets as a plain array, discarding
 * paging metadata. Kept for callers that only ever show one bounded page
 * (e.g. the "Select from library" picker) — the Library grid itself pages
 * through {@link fetchLibraryAssetsPage} instead so a larger library doesn't
 * silently read as complete.
 */
export async function fetchLibraryAssets(query: LibraryAssetQuery = {}): Promise<LibraryAsset[]> {
  return (await fetchLibraryAssetsPage(query)).assets;
}

/**
 * Fetch a single library asset by id (`GET /api/library/assets/:id`). Returns
 * null when the asset is gone or the request fails. Powers the Library grid's
 * incremental SSE merge — on an `ingest` event we hydrate just the one asset
 * instead of refetching the whole list.
 */
export async function fetchLibraryAsset(id: string): Promise<LibraryAsset | null> {
  try {
    const resp = await fetch(`/api/library/assets/${encodeURIComponent(id)}`);
    if (!resp.ok) return null;
    const json = (await resp.json()) as { asset?: LibraryAsset };
    return json.asset ?? null;
  } catch {
    return null;
  }
}

/**
 * Copy a library asset into a project's design files (default `library/`
 * subdir) and record a provenance back-link so the registry knows the asset
 * was consumed. Powers "Select from library" in the composer and Design Files.
 * With `includeElement`, an element-pick capture also materializes its captured
 * markup as a companion `.element.html` file (see `elementRelPath`). Returns the
 * apply response (`relPath` + optional `elementRelPath`), or null on error.
 */
export async function applyLibraryAsset(
  assetId: string,
  projectId: string,
  dir?: string,
  opts?: { includeElement?: boolean },
): Promise<LibraryApplyResponse | null> {
  try {
    const resp = await fetch(`/api/library/assets/${encodeURIComponent(assetId)}/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId,
        ...(dir ? { dir } : {}),
        ...(opts?.includeElement ? { includeElement: true } : {}),
      }),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as LibraryApplyResponse;
  } catch {
    return null;
  }
}

/**
 * Fetch the captured `outerHTML` of an element-pick library asset (served from
 * `/api/library/assets/:id/element`). Returns null when the asset has no stored
 * element markup or the request fails.
 */
export async function fetchLibraryAssetElementHtml(assetId: string): Promise<string | null> {
  try {
    const resp = await fetch(libraryAssetElementUrl(assetId));
    if (!resp.ok) return null;
    const html = await resp.text();
    return html.trim() ? html : null;
  } catch {
    return null;
  }
}

/**
 * Turn a captured `html` library asset into a brand-new editable OD project.
 * The daemon copies the capture into the project as an editable `index.html`
 * and seeds a conversation; the caller opens the project on that file. Returns
 * null on error.
 */
export async function editLibraryAssetAsPage(
  assetId: string,
): Promise<LibraryEditAsPageResponse | null> {
  try {
    const resp = await fetch(`/api/library/assets/${encodeURIComponent(assetId)}/edit-as-page`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!resp.ok) return null;
    return (await resp.json()) as LibraryEditAsPageResponse;
  } catch {
    return null;
  }
}

const LIBRARY_MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'text/html': '.html',
  'text/css': '.css',
  'application/json': '.json',
};

/** A filesystem-safe filename for a library asset, with an extension by mime. */
function libraryAssetFileName(asset: LibraryAsset, mime: string): string {
  const fallback = `asset-${asset.id.slice(0, 8)}`;
  const base =
    (asset.sourceTitle || asset.sourceDomain || fallback)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || fallback;
  const ext =
    LIBRARY_MIME_EXT[mime] ||
    (mime.startsWith('image/') ? `.${mime.slice(6).split('+')[0]}` : '');
  return `${base}${ext}`;
}

/**
 * Fetch a library asset's bytes and wrap them in a `File`, so the asset can be
 * fed into upload-shaped flows that expect browser File objects (e.g. seeding
 * the design-system creation flow's source material). Returns null on error.
 */
export async function fetchLibraryAssetAsFile(asset: LibraryAsset): Promise<File | null> {
  try {
    const resp = await fetch(libraryAssetRawUrl(asset.id));
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const type = asset.mime || blob.type || 'application/octet-stream';
    return new File([blob], libraryAssetFileName(asset, type), { type });
  } catch {
    return null;
  }
}

export async function deleteLibraryAsset(id: string): Promise<boolean> {
  try {
    const resp = await fetch(`/api/library/assets/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Force a Library reconcile (`POST /api/library/sync`) — pulls design systems
 * and agent-produced project deliverables into the Library as referenced assets.
 * Powers the Library toolbar "Sync" button. Returns the counts of what was newly
 * indexed, or null on error.
 */
export async function syncLibrary(): Promise<LibrarySyncResponse | null> {
  try {
    const resp = await fetch('/api/library/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!resp.ok) return null;
    return (await resp.json()) as LibrarySyncResponse;
  } catch {
    return null;
  }
}

// --- manual upload ---------------------------------------------------------

/** Outcome of a single manual upload — drives the per-file status in the UI. */
export interface LibraryUploadOutcome {
  ok: boolean;
  asset?: LibraryAsset;
  deduped?: boolean;
  /** Human-readable failure reason (policy reject, oversize, network…). */
  error?: string;
  /** Daemon error code when the failure came back from the server. */
  code?: string;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'));
    reader.readAsDataURL(file);
  });
}

async function readLibraryUploadError(resp: Response): Promise<{ error: string; code?: string }> {
  const payload = (await resp.json().catch(() => null)) as
    | { error?: { message?: string; code?: string } | string }
    | null;
  const err = payload?.error;
  if (typeof err === 'object' && err) {
    return { error: err.message ?? `Upload failed (${resp.status})`, ...(err.code ? { code: err.code } : {}) };
  }
  return { error: typeof err === 'string' && err ? err : `Upload failed (${resp.status})` };
}

/**
 * Upload one file into the Library through the manual-upload ingest path.
 *
 * Runs the shared format/size policy as a pre-flight so an unsupported or
 * oversized file fails instantly with a friendly message instead of a wasted
 * round-trip, then posts the bytes inline as a `data:` URI. The daemon enforces
 * the same policy as the source of truth.
 */
export async function uploadLibraryFile(file: File): Promise<LibraryUploadOutcome> {
  if (file.size > LIBRARY_UPLOAD_MAX_BYTES) {
    return {
      ok: false,
      code: 'PAYLOAD_TOO_LARGE',
      error: `Too large — max ${Math.round(LIBRARY_UPLOAD_MAX_BYTES / 1_000_000)} MB`,
    };
  }
  if (!isLibraryUploadMimeAllowed(file.type || undefined, file.name)) {
    return { ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', error: 'Unsupported format' };
  }
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const resp = await fetch('/api/library/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl, filename: file.name, mime: file.type || undefined }),
    });
    if (!resp.ok) {
      return { ok: false, ...(await readLibraryUploadError(resp)) };
    }
    const json = (await resp.json()) as LibraryIngestResponse;
    return { ok: true, asset: json.asset, deduped: json.deduped };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Upload failed' };
  }
}

/** Upload a pasted/typed text snippet as a text-family Library asset. */
export async function uploadLibraryText(
  text: string,
  opts: { filename?: string } = {},
): Promise<LibraryUploadOutcome> {
  try {
    const resp = await fetch('/api/library/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, ...(opts.filename ? { filename: opts.filename } : {}) }),
    });
    if (!resp.ok) {
      return { ok: false, ...(await readLibraryUploadError(resp)) };
    }
    const json = (await resp.json()) as LibraryIngestResponse;
    return { ok: true, asset: json.asset, deduped: json.deduped };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Upload failed' };
  }
}

export async function startLibraryPairing(): Promise<LibraryPairingStartResponse | null> {
  try {
    const resp = await fetch('/api/library/pair', { method: 'POST' });
    if (!resp.ok) return null;
    return (await resp.json()) as LibraryPairingStartResponse;
  } catch {
    return null;
  }
}

export async function fetchLibraryConnection(): Promise<LibraryConnectionStatus | null> {
  try {
    const resp = await fetch('/api/library/connection');
    if (!resp.ok) return null;
    return (await resp.json()) as LibraryConnectionStatus;
  } catch {
    return null;
  }
}

// --- Design Library ----------------------------------------------------------

import type {
  DesignLibraryCatalog,
  DesignLibraryGroup,
  DesignLibraryItem,
  DesignLibraryStartProjectResponse,
} from '@open-design/contracts';

// Read-only browse of the local curated reference-asset library
// (apps/daemon/src/routes/design-library.ts). Discriminated result (not a
// bare null) so the section can show a real "not found on this machine"
// empty state instead of an indistinguishable network failure.
export type DesignLibraryCatalogResult =
  | { ok: true; catalog: DesignLibraryCatalog }
  | { ok: false; notFound: boolean; message: string };

// A 200 body must actually look like a catalog before consumers use it.
// Without this gate a generic 200 stub (or a proxy answering `{}` for every
// route) reaches consumers as `ok: true` and the first
// `for (const group of catalog.groups)` throws. The gate validates the FULL
// `DesignLibraryCatalog` contract — every field, at every level — so the
// predicate genuinely means what its type claims; per-field spot checks kept
// leaving render paths that threw (objects as React children,
// `thumb.split is not a function`). One deliberate loosening: `allowed_use`
// is validated as `string`, not the four-tier union, because an unknown tier
// must fail CLOSED downstream (it is not in any COPYABLE_ALLOWED_USE set, so
// it gets zero copy affordances) rather than reject the whole catalog when
// the daemon learns a new tier.
function isDesignLibraryItemShape(item: unknown): boolean {
  if (typeof item !== 'object' || item === null) return false;
  const candidate = item as Record<keyof DesignLibraryItem, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.rel === 'string' &&
    (candidate.thumb === null || typeof candidate.thumb === 'string') &&
    typeof candidate.kind === 'string' &&
    typeof candidate.files === 'number' &&
    typeof candidate.size === 'string' &&
    typeof candidate.category === 'string' &&
    Array.isArray(candidate.domains) &&
    candidate.domains.every((domain) => typeof domain === 'string') &&
    typeof candidate.allowed_use === 'string' &&
    (candidate.duplicate_of === undefined || typeof candidate.duplicate_of === 'string') &&
    (candidate.description === undefined || typeof candidate.description === 'string') &&
    (candidate.aspects === undefined ||
      (Array.isArray(candidate.aspects) && candidate.aspects.every((aspect) => typeof aspect === 'string'))) &&
    (candidate.stacks === undefined ||
      (Array.isArray(candidate.stacks) && candidate.stacks.every((stack) => typeof stack === 'string'))) &&
    (candidate.reference === undefined || isDesignLibraryReferenceShape(candidate.reference))
  );
}

function isDesignLibraryReferenceShape(reference: unknown): boolean {
  if (typeof reference !== 'object' || reference === null) return false;
  const candidate = reference as Record<string, unknown>;
  return (
    typeof candidate.source === 'string' &&
    (candidate.design === null || typeof candidate.design === 'string') &&
    (candidate.html === null || typeof candidate.html === 'string') &&
    (candidate.design_sha256 === undefined || typeof candidate.design_sha256 === 'string') &&
    (candidate.html_sha256 === undefined || typeof candidate.html_sha256 === 'string')
  );
}

function isDesignLibraryGroupShape(group: unknown): boolean {
  if (typeof group !== 'object' || group === null) return false;
  const candidate = group as Record<keyof DesignLibraryGroup, unknown>;
  return (
    typeof candidate.title === 'string' &&
    typeof candidate.folder === 'string' &&
    typeof candidate.blurb === 'string' &&
    Array.isArray(candidate.items) &&
    candidate.items.every(isDesignLibraryItemShape)
  );
}

function isDesignLibraryCatalogShape(payload: unknown): payload is DesignLibraryCatalog {
  if (typeof payload !== 'object' || payload === null) return false;
  const candidate = payload as Record<keyof DesignLibraryCatalog, unknown>;
  return (
    typeof candidate.library === 'string' &&
    typeof candidate.rights_ledger === 'string' &&
    typeof candidate.note === 'string' &&
    typeof candidate.total_collections === 'number' &&
    typeof candidate.root === 'string' &&
    Array.isArray(candidate.groups) &&
    candidate.groups.every(isDesignLibraryGroupShape)
  );
}

export async function fetchDesignLibraryCatalog(): Promise<DesignLibraryCatalogResult> {
  try {
    const resp = await fetch('/api/design-library/catalog');
    if (!resp.ok) {
      const payload = (await resp.json().catch(() => null)) as { error?: string } | null;
      return {
        ok: false,
        notFound: resp.status === 404,
        message: payload?.error || `Request failed (${resp.status})`,
      };
    }
    const payload: unknown = await resp.json();
    if (!isDesignLibraryCatalogShape(payload)) {
      return { ok: false, notFound: false, message: 'Malformed design-library catalog response' };
    }
    return { ok: true, catalog: payload };
  } catch (err) {
    return { ok: false, notFound: false, message: err instanceof Error ? err.message : 'Network error' };
  }
}

/** `thumb` is a rel path like `.catalog/thumbs/x.jpg` — the route only serves basenames. */
export function designLibraryThumbUrl(thumb: string): string {
  const file = thumb.split('/').pop() || thumb;
  return `/api/design-library/thumb/${encodeURIComponent(file)}`;
}

export async function openDesignLibraryPath(rel: string): Promise<boolean> {
  try {
    const resp = await fetch('/api/design-library/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rel }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// Copies a licensed kit's files into a new managed project (only the
// `licensed-source-review` / `own-code` allowed_use tiers reach a "Use as
// template" affordance that calls this — see DesignLibrarySection.tsx).
// Discriminated result mirrors fetchDesignLibraryCatalog above.
export type StartDesignLibraryProjectResult =
  | { ok: true; response: DesignLibraryStartProjectResponse }
  | { ok: false; message: string };

export async function startDesignLibraryProject(
  rel: string,
  name?: string,
  options?: { mode?: 'copy' | 'reference'; aspects?: string[] },
): Promise<StartDesignLibraryProjectResult> {
  try {
    const body = {
      rel,
      ...(name ? { name } : {}),
      ...(options?.mode ? { mode: options.mode } : {}),
      ...(options?.aspects?.length ? { aspects: options.aspects } : {}),
    };
    const resp = await fetch('/api/design-library/start-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const payload = (await resp.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, message: payload?.error || `Request failed (${resp.status})` };
    }
    const response = (await resp.json()) as DesignLibraryStartProjectResponse;
    if (!response?.ok || !response.projectId) {
      return { ok: false, message: 'Could not start a project from this kit.' };
    }
    return { ok: true, response };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Network error' };
  }
}

// --- Storyboard ---------------------------------------------------------

import type {
  DraftStoryboardShotsRequest,
  DraftStoryboardShotsResponse,
  GenerateStoryboardFrameRequest,
  GenerateStoryboardFrameResponse,
  PatchStoryboardRequest,
  RenderStoryboardShotResponse,
  Storyboard,
  StoryboardSummary,
  UploadStoryboardFrameResponse,
} from '@open-design/contracts';

export type StoryboardApiResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      message: string;
      /** HTTP status, when the failure came from a response (vs. a network error). */
      status?: number;
      /**
       * On a 409 (see PatchStoryboardRequest.expectedUpdatedAt), the server's
       * CURRENT doc — callers can reapply their mutation to it and retry
       * instead of losing the edit. Only ever set alongside status === 409.
       */
      conflict?: Storyboard;
    };

async function readStoryboardApiError(resp: Response): Promise<string> {
  try {
    const payload = (await resp.json()) as { error?: { message?: string } | string };
    const message = typeof payload.error === 'string' ? payload.error : payload.error?.message;
    return message || `Request failed (${resp.status})`;
  } catch {
    return `Request failed (${resp.status})`;
  }
}

export async function fetchStoryboardList(): Promise<StoryboardApiResult<StoryboardSummary[]>> {
  try {
    const resp = await fetch('/api/storyboards');
    if (!resp.ok) return { ok: false, message: await readStoryboardApiError(resp) };
    const data = (await resp.json()) as { storyboards: StoryboardSummary[] };
    return { ok: true, value: data.storyboards };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function createStoryboard(title: string): Promise<StoryboardApiResult<Storyboard>> {
  try {
    const resp = await fetch('/api/storyboards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!resp.ok) return { ok: false, message: await readStoryboardApiError(resp) };
    const data = (await resp.json()) as { storyboard: Storyboard };
    return { ok: true, value: data.storyboard };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function fetchStoryboard(id: string): Promise<StoryboardApiResult<Storyboard>> {
  try {
    const resp = await fetch(`/api/storyboards/${encodeURIComponent(id)}`);
    if (!resp.ok) return { ok: false, message: await readStoryboardApiError(resp) };
    const data = (await resp.json()) as { storyboard: Storyboard };
    return { ok: true, value: data.storyboard };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function patchStoryboard(
  id: string,
  patch: PatchStoryboardRequest,
): Promise<StoryboardApiResult<Storyboard>> {
  try {
    const resp = await fetch(`/api/storyboards/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (resp.status === 409) {
      // Optimistic-concurrency conflict (see PatchStoryboardRequest.expectedUpdatedAt):
      // the body is {error:'storyboard changed', storyboard:<current doc>}, not the
      // generic {error:{code,message}} envelope — read it directly so callers get
      // the current doc to reapply their mutation against.
      const payload = (await resp.json().catch(() => null)) as { error?: string; storyboard?: Storyboard } | null;
      return {
        ok: false,
        status: 409,
        message: (payload && typeof payload.error === 'string' && payload.error) || 'storyboard changed',
        conflict: payload?.storyboard,
      };
    }
    if (!resp.ok) return { ok: false, status: resp.status, message: await readStoryboardApiError(resp) };
    const data = (await resp.json()) as { storyboard: Storyboard };
    return { ok: true, value: data.storyboard };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * POST /api/storyboards/:id/style-reference — extracts a style profile from
 * pasted DESIGN.md server-side (brand engine design-md leg) and attaches it
 * to the storyboard so frame/shot prompts inherit it. Returns the updated doc.
 */
export async function setStoryboardStyleReference(
  id: string,
  designMd: string,
  expectedUpdatedAt?: string,
): Promise<StoryboardApiResult<Storyboard>> {
  return styleReferenceMutation(id, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ designMd, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) }),
  });
}

/** DELETE /api/storyboards/:id/style-reference — clears it. Returns the updated doc. */
export async function clearStoryboardStyleReference(
  id: string,
  expectedUpdatedAt?: string,
): Promise<StoryboardApiResult<Storyboard>> {
  return styleReferenceMutation(id, {
    method: 'DELETE',
    ...(expectedUpdatedAt
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedUpdatedAt }),
        }
      : {}),
  });
}

/** Shared transport for both style-reference mutations — same 409 conflict
 * envelope handling as patchStoryboard (see its doc comment). */
async function styleReferenceMutation(
  id: string,
  init: RequestInit,
): Promise<StoryboardApiResult<Storyboard>> {
  try {
    const resp = await fetch(`/api/storyboards/${encodeURIComponent(id)}/style-reference`, init);
    if (resp.status === 409) {
      const payload = (await resp.json().catch(() => null)) as { error?: string; storyboard?: Storyboard } | null;
      return {
        ok: false,
        status: 409,
        message: (payload && typeof payload.error === 'string' && payload.error) || 'storyboard changed',
        conflict: payload?.storyboard,
      };
    }
    if (!resp.ok) return { ok: false, status: resp.status, message: await readStoryboardApiError(resp) };
    const data = (await resp.json()) as { storyboard: Storyboard };
    return { ok: true, value: data.storyboard };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * POST /api/storyboards/:id/draft-shots — drafts several shots at once from
 * a brief (as opposed to the single-shot addShotFromPrompt client-only
 * path). Same 409/expectedUpdatedAt optimistic-concurrency shape as
 * patchStoryboard above, since a draft also appends to and replaces the
 * server's shots array.
 */
export async function draftStoryboardShots(
  id: string,
  body: DraftStoryboardShotsRequest,
): Promise<StoryboardApiResult<DraftStoryboardShotsResponse>> {
  try {
    const resp = await fetch(`/api/storyboards/${encodeURIComponent(id)}/draft-shots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (resp.status === 409) {
      // Same conflict envelope as patchStoryboard's 409 branch (see its
      // comment above): {error:'storyboard changed', storyboard:<current doc>}.
      const payload = (await resp.json().catch(() => null)) as { error?: string; storyboard?: Storyboard } | null;
      return {
        ok: false,
        status: 409,
        message: (payload && typeof payload.error === 'string' && payload.error) || 'storyboard changed',
        conflict: payload?.storyboard,
      };
    }
    if (!resp.ok) return { ok: false, status: resp.status, message: await readStoryboardApiError(resp) };
    return { ok: true, value: (await resp.json()) as DraftStoryboardShotsResponse };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function deleteStoryboard(id: string): Promise<boolean> {
  try {
    const resp = await fetch(`/api/storyboards/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * URL for a generated storyboard still/clip. Reuses the existing generic
 * raw-file route every project already serves (range-request support for
 * `<video>` seeking included) instead of adding a storyboard-specific
 * static route — the hidden `storyboard-media` project is a normal project
 * as far as file serving is concerned.
 */
export function storyboardFrameUrl(relPath: string): string {
  return `/api/projects/storyboard-media/raw/${encodeURIComponent(relPath)}`;
}

/**
 * Uploads a single external image (file-picker or drag-and-drop) into the
 * hidden storyboard-media project. Unlike its StoryboardApiResult siblings
 * above, this throws on failure — callers (StoryboardEditor's per-shot and
 * whole-list upload handlers) already run inside a try/catch that clears
 * their own busy state, so a thrown error is the simplest shape to funnel
 * into that catch.
 */
export async function uploadStoryboardFrame(id: string, dataUrl: string): Promise<UploadStoryboardFrameResponse> {
  const resp = await fetch(`/api/storyboards/${encodeURIComponent(id)}/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl }),
  });
  if (!resp.ok) throw new Error(await readStoryboardApiError(resp));
  return (await resp.json()) as UploadStoryboardFrameResponse;
}

export async function openStoryboardFolder(id: string): Promise<boolean> {
  try {
    const resp = await fetch(`/api/storyboards/${encodeURIComponent(id)}/open-folder`, { method: 'POST' });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function generateStoryboardFrame(
  id: string,
  input: GenerateStoryboardFrameRequest,
): Promise<StoryboardApiResult<GenerateStoryboardFrameResponse>> {
  try {
    const resp = await fetch(`/api/storyboards/${encodeURIComponent(id)}/frames`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!resp.ok) return { ok: false, message: await readStoryboardApiError(resp) };
    return { ok: true, value: (await resp.json()) as GenerateStoryboardFrameResponse };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function renderStoryboardShot(
  id: string,
  shotId: string,
): Promise<StoryboardApiResult<RenderStoryboardShotResponse>> {
  try {
    const resp = await fetch(
      `/api/storyboards/${encodeURIComponent(id)}/shots/${encodeURIComponent(shotId)}/render`,
      { method: 'POST' },
    );
    if (!resp.ok) return { ok: false, message: await readStoryboardApiError(resp) };
    return { ok: true, value: (await resp.json()) as RenderStoryboardShotResponse };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function assembleStoryboard(id: string): Promise<StoryboardApiResult<{ output: string }>> {
  try {
    const resp = await fetch(`/api/storyboards/${encodeURIComponent(id)}/assemble`, { method: 'POST' });
    if (!resp.ok) return { ok: false, message: await readStoryboardApiError(resp) };
    return { ok: true, value: (await resp.json()) as { output: string } };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function exportStoryboardSlider(id: string): Promise<StoryboardApiResult<{ output: string }>> {
  try {
    const resp = await fetch(`/api/storyboards/${encodeURIComponent(id)}/export-slider`, { method: 'POST' });
    if (!resp.ok) return { ok: false, message: await readStoryboardApiError(resp) };
    return { ok: true, value: (await resp.json()) as { output: string } };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Network error' };
  }
}

export interface MediaTaskSnapshot {
  status: 'running' | 'done' | 'failed' | 'interrupted';
  nextSince?: number;
  progress?: string[];
  file?: { name?: string; size?: number; mime?: string };
  error?: { message?: string };
}

/**
 * Polls the EXISTING POST /api/media/tasks/:id/wait long-poll endpoint to
 * completion. No web caller drove media generation directly before the
 * Storyboard feature (generation was always chat-agent/CLI-driven), so
 * there was no browser-side poll helper to reuse — this is deliberately a
 * thin mirror of the CLI's pollUntilDoneOrBudget (apps/daemon/src/cli.ts),
 * minus the process.exit calls a browser has no equivalent for.
 */
export async function waitForMediaTask(
  taskId: string,
  options: { totalBudgetMs?: number; onProgress?: (lines: string[]) => void } = {},
): Promise<MediaTaskSnapshot> {
  const totalBudgetMs = options.totalBudgetMs ?? 15 * 60 * 1000;
  const startedAt = Date.now();
  let since = 0;
  let last: MediaTaskSnapshot = { status: 'running' };
  while (Date.now() - startedAt < totalBudgetMs) {
    const remaining = totalBudgetMs - (Date.now() - startedAt);
    const timeoutMs = Math.max(500, Math.min(20_000, remaining));
    let resp: Response;
    try {
      resp = await fetch(`/api/media/tasks/${encodeURIComponent(taskId)}/wait`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ since, timeoutMs }),
      });
    } catch (err) {
      return { status: 'failed', error: { message: err instanceof Error ? err.message : 'Network error' } };
    }
    if (!resp.ok) {
      return { status: 'failed', error: { message: await readStoryboardApiError(resp) } };
    }
    const snap = (await resp.json()) as MediaTaskSnapshot;
    last = snap;
    if (Array.isArray(snap.progress) && snap.progress.length > 0) options.onProgress?.(snap.progress);
    if (typeof snap.nextSince === 'number') since = snap.nextSince;
    if (snap.status === 'done' || snap.status === 'failed' || snap.status === 'interrupted') return snap;
  }
  return last;
}
