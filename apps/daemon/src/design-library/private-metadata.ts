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
