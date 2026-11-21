import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { join, resolve } from 'node:path';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import type {
  HttpKeyValueItem,
  HttpResponseData,
  HttpSendPayload,
  SavedHttpRequest
} from '@shared/types';
import {
  createDefaultHttpWorkspace,
  type HttpCollectionWorkspace
} from '@shared/apiCollectionEngine';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB cap

function buildTargetUrl(rawUrl: string, queryParams?: HttpKeyValueItem[]): URL {
  let normalized = rawUrl.trim();
  if (!normalized) {
    throw new Error('URL tujuan belum diisi.');
  }
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `http://${normalized}`;
  }
  const parsed = new URL(normalized);
  for (const item of queryParams ?? []) {
    if (item.enabled && item.key.trim()) {
      parsed.searchParams.append(item.key.trim(), item.value ?? '');
    }
  }
  return parsed;
}

function formatSessionCookie(cookieSession?: string): string | null {
  const trimmed = cookieSession?.trim();
  if (!trimmed) return null;
  if (trimmed.includes('=')) {
    return trimmed;
  }
  return `PHPSESSID=${trimmed}`;
}

export class HttpClientService {
  private readonly storageDir: string;
  private readonly requestsFile: string;
  private readonly workspaceFile: string;

  constructor(storageDir: string) {
    this.storageDir = resolve(storageDir);
    this.requestsFile = join(this.storageDir, 'http-requests.json');
    this.workspaceFile = join(this.storageDir, 'http-collections.json');
  }

  async getWorkspace(): Promise<HttpCollectionWorkspace> {
    if (!existsSync(this.workspaceFile)) {
      const base = createDefaultHttpWorkspace();
      const legacy = await this.listSaved();
      if (legacy.length > 0) {
        base.requests = legacy.map((r) => ({ ...r, folder: 'Umum' }));
      }
      return base;
    }
    try {
      const raw = await readFile(this.workspaceFile, 'utf-8');
      const parsed = JSON.parse(raw) as HttpCollectionWorkspace;
      if (!parsed.environments || parsed.environments.length === 0) {
        parsed.environments = createDefaultHttpWorkspace().environments;
      }
      if (!parsed.folders) parsed.folders = ['Umum'];
      if (!parsed.requests) parsed.requests = [];
      return parsed;
    } catch {
      return createDefaultHttpWorkspace();
    }
  }

  async saveWorkspace(workspace: HttpCollectionWorkspace): Promise<HttpCollectionWorkspace> {
    await mkdir(this.storageDir, { recursive: true });
    await writeFile(this.workspaceFile, JSON.stringify(workspace, null, 2), 'utf-8');
    return workspace;
  }

  async listSaved(): Promise<SavedHttpRequest[]> {
    if (!existsSync(this.requestsFile)) return [];
    try {
      const raw = await readFile(this.requestsFile, 'utf-8');
      return JSON.parse(raw) as SavedHttpRequest[];
    } catch {
      return [];
    }
  }

  private async writeSaved(items: SavedHttpRequest[]): Promise<void> {
    await mkdir(this.storageDir, { recursive: true });
    await writeFile(this.requestsFile, JSON.stringify(items, null, 2), 'utf-8');
  }

