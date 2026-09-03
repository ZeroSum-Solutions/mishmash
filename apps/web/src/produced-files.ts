import { isImplicitProducedFileCandidate } from '@open-design/contracts';
import type { ProjectFile } from './types';

// Implicit attribution is based on project-file timing or pre/post file-list
// diffs. The predicate itself lives in `packages/contracts/src/api/delivery.ts`
// so the daemon's own delivery classification attributes exactly the same files
// to a run as this client does.
export { isImplicitProducedFileCandidate };

export function filterImplicitProducedFiles(files: readonly ProjectFile[]): ProjectFile[] {
  return files.filter(isImplicitProducedFileCandidate);
}
