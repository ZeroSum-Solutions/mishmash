import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const repoRoot = path.resolve(import.meta.dirname, '..');
const daemonSourceRoot = path.join(repoRoot, 'apps/daemon/src');
const inventoryPath = path.join(
  repoRoot,
  'apps/daemon/src/filesystem/legacy-write-inventory.json',
);

const MUTATION_PRIMITIVES = new Set([
  'appendFile', 'appendFileSync', 'chmod', 'chmodSync', 'chown', 'chownSync',
  'copyFile', 'copyFileSync', 'cp', 'cpSync', 'createWriteStream', 'link', 'linkSync',
  'mkdir', 'mkdirSync', 'mkdtemp', 'mkdtempSync', 'rename', 'renameSync', 'rm',
  'rmSync', 'rmdir', 'rmdirSync', 'symlink', 'symlinkSync', 'truncate',
  'truncateSync', 'unlink', 'unlinkSync', 'writeFile', 'writeFileSync',
]);

interface InventoryEntry {
  file: string;
  symbol: string;
  primitive: string;
  count: number;
}

async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(target));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(target);
  }
  return files;
}

function repositoryPath(file: string): string {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

function propertyName(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
}

function enclosingSymbol(node: ts.Node): string {
  let cursor: ts.Node | undefined = node;
  while (cursor) {
    if (ts.isFunctionDeclaration(cursor) && cursor.name) return cursor.name.text;
    if (ts.isMethodDeclaration(cursor)) return propertyName(cursor.name) ?? '<method>';
    if (ts.isConstructorDeclaration(cursor)) return 'constructor';
    if (ts.isGetAccessorDeclaration(cursor) || ts.isSetAccessorDeclaration(cursor)) {
      return propertyName(cursor.name) ?? '<accessor>';
    }
    if (ts.isArrowFunction(cursor) || ts.isFunctionExpression(cursor)) {
      const parent = cursor.parent;
      if (ts.isVariableDeclaration(parent)) return propertyName(parent.name) ?? '<function>';
      if (ts.isPropertyAssignment(parent)) return propertyName(parent.name) ?? '<function>';
    }
    cursor = cursor.parent;
  }
  return '<module>';
}

function collectFileEntries(file: string): InventoryEntry[] {
  const source = ts.createSourceFile(
    file,
    ts.sys.readFile(file) ?? '',
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const namedImports = new Map<string, string>();
  const namespaceImports = new Set<string>();

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== 'node:fs' && statement.moduleSpecifier.text !== 'node:fs/promises') continue;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) namespaceImports.add(clause.name.text);
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      namespaceImports.add(clause.namedBindings.name.text);
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text;
        if (MUTATION_PRIMITIVES.has(imported)) namedImports.set(element.name.text, imported);
      }
    }
  }

  const counts = new Map<string, InventoryEntry>();
  const record = (node: ts.Node, primitive: string): void => {
    const symbol = enclosingSymbol(node);
    const key = `${symbol}\0${primitive}`;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { file: repositoryPath(file), symbol, primitive, count: 1 });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        const primitive = namedImports.get(node.expression.text);
        if (primitive) record(node, primitive);
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        const primitive = node.expression.name.text;
        if (MUTATION_PRIMITIVES.has(primitive)) {
          let owner: ts.Expression = node.expression.expression;
          if (ts.isPropertyAccessExpression(owner) && owner.name.text === 'promises') owner = owner.expression;
          if (ts.isIdentifier(owner) && namespaceImports.has(owner.text)) record(node, primitive);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...counts.values()];
}

export async function collectDaemonFilesystemWriteInventory(): Promise<InventoryEntry[]> {
  const files = (await sourceFiles(daemonSourceRoot)).filter(
    (file) => repositoryPath(file) !== 'apps/daemon/src/filesystem/write-gateway.ts',
  );
  return files.flatMap(collectFileEntries).sort((a, b) =>
    a.file.localeCompare(b.file)
      || a.symbol.localeCompare(b.symbol)
      || a.primitive.localeCompare(b.primitive),
  );
}

function pinnedInventory(entries: InventoryEntry[]): Record<string, string> {
  const grouped = new Map<string, string[]>();
  for (const entry of entries) {
    const key = `${entry.file}#${entry.symbol}`;
    const values = grouped.get(key) ?? [];
    values.push(`${entry.primitive}:${entry.count}`);
    grouped.set(key, values);
  }
  return Object.fromEntries(
    [...grouped].sort(([left], [right]) => left.localeCompare(right)).map(([key, values]) => [
      key,
      values.sort().join(','),
    ]),
  );
}

export async function checkDaemonFilesystemWrites(): Promise<boolean> {
  const current = await collectDaemonFilesystemWriteInventory();
  const strictFindings = current.filter(({ file }) =>
    file === 'apps/daemon/src/routes/design-library.ts'
      || file.startsWith('apps/daemon/src/design-library/'),
  );
  if (strictFindings.length > 0) {
    console.error('Design Library and promotion modules must not call node:fs mutation primitives directly:');
    for (const finding of strictFindings) {
      console.error(`- ${finding.file}#${finding.symbol}: ${finding.primitive} x${finding.count}`);
    }
    return false;
  }

  const expected = JSON.parse(await readFile(inventoryPath, 'utf8')) as unknown;
  const actual = pinnedInventory(current);
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)
    || JSON.stringify(expected) !== JSON.stringify(actual)) {
    console.error('Daemon direct filesystem-write inventory drifted. Route new writes through write-gateway.ts or update the audited legacy inventory deliberately.');
    const expectedRows = expected && typeof expected === 'object' && !Array.isArray(expected)
      ? expected as Record<string, string>
      : {};
    for (const [key, value] of Object.entries(actual)) if (expectedRows[key] !== value) {
      console.error(`- current ${key}: ${value}`);
    }
    for (const [key, value] of Object.entries(expectedRows)) if (actual[key] !== value) {
      console.error(`- pinned ${key}: ${value}`);
    }
    return false;
  }

  console.log(`Daemon filesystem-write inventory passed: ${current.length} pinned file/symbol/primitive rows; Design Library promotion modules have zero direct mutation calls.`);
  return true;
}

if (process.argv.includes('--print')) {
  console.log(JSON.stringify(pinnedInventory(await collectDaemonFilesystemWriteInventory()), null, 2));
}
