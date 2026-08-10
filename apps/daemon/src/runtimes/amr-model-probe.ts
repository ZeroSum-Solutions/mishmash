import {
  applyAgentLaunchEnv,
  getAgentDef,
  resolveAgentLaunch,
  spawnEnvForAgent,
} from '../agents.js';
import { agentCliEnvForAgent, type readAppConfig } from '../app-config.js';
import { readVelaCredentialRevision } from '../integrations/vela.js';
import type { VelaCredentialRevision } from '../integrations/vela.js';

/**
 * The optional AMR (vela) runtime is not installed / not resolvable on this
 * host. Callers that surface the model catalog treat this as "no catalog",
 * not as a server error.
 */
export class AmrVelaUnresolvedError extends Error {
  constructor() {
    super('AMR vela binary could not be resolved');
    this.name = 'AmrVelaUnresolvedError';
  }
}

export interface ResolveAmrModelProbeDeps {
  dataDir: string;
  env: NodeJS.ProcessEnv;
  readAppConfig: typeof readAppConfig;
}

export interface BuildAmrModelCacheKeyInput {
  launchPath: string;
  env: NodeJS.ProcessEnv;
  credentialRevision: VelaCredentialRevision;
}

export function buildAmrModelCacheKey({
  launchPath,
  env,
  credentialRevision,
}: BuildAmrModelCacheKeyInput): string {
  return JSON.stringify({
    launchPath,
    home: env.HOME ?? env.USERPROFILE ?? '',
    openDesignAmrProfile: env.OPEN_DESIGN_AMR_PROFILE ?? '',
    velaProfile: env.VELA_PROFILE ?? '',
    velaLinkUrl: env.VELA_LINK_URL ?? '',
    velaRuntimeKey: env.VELA_RUNTIME_KEY ?? '',
    velaOpencodeBin: env.VELA_OPENCODE_BIN ?? '',
    credentialRevision,
  });
}

export async function resolveAmrModelProbe({
  dataDir,
  env: baseEnv,
  readAppConfig,
}: ResolveAmrModelProbeDeps) {
  const appConfig = await readAppConfig(dataDir);
  const configuredEnv = agentCliEnvForAgent(appConfig.agentCliEnv, 'amr');
  const def = getAgentDef('amr');
  if (!def) throw new Error('AMR runtime definition is missing');
  const agentLaunch = resolveAgentLaunch(def, configuredEnv);
  const launchPath = agentLaunch.launchPath ?? agentLaunch.selectedPath;
  if (!launchPath) throw new AmrVelaUnresolvedError();
  const env = applyAgentLaunchEnv(
    spawnEnvForAgent(
      def.id,
      {
        ...baseEnv,
        ...(def.env || {}),
      },
      configuredEnv,
      undefined,
    ),
    agentLaunch,
  );
  const credentialRevision = readVelaCredentialRevision(baseEnv, configuredEnv);
  const cacheKey = buildAmrModelCacheKey({
    launchPath,
    env,
    credentialRevision,
  });
  return { launchPath, env, configuredEnv, cacheKey };
}
