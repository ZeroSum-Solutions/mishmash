export interface AgentModelPrefs {
  model?: string;
  reasoning?: string;
}

export type AgentCliEnvPrefs = Record<string, Record<string, string>>;
export type AgentCliEnvIntentPrefs = Record<string, { apiKeyOverride?: boolean }>;

export interface TelemetryPrefs {
  metrics?: boolean;
  content?: boolean;
  artifactManifest?: boolean;
}

export interface OrbitConfigPrefs {
  enabled: boolean;
  /** Local 24-hour clock time in HH:mm format. Defaults to 08:00. */
  time: string;
  /** Optional skill id from the examples gallery where scenario === "orbit". */
  templateSkillId?: string | null;
}

export interface ProjectLocationPrefs {
  id: string;
  name: string;
  path: string;
}

export interface AppConfigPrefs {
  onboardingCompleted?: boolean;
  agentId?: string | null;
  agentModels?: Record<string, AgentModelPrefs>;
  agentCliEnv?: AgentCliEnvPrefs;
  agentCliEnvIntent?: AgentCliEnvIntentPrefs;
  skillId?: string | null;
  designSystemId?: string | null;
  disabledSkills?: string[];
  disabledDesignSystems?: string[];
  installationId?: string | null;
  telemetry?: TelemetryPrefs;
  /**
   * Unix-millis timestamp of when the user resolved the first-run privacy
   * consent surface (Share or Decline). Set on first decision and on
   * subsequent toggles in Settings → Privacy. Independent of
   * installationId so that "Delete my data" can rotate the id without
   * re-popping the consent banner.
   */
  privacyDecisionAt?: number | null;
  allowSilentUpdates?: boolean;
  orbit?: OrbitConfigPrefs;
  customInstructions?: string | null;
  /** External project library roots. The daemon adds its built-in .od/projects location at read time. */
  projectLocations?: ProjectLocationPrefs[];
  /** Project location id used for new projects when the create request does not choose one explicitly. */
  defaultProjectLocationId?: string | null;
  /**
   * Most-recently-used local working directories the user granted the agent
   * read access to (via the Home composer's working-directory picker). These
   * become a new project's `metadata.linkedDirs` — the agent perceives them
   * through `--add-dir`; they are NOT imported into Design Files. Stored
   * most-recent-first and capped by the daemon.
   */
  recentLinkedDirs?: string[];
  /**
   * Which routing-policy generation produced the archive this config came from.
   * Written only by the daemon's backup path (`apps/daemon/src/backup/create.ts`)
   * into the ARCHIVED copy, and preserved on the way back in so a restored
   * config still says which policy its telemetry should be read against.
   *
   * Server-owned: it appears in `GET` responses but is absent from
   * `UpdateAppConfigRequest`, and the daemon discards a client-supplied value.
   * `null` records "policy version unavailable when the archive was produced".
   */
  routingPolicyVersion?: number | null;
}

export interface AppConfigResponse {
  config: AppConfigPrefs;
}

/**
 * Keys the daemon owns outright. They are part of the persisted/read config
 * shape above, but a client may not set them, so they are omitted from the
 * update request rather than left implicitly writable.
 */
export type ServerOwnedAppConfigKey = 'routingPolicyVersion';

export type UpdateAppConfigRequest = Partial<Omit<AppConfigPrefs, ServerOwnedAppConfigKey>>;

/** Response body for `GET /api/recent-dirs` — recent working directories
 *  pruned to those that still exist on disk, most-recent-first. */
export interface RecentLinkedDirsResponse {
  dirs: string[];
}
