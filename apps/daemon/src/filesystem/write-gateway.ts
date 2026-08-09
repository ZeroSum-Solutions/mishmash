import { createWriteStream as nodeCreateWriteStream } from 'node:fs';
import {
  appendFile as nodeAppendFile,
  copyFile as nodeCopyFile,
  lstat,
  mkdir as nodeMkdir,
  realpath,
  rename as nodeRename,
  rm as nodeRm,
  unlink as nodeUnlink,
  writeFile as nodeWriteFile,
} from 'node:fs/promises';
import path from 'node:path';
import type { PathLike } from 'node:fs';
import type { Writable } from 'node:stream';

export type FilesystemWriteCapabilityKind =
  | 'runtimeData'
  | 'managedProject'
  | 'importedProject'
  | 'backupDestination'
  | 'mediaConfig'
  | 'temp'
  | 'externalTool'
  | 'cliOutput';

declare const WRITE_CAPABILITY: unique symbol;

/** Opaque authority minted only by a configured FilesystemWriteGateway. */
export interface FilesystemWriteCapability {
  readonly [WRITE_CAPABILITY]: true;
}

export interface FilesystemWriteAuditEntry {
  operation: 'mkdir' | 'writeFile' | 'appendFile' | 'copyFile' | 'rename' | 'rm' | 'unlink' | 'createWriteStream';
  capability: FilesystemWriteCapabilityKind;
  destination: string;
  source?: string;
}

export type FilesystemWriteAuditSink = (entry: FilesystemWriteAuditEntry) => void;

export interface CreateFilesystemWriteGatewayOptions {
  runtimeDataRoot: string;
  forbiddenWriteRoots?: readonly string[];
  auditSink?: FilesystemWriteAuditSink;
}

interface CapabilityState {
  owner: object;
  kind: FilesystemWriteCapabilityKind;
  root: string;
  canonicalRoot: string;
}

interface ValidatedTarget {
  absolute: string;
  canonical: string;
}

const capabilityState = new WeakMap<object, CapabilityState>();

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function overlaps(left: string, right: string): boolean {
  return isWithin(left, right) || isWithin(right, left);
}

