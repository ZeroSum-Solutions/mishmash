// Typeface catalogue — thin client for /api/typefaces*, mirroring the
// `od typefaces` CLI subcommand (apps/daemon/src/cli.ts) so both surfaces
// call the identical daemon endpoint. See
// apps/daemon/src/typefaces/catalogue.ts for what the index actually is.
import type {
  GetTypefaceResponse,
  InstallTypefaceRequest,
  InstallTypefaceResponse,
  ListTypefacesQuery,
  ListTypefacesResponse,
  TypefaceDetail,
  TypefaceSummary,
} from '@open-design/contracts';

export async function fetchTypefaces(query: ListTypefacesQuery = {}): Promise<{ typefaces: TypefaceSummary[]; scannedFamilies: number }> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.monospace != null) params.set('monospace', String(query.monospace));
  if (query.condensed) params.set('condensed', 'true');
  const qs = params.toString();
  try {
    const resp = await fetch(`/api/typefaces${qs ? `?${qs}` : ''}`);
    if (!resp.ok) return { typefaces: [], scannedFamilies: 0 };
    const json = (await resp.json()) as ListTypefacesResponse;
    return { typefaces: json.typefaces ?? [], scannedFamilies: json.scannedFamilies ?? 0 };
  } catch {
    return { typefaces: [], scannedFamilies: 0 };
  }
}

export async function fetchTypeface(id: string): Promise<TypefaceDetail | null> {
  try {
    const resp = await fetch(`/api/typefaces/${encodeURIComponent(id)}`);
    if (!resp.ok) return null;
    const json = (await resp.json()) as GetTypefaceResponse;
    return json.typeface;
  } catch {
    return null;
  }
}

export type InstallTypefaceOutcome =
  | { ok: true; result: InstallTypefaceResponse }
  | { ok: false; message: string };

export async function installTypefaceIntoProject(
  id: string,
  request: InstallTypefaceRequest,
): Promise<InstallTypefaceOutcome> {
  try {
    const resp = await fetch(`/api/typefaces/${encodeURIComponent(id)}/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const json = await resp.json().catch(() => null);
    if (!resp.ok) {
      const message = (json as { error?: { message?: string } } | null)?.error?.message ?? `install failed (${resp.status})`;
      return { ok: false, message };
    }
    return { ok: true, result: json as InstallTypefaceResponse };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Stable, cache-friendly URL for one indexed face's raw woff2 bytes (R1/R8). Mirrors projectRawUrl's per-segment-encoding convention (apps/web/src/providers/registry.ts:2220-2227). */
export function typefaceFaceUrl(id: string, file: string): string {
  return `/api/typefaces/${encodeURIComponent(id)}/faces/${encodeURIComponent(file)}`;
}
