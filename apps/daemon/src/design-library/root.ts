import os from 'node:os';
import path from 'node:path';

/** Resolve the one Design Assets read root for the current request/test environment. */
export function configuredDesignLibraryRoot(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const configured = env.OD_DESIGN_LIBRARY_DIR;
  return configured && configured.trim().length > 0 ? path.resolve(configured) : null;
}

export function designLibraryRoot(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = os.homedir(),
): string {
  return configuredDesignLibraryRoot(env)
    ?? path.join(homeDirectory, 'Desktop', 'Design Assets');
}
