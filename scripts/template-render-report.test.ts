import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { replaceJsonLinesAtomically } from "./template-render-report-lib.ts";

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
