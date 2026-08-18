import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  fontFaceCss,
  parseWebfontFaces,
  webfontFormatExtension,
  type FontFaceCssFile,
  type FontFaceRef,
} from "../apps/daemon/src/brands/webfonts.ts";

export interface FontDirectoryDeduplication {
  filesBefore: number;
  bytesBefore: number;
  filesAfter: number;
  bytesAfter: number;
}

const fontProviderHostSource = String.raw`(?:fonts\.googleapis\.com|fonts\.gstatic\.com|rsms\.me|api\.fontshare\.com|cdn\.fontshare\.com)`;

export type LoadingFontProviderReference = {
  kind: "link" | "import" | "url";
  host: string;
};

export function findFontProviderReferences(source: string): string[] {
  const hosts = new Set<string>();
  for (const match of source.matchAll(new RegExp(`\\b(${fontProviderHostSource})\\b`, "gi"))) {
    if (match[1]) hosts.add(match[1].toLowerCase());
  }
  return [...hosts].sort();
}

/** Find only provider references that a browser can load, ignoring inert comments. */
export function findLoadingFontProviderReferences(source: string): LoadingFontProviderReference[] {
  const withoutComments = source.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, "");
  const references = new Map<string, LoadingFontProviderReference>();
  const collect = (kind: LoadingFontProviderReference["kind"], candidate: string) => {
    for (const host of findFontProviderReferences(candidate)) {
      references.set(`${kind}:${host}`, { kind, host });
    }
  };

  for (const match of withoutComments.matchAll(/<link\b[^>]*>/gi)) collect("link", match[0]);
  for (const match of withoutComments.matchAll(/@import\b[^;]*(?:;|$)/gi)) collect("import", match[0]);
  for (const match of withoutComments.matchAll(/url\(\s*[^)]*\)/gi)) collect("url", match[0]);
  return [...references.values()].sort((left, right) =>
    `${left.kind}:${left.host}`.localeCompare(`${right.kind}:${right.host}`),
  );
}

export function rewriteNonLoadingFontReferences(source: string): string {
  const rewriteComment = (comment: string) =>
    comment
      .replace(
        new RegExp(`\\s+from\\s+(?:https?:\\/\\/)?${fontProviderHostSource}(?:\\/[^\\s*<>]*)?`, "gi"),
        ", self-hosted",
      )
      .replace(
        new RegExp(`(?:https?:\\/\\/)?${fontProviderHostSource}(?:\\/[^\\s*<>]*)?`, "gi"),
        "self-hosted",
      );

  return source.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, rewriteComment);
}

function filenamePart(value: string, fallback: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

function legacySubset(face: FontFaceRef, sourceFile: string): string {
  if (face.subset) return filenamePart(face.subset, "unbounded");

  const extension = path.extname(sourceFile);
  const basename = path.basename(sourceFile, extension);
  const family = filenamePart(face.family, "font");
  const weight = face.weight.replace(/\s+/g, "-").replace(/[^a-z0-9.-]+/gi, "");
  const style = face.style === "normal" ? "" : `-${face.style.replace(/[^a-z]/gi, "")}`;
  const legacyPrefix = `${family}-${weight}${style}-`;
  const withoutHash = (value: string) => value.replace(/-[0-9a-f]{10}$/i, "");

  if (basename.startsWith(legacyPrefix)) {
    return filenamePart(withoutHash(basename.slice(legacyPrefix.length)), "unbounded");
  }
  if (basename.startsWith(`${family}-`)) {
    return filenamePart(withoutHash(basename.slice(family.length + 1)), "unbounded");
  }
  return "unbounded";
}

export function vendoredFontFileName(face: FontFaceRef, buffer: Buffer, subset?: string): string {
  const family = filenamePart(face.family, "font");
  const subsetPart = filenamePart(subset ?? face.subset ?? "unbounded", "unbounded");
  const hash = fontContentIdentity(buffer).slice(0, 10);
  return `${family}-${subsetPart}-${hash}${webfontFormatExtension(face.format)}`;
}

export function fontContentIdentity(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

type FontDirectoryDeduplicationPlan = {
  result: FontDirectoryDeduplication;
  css: string;
  rewrittenCss: string;
  sourceFiles: Map<string, Buffer>;
  targetFiles: Map<string, Buffer>;
};

async function planFontDirectoryDeduplication(
  fontsDir: string,
): Promise<FontDirectoryDeduplicationPlan | null> {
  const cssPath = path.join(fontsDir, "fonts.css");
  let css: string;
  try {
    css = await fs.readFile(cssPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const faces = parseWebfontFaces(css, pathToFileURL(cssPath).href);
  const sourceFiles = new Map<string, Buffer>();
  const targetFiles = new Map<string, Buffer>();
  const targetFileByContent = new Map<string, string>();
  const localFaces: FontFaceCssFile[] = [];

  for (const face of faces) {
    const url = new URL(face.url);
    if (url.protocol !== "file:") continue;
    const sourcePath = fileURLToPath(url);
    if (path.dirname(sourcePath) !== fontsDir) {
      throw new Error(`font stylesheet escapes its directory: ${face.url}`);
    }
    const sourceFile = path.basename(sourcePath);
    let buffer = sourceFiles.get(sourceFile);
    if (!buffer) {
      buffer = await fs.readFile(sourcePath);
      sourceFiles.set(sourceFile, buffer);
    }
    const identity = fontContentIdentity(buffer);
    const file = targetFileByContent.get(identity)
      ?? vendoredFontFileName(face, buffer, legacySubset(face, sourceFile));
    targetFileByContent.set(identity, file);
    targetFiles.set(file, buffer);
    localFaces.push({
      family: face.family,
      weight: face.weight,
      style: face.style,
      file,
      format: face.format,
      ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
    });
  }

  if (localFaces.length === 0) {
    return null;
  }

  const rewrittenCss = `${fontFaceCss(localFaces, "./").trimEnd()}\n`;
  return {
    result: {
      filesBefore: sourceFiles.size,
      bytesBefore: [...sourceFiles.values()].reduce((total, buffer) => total + buffer.length, 0),
      filesAfter: targetFiles.size,
      bytesAfter: [...targetFiles.values()].reduce((total, buffer) => total + buffer.length, 0),
    },
    css,
    rewrittenCss,
    sourceFiles,
    targetFiles,
  };
}

/** True when another local deduplication pass would alter CSS or font files. */
export async function fontDirectoryNeedsDeduplication(fontsDir: string): Promise<boolean> {
  const plan = await planFontDirectoryDeduplication(fontsDir);
  if (!plan) return false;
  if (plan.rewrittenCss !== plan.css || plan.sourceFiles.size !== plan.targetFiles.size) return true;
  for (const [file, target] of plan.targetFiles) {
    if (!plan.sourceFiles.get(file)?.equals(target)) return true;
  }
  return false;
}

export async function dedupeFontDirectory(fontsDir: string): Promise<FontDirectoryDeduplication> {
  const plan = await planFontDirectoryDeduplication(fontsDir);
  if (!plan) return { filesBefore: 0, bytesBefore: 0, filesAfter: 0, bytesAfter: 0 };

  for (const [file, buffer] of plan.targetFiles) await fs.writeFile(path.join(fontsDir, file), buffer);
  if (plan.rewrittenCss !== plan.css) {
    await fs.writeFile(path.join(fontsDir, "fonts.css"), plan.rewrittenCss, "utf8");
  }
  for (const sourceFile of plan.sourceFiles.keys()) {
    if (!plan.targetFiles.has(sourceFile)) await fs.unlink(path.join(fontsDir, sourceFile));
  }
  return plan.result;
}