async function canonicalizeFromExistingParent(target: string): Promise<string> {
  const suffix: string[] = [];
  let cursor = path.resolve(target);
  for (;;) {
    try {
      const resolved = await realpath(cursor);
      return path.join(resolved, ...suffix.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function assertNotSymlink(target: string): Promise<void> {
  try {
    if ((await lstat(target)).isSymbolicLink()) {
      throw new Error(`filesystem write target is a symbolic link: ${target}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function absolutePath(target: PathLike): string {
  if (typeof target !== 'string') {
    throw new Error('filesystem write targets must be absolute string paths');
  }
  if (!path.isAbsolute(target)) {
    throw new Error(`filesystem write target must be absolute: ${target}`);
  }
  return path.resolve(target);
}

export class FilesystemWriteGateway {
  readonly #owner = Object.freeze({});
  readonly #runtimeDataRoot: string;
  readonly #forbiddenRoots: string[];
  readonly #auditSink: FilesystemWriteAuditSink | undefined;

  private constructor(options: CreateFilesystemWriteGatewayOptions) {
    if (!path.isAbsolute(options.runtimeDataRoot)) {
      throw new Error('runtimeDataRoot must be absolute');
    }
    this.#runtimeDataRoot = path.resolve(options.runtimeDataRoot);
    this.#forbiddenRoots = (options.forbiddenWriteRoots ?? []).map((root) => {
      if (!path.isAbsolute(root)) throw new Error('forbidden write roots must be absolute');
      return path.resolve(root);
    });
    this.#auditSink = options.auditSink;
  }

  static create(options: CreateFilesystemWriteGatewayOptions): FilesystemWriteGateway {
    return new FilesystemWriteGateway(options);
  }

  runtimeData(): Promise<FilesystemWriteCapability> {
    return this.#mint('runtimeData', this.#runtimeDataRoot, true);
  }

  managedProject(root: string): Promise<FilesystemWriteCapability> {
    return this.#mint('managedProject', root, true);
  }

  importedProject(root: string): Promise<FilesystemWriteCapability> {
    return this.#mint('importedProject', root, false);
  }

  backupDestination(root: string): Promise<FilesystemWriteCapability> {
    return this.#mint('backupDestination', root, false);
  }

  mediaConfig(root: string): Promise<FilesystemWriteCapability> {
    return this.#mint('mediaConfig', root, false);
  }

  temp(root: string): Promise<FilesystemWriteCapability> {
    return this.#mint('temp', root, false);
  }

  externalTool(root: string): Promise<FilesystemWriteCapability> {
    return this.#mint('externalTool', root, false);
  }

  cliOutput(root: string): Promise<FilesystemWriteCapability> {
    return this.#mint('cliOutput', root, false);
  }

  async mkdir(
    capability: FilesystemWriteCapability,
    target: PathLike,
    options?: Parameters<typeof nodeMkdir>[1],
  ): Promise<Awaited<ReturnType<typeof nodeMkdir>>> {
    const validated = await this.#beforeWrite(capability, target);
    const result = await nodeMkdir(validated.absolute, options);
    await this.#afterWrite(capability, validated.absolute);
    this.#record(capability, 'mkdir', validated.canonical);
    return result;
  }

  async writeFile(
    capability: FilesystemWriteCapability,
    target: PathLike,
    data: Parameters<typeof nodeWriteFile>[1],
    options?: Parameters<typeof nodeWriteFile>[2],
  ): Promise<void> {
    const validated = await this.#beforeWrite(capability, target);
    await nodeWriteFile(validated.absolute, data, options);
    await this.#afterWrite(capability, validated.absolute);
    this.#record(capability, 'writeFile', validated.canonical);
  }

  async appendFile(
    capability: FilesystemWriteCapability,
    target: PathLike,
    data: Parameters<typeof nodeAppendFile>[1],
    options?: Parameters<typeof nodeAppendFile>[2],
  ): Promise<void> {
    const validated = await this.#beforeWrite(capability, target);
    await nodeAppendFile(validated.absolute, data, options);
    await this.#afterWrite(capability, validated.absolute);
    this.#record(capability, 'appendFile', validated.canonical);
  }

  async copyFile(
    capability: FilesystemWriteCapability,
    source: PathLike,
    destination: PathLike,
    mode?: number,
  ): Promise<void> {
    const validated = await this.#beforeWrite(capability, destination);
    await nodeCopyFile(source, validated.absolute, mode);
    await this.#afterWrite(capability, validated.absolute);
    this.#record(capability, 'copyFile', validated.canonical, String(source));
  }

  async rename(
    capability: FilesystemWriteCapability,
    source: PathLike,
    destination: PathLike,
  ): Promise<void> {
    const validatedSource = await this.#beforeWrite(capability, source);
    const validatedDestination = await this.#beforeWrite(capability, destination);
    await nodeRename(validatedSource.absolute, validatedDestination.absolute);
    await this.#afterWrite(capability, validatedDestination.absolute);
    this.#record(capability, 'rename', validatedDestination.canonical, validatedSource.canonical);
  }

  async rm(
    capability: FilesystemWriteCapability,
    target: PathLike,
    options?: Parameters<typeof nodeRm>[1],
  ): Promise<void> {
    const validated = await this.#beforeWrite(capability, target);
    await nodeRm(validated.absolute, options);
    await this.#afterRemoval(capability, validated.absolute);
    this.#record(capability, 'rm', validated.canonical);
  }

  async unlink(capability: FilesystemWriteCapability, target: PathLike): Promise<void> {
    const validated = await this.#beforeWrite(capability, target);
    await nodeUnlink(validated.absolute);
    await this.#afterRemoval(capability, validated.absolute);
    this.#record(capability, 'unlink', validated.canonical);
  }

  async createWriteStream(
    capability: FilesystemWriteCapability,
    target: PathLike,
    options?: Parameters<typeof nodeCreateWriteStream>[1],
  ): Promise<Writable> {
    const validated = await this.#beforeWrite(capability, target);
    const stream = nodeCreateWriteStream(validated.absolute, options);
    await new Promise<void>((resolve, reject) => {
      stream.once('open', () => resolve());
      stream.once('error', reject);
    });
    try {
      await this.#afterWrite(capability, validated.absolute);
    } catch (error) {
      stream.destroy();
      throw error;
    }
    this.#record(capability, 'createWriteStream', validated.canonical);
    return stream;
  }

  async #mint(
    kind: FilesystemWriteCapabilityKind,
    root: string,
    mustBeRuntimeOwned: boolean,
  ): Promise<FilesystemWriteCapability> {
    if (!path.isAbsolute(root)) throw new Error(`${kind} capability root must be absolute`);
    const absoluteRoot = path.resolve(root);
    const canonicalRoot = await canonicalizeFromExistingParent(absoluteRoot);
    const canonicalRuntime = await canonicalizeFromExistingParent(this.#runtimeDataRoot);
    if (mustBeRuntimeOwned && !isWithin(canonicalRuntime, canonicalRoot)) {
      throw new Error(`${kind} capability root must be inside runtimeDataRoot`);
    }
    await this.#assertCapabilityRootNotForbidden(canonicalRoot);
    const capability = Object.freeze({}) as FilesystemWriteCapability;
    capabilityState.set(capability, { owner: this.#owner, kind, root: absoluteRoot, canonicalRoot });
    return capability;
  }

  #state(capability: FilesystemWriteCapability): CapabilityState {
    const state = capabilityState.get(capability as object);
    if (!state || state.owner !== this.#owner) {
      throw new Error('filesystem write capability was not minted by this gateway');
    }
    return state;
  }

  async #beforeWrite(
    capability: FilesystemWriteCapability,
    target: PathLike,
  ): Promise<ValidatedTarget> {
    const state = this.#state(capability);
    const absolute = absolutePath(target);
    if (!isWithin(state.root, absolute)) {
      throw new Error(`filesystem write target escapes ${state.kind} capability root`);
    }
    await assertNotSymlink(absolute);
    const canonical = await canonicalizeFromExistingParent(absolute);
    if (!isWithin(state.canonicalRoot, canonical)) {
      throw new Error(`filesystem write target escapes canonical ${state.kind} capability root`);
    }
    await this.#assertNotForbidden(canonical);
    return { absolute, canonical };
  }

  async #afterWrite(capability: FilesystemWriteCapability, target: string): Promise<void> {
    const state = this.#state(capability);
    await assertNotSymlink(target);
    const canonical = await realpath(target);
    if (!isWithin(state.canonicalRoot, canonical)) {
      throw new Error(`filesystem write target escaped canonical ${state.kind} capability root after creation`);
    }
    await this.#assertNotForbidden(canonical);
  }

  async #afterRemoval(capability: FilesystemWriteCapability, target: string): Promise<void> {
    const state = this.#state(capability);
    const canonical = await canonicalizeFromExistingParent(path.dirname(target));
    if (!isWithin(state.canonicalRoot, canonical)) {
      throw new Error(`filesystem write parent escaped canonical ${state.kind} capability root after removal`);
    }
  }

  async #assertNotForbidden(candidate: string): Promise<void> {
    for (const root of this.#forbiddenRoots) {
      const canonicalRoot = await canonicalizeFromExistingParent(root);
      if (overlaps(canonicalRoot, candidate)) {
        throw new Error('filesystem write target overlaps a forbidden write root');
      }
    }
  }

  async #assertCapabilityRootNotForbidden(candidate: string): Promise<void> {
    for (const root of this.#forbiddenRoots) {
      const canonicalRoot = await canonicalizeFromExistingParent(root);
      if (isWithin(canonicalRoot, candidate)) {
        throw new Error('filesystem write capability root is inside a forbidden write root');
      }
    }
  }

  #record(
    capability: FilesystemWriteCapability,
    operation: FilesystemWriteAuditEntry['operation'],
    destination: string,
    source?: string,
  ): void {
    if (!this.#auditSink) return;
    const entry: FilesystemWriteAuditEntry = {
      operation,
      capability: this.#state(capability).kind,
      destination,
      ...(source === undefined ? {} : { source }),
    };
    this.#auditSink(entry);
  }
}

export function createFilesystemWriteGateway(
  options: CreateFilesystemWriteGatewayOptions,
): FilesystemWriteGateway {
  return FilesystemWriteGateway.create(options);
}
