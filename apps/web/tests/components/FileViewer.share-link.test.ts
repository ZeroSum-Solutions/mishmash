import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  pickLatestShareDeployment,
  resolveShareUrl,
  shareUrlForDeployment,
} from '../../src/components/FileViewer';
import type { WebDeployProviderId, WebDeploymentInfo } from '../../src/providers/registry';

function deployment(overrides: Partial<WebDeploymentInfo> = {}): WebDeploymentInfo {
  return {
    id: 'dep-1',
    projectId: 'project-1',
    fileName: 'index.html',
    providerId: 'vercel-self',
    url: 'https://demo.vercel.app',
    deploymentCount: 1,
    target: 'production',
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as WebDeploymentInfo;
}

describe('shareUrlForDeployment', () => {
  it('uses the plain deployment URL for a non-Cloudflare provider', () => {
    expect(shareUrlForDeployment(deployment({ providerId: 'vercel-self', url: 'https://demo.vercel.app' })))
      .toBe('https://demo.vercel.app');
  });

  it('prefers a ready Cloudflare custom domain over the raw pages.dev URL', () => {
    const dep = deployment({
      providerId: 'cloudflare-pages',
      url: 'https://demo.pages.dev',
      cloudflarePages: {
        projectName: 'demo',
        pagesDev: { url: 'https://demo.pages.dev', status: 'ready' },
        customDomain: {
          hostname: 'demo.example.com',
          url: 'https://demo.example.com',
          zoneId: 'zone-1',
          zoneName: 'example.com',
          domainPrefix: 'demo',
          status: 'ready',
        },
      },
    });
    expect(shareUrlForDeployment(dep)).toBe('https://demo.example.com');
  });

  it('falls back to the raw deployment URL when the Cloudflare custom domain is not ready yet', () => {
    const dep = deployment({
      providerId: 'cloudflare-pages',
      url: 'https://demo.pages.dev',
      cloudflarePages: {
        projectName: 'demo',
        pagesDev: { url: 'https://demo.pages.dev', status: 'ready' },
        customDomain: {
          hostname: 'demo.example.com',
          url: 'https://demo.example.com',
          zoneId: 'zone-1',
          zoneName: 'example.com',
          domainPrefix: 'demo',
          status: 'pending',
        },
      },
    });
    expect(shareUrlForDeployment(dep)).toBe('https://demo.pages.dev');
  });

  it('ignores a ready custom domain on a non-Cloudflare deployment even if the field is present', () => {
    // A non-Cloudflare deployment should never key off cloudflarePages —
    // guards against a future provider reusing the same shape and
    // accidentally routing through the Cloudflare-only branch.
    const dep = deployment({
      providerId: 'vercel-self',
      url: 'https://demo.vercel.app',
      cloudflarePages: {
        projectName: 'demo',
        pagesDev: { url: 'https://demo.pages.dev', status: 'ready' },
        customDomain: {
          hostname: 'demo.example.com',
          url: 'https://demo.example.com',
          zoneId: 'zone-1',
          zoneName: 'example.com',
          domainPrefix: 'demo',
          status: 'ready',
        },
      },
    });
    expect(shareUrlForDeployment(dep)).toBe('https://demo.vercel.app');
  });

  it('returns an empty string when the deployment has no URL', () => {
    expect(shareUrlForDeployment(deployment({ url: '' }))).toBe('');
  });
});

describe('resolveShareUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves a relative path against the current window origin in a browser context', () => {
    vi.stubGlobal('window', { location: { origin: 'https://app.example.com' } });
    expect(resolveShareUrl('/p/project-1')).toBe('https://app.example.com/p/project-1');
  });

  it('returns an absolute http(s) URL unchanged', () => {
    expect(resolveShareUrl('https://demo.example.com/page')).toBe('https://demo.example.com/page');
    expect(resolveShareUrl('http://demo.example.com')).toBe('http://demo.example.com');
  });

  it('trims surrounding whitespace before checking for an absolute URL', () => {
    expect(resolveShareUrl('  https://demo.example.com  ')).toBe('https://demo.example.com');
  });

  it('returns an empty string for an empty or whitespace-only input', () => {
    expect(resolveShareUrl('')).toBe('');
    expect(resolveShareUrl('   ')).toBe('');
  });

  it('returns a relative path unresolved when there is no window (SSR/node)', () => {
    // This suite runs under the default node test environment (no DOM), so
    // it exercises the real `typeof window === 'undefined'` guard rather than
    // stubbing it — the relative path is handed back unchanged instead of
    // throwing on a missing `window.location`.
    expect(typeof window).toBe('undefined');
    expect(resolveShareUrl('/p/project-1')).toBe('/p/project-1');
  });
});

describe('pickLatestShareDeployment', () => {
  it('returns null when there are no deployments', () => {
    expect(pickLatestShareDeployment({})).toBeNull();
  });

  it('picks the most recently updated deployment across providers', () => {
    const older = deployment({ providerId: 'vercel-self', updatedAt: 100, url: 'https://older.vercel.app' });
    const newer = deployment({ providerId: 'cloudflare-pages', updatedAt: 200, url: 'https://newer.pages.dev' });
    const byProvider: Partial<Record<WebDeployProviderId, WebDeploymentInfo>> = {
      'vercel-self': older,
      'cloudflare-pages': newer,
    };
    expect(pickLatestShareDeployment(byProvider)).toBe(newer);
  });

  it('skips a failed deployment even when it is the newest', () => {
    const failed = deployment({ providerId: 'cloudflare-pages', updatedAt: 300, url: 'https://failed.pages.dev', status: 'failed' });
    const ready = deployment({ providerId: 'vercel-self', updatedAt: 100, url: 'https://ready.vercel.app', status: 'ready' });
    const byProvider: Partial<Record<WebDeployProviderId, WebDeploymentInfo>> = {
      'cloudflare-pages': failed,
      'vercel-self': ready,
    };
    expect(pickLatestShareDeployment(byProvider)).toBe(ready);
  });

  it('skips a deployment that resolves to an empty share URL', () => {
    // A ready Cloudflare deployment whose pending custom domain has no ready
    // URL and no raw url either — shareUrlForDeployment returns '' for it, so
    // it must not be surfaced as "the" share link even though it's newest.
    const emptyUrl = deployment({
      providerId: 'cloudflare-pages',
      updatedAt: 300,
      url: '',
      status: 'ready',
    });
    const usable = deployment({ providerId: 'vercel-self', updatedAt: 100, url: 'https://ready.vercel.app' });
    const byProvider: Partial<Record<WebDeployProviderId, WebDeploymentInfo>> = {
      'cloudflare-pages': emptyUrl,
      'vercel-self': usable,
    };
    expect(pickLatestShareDeployment(byProvider)).toBe(usable);
  });
});
