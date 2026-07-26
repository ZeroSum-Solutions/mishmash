import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const agentsMdPath = path.join(repoRoot, "AGENTS.md");
const claudeMdPath = path.join(repoRoot, "CLAUDE.md");
const authorityPath = path.join(repoRoot, "docs", "design-authority.json");

const OPEN_MARKER = "<!-- mishmash:context-isolation:v1 -->";
const CLOSE_MARKER = "<!-- /mishmash:context-isolation:v1 -->";
const POINTER_OPEN = "<!-- mishmash:claude-context-pointer:v1 -->";
const POINTER_CLOSE = "<!-- /mishmash:claude-context-pointer:v1 -->";

// The enforceable contract. Keys are stable machine ids, so a decoy row cannot
// win a fuzzy substring match and a reworded label cannot silently flip meaning.
// To change what this repo disclaims or retains, edit BOTH this map and
// docs/design-authority.json — that pairing is the point.
const EXPECTED_DIRECTIVES: Readonly<Record<string, string>> = {
  "operator-global-claude-md-design-contract": "DISCLAIMED",
  "operator-global-claude-md-design-skill-chain": "DISCLAIMED",
  "operator-global-claude-md-frontend-defaults": "DISCLAIMED",
  "operator-cursor-rule-design-mdc": "DISCLAIMED",
  "google-design-md-tooling": "RETAINED",
  "mishmash-native-design-systems": "RETAINED",
  "mishmash-skills-on-merit": "RETAINED",
  "gsap-default-permission": "RETAINED",
};

const LEGAL_DIRECTIVES = new Set(["DISCLAIMED", "RETAINED", "PENDING-DECISION"]);

interface AuthorityFile {
  version: number;
  directives: Array<{ subject: string; directive: string; label: string }>;
}

function readAuthority(): AuthorityFile {
  return JSON.parse(readFileSync(authorityPath, "utf8")) as AuthorityFile;
}

function assertSingleBlock(contents: string, open: string, close: string, label: string): void {
  const openIndex = contents.indexOf(open);
  const closeIndex = contents.indexOf(close);

  assert.notEqual(openIndex, -1, `missing opening ${label} marker`);
  assert.notEqual(closeIndex, -1, `missing closing ${label} marker`);
  assert.ok(openIndex < closeIndex, `opening ${label} marker must precede its closing marker`);
  assert.equal(
    contents.indexOf(open, openIndex + open.length),
    -1,
    `duplicate opening ${label} marker`,
  );
  assert.equal(
    contents.indexOf(close, closeIndex + close.length),
    -1,
    `duplicate closing ${label} marker`,
  );
}

test("design-authority.json declares exactly the expected subjects", () => {
  const authority = readAuthority();
  const found = authority.directives.map((entry) => entry.subject).sort();
  const expected = Object.keys(EXPECTED_DIRECTIVES).sort();

  assert.deepEqual(
    found,
    expected,
    "docs/design-authority.json subjects drifted from the guard's expected set",
  );
});

test("design-authority.json assigns the expected polarity to every subject", () => {
  for (const entry of readAuthority().directives) {
    assert.ok(
      LEGAL_DIRECTIVES.has(entry.directive),
      `subject "${entry.subject}" has illegal directive "${entry.directive}"`,
    );
    assert.equal(
      entry.directive,
      EXPECTED_DIRECTIVES[entry.subject],
      `subject "${entry.subject}" must be ${EXPECTED_DIRECTIVES[entry.subject]}, found ${entry.directive}`,
    );
  }
});

test("design-authority.json never declares a subject twice", () => {
  const subjects = readAuthority().directives.map((entry) => entry.subject);
  assert.equal(
    new Set(subjects).size,
    subjects.length,
    "duplicate subject in docs/design-authority.json",
  );
});

test("design-authority.json entries carry a human-readable label", () => {
  for (const entry of readAuthority().directives) {
    assert.ok(
      typeof entry.label === "string" && entry.label.trim().length > 0,
      `subject "${entry.subject}" is missing a label`,
    );
  }
});

test("AGENTS.md carries one design-authority block that points at the data file", () => {
  const contents = readFileSync(agentsMdPath, "utf8");
  assertSingleBlock(contents, OPEN_MARKER, CLOSE_MARKER, "mishmash:context-isolation:v1");
  assert.ok(
    contents.includes("docs/design-authority.json"),
    "AGENTS.md must point at docs/design-authority.json as the enforceable source",
  );
  assert.ok(
    contents.includes("Design authority and operator-context isolation:"),
    "AGENTS.md core documentation index must point at the Design authority section",
  );
});

test("CLAUDE.md imports AGENTS.md on its first line", () => {
  const firstLine = (readFileSync(claudeMdPath, "utf8").split("\n", 1)[0] ?? "").trim();
  assert.equal(firstLine, "@AGENTS.md", "CLAUDE.md must import AGENTS.md on line 1");
});

test("CLAUDE.md points at the doctrine instead of forking it", () => {
  const contents = readFileSync(claudeMdPath, "utf8");
  assertSingleBlock(contents, POINTER_OPEN, POINTER_CLOSE, "mishmash:claude-context-pointer:v1");

  assert.ok(contents.includes("Design authority"), "CLAUDE.md must name the AGENTS.md section");
  assert.ok(
    contents.includes("docs/design-authority.json"),
    "CLAUDE.md must name the enforceable data file",
  );

  // A second copy of the directives here would be a fork, and forks drift.
  for (const directive of LEGAL_DIRECTIVES) {
    assert.ok(
      !contents.includes(directive),
      `CLAUDE.md must not restate directive "${directive}"; docs/design-authority.json owns it`,
    );
  }
  for (const subject of Object.keys(EXPECTED_DIRECTIVES)) {
    assert.ok(
      !contents.includes(subject),
      `CLAUDE.md must not restate subject "${subject}"; docs/design-authority.json owns it`,
    );
  }
});
