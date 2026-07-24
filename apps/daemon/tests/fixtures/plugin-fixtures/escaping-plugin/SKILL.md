---
name: escaping-plugin
description: Phase 1 e2e fixture whose HTML preview references a file outside its own directory, used to regression-test the duplicate-project cross-directory dependency guard.
od:
  kind: skill
  taskKind: new-generation
  preview:
    type: html
---

# Escaping Plugin

This is the SKILL.md half of the cross-directory-dependency fixture. The
companion `open-design.json` sidecar carries the canonical Open Design
plugin manifest fields. `index.html` intentionally references an asset
outside this directory so `duplicate-project.ts` rejects the duplicate
with `UNSUPPORTED_DUPLICATE_DEPENDENCIES` instead of silently copying a
broken reference.
