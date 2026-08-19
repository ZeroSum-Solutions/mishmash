// F001 R6 -- design advisor HTTP surface: brief -> matched archetype (R4) ->
// ranked design-templates/index.json candidates with a named rationale
// (R5). Mirrors apps/daemon/src/routes/catalogue-match.ts's shape -- one
// endpoint, shared by this route and `od design-advisor recommend`
// (apps/daemon/src/cli.ts), per AGENTS.md "Capability exposure".
//
// R7 (the `gallery-select` GenUI surface, and a chat-agent triggering this
// endpoint mid-conversation) is intentionally NOT wired here -- see
// NOTES.md. It is parked on the still-open GenUI invocation architecture
// decision (CROSS-CUTTING-CORRECTIONS.md "Decisions required" #2): every
// existing GenUI surface request goes through the plugin-pipeline system
// with a real `pluginSnapshotId`, and there is no precedent for a
// non-plugin caller. This route is the plain request/response half F001 R6
// says is buildable independently of that decision -- it never touches
// apps/daemon/src/genui/*.

import { existsSync, readFileSync } from 'node:fs';
import express, { type Express } from 'express';
import {
  DESIGN_ADVISOR_DEFAULT_LIMIT,
  DESIGN_ADVISOR_MAX_LIMIT,
  type DesignAdvisorResponse,
} from '@open-design/contracts';
import { matchArchetype } from '../design/brief-extraction.js';
import { rankCandidates, type DesignIndexRow } from '../design/rank-candidates.js';
import { ARCHETYPES } from '../design/site-archetypes.js';

export interface DesignAdvisorRouteDeps {
  /** Absolute path to design-templates/index.json (F001 R1's build artifact). */
  designIndexPath: string;
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DESIGN_ADVISOR_DEFAULT_LIMIT;
  return Math.max(1, Math.min(DESIGN_ADVISOR_MAX_LIMIT, Math.floor(limit)));
}

/** Loads and parses design-templates/index.json. Exported for direct testing without standing up an Express app. */
export function loadDesignIndexRows(designIndexPath: string): DesignIndexRow[] {
  if (!existsSync(designIndexPath)) return [];
  const parsed = JSON.parse(readFileSync(designIndexPath, 'utf8')) as { templates?: DesignIndexRow[] };
  return Array.isArray(parsed.templates) ? parsed.templates : [];
}

export function registerDesignAdvisorRoutes(app: Express, deps: DesignAdvisorRouteDeps): void {
  const { designIndexPath } = deps;

  app.post('/api/design-advisor/recommend', express.json({ limit: '64kb' }), async (req, res) => {
    const body = (req.body ?? {}) as { prompt?: unknown; limit?: unknown };
    const prompt = typeof body.prompt === 'string' ? body.prompt : '';
    if (prompt.trim().length === 0) {
      res.status(400).json({ ok: false, error: 'missing `prompt`' });
      return;
    }
    const limit = clampLimit(typeof body.limit === 'number' ? body.limit : undefined);

    const archetypes = Object.values(ARCHETYPES);
    const match = matchArchetype(archetypes, prompt);
    if (!match) {
      const response: DesignAdvisorResponse = { archetypeId: null, candidates: [] };
      res.json(response);
      return;
    }
    const archetype = ARCHETYPES[match.archetypeId];
    if (!archetype) {
      // Unreachable in practice -- match.archetypeId always comes from
      // Object.values(ARCHETYPES) above -- but fail loudly rather than
      // silently rather than assume.
      res.status(500).json({ ok: false, error: `matched archetype "${match.archetypeId}" not found` });
      return;
    }

    if (!existsSync(designIndexPath)) {
      console.warn('[design-advisor] design-templates/index.json missing:', designIndexPath);
      res.status(500).json({ ok: false, error: 'design index not built -- run scripts/build-design-index.ts' });
      return;
    }
    let rows: DesignIndexRow[];
    try {
      rows = loadDesignIndexRows(designIndexPath);
    } catch (err) {
      console.warn('[design-advisor] failed to parse design index:', (err as Error)?.message ?? err);
      res.status(500).json({ ok: false, error: 'failed to load the design index' });
      return;
    }

    const ranked = rankCandidates(archetype, rows);
    const response: DesignAdvisorResponse = {
      archetypeId: archetype.id,
      candidates: ranked.slice(0, limit),
    };
    res.json(response);
  });
}
