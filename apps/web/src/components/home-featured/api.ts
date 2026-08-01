// Home featured row — local fetch wrapper for Stream A's
// `POST /api/design-library/start-project` endpoint (see
// docs/plans/2026-08-01-ui8-kit-starters-and-home-restructure.md §Stream A
// and §Stream B). Stream B lands ahead of Stream A's merge, so this file
// codes against the endpoint's documented response shape directly instead
// of importing a helper that doesn't exist on this branch yet.
//
// MERGE NOTE: once Stream A lands `startDesignLibraryProject` in
// `apps/web/src/providers/registry.ts`, delete this file and import that
// helper from FeaturedTemplatesRow instead. Keep the same call signature
// (`startDesignLibraryProject(rel, name?)`) so the swap is a one-line import
// change.

export interface StartDesignLibraryProjectSuccess {
  ok: true;
  projectId: string;
  conversationId: string | null;
  entryFile?: string;
}

export interface StartDesignLibraryProjectFailure {
  ok: false;
  status: number;
  message: string;
}

export type StartDesignLibraryProjectResult =
  | StartDesignLibraryProjectSuccess
  | StartDesignLibraryProjectFailure;

interface StartDesignLibraryProjectPayload {
  ok?: boolean;
  projectId?: string;
  conversationId?: string | null;
  entryFile?: string;
  error?: string;
}

export async function startDesignLibraryProject(
  rel: string,
  name?: string,
): Promise<StartDesignLibraryProjectResult> {
  try {
    const resp = await fetch('/api/design-library/start-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(name ? { rel, name } : { rel }),
    });
    const payload = (await resp.json().catch(() => null)) as StartDesignLibraryProjectPayload | null;
    if (!resp.ok || !payload?.ok || !payload.projectId) {
      return {
        ok: false,
        status: resp.status,
        message: payload?.error || `Request failed (${resp.status})`,
      };
    }
    return {
      ok: true,
      projectId: payload.projectId,
      conversationId: payload.conversationId ?? null,
      ...(payload.entryFile ? { entryFile: payload.entryFile } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : 'Network error',
    };
  }
}
