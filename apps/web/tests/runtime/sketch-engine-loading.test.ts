import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('sketch engine loading boundary', () => {
  it('keeps Excalidraw CSS and editor code out of the global app layout', () => {
    const layout = readFileSync(resolve(WEB_ROOT, 'app/layout.tsx'), 'utf8');
    const workspace = readFileSync(resolve(WEB_ROOT, 'src/components/FileWorkspace.tsx'), 'utf8');

    expect(layout).not.toContain('@excalidraw/excalidraw/index.css');
    expect(workspace).toContain("await import('@excalidraw/excalidraw/index.css')");
    expect(workspace).toContain("await import('./SketchEditor')");
    expect(workspace).not.toContain("from './SketchEditor'");
  });

  it('does not retain the hidden Excalidraw prewarm component', () => {
    expect(existsSync(resolve(WEB_ROOT, 'src/components/SketchEnginePrewarm.tsx'))).toBe(false);
    expect(existsSync(resolve(WEB_ROOT, 'src/components/SketchEnginePrewarm.module.css'))).toBe(false);
  });
});
