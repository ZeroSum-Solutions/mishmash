import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  dedupeFontDirectory,
  findFontProviderReferences,
  rewriteNonLoadingFontReferences,
} from "./vendor-fonts-lib.ts";

test("dedupeFontDirectory shares one content-addressed file across variable-font weights", async () => {
  const fontsDir = await mkdtemp(path.join(os.tmpdir(), "mishmash-vendor-fonts-"));
  const fontBytes = Buffer.from("wOF2-identical-variable-font-fixture");
  const oldFiles = [
    "inter-400-latin-aaaaaaaaaa.woff2",
    "inter-500-latin-aaaaaaaaaa.woff2",
    "inter-600-latin-aaaaaaaaaa.woff2",
  ];

  try {
    for (const file of oldFiles) await writeFile(path.join(fontsDir, file), fontBytes);
    await writeFile(
      path.join(fontsDir, "fonts.css"),
      oldFiles
        .map(
          (file, index) => `@font-face {
  font-family: "Inter";
  src: url("./${file}") format("woff2");
  font-weight: ${400 + index * 100};
  font-style: normal;
  unicode-range: U+0000-00FF;
  font-display: swap;
}`,
        )
        .join("\n"),
      "utf8",
    );

    const result = await dedupeFontDirectory(fontsDir);

    const hash = createHash("sha256").update(fontBytes).digest("hex").slice(0, 10);
    const expectedFile = `inter-latin-${hash}.woff2`;
    assert.deepEqual(await readdir(fontsDir), ["fonts.css", expectedFile]);
    assert.deepEqual(result, {
      filesBefore: 3,
      bytesBefore: fontBytes.length * 3,
      filesAfter: 1,
      bytesAfter: fontBytes.length,
    });

    const css = await readFile(path.join(fontsDir, "fonts.css"), "utf8");
    assert.equal(css.match(new RegExp(expectedFile, "g"))?.length, 3);
    assert.match(css, /font-weight: 400/);
    assert.match(css, /font-weight: 500/);
    assert.match(css, /font-weight: 600/);
  } finally {
    await rm(fontsDir, { recursive: true, force: true });
  }
});

test("the residual census finds provider names in inert comments and cleans only those comments", () => {
  const source = `<!-- Inter Font: https://rsms.me/inter/ -->
<style>/* Font: Inter Variable from rsms.me */</style>
<link rel="stylesheet" href="https://rsms.me/inter/inter.css">`;

  assert.deepEqual(findFontProviderReferences(source), ["rsms.me"]);

  const rewritten = rewriteNonLoadingFontReferences(source);
  assert.doesNotMatch(rewritten, /Inter Font: https:\/\/rsms\.me|Inter Variable from rsms\.me/);
  assert.match(rewritten, /Inter Font: self-hosted/);
  assert.match(rewritten, /Inter Variable, self-hosted/);
  assert.match(rewritten, /<link rel="stylesheet" href="https:\/\/rsms\.me\/inter\/inter\.css">/);
});
