import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as spaShellRoute from '../../app/[[...slug]]/page';

const WEB_ROOT = dirname(fileURLToPath(new URL('../../..', import.meta.url)));

async function loadNextConfig() {
  vi.resetModules();
  return (await import('../../next.config')).default;
}

afterEach(() => {
  delete process.env.OD_WEB_DIST_DIR;
  delete process.env.OD_WEB_OUTPUT_MODE;
  vi.resetModules();
});

describe('SPA shell export route', () => {
  it('stays compatible with static export builds', async () => {
    const nextConfig = await loadNextConfig();
    expect(nextConfig.output).toBe('export');
    expect(nextConfig.distDir).toBeUndefined();
    expect(nextConfig.productionBrowserSourceMaps).toBe(false);
    expect('dynamicParams' in spaShellRoute).toBe(false);
    expect(spaShellRoute.generateStaticParams()).toEqual([{ slug: [] }]);
  });

  it.each(['server', 'standalone'] as const)(
    'keeps browser source maps for the packaged %s build',
    async (outputMode) => {
      process.env.OD_WEB_OUTPUT_MODE = outputMode;

      const nextConfig = await loadNextConfig();

      expect(nextConfig.output).toBe(outputMode === 'standalone' ? 'standalone' : undefined);
      expect(nextConfig.productionBrowserSourceMaps).toBe(true);
    },
  );

  it('keeps an explicit dist dir override even when static export is selected', async () => {
    const configuredDistDir = resolve(WEB_ROOT, '.tmp', 'vitest-next');
    process.env.OD_WEB_DIST_DIR = configuredDistDir;

    const nextConfig = await loadNextConfig();

    expect(nextConfig.output).toBe('export');
    expect(nextConfig.distDir).toContain('vitest-next');
  });

  it('treats an empty dist dir override as unset for static export builds', async () => {
    process.env.OD_WEB_DIST_DIR = '';

    const nextConfig = await loadNextConfig();

    expect(nextConfig.output).toBe('export');
    expect(nextConfig.distDir).toBeUndefined();
  });
});
