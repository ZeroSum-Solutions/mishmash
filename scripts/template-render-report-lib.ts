import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

type InlineRelativeAssets = (
  html: string,
  projectId: string,
  fileName: string,
  projectFilePaths: ReadonlySet<string> | null,
  access: {
    fetch: typeof globalThis.fetch;
    rawUrl: (projectId: string, filePath: string) => string;
  },
) => Promise<string>;

const runtimeRequire = createRequire(import.meta.url);
const { assetBaseDirFor, inlineRelativeAssets } = runtimeRequire(
  "../apps/web/src/components/file-viewer-preview-assets.ts",
) as {
  assetBaseDirFor: (filePath: string) => string;
  inlineRelativeAssets: InlineRelativeAssets;
};
const { projectRawUrl } = runtimeRequire("../apps/web/src/providers/registry.ts") as {
  projectRawUrl: (projectId: string, filePath: string) => string;
};
const { buildSrcdoc } = runtimeRequire("../apps/web/src/runtime/srcdoc.ts") as {
  buildSrcdoc: (source: string, options: Record<string, unknown>) => string;
};

export interface BlockedResourceEvent {
  url: string;
  reason: "csp" | "requestfailed" | "http-error";
  detail: string;
}

export interface BlockedResourceSummary {
  eventCount: number;
  distinctUrlCount: number;
  cspCount: number;
  remoteCount: number;
  localCount: number;
  byUrl: Map<string, BlockedResourceEvent>;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return ipv4?.[1] === "127";
}

export function summarizeBlockedEvents(
  blocked: readonly BlockedResourceEvent[],
): BlockedResourceSummary {
  const byUrl = new Map<string, BlockedResourceEvent>();
  for (const entry of blocked) {
    const existing = byUrl.get(entry.url);
    if (!existing || (existing.reason !== "csp" && entry.reason === "csp")) {
      byUrl.set(entry.url, entry);
    }
  }

  let cspCount = 0;
  let remoteCount = 0;
  let localCount = 0;
  for (const entry of byUrl.values()) {
    if (entry.reason === "csp" || entry.detail === "csp") cspCount += 1;
    try {
      const url = new URL(entry.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (isLoopbackHost(url.hostname)) localCount += 1;
      else remoteCount += 1;
    } catch {
      // Inline/eval CSP targets are not subresource hosts. They remain in the
      // distinct and CSP counts but do not belong to local or remote buckets.
    }
  }

  return {
    eventCount: blocked.length,
    distinctUrlCount: byUrl.size,
    cspCount,
    remoteCount,
    localCount,
    byUrl,
  };
}

export function projectEntryFile(project: unknown): string | null {
  if (!project || typeof project !== "object") return null;
  const metadata = (project as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const entryFile = (metadata as { entryFile?: unknown }).entryFile;
  return typeof entryFile === "string" && entryFile.trim().length > 0 ? entryFile : null;
}

export async function prepareCanvasRenderDocument(input: {
  projectId: string;
  entryFile: string;
  projectFilePaths: ReadonlySet<string>;
  webOrigin: string;
  fetch: typeof globalThis.fetch;
}): Promise<{ srcdoc: string; targetUrl: string; httpStatus: number }> {
  const absoluteRawUrl = (projectId: string, filePath: string) =>
    new URL(projectRawUrl(projectId, filePath), input.webOrigin).href;
  const targetUrl = absoluteRawUrl(input.projectId, input.entryFile);
  const entryResponse = await input.fetch(targetUrl);
  if (!entryResponse.ok) {
    throw new Error(`entry HTML fetch failed (${entryResponse.status}): ${targetUrl}`);
  }
  const source = await entryResponse.text();
  const inlined = await inlineRelativeAssets(
    source,
    input.projectId,
    input.entryFile,
    input.projectFilePaths,
    { fetch: input.fetch, rawUrl: absoluteRawUrl },
  );
  const baseHref = absoluteRawUrl(input.projectId, assetBaseDirFor(input.entryFile));
  return {
    targetUrl,
    httpStatus: entryResponse.status,
    srcdoc: buildSrcdoc(inlined, {
      baseHref,
      selectionBridge: true,
      editBridge: true,
      paletteBridge: false,
      previewFocusGuard: true,
      reloadKey: 0,
    }),
  };
}

export async function replaceJsonLinesAtomically(outputPath: string, records: readonly unknown[]): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  const body = records.length === 0 ? "" : `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  await writeFile(temporaryPath, body, "utf8");
  await rename(temporaryPath, outputPath);
}
