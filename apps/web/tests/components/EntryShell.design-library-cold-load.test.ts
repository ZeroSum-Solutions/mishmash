import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const entryShellSource = readFileSync(
  fileURLToPath(new URL('../../src/components/EntryShell.tsx', import.meta.url)),
  'utf8',
);

describe('EntryShell Design Library cold-load boundary', () => {
  it('loads Design Library on demand and keeps it mounted after the first visit', () => {
    expect(entryShellSource).not.toMatch(
      /^import \{ DesignLibrarySection \} from '\.\/DesignLibrarySection'/m,
    );
    expect(entryShellSource).toContain("import('./DesignLibrarySection')");
    expect(entryShellSource).toContain('designLibraryVisited');
  });

  it('keeps the visited catalog render stable while switching entry routes', () => {
    expect(entryShellSource).toContain('memo(lazy(() =>');
    expect(entryShellSource).toContain('handleDesignLibraryOpenProject');
    expect(entryShellSource).toMatch(/<DesignLibrarySection\s+active\s+onOpenProject=\{handleDesignLibraryOpenProject\}/);
  });
});
