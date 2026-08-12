import { readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function findSourceMaps(root) {
  const maps = [];
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current == null) break;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.name.endsWith('.map')) {
        maps.push(entryPath);
      }
    }
  }

  return maps.sort();
}

export async function assertStaticExportHasNoSourceMaps({
  outputRoot = join(WEB_ROOT, 'out'),
  webOutputMode = process.env.OD_WEB_OUTPUT_MODE,
} = {}) {
  if (webOutputMode === 'server' || webOutputMode === 'standalone') {
    return { checked: false, maps: [] };
  }

  let maps;
  try {
    maps = await findSourceMaps(outputRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`static export output is missing: ${outputRoot}`);
    }
    throw error;
  }

  if (maps.length > 0) {
    const listed = maps.map((mapPath) => relative(outputRoot, mapPath)).join(', ');
    throw new Error(`static export contains ${maps.length} source map(s): ${listed}`);
  }

  return { checked: true, maps: [] };
}

async function main() {
  const result = await assertStaticExportHasNoSourceMaps();
  if (result.checked) {
    process.stderr.write('[static-export] verified zero served source maps\n');
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`[static-export] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
