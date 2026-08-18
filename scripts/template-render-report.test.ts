import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import * as reportLib from "./template-render-report-lib.ts";

const { replaceJsonLinesAtomically } = reportLib;

type BlockedEntry = {
  url: string;
  reason: "csp" | "requestfailed" | "http-error";
  detail: string;
};

type BlockedSummary = {
  eventCount: number;
  distinctUrlCount: number;
  cspCount: number;
  remoteCount: number;
  localCount: number;
  byUrl: Map<string, BlockedEntry>;
};

type SummarizeBlocked = (blocked: BlockedEntry[]) => BlockedSummary;

type AuthoritativeEntryFile = (project: unknown) => string | null;

type PrepareCanvasDocument = (input: {
  projectId: string;
  entryFile: string;
  projectFilePaths: ReadonlySet<string>;
  webOrigin: string;
  fetch: typeof globalThis.fetch;
}) => Promise<{ srcdoc: string; targetUrl: string; httpStatus: number }>;

test("replaceJsonLinesAtomically leaves one clean invocation instead of appending runs", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mishmash-render-report-"));
  const artifact = path.join(dir, "census.jsonl");

  try {
    await replaceJsonLinesAtomically(artifact, [
      { surface: "gallery-card", id: "first" },
      { surface: "canvas-raw-file", id: "first" },
    ]);
    await replaceJsonLinesAtomically(artifact, [{ surface: "canvas-raw-file", id: "second" }]);

    const lines = (await readFile(artifact, "utf8")).trim().split("\n");
    assert.deepEqual(lines.map((line) => JSON.parse(line)), [
      { surface: "canvas-raw-file", id: "second" },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("summarizeBlockedEvents counts retry noise once per URL while retaining the raw event count", () => {
  const summarizeBlockedEvents = (
    reportLib as typeof reportLib & { summarizeBlockedEvents?: SummarizeBlocked }
  ).summarizeBlockedEvents;
  assert.equal(typeof summarizeBlockedEvents, "function");
  if (!summarizeBlockedEvents) return;

  const summary = summarizeBlockedEvents([
    { url: "https://fonts.example/font.woff2", reason: "requestfailed", detail: "net::ERR_FAILED" },
    { url: "https://fonts.example/font.woff2", reason: "requestfailed", detail: "net::ERR_FAILED" },
    { url: "https://fonts.example/font.woff2", reason: "csp", detail: "font-src (enforce)" },
  ]);

  assert.equal(summary.eventCount, 3);
  assert.equal(summary.distinctUrlCount, 1);
  assert.equal(summary.cspCount, 1);
  assert.equal(summary.remoteCount, 1);
  assert.equal(summary.localCount, 0);
  assert.equal(summary.byUrl.get("https://fonts.example/font.woff2")?.reason, "csp");
});

test("summarizeBlockedEvents splits distinct loopback URLs from remote URLs", () => {
  const summarizeBlockedEvents = (
    reportLib as typeof reportLib & { summarizeBlockedEvents?: SummarizeBlocked }
  ).summarizeBlockedEvents;
  assert.equal(typeof summarizeBlockedEvents, "function");
  if (!summarizeBlockedEvents) return;

  const summary = summarizeBlockedEvents([
    { url: "http://127.0.0.1:59920/assets/a.js", reason: "requestfailed", detail: "failed" },
    { url: "http://localhost:59920/assets/b.css", reason: "http-error", detail: "404" },
    { url: "http://[::1]:59920/assets/c.png", reason: "requestfailed", detail: "failed" },
    { url: "https://cdn.example/assets/d.js", reason: "requestfailed", detail: "failed" },
    { url: "(inline)", reason: "csp", detail: "script-src-elem (enforce)" },
  ]);

  assert.equal(summary.distinctUrlCount, 5);
  assert.equal(summary.localCount, 3);
  assert.equal(summary.remoteCount, 1);
  assert.equal(summary.cspCount, 1);
});

test("projectEntryFile trusts the daemon metadata even when another HTML file sorts first", () => {
  const projectEntryFile = (
    reportLib as typeof reportLib & { projectEntryFile?: AuthoritativeEntryFile }
  ).projectEntryFile;
  assert.equal(typeof projectEntryFile, "function");
  if (!projectEntryFile) return;

  assert.equal(
    projectEntryFile({ metadata: { entryFile: "pages/home.html" } }),
    "pages/home.html",
  );
});

test("projectEntryFile returns null when the daemon supplied no entryFile", () => {
  const projectEntryFile = (
    reportLib as typeof reportLib & { projectEntryFile?: AuthoritativeEntryFile }
  ).projectEntryFile;
  assert.equal(typeof projectEntryFile, "function");
  if (!projectEntryFile) return;

  assert.equal(projectEntryFile({ metadata: {} }), null);
  assert.equal(projectEntryFile({ metadata: { entryFile: "  " } }), null);
});

test("prepareCanvasRenderDocument fetches in the parent, inlines assets, and builds srcdoc", async () => {
  const prepareCanvasRenderDocument = (
    reportLib as typeof reportLib & { prepareCanvasRenderDocument?: PrepareCanvasDocument }
  ).prepareCanvasRenderDocument;
  assert.equal(typeof prepareCanvasRenderDocument, "function");
  if (!prepareCanvasRenderDocument) return;

  const origin = "http://127.0.0.1:59920";
  const base = `${origin}/api/projects/p1/raw/`;
  const responses = new Map<string, Response>([
    [
      `${base}pages/index.html`,
      new Response(
        '<!doctype html><html><head><link rel="stylesheet" href="../fonts/fonts.css"></head>' +
          '<body><img src="../assets/logo.png"><script src="../assets/app.js"></script></body></html>',
        { status: 200, headers: { "content-type": "text/html" } },
      ),
    ],
    [
      `${base}fonts/fonts.css`,
      new Response("@font-face{font-family:Local;src:url('./local.woff2')}", {
        headers: { "content-type": "text/css" },
      }),
    ],
    [
      `${base}assets/app.js`,
      new Response("window.__harnessLoaded = true;", {
        headers: { "content-type": "text/javascript" },
      }),
    ],
    [
      `${base}fonts/local.woff2`,
      new Response(new Uint8Array([0, 1, 2, 3]), {
        headers: { "content-type": "font/woff2" },
      }),
    ],
    [
      `${base}assets/logo.png`,
      new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { "content-type": "image/png" },
      }),
    ],
  ]);
  const fetchFixture: typeof globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const response = responses.get(url);
    return response?.clone() ?? new Response("missing fixture", { status: 404 });
  };

  const prepared = await prepareCanvasRenderDocument({
    projectId: "p1",
    entryFile: "pages/index.html",
    projectFilePaths: new Set([
      "pages/index.html",
      "fonts/fonts.css",
      "fonts/local.woff2",
      "assets/logo.png",
      "assets/app.js",
    ]),
    webOrigin: origin,
    fetch: fetchFixture,
  });

  assert.equal(prepared.httpStatus, 200);
  assert.equal(prepared.targetUrl, `${base}pages/index.html`);
  assert.match(prepared.srcdoc, /<base href="http:\/\/127\.0\.0\.1:59920\/api\/projects\/p1\/raw\/pages\/">/);
  assert.match(prepared.srcdoc, /data:font\/woff2;base64,AAECAw==/);
  assert.match(prepared.srcdoc, /data:image\/png;base64,iVBORw==/);
  assert.match(prepared.srcdoc, /window\.__harnessLoaded = true;/);
  assert.doesNotMatch(prepared.srcdoc, /<script src="\.\.\/assets\/app\.js"><\/script>/);
});
