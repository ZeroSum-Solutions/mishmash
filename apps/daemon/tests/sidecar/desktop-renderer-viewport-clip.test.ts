import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { exportArtifact, renderSlides } from "../../src/sidecar/desktop-renderer/render.js";

// CANVAS-13. The renderer only ever answered `page.screenshot({ fullPage: true })`
// for an image export -- the whole document, at whatever height it happens to be.
// That is the right answer for "export this artifact" and the wrong one for
// annotation capture, which needs the pixels the user is actually looking at:
// PreviewDrawOverlay re-paints the user's marks onto the returned image, scaling
// them by the preview frame's rect against the image's own dimensions. Hand it a
// full-page render and every mark lands somewhere the user did not put it, which
// is worse than a failed capture.
//
// `viewportScrollY` asks for the visible band instead. These specs render a page
// built from three viewport-tall bands of flat colour, so "did we get the right
// band" is answerable from a single pixel rather than from image diffing.

const VIEWPORT_WIDTH = 400;
const VIEWPORT_HEIGHT = 500;

const BANDS = [
  { name: "red", css: "#ff0000", rgb: [255, 0, 0] },
  { name: "green", css: "#00ff00", rgb: [0, 255, 0] },
  { name: "blue", css: "#0000ff", rgb: [0, 0, 255] },
] as const;

const BANDED_PAGE = `<!doctype html>
<html><head><style>
  html, body { margin: 0; padding: 0; }
  div { width: 100%; height: ${VIEWPORT_HEIGHT}px; }
</style></head>
<body>${BANDS.map((b) => `<div style="background:${b.css}"></div>`).join("")}</body></html>`;

let runtimeDataDir: string;

beforeAll(async () => {
  runtimeDataDir = await mkdtemp(join(tmpdir(), "od-viewport-clip-"));
});

afterAll(async () => {
  await rm(runtimeDataDir, { recursive: true, force: true });
});

/** Reads the centre pixel, which is the whole assertion for a flat-colour band. */
async function centrePixel(filePath: string): Promise<{ width: number; height: number; rgb: number[] }> {
  const image = sharp(await readFile(filePath));
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const raw = await image
    .extract({
      left: Math.floor(width / 2),
      top: Math.floor(height / 2),
      width: 1,
      height: 1,
    })
    .raw()
    .toBuffer();
  return { width, height, rgb: [raw[0]!, raw[1]!, raw[2]!] };
}

describe("desktop renderer viewport clip (CANVAS-13)", () => {
  it("captures the band at the requested scroll offset, not the whole document", async () => {
    const result = await exportArtifact(runtimeDataDir, {
      deck: false,
      format: "image",
      html: BANDED_PAGE,
      title: "banded",
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      viewportScrollY: VIEWPORT_HEIGHT, // second band
    });

    expect(result.ok, result.error).toBe(true);
    const { width, height, rgb } = await centrePixel(result.path!);
    // One viewport, not three: a full-page render of this document is
    // 3 x VIEWPORT_HEIGHT tall, so the height alone falsifies the old behaviour.
    expect({ width, height }).toEqual({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });
    expect(rgb).toEqual([...BANDS[1]!.rgb]);
    await rm(result.path!, { force: true });
  }, 60_000);

  it("treats scroll offset 0 as the first viewport, not as 'unset'", async () => {
    // The offset is presence-checked rather than truthiness-checked: a user who
    // has not scrolled is the most ordinary case there is, and `0` collapsing
    // back to a full-page render would break exactly that case.
    const result = await exportArtifact(runtimeDataDir, {
      deck: false,
      format: "image",
      html: BANDED_PAGE,
      title: "banded",
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      viewportScrollY: 0,
    });

    expect(result.ok, result.error).toBe(true);
    const { height, rgb } = await centrePixel(result.path!);
    expect(height).toBe(VIEWPORT_HEIGHT);
    expect(rgb).toEqual([...BANDS[0]!.rgb]);
    await rm(result.path!, { force: true });
  }, 60_000);

  it("still renders the whole document when no offset is asked for", async () => {
    // Export as image and Copy screenshot both depend on this staying full-page.
    const result = await exportArtifact(runtimeDataDir, {
      deck: false,
      format: "image",
      html: BANDED_PAGE,
      title: "banded",
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
    });

    expect(result.ok, result.error).toBe(true);
    const { height } = await centrePixel(result.path!);
    expect(height).toBe(VIEWPORT_HEIGHT * BANDS.length);
    await rm(result.path!, { force: true });
  }, 60_000);
  // `renderSlides` is the OTHER renderer entry point, and it is the one a real
  // tools-dev runtime actually uses: `handleScreenshotExport` reaches
  // `desktopArtifactExporter` only when no `desktopSlideRenderer` is wired, which
  // is not the case there. Wiring the clip into `exportArtifact` alone left the
  // live runtime still answering full-page renders -- caught by driving the
  // running daemon over HTTP, not by any of the specs above.
  describe("through renderSlides, the entry point a live runtime uses", () => {
    async function pixelOf(dataUrl: string) {
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      const image = sharp(Buffer.from(base64, "base64"));
      const meta = await image.metadata();
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      const raw = await image
        .extract({ left: Math.floor(width / 2), top: Math.floor(height / 2), width: 1, height: 1 })
        .raw()
        .toBuffer();
      return { width, height, rgb: [raw[0]!, raw[1]!, raw[2]!] };
    }

    it("captures the band at the requested scroll offset", async () => {
      const result = await renderSlides(runtimeDataDir, {
        deck: false,
        html: BANDED_PAGE,
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        viewportScrollY: VIEWPORT_HEIGHT * 2, // third band
      });

      expect(result.ok, result.error).toBe(true);
      expect(result.mode).toBe("page");
      expect(result.slides).toHaveLength(1);
      const { width, height, rgb } = await pixelOf(result.slides![0]!);
      expect({ width, height }).toEqual({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });
      expect(rgb).toEqual([...BANDS[2]!.rgb]);
    }, 60_000);

    it("leaves an unclipped page render whole", async () => {
      const result = await renderSlides(runtimeDataDir, {
        deck: false,
        html: BANDED_PAGE,
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
      });

      expect(result.ok, result.error).toBe(true);
      const { height } = await pixelOf(result.slides![0]!);
      expect(height).toBe(VIEWPORT_HEIGHT * BANDS.length);
    }, 60_000);
  });
});
