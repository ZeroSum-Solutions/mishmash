import type { Express } from 'express';
import type {
  OpenDesignDiscordPresenceResponse,
  OpenDesignGithubLatestReleaseResponse,
  OpenDesignGithubRepoResponse,
} from '@open-design/contracts';
import type { RouteDeps } from '../server-context.js';
import type { OpenDesignPublicMetadataService } from '../services/open-design-public-metadata.js';

export interface RegisterOpenDesignPublicMetadataRoutesDeps extends RouteDeps<'http'> {
  openDesignPublicMetadata: OpenDesignPublicMetadataService;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerOpenDesignPublicMetadataRoutes(
  app: Express,
  ctx: RegisterOpenDesignPublicMetadataRoutesDeps,
): void {
  const { openDesignPublicMetadata } = ctx;

  app.get('/api/github/open-design', async (_req, res) => {
    try {
      const stats = await openDesignPublicMetadata.readGithubRepoStats();
      const payload: OpenDesignGithubRepoResponse = {
        repo: 'wiggdevin/mishmash',
        stargazers_count: stats.stargazersCount,
        fetchedAt: stats.fetchedAt,
        stale: stats.stale,
      };
      res.json(payload);
    } catch (error) {
      res.status(502).json({ error: errorMessage(error) });
    }
  });

  app.get('/api/github/open-design/releases/latest', async (_req, res) => {
    try {
      const release = await openDesignPublicMetadata.readLatestReleaseInfo();
      const payload: OpenDesignGithubLatestReleaseResponse = {
        repo: 'wiggdevin/mishmash',
        tag_name: release.tagName,
        html_url: release.htmlUrl,
        fetchedAt: release.fetchedAt,
        stale: release.stale,
      };
      res.json(payload);
    } catch (error) {
      res.status(502).json({ error: errorMessage(error) });
    }
  });

  app.get('/api/community/discord', async (_req, res) => {
    try {
      const presence = await openDesignPublicMetadata.readDiscordPresence();
      const payload: OpenDesignDiscordPresenceResponse = {
        // No public community Discord exists for this private, internal
        // fork (docs/FORK-PIN.md) -- empty strings signal "not configured"
        // rather than re-serving the upstream project's invite.
        inviteCode: '',
        inviteUrl: '',
        onlineCount: presence.onlineCount,
        memberCount: presence.memberCount,
        fetchedAt: presence.fetchedAt,
        stale: presence.stale,
      };
      res.json(payload);
    } catch (error) {
      res.status(502).json({ error: errorMessage(error) });
    }
  });
}
