// Hermetic Vimeo API double (INV-7.13 F-05 fixture). A real node:http
// server, precedent mock-openai.ts: freezes two video ids, one account, an
// OAuth token pair, and download bytes with a frozen size and SHA-256, so
// the PASS gate for "Vimeo imports a fixture through OAuth" never depends
// on the real Vimeo API or a live account.
//
// Every canary below (client secret, authorization code, access token,
// refresh token) is a fixed, low-entropy, obviously-fake string used ONLY
// so the secret-negative scan (video-import red spec item 7) has something
// concrete to search for across the data root, project root, SQLite bytes,
// logs, and captured HTTP bodies.

import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export const MOCK_VIMEO_CLIENT_ID = 'mock-vimeo-client-id-canary';
export const MOCK_VIMEO_CLIENT_SECRET = 'mock-vimeo-client-secret-canary';
export const MOCK_VIMEO_AUTHORIZATION_CODE = 'mock-vimeo-authorization-code-canary';
export const MOCK_VIMEO_ACCESS_TOKEN = 'mock-vimeo-access-token-canary';
export const MOCK_VIMEO_REFRESH_TOKEN = 'mock-vimeo-refresh-token-canary';
export const MOCK_VIMEO_ACCOUNT_NAME = 'Fixture Account';

export const MOCK_VIMEO_VIDEO_ID = 'vid_normal_fixture';
export const MOCK_VIMEO_REDIRECT_VIDEO_ID = 'vid_redirect_fixture';
export const MOCK_VIMEO_OVERSIZE_VIDEO_ID = 'vid_oversize_fixture';
export const MOCK_VIMEO_UNKNOWN_VIDEO_ID = 'vid_does_not_exist';

const NORMAL_VIDEO_BYTES_SIZE = 256 * 1024; // 256 KiB
const OVERSIZE_VIDEO_BYTES_SIZE = 6 * 1024 * 1024; // 6 MiB — bigger than any tiny test limit

function deterministicBytes(size: number, seed: number): Buffer {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i += 1) {
    buf[i] = (i * 31 + seed) % 251;
  }
  return buf;
}

export const MOCK_VIMEO_NORMAL_VIDEO_BYTES = deterministicBytes(NORMAL_VIDEO_BYTES_SIZE, 7);
export const MOCK_VIMEO_OVERSIZE_VIDEO_BYTES = deterministicBytes(OVERSIZE_VIDEO_BYTES_SIZE, 13);
export const MOCK_VIMEO_NORMAL_VIDEO_SHA256 = createHash('sha256').update(MOCK_VIMEO_NORMAL_VIDEO_BYTES).digest('hex');
export const MOCK_VIMEO_OVERSIZE_VIDEO_SHA256 = createHash('sha256').update(MOCK_VIMEO_OVERSIZE_VIDEO_BYTES).digest('hex');

export type MockVimeoRequest = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  receivedAt: string;
};

export type MockVimeoServer = {
  baseUrl: string;
  close: () => Promise<void>;
  requests: () => MockVimeoRequest[];
};

function videoMetadata(id: string, baseUrl: string): { name: string; size: number; downloadPath: string } | null {
  if (id === MOCK_VIMEO_VIDEO_ID) {
    return { name: 'Fixture Clip', size: MOCK_VIMEO_NORMAL_VIDEO_BYTES.length, downloadPath: `/download/${id}` };
  }
  if (id === MOCK_VIMEO_REDIRECT_VIDEO_ID) {
    return { name: 'Fixture Clip (redirected)', size: MOCK_VIMEO_NORMAL_VIDEO_BYTES.length, downloadPath: `/download/${id}` };
  }
  if (id === MOCK_VIMEO_OVERSIZE_VIDEO_ID) {
    return { name: 'Fixture Clip (oversize)', size: MOCK_VIMEO_OVERSIZE_VIDEO_BYTES.length, downloadPath: `/download/${id}` };
  }
  void baseUrl;
  return null;
}

function bytesForVideo(id: string): Buffer | null {
  if (id === MOCK_VIMEO_VIDEO_ID || id === MOCK_VIMEO_REDIRECT_VIDEO_ID) return MOCK_VIMEO_NORMAL_VIDEO_BYTES;
  if (id === MOCK_VIMEO_OVERSIZE_VIDEO_ID) return MOCK_VIMEO_OVERSIZE_VIDEO_BYTES;
  return null;
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) return null;
  return { start, end };
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/vnd.vimeo.*+json;version=3.4');
  res.end(JSON.stringify(value));
}

