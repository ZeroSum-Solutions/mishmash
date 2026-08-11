export const DESIGN_LIBRARY_PRIVATE_METADATA_NAMES = Object.freeze([
  '.catalog',
  'rights.json',
  '.design-library-item.json',
]);

const NORMALIZED_PRIVATE_METADATA_NAMES = new Set(
  DESIGN_LIBRARY_PRIVATE_METADATA_NAMES.map((name) => name.toLowerCase()),
);

export function isDesignLibraryPrivateMetadataName(name: string): boolean {
  return NORMALIZED_PRIVATE_METADATA_NAMES.has(name.toLowerCase());
}

/**
 * OS-generated junk files that carry no licensed content. Finder writes
 * `.DS_Store` merely by browsing a folder, so it must never affect a
 * licensed item's rights-authorization hash -- otherwise looking at the
 * folder silently invalidates an already-proven rights record (MM-014).
 */
export const DESIGN_LIBRARY_JUNK_FILE_NAMES = Object.freeze(['.DS_Store']);

const NORMALIZED_JUNK_FILE_NAMES = new Set(
  DESIGN_LIBRARY_JUNK_FILE_NAMES.map((name) => name.toLowerCase()),
);

export function isDesignLibraryJunkFileName(name: string): boolean {
  return NORMALIZED_JUNK_FILE_NAMES.has(name.toLowerCase());
}