  async saveRequest(
    payload: Omit<SavedHttpRequest, 'id' | 'updatedAt'> & { id?: string }
  ): Promise<SavedHttpRequest> {
    const items = await this.listSaved();
    const id =
      payload.id?.trim() ||
      `http-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const saved: SavedHttpRequest = {
      ...payload,
      id,
      name: payload.name.trim() || `${payload.method} ${payload.url}`,
      updatedAt: new Date().toISOString()
    };
    const idx = items.findIndex((r) => r.id === id);
    if (idx >= 0) {
      items[idx] = saved;
    } else {
      items.unshift(saved);
    }
    await this.writeSaved(items.slice(0, 120));
    return saved;
  }

  async deleteSaved(id: string): Promise<void> {
    const items = await this.listSaved();
    await this.writeSaved(items.filter((r) => r.id !== id));
  }

  async send(payload: HttpSendPayload): Promise<HttpResponseData> {
    const started = Date.now();
    const initialUrl = buildTargetUrl(payload.url, payload.queryParams);
    const timeoutMs = Math.max(1000, Math.min(120000, payload.timeoutMs ?? 20000));
    const followRedirects = payload.followRedirects !== false;

    const headers: Record<string, string> = {
      Accept: '*/*',
      'User-Agent': 'HMW-Studio-HTTP-Client/4.0',
      'Accept-Encoding': 'gzip, deflate, br'
    };

    for (const h of payload.headers ?? []) {
      if (h.enabled && h.key.trim()) {
        headers[h.key.trim()] = h.value ?? '';
      }
    }

    const sessionCookie = formatSessionCookie(payload.cookieSession);
    if (sessionCookie) {
      const existingKey = Object.keys(headers).find((k) => k.toLowerCase() === 'cookie');
      if (existingKey) {
        headers[existingKey] = `${headers[existingKey]}; ${sessionCookie}`;
      } else {
        headers.Cookie = sessionCookie;
      }
    }

    let bodyBuffer: Buffer | null = null;
    const method = payload.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      if (payload.bodyMode === 'urlencoded') {
        const params = new URLSearchParams();
        for (const f of payload.formFields ?? []) {
          if (f.enabled && f.key.trim()) {
            params.append(f.key.trim(), f.value ?? '');
          }
        }
        bodyBuffer = Buffer.from(params.toString(), 'utf-8');
        if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
          headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        }
      } else if (payload.bodyMode === 'json') {
        bodyBuffer = Buffer.from(payload.rawBody ?? '', 'utf-8');
        if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
          headers['Content-Type'] = 'application/json; charset=UTF-8';
        }
      } else if (payload.bodyMode === 'raw') {
        bodyBuffer = Buffer.from(payload.rawBody ?? '', 'utf-8');
        if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
          headers['Content-Type'] = 'text/plain; charset=UTF-8';
        }
      }
    }

    const performSingleRequest = (
      currentUrl: URL,
      currentMethod: string,
      currentBody: Buffer | null,
      redirectsLeft: number
    ): Promise<HttpResponseData> =>
      new Promise((resolveResp, rejectResp) => {
        const isHttps = currentUrl.protocol === 'https:';
        const reqFn = isHttps ? httpsRequest : httpRequest;

        const reqHeaders: Record<string, string> = { ...headers };
        if (currentBody) {
          reqHeaders['Content-Length'] = String(currentBody.byteLength);
        } else {
          delete reqHeaders['Content-Length'];
        }

        const req = reqFn(
          currentUrl,
          {
            method: currentMethod,
            headers: reqHeaders,
            timeout: timeoutMs,
            ...(isHttps ? { rejectUnauthorized: !payload.insecureTls } : {})
          },
          (res) => {
            const status = res.statusCode ?? 0;
            const locationHeader = res.headers.location;

            if (
              followRedirects &&
              redirectsLeft > 0 &&
              locationHeader &&
              [301, 302, 303, 307, 308].includes(status)
            ) {
              res.resume();
              const nextUrl = new URL(locationHeader, currentUrl);
              const nextMethod = status === 303 ? 'GET' : currentMethod;
              const nextBody = status === 303 ? null : currentBody;
              performSingleRequest(nextUrl, nextMethod, nextBody, redirectsLeft - 1)
                .then(resolveResp)
                .catch(rejectResp);
              return;
            }

            const chunks: Buffer[] = [];
            let totalBytes = 0;
            let truncated = false;

            res.on('data', (chunk: Buffer) => {
              if (totalBytes < MAX_RESPONSE_BYTES) {
                const remaining = MAX_RESPONSE_BYTES - totalBytes;
                if (chunk.length > remaining) {
                  chunks.push(chunk.subarray(0, remaining));
                  truncated = true;
                } else {
                  chunks.push(chunk);
                }
              } else {
                truncated = true;
              }
              totalBytes += chunk.length;
            });

            res.on('end', () => {
              const durationMs = Math.max(1, Date.now() - started);
              let rawBuf = Buffer.concat(chunks);
              const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
              if (!truncated && rawBuf.length > 0) {
                try {
                  if (encoding.includes('gzip')) {
                    rawBuf = gunzipSync(rawBuf);
                  } else if (encoding.includes('deflate')) {
                    rawBuf = inflateSync(rawBuf);
                  } else if (encoding.includes('br')) {
                    rawBuf = brotliDecompressSync(rawBuf);
                  }
                } catch {
                  // Keep raw bytes if decompression fails
                }
              }

              const outHeaders: Record<string, string> = {};
              for (const [k, v] of Object.entries(res.headers)) {
                if (Array.isArray(v)) {
                  outHeaders[k] = v.join('; ');
                } else if (v !== undefined) {
                  outHeaders[k] = String(v);
                }
              }

              const contentType = String(res.headers['content-type'] ?? '');
              let bodyText = rawBuf.toString('utf-8');
              let isJson = contentType.toLowerCase().includes('json');
              if (isJson || bodyText.trim().startsWith('{') || bodyText.trim().startsWith('[')) {
                try {
                  const parsedJson = JSON.parse(bodyText);
                  bodyText = JSON.stringify(parsedJson, null, 2);
                  isJson = true;
                } catch {
                  // Keep raw string
                }
              }

              resolveResp({
                ok: status >= 200 && status < 400,
                status,
                statusText: res.statusMessage || '',
                durationMs,
                sizeBytes: totalBytes,
                contentType,
                isJson,
                headers: outHeaders,
                body: bodyText,
                finalUrl: currentUrl.toString(),
                truncated
              });
            });

            res.on('error', rejectResp);
          }
        );

        req.on('timeout', () => {
          req.destroy(new Error(`Request melewati batas waktu (${timeoutMs} ms).`));
        });

        req.on('error', (err) => {
          rejectResp(err);
        });

        if (currentBody) {
          req.write(currentBody);
        }
        req.end();
      });

    return performSingleRequest(initialUrl, method, bodyBuffer, 5);
  }
}
