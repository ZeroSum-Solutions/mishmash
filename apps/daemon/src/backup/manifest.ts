// Shared archive-manifest vocabulary for the backup/restore engine.
//
// An "archive" is a plain directory (never a tar/zip) containing:
//   manifest.json   -- ArchiveManifestEntry[], the sole source of truth for
//                       archive contents (read directly by callers; never a
//                       self-report).
//   manifest.sha256 -- hex sha256 of manifest.json's exact bytes, so a
//                       corrupted manifest is detected deterministically
//                       regardless of where in the JSON a byte lands.
//   data/...         -- the actual snapshotted payload per class.
//   checksums/...     -- per-file sha256 indexes for directory classes, so a
//                       single corrupted file inside e.g. projects-dir can be
//                       attributed to that class at restore time.
//
// Secret classes (mcp-config-tokens, connector-credentials, byok-keys) are
// never written to the archive at all -- see docs/security/backup-secret-
// inventory.json for the documented-gap policy. app-config IS archived, but
// with agentCliEnv/agentCliEnvIntent (the on-disk BYOK material) stripped
// first, so the byok-keys exclusion is genuine rather than nominal.

export type ArchiveClass =
  | 'sqlite-database'
  | 'projects-dir'
  | 'library-assets'
  | 'memory-markdown'
  | 'app-config'
  | 'covers';

export const ARCHIVE_DIR_CLASSES = ['projects-dir', 'library-assets', 'memory-markdown', 'covers'] as const satisfies readonly ArchiveClass[];

export const ARCHIVE_FILE_CLASSES = ['sqlite-database', 'app-config'] as const satisfies readonly ArchiveClass[];

/** Every class this engine actually writes into an archive. */
export const ALL_ARCHIVE_CLASSES: readonly ArchiveClass[] = [
  'sqlite-database',
  'projects-dir',
  'library-assets',
  'memory-markdown',
  'app-config',
  'covers',
];

export interface ArchiveManifestFileEntry {
  class: ArchiveClass;
  relPath: string;
  sha256: string;
}

export interface ArchiveManifestDirEntry {
  class: ArchiveClass;
  relPath: string;
  checksumsRelPath: string;
}

export type ArchiveManifestEntry = ArchiveManifestFileEntry | ArchiveManifestDirEntry;

export function isDirEntry(entry: ArchiveManifestEntry): entry is ArchiveManifestDirEntry {
  return typeof (entry as ArchiveManifestDirEntry).checksumsRelPath === 'string';
}

export const MANIFEST_FILENAME = 'manifest.json';
export const MANIFEST_HASH_FILENAME = 'manifest.sha256';

export const RELPATH_BY_CLASS: Record<ArchiveClass, string> = {
  'sqlite-database': 'data/app.sqlite',
  'projects-dir': 'data/projects',
  'library-assets': 'data/library',
  'memory-markdown': 'data/memory',
  'app-config': 'data/app-config.json',
  covers: 'data/covers',
};

export const CHECKSUMS_RELPATH_BY_CLASS: Partial<Record<ArchiveClass, string>> = {
  'projects-dir': 'checksums/projects-dir.json',
  'library-assets': 'checksums/library-assets.json',
  'memory-markdown': 'checksums/memory-markdown.json',
  covers: 'checksums/covers.json',
};
