import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// This guard parses the source text rather than importing
// `DESIGN_TOOLBOX_ACTIONS`. Importing would be more faithful, but it pulls
// apps/web source into the scripts TypeScript project, where `--moduleResolution
// node16` then rejects the app's extensionless relative imports (TS2835) and
// breaks `pnpm typecheck`. The app's tsconfig and the scripts tsconfig are
// deliberately different; a repo-level guard must not fuse them.
//
// The parse is narrow on purpose: each action's `id` and its `preferredSkillIds`
// literal. If someone builds those arrays dynamically this test would silently
// see fewer actions, so the action count is asserted against a floor below.
const repoRoot = path.resolve(import.meta.dirname, "..");
const skillsDir = path.join(repoRoot, "skills");
const toolboxPath = path.join(repoRoot, "apps", "web", "src", "runtime", "design-toolbox.ts");

const ACTION_BLOCK = /id:\s*'([^']+)'[\s\S]*?preferredSkillIds:\s*\[([^\]]*)\]/g;
const QUOTED = /'([^']+)'/g;

// Floor, not an exact count: a new action should not have to update this test,
// but a parse that silently collapses to zero must fail loudly.
const MIN_EXPECTED_ACTIONS = 10;

interface ToolboxAction {
  id: string;
  preferredSkillIds: string[];
}

function parseActions(): ToolboxAction[] {
  const source = readFileSync(toolboxPath, "utf8");
  const actions: ToolboxAction[] = [];
  for (const match of source.matchAll(ACTION_BLOCK)) {
    const [, id, body = ""] = match;
    if (!id) continue;
    actions.push({
      id,
      preferredSkillIds: [...body.matchAll(QUOTED)].map(([, value]) => value ?? ""),
    });
  }
  return actions;
}

function skillExists(id: string): boolean {
  return existsSync(path.join(skillsDir, id, "SKILL.md"));
}

test("the design toolbox source still parses into actions", () => {
  const actions = parseActions();
  assert.ok(
    actions.length >= MIN_EXPECTED_ACTIONS,
    `parsed only ${actions.length} design toolbox action(s) from ${path.relative(repoRoot, toolboxPath)}; ` +
      "the parse likely broke rather than the data shrinking",
  );
});

test("every design toolbox action declares at least one preferred skill id", () => {
  const empties = parseActions().filter((action) => action.preferredSkillIds.length === 0);
  assert.deepEqual(
    empties.map((action) => action.id),
    [],
    `design toolbox action(s) with no preferredSkillIds: ${empties.map((action) => action.id).join(", ")} — ` +
      "an action with zero candidate skills can never resolve to a real skill and defeats the router.",
  );
});

test("no design toolbox action lists a duplicate preferred skill id", () => {
  const violations: string[] = [];
  for (const action of parseActions()) {
    const seen = new Set<string>();
    for (const id of action.preferredSkillIds) {
      if (seen.has(id)) {
        violations.push(`action "${action.id}" lists preferred skill id "${id}" more than once`);
      }
      seen.add(id);
    }
  }
  assert.deepEqual(violations, [], `duplicate preferred skill id(s):\n${violations.join("\n")}`);
});

test("every preferred skill id resolves to a real skills/<id>/SKILL.md directory", () => {
  const violations: string[] = [];
  for (const action of parseActions()) {
    for (const id of action.preferredSkillIds) {
      if (!skillExists(id)) {
        violations.push(
          `design toolbox action "${action.id}" preferredSkillIds includes "${id}", ` +
            `which does not resolve to skills/${id}/SKILL.md`,
        );
      }
    }
  }
  assert.deepEqual(violations, [], `unresolvable preferred skill id(s):\n${violations.join("\n")}`);
});