async function readFormBody(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function redactHeaders(headers: IncomingMessage['headers']): Record<string, string | string[] | undefined> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      key.toLowerCase() === 'authorization' ? '[REDACTED]' : value,
    ]),
  );
}

export async function createMockVimeoServer(): Promise<MockVimeoServer> {
  const requests: MockVimeoRequest[] = [];
  let baseUrl = '';

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock-vimeo.local');
    const path = url.pathname;
    requests.push({
      method: req.method ?? 'GET',
      path,
      headers: redactHeaders(req.headers),
      receivedAt: new Date().toISOString(),
    });

    if (req.method === 'GET' && path === '/oauth/authorize') {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><title>Mock Vimeo authorize</title><p>mock authorize page</p>');
      return;
    }

    if (req.method === 'POST' && path === '/oauth/access_token') {
      const authHeader = req.headers.authorization ?? '';
      const expected = `Basic ${Buffer.from(`${MOCK_VIMEO_CLIENT_ID}:${MOCK_VIMEO_CLIENT_SECRET}`).toString('base64')}`;
      if (authHeader !== expected) {
        sendJson(res, 401, { error: 'invalid client credentials' });
        return;
      }
      const body = await readFormBody(req);
      if (body.get('grant_type') !== 'authorization_code' || body.get('code') !== MOCK_VIMEO_AUTHORIZATION_CODE) {
        sendJson(res, 400, { error: 'invalid_grant' });
        return;
      }
      sendJson(res, 200, {
        access_token: MOCK_VIMEO_ACCESS_TOKEN,
        token_type: 'bearer',
        scope: 'public private video_files',
        refresh_token: MOCK_VIMEO_REFRESH_TOKEN,
        user: { name: MOCK_VIMEO_ACCOUNT_NAME },
      });
      return;
    }

    const videoMatch = /^\/videos\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && videoMatch) {
      if (req.headers.authorization !== `Bearer ${MOCK_VIMEO_ACCESS_TOKEN}`) {
        sendJson(res, 401, { error: 'invalid access token' });
        return;
      }
      const id = decodeURIComponent(videoMatch[1] ?? '');
      const metadata = videoMetadata(id, baseUrl);
      if (!metadata) {
        sendJson(res, 404, { error: 'video not found' });
        return;
      }
      sendJson(res, 200, {
        uri: `/videos/${id}`,
        name: metadata.name,
        size: metadata.size,
        download: [
          { quality: 'source', type: 'source', size: metadata.size, link: `${baseUrl}${metadata.downloadPath}` },
        ],
        files: [
          { quality: 'source', type: 'video/mp4', size: metadata.size, link: `${baseUrl}${metadata.downloadPath}` },
        ],
      });
      return;
    }

    const downloadMatch = /^\/download\/([^/]+)(\/dest)?$/.exec(path);
    if (req.method === 'GET' && downloadMatch) {
      const id = decodeURIComponent(downloadMatch[1] ?? '');
      const isDestHop = Boolean(downloadMatch[2]);
      if (id === MOCK_VIMEO_REDIRECT_VIDEO_ID && !isDestHop) {
        res.statusCode = 302;
        res.setHeader('location', `${path}/dest`);
        res.end();
        return;
      }
      const bytes = bytesForVideo(id);
      if (!bytes) {
        sendJson(res, 404, { error: 'download not found' });
        return;
      }
      const range = parseRange(req.headers.range, bytes.length);
      res.setHeader('content-type', 'video/mp4');
      res.setHeader('accept-ranges', 'bytes');
      if (range) {
        res.statusCode = 206;
        res.setHeader('content-range', `bytes ${range.start}-${range.end}/${bytes.length}`);
        res.setHeader('content-length', String(range.end - range.start + 1));
        res.end(bytes.subarray(range.start, range.end + 1));
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-length', String(bytes.length));
      res.end(bytes);
      return;
    }

    sendJson(res, 404, { error: `unexpected mock Vimeo path: ${req.method ?? 'GET'} ${path}` });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });

  const address = server.address();
  if (address == null || typeof address === 'string') {
    await closeServer(server);
    throw new Error('mock Vimeo server did not receive a TCP port');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    close: () => closeServer(server),
    requests: () => requests.slice(),
  };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => (error == null ? resolveClose() : rejectClose(error)));
  });
}
