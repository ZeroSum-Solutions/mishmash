// Per-user video-import provider tokens. Shaped like
// `FileConnectorCredentialStore` (connectors/service.ts:192-261): JSON under
// the daemon data root, directory created 0700, file written 0600 via
// temp-write + rename + chmod (connectors/service.ts:253-260, copied
// exactly). The one deliberate addition over that precedent: `writeRecords`
// removes its own temp file on a failed rename instead of leaving a `.tmp`
// remnant behind (INV-7.8 / W7-R2-25).
//
// The token is the credential boundary INV-7.8 draws: it lives only in this
// file, never in contracts, SQLite, project files, logs, SSE/task
// responses, or browser storage. `disconnect()` removes the file entirely
// rather than trimming a key — nothing else needs to survive a disconnect.

import fs from 'node:fs';
import path from 'node:path';

import type { VideoImportProvider, VideoImportProviderAccount } from '@open-design/contracts';

export interface VideoImportCredentialRecord {
  schemaVersion: 1;
  provider: VideoImportProvider;
  accessToken: string;
  refreshToken?: string;
  account?: VideoImportProviderAccount;
  updatedAt: string;
}

type StoredRecords = Partial<Record<VideoImportProvider, VideoImportCredentialRecord>>;

function isStoredRecord(value: unknown): value is VideoImportCredentialRecord {
  if (value === null || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return (
    raw.schemaVersion === 1
    && typeof raw.provider === 'string'
    && typeof raw.accessToken === 'string'
    && typeof raw.updatedAt === 'string'
  );
}

export class FileVideoImportCredentialStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'video-import', 'credentials.json');
  }

  get(provider: VideoImportProvider): VideoImportCredentialRecord | undefined {
    return this.readRecords()[provider];
  }

  set(record: VideoImportCredentialRecord): void {
    const records = this.readRecords();
    records[record.provider] = { ...record };
    this.writeRecords(records);
  }

  /** Disconnect removes the whole file — see the file-header note above. */
  delete(): void {
    try {
      fs.unlinkSync(this.filePath);
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }

  private readRecords(): StoredRecords {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const records: StoredRecords = {};
      for (const [provider, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (isStoredRecord(value)) records[provider as VideoImportProvider] = value;
      }
      return records;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return {};
      throw error;
    }
  }

  private writeRecords(records: StoredRecords): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(records, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // best-effort cleanup; the original rename error is what matters
      }
      throw error;
    }
    fs.chmodSync(this.filePath, 0o600);
  }
}
