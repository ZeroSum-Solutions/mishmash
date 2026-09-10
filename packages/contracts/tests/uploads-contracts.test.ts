// W8A — the staged-upload request carries an optional `dir` (mirroring the
// legacy multipart route's `dir` form field) and `matchAcceptedKind` is the
// one extension-lowercasing match the web client runs against the PUBLISHED
// `acceptedKinds` (the daemon's own `findAcceptedKind` performs the same
// match against its hardcoded list; `apps/web` may not import daemon
// internals). RED on base d7ff39a36 as a compile/import failure only (the new
// export does not exist); the BEHAVIOURAL red for this track lives in
// `apps/daemon/tests/project-upload-stream.test.ts` (dir path) and
// `apps/web/tests/providers/registry.test.ts` (type rejection).

import { describe, expect, it } from 'vitest';

import {
  matchAcceptedKind,
  type CreateProjectUploadRequest,
  type UploadAcceptedKind,
} from '../src/api/uploads.js';

const KINDS: UploadAcceptedKind[] = [
  { extensions: ['png'], mime: 'image/png', sniff: 'magic' },
  { extensions: ['jpg', 'jpeg'], mime: 'image/jpeg', sniff: 'magic' },
  { extensions: ['txt'], mime: 'text/plain', sniff: 'text' },
];

describe('CreateProjectUploadRequest.dir', () => {
  it('is optional and round-trips as a plain project-relative string', () => {
    const withDir: CreateProjectUploadRequest = { files: [{ name: 'a.txt', size: 1, mime: 'text/plain' }], dir: 'assets/refs' };
    const withoutDir: CreateProjectUploadRequest = { files: [{ name: 'a.txt', size: 1, mime: 'text/plain' }] };
    expect(JSON.parse(JSON.stringify(withDir)).dir).toBe('assets/refs');
    expect('dir' in withoutDir).toBe(false);
  });
});

describe('matchAcceptedKind', () => {
  it('matches by lower-cased extension, any alias', () => {
    expect(matchAcceptedKind('photo.PNG', KINDS)?.mime).toBe('image/png');
    expect(matchAcceptedKind('photo.JPEG', KINDS)?.mime).toBe('image/jpeg');
    expect(matchAcceptedKind('photo.jpg', KINDS)?.mime).toBe('image/jpeg');
    expect(matchAcceptedKind('notes.txt', KINDS)?.mime).toBe('text/plain');
  });

  it('returns null for an unlisted extension, no extension, or a dot-only name', () => {
    expect(matchAcceptedKind('setup.exe', KINDS)).toBeNull();
    expect(matchAcceptedKind('README', KINDS)).toBeNull();
    expect(matchAcceptedKind('.gitignore', KINDS)).toBeNull();
    expect(matchAcceptedKind('archive.tar.gz', KINDS)).toBeNull();
  });

  it('uses only the last extension segment and never matches against an empty kinds list', () => {
    expect(matchAcceptedKind('archive.tar.txt', KINDS)?.mime).toBe('text/plain');
    expect(matchAcceptedKind('notes.txt', [])).toBeNull();
  });
});
