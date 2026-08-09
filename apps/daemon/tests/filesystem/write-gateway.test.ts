import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createFilesystemWriteGateway,
  type FilesystemWriteAuditEntry,
} from '../../src/filesystem/write-gateway.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

const canSymlink = (() => {
  try {
    const root = mkdtempSync(path.join(tmpdir(), 'od-write-gateway-symlink-probe-'));
    writeFileSync(path.join(root, 'target'), 'x');
    symlinkSync(path.join(root, 'target'), path.join(root, 'link'));
    rmSync(root, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
})();

describe('FilesystemWriteGateway', () => {
  it('writes existing and non-existing runtime targets and records canonical destinations', async () => {
    const root = await tempRoot('od-write-gateway-basic-');
    const runtimeRoot = path.join(root, 'runtime');
    await mkdir(runtimeRoot);
    const audit: FilesystemWriteAuditEntry[] = [];
    const gateway = createFilesystemWriteGateway({
      runtimeDataRoot: runtimeRoot,
      auditSink: (entry) => audit.push(entry),
    });
    const capability = await gateway.runtimeData();
    const nested = path.join(runtimeRoot, 'library', 'objects');
    const target = path.join(nested, 'asset.txt');

    await gateway.mkdir(capability, nested, { recursive: true });
    await gateway.writeFile(capability, target, 'first', 'utf8');
    await gateway.appendFile(capability, target, '-second', 'utf8');

    expect(await readFile(target, 'utf8')).toBe('first-second');
    expect(audit.map((entry) => entry.operation)).toEqual(['mkdir', 'writeFile', 'appendFile']);
    expect(audit.every((entry) => entry.capability === 'runtimeData')).toBe(true);
    expect(audit.at(-1)?.destination).toBe(await realpath(target));
  });

  it('rejects relative paths, dot traversal, and capabilities from another gateway', async () => {
    const root = await tempRoot('od-write-gateway-escape-');
    const runtimeRoot = path.join(root, 'runtime');
    await mkdir(runtimeRoot);
    const first = createFilesystemWriteGateway({ runtimeDataRoot: runtimeRoot });
    const second = createFilesystemWriteGateway({ runtimeDataRoot: runtimeRoot });
    const capability = await first.runtimeData();

    await expect(first.writeFile(capability, 'relative.txt', 'x')).rejects.toThrow('must be absolute');
    await expect(
      first.writeFile(capability, path.join(runtimeRoot, '..', 'escaped.txt'), 'x'),
    ).rejects.toThrow('escapes runtimeData capability root');
    await expect(second.writeFile(capability, path.join(runtimeRoot, 'foreign.txt'), 'x')).rejects.toThrow(
      'not minted by this gateway',
    );
  });

  it.runIf(canSymlink)('rejects symlinked parents and symlink targets', async () => {
    const root = await tempRoot('od-write-gateway-symlink-');
    const runtimeRoot = path.join(root, 'runtime');
    const outside = path.join(root, 'outside');
    await mkdir(runtimeRoot);
    await mkdir(outside);
    const gateway = createFilesystemWriteGateway({ runtimeDataRoot: runtimeRoot });
    const capability = await gateway.runtimeData();

    const linkedParent = path.join(runtimeRoot, 'linked-parent');
    await symlink(outside, linkedParent);
    await expect(gateway.writeFile(capability, path.join(linkedParent, 'escaped.txt'), 'x')).rejects.toThrow(
      'escapes canonical runtimeData capability root',
    );

    const realTarget = path.join(runtimeRoot, 'real.txt');
    const linkedTarget = path.join(runtimeRoot, 'linked.txt');
    await writeFile(realTarget, 'safe');
    await symlink(realTarget, linkedTarget);
    await expect(gateway.writeFile(capability, linkedTarget, 'changed')).rejects.toThrow('symbolic link');
    await expect(readFile(realTarget, 'utf8')).resolves.toBe('safe');
  });

  it('lets a broad runtime capability exist but forbids writes in or over the protected root', async () => {
    const root = await tempRoot('od-write-gateway-forbidden-');
    const runtimeRoot = path.join(root, 'runtime');
    const forbiddenRoot = path.join(runtimeRoot, 'design-assets');
    await mkdir(forbiddenRoot, { recursive: true });
    await writeFile(path.join(forbiddenRoot, 'sentinel'), 'keep');
    const gateway = createFilesystemWriteGateway({
      runtimeDataRoot: runtimeRoot,
      forbiddenWriteRoots: [forbiddenRoot],
    });
    const capability = await gateway.runtimeData();

    await gateway.writeFile(capability, path.join(runtimeRoot, 'allowed.txt'), 'ok');
    await expect(gateway.writeFile(capability, path.join(forbiddenRoot, 'blocked.txt'), 'no')).rejects.toThrow(
      'forbidden write root',
    );
    await expect(gateway.rm(capability, runtimeRoot, { recursive: true })).rejects.toThrow(
      'forbidden write root',
    );
    await expect(readFile(path.join(forbiddenRoot, 'sentinel'), 'utf8')).resolves.toBe('keep');
  });

  it('forbidden roots override every externally rooted capability kind', async () => {
    const root = await tempRoot('od-write-gateway-capabilities-');
    const runtimeRoot = path.join(root, 'runtime');
    const forbiddenRoot = path.join(root, 'design-assets');
    await mkdir(runtimeRoot);
    await mkdir(forbiddenRoot);
    const gateway = createFilesystemWriteGateway({
      runtimeDataRoot: runtimeRoot,
      forbiddenWriteRoots: [forbiddenRoot],
    });

    for (const createCapability of [
      () => gateway.importedProject(forbiddenRoot),
      () => gateway.backupDestination(forbiddenRoot),
      () => gateway.mediaConfig(forbiddenRoot),
      () => gateway.temp(forbiddenRoot),
      () => gateway.externalTool(forbiddenRoot),
      () => gateway.cliOutput(forbiddenRoot),
    ]) {
      await expect(createCapability()).rejects.toThrow('inside a forbidden write root');
    }
  });

  it('forbidden roots override a managed-project capability', async () => {
    const root = await tempRoot('od-write-gateway-managed-forbidden-');
    const runtimeRoot = path.join(root, 'runtime');
    const projectsRoot = path.join(runtimeRoot, 'projects');
    const forbiddenRoot = path.join(projectsRoot, 'design-assets');
    await mkdir(forbiddenRoot, { recursive: true });
    const gateway = createFilesystemWriteGateway({
      runtimeDataRoot: runtimeRoot,
      forbiddenWriteRoots: [forbiddenRoot],
    });
    const capability = await gateway.managedProject(projectsRoot);

    await expect(
      gateway.writeFile(capability, path.join(forbiddenRoot, 'blocked.txt'), 'no'),
    ).rejects.toThrow('forbidden write root');
  });

  it('requires both rename endpoints to stay in the same capability and audits both', async () => {
    const root = await tempRoot('od-write-gateway-rename-');
    const runtimeRoot = path.join(root, 'runtime');
    const outside = path.join(root, 'outside');
    await mkdir(runtimeRoot);
    await mkdir(outside);
    const audit: FilesystemWriteAuditEntry[] = [];
    const gateway = createFilesystemWriteGateway({
      runtimeDataRoot: runtimeRoot,
      auditSink: (entry) => audit.push(entry),
    });
    const capability = await gateway.runtimeData();
    const source = path.join(runtimeRoot, 'source.txt');
    const destination = path.join(runtimeRoot, 'destination.txt');
    await writeFile(source, 'move');

    await gateway.rename(capability, source, destination);
    await expect(readFile(destination, 'utf8')).resolves.toBe('move');
    expect(audit).toContainEqual({
      operation: 'rename',
      capability: 'runtimeData',
      source: await realpath(path.dirname(source)).then((parent) => path.join(parent, path.basename(source))),
      destination: await realpath(destination),
    });

    await expect(gateway.rename(capability, destination, path.join(outside, 'escaped.txt'))).rejects.toThrow(
      'escapes runtimeData capability root',
    );
  });

  it('copies, streams, unlinks, and removes only through the capability', async () => {
    const root = await tempRoot('od-write-gateway-operations-');
    const runtimeRoot = path.join(root, 'runtime');
    await mkdir(runtimeRoot);
    const source = path.join(root, 'source.txt');
    await writeFile(source, 'source');
    const gateway = createFilesystemWriteGateway({ runtimeDataRoot: runtimeRoot });
    const capability = await gateway.runtimeData();
    const copied = path.join(runtimeRoot, 'copied.txt');
    const streamed = path.join(runtimeRoot, 'streamed.txt');

    await gateway.copyFile(capability, source, copied);
    const stream = await gateway.createWriteStream(capability, streamed);
    await new Promise<void>((resolve, reject) => {
      stream.end('stream', resolve);
      stream.once('error', reject);
    });
    await expect(readFile(copied, 'utf8')).resolves.toBe('source');
    await expect(readFile(streamed, 'utf8')).resolves.toBe('stream');

    await gateway.unlink(capability, copied);
    await gateway.rm(capability, streamed);
    await expect(readFile(copied)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(streamed)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
