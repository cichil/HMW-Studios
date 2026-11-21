import type { HttpBodyMode, HttpKeyValueItem, HttpMethod, HttpSendPayload, SavedHttpRequest } from './types';

export interface HttpEnvironmentProfile {
  id: string;
  name: string; // e.g. 'Development', 'Staging', 'Production'
  variables: Record<string, string>; // e.g. { base_url: 'https://api.kemenperin.go.id', token: '' }
}

export interface HttpCollectionWorkspace {
  activeEnvId: string;
  environments: HttpEnvironmentProfile[];
  folders: string[];
  requests: Array<
    SavedHttpRequest & {
      folder?: string;
      autoCaptureJsonPath?: string; // e.g. 'data.access_token'
      autoCaptureTargetVar?: string; // e.g. 'token'
    }
  >;
}

export function createDefaultHttpWorkspace(): HttpCollectionWorkspace {
  return {
    activeEnvId: 'env-dev',
    environments: [
      {
        id: 'env-dev',
        name: 'Development (Lokal)',
        variables: {
          base_url: 'http://localhost',
          token: '',
          api_key: ''
        }
      },
      {
        id: 'env-prod',
        name: 'Production',
        variables: {
          base_url: 'https://server-produksi.local',
          token: '',
          api_key: ''
        }
      }
    ],
    folders: ['Umum', 'Autentikasi'],
    requests: []
  };
}

export function resolveEnvTemplateString(
  input: string,
  variables: Record<string, string>
): string {
  if (!input) return input;
  return input.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (full, key: string) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : full;
  });
}

export function resolveHttpPayloadWithEnv(
  payload: HttpSendPayload,
  variables: Record<string, string>
): HttpSendPayload {
  const mapKv = (items?: HttpKeyValueItem[]): HttpKeyValueItem[] | undefined =>
    items?.map((item) => ({
      ...item,
      key: resolveEnvTemplateString(item.key, variables),
      value: resolveEnvTemplateString(item.value, variables)
    }));

  return {
    ...payload,
    url: resolveEnvTemplateString(payload.url, variables),
    cookieSession: payload.cookieSession
      ? resolveEnvTemplateString(payload.cookieSession, variables)
      : payload.cookieSession,
    rawBody: payload.rawBody ? resolveEnvTemplateString(payload.rawBody, variables) : payload.rawBody,
    queryParams: mapKv(payload.queryParams),
    headers: mapKv(payload.headers),
    formFields: mapKv(payload.formFields)
  };
}

/**
 * Extracts a nested value from JSON string by dot-path (e.g. `data.access_token` or `items.0.id`).
 */
export function extractJsonPathValue(jsonText: string, dotPath: string): string | null {
  const path = dotPath.trim();
  if (!path || !jsonText.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  const segments = path.split('.').map((s) => s.trim()).filter(Boolean);
  let cursor: unknown = parsed;
  for (const seg of segments) {
    if (cursor === null || cursor === undefined) return null;
    if (Array.isArray(cursor)) {
      const idx = Number.parseInt(seg, 10);
      if (!Number.isFinite(idx) || idx < 0 || idx >= cursor.length) return null;
      cursor = cursor[idx];
    } else if (typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>)[seg];
    } else {
      return null;
    }
  }

  if (cursor === null || cursor === undefined) return null;
  return typeof cursor === 'object' ? JSON.stringify(cursor) : String(cursor);
}

export function extractSessionCookieFromHeaders(headers: Record<string, string>): string | null {
  const setCookieEntry = Object.entries(headers).find(
    ([k]) => k.toLowerCase() === 'set-cookie'
  );
  if (!setCookieEntry) return null;
  const raw = setCookieEntry[1];
  const pairs: string[] = [];
  for (const part of raw.split(/,(?=\s*[a-zA-Z0-9_-]+=)/)) {
    const firstSemi = part.split(';')[0]?.trim();
    if (firstSemi && firstSemi.includes('=')) {
      pairs.push(firstSemi);
    }
  }
  return pairs.length > 0 ? pairs.join('; ') : null;
}

export interface ImportedApiSpecResult {
  sourceFormat: 'openapi-3' | 'swagger-2' | 'postman-v2';
  collectionName: string;
  baseUrl?: string;
  requests: Array<
    Omit<SavedHttpRequest, 'id' | 'updatedAt'> & {
      folder: string;
    }
  >;
}

const VALID_METHODS = new Set<HttpMethod>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS'
]);

function normalizeMethod(m: unknown): HttpMethod {
  const up = String(m || 'GET').toUpperCase() as HttpMethod;
  return VALID_METHODS.has(up) ? up : 'GET';
}

export function importOpenApiOrPostmanJson(rawJson: string): ImportedApiSpecResult {
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(rawJson) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Format JSON tidak valid: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 1. Postman Collection v2.x
  if (doc.info && typeof doc.info === 'object' && Array.isArray(doc.item)) {
    const info = doc.info as Record<string, unknown>;
    const collectionName = String(info.name || 'Postman Collection');
    const requests: ImportedApiSpecResult['requests'] = [];

    const walkPostmanItems = (items: unknown[], folderName: string): void => {
      for (const raw of items) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as Record<string, unknown>;
        if (Array.isArray(item.item)) {
          walkPostmanItems(item.item, String(item.name || folderName));
          continue;
        }
        const reqObj = item.request as Record<string, unknown> | undefined;
        if (!reqObj || typeof reqObj !== 'object') continue;

        const method = normalizeMethod(reqObj.method);
        let url = '';
        if (typeof reqObj.url === 'string') {
          url = reqObj.url;
        } else if (reqObj.url && typeof reqObj.url === 'object') {
          const u = reqObj.url as Record<string, unknown>;
          url = String(u.raw || '');
        }

        const headers: HttpKeyValueItem[] = Array.isArray(reqObj.header)
          ? reqObj.header
              .filter((h): h is Record<string, unknown> => Boolean(h && typeof h === 'object'))
              .map((h) => ({
                key: String(h.key || ''),
                value: String(h.value || ''),
                enabled: !h.disabled
              }))
              .filter((h) => h.key.length > 0)
          : [];

        let bodyMode: HttpBodyMode = 'none';
        let rawBody = '';
        const formFields: HttpKeyValueItem[] = [];
        if (reqObj.body && typeof reqObj.body === 'object') {
          const b = reqObj.body as Record<string, unknown>;
          if (b.mode === 'raw') {
            rawBody = String(b.raw || '');
            bodyMode = rawBody.trim().startsWith('{') || rawBody.trim().startsWith('[') ? 'json' : 'raw';
          } else if (b.mode === 'urlencoded' && Array.isArray(b.urlencoded)) {
            bodyMode = 'urlencoded';
            for (const f of b.urlencoded) {
              if (f && typeof f === 'object') {
                const fo = f as Record<string, unknown>;
                formFields.push({
                  key: String(fo.key || ''),
                  value: String(fo.value || ''),
                  enabled: !fo.disabled
                });
              }
            }
          }
        }

        requests.push({
          name: String(item.name || `${method} ${url}`),
          folder: folderName,
          method,
          url: url || '{{base_url}}/',
          headers,
          queryParams: [],
          bodyMode,
          rawBody,
          formFields,
          insecureTls: true,
          followRedirects: true
        });
      }
    };

    walkPostmanItems(doc.item, collectionName);
    return {
      sourceFormat: 'postman-v2',
      collectionName,
      requests
    };
  }

  // 2. OpenAPI 3.x or Swagger 2.0
  if (doc.paths && typeof doc.paths === 'object') {
    const isSwagger2 = typeof doc.swagger === 'string' && doc.swagger.startsWith('2');
    const info = (doc.info ?? {}) as Record<string, unknown>;
    const collectionName = String(info.title || 'OpenAPI Collection');
    let baseUrl = '{{base_url}}';
    if (!isSwagger2 && Array.isArray(doc.servers) && doc.servers[0] && typeof doc.servers[0] === 'object') {
      const sUrl = String((doc.servers[0] as Record<string, unknown>).url || '').replace(/\/+$/, '');
      if (sUrl) baseUrl = sUrl;
    } else if (isSwagger2 && doc.host) {
      const scheme = Array.isArray(doc.schemes) && doc.schemes[0] ? String(doc.schemes[0]) : 'https';
      const bp = String(doc.basePath || '').replace(/\/+$/, '');
      baseUrl = `${scheme}://${String(doc.host)}${bp}`;
    }

    const requests: ImportedApiSpecResult['requests'] = [];
    for (const [pathKey, pathDef] of Object.entries(doc.paths as Record<string, unknown>)) {
      if (!pathDef || typeof pathDef !== 'object') continue;
      for (const [methodKey, opVal] of Object.entries(pathDef as Record<string, unknown>)) {
        const method = methodKey.toUpperCase() as HttpMethod;
        if (!VALID_METHODS.has(method)) continue;
        const op = (opVal ?? {}) as Record<string, unknown>;
        const tags = Array.isArray(op.tags) && op.tags[0] ? String(op.tags[0]) : collectionName;
        const summary = String(op.summary || op.operationId || `${method} ${pathKey}`);
        const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';

        const queryParams: HttpKeyValueItem[] = [];
        if (Array.isArray(op.parameters)) {
          for (const p of op.parameters) {
            if (p && typeof p === 'object' && (p as Record<string, unknown>).in === 'query') {
              queryParams.push({
                key: String((p as Record<string, unknown>).name || ''),
                value: '',
                enabled: Boolean((p as Record<string, unknown>).required)
              });
            }
          }
        }

        requests.push({
          name: summary,
          folder: tags,
          method,
          url: `{{base_url}}${pathKey}`,
          queryParams,
          headers: hasBody ? [{ key: 'Content-Type', value: 'application/json', enabled: true }] : [],
          bodyMode: hasBody ? 'json' : 'none',
          rawBody: hasBody ? '{\n  \n}' : '',
          formFields: [],
          insecureTls: true,
          followRedirects: true
        });
      }
    }

    return {
      sourceFormat: isSwagger2 ? 'swagger-2' : 'openapi-3',
      collectionName,
      baseUrl,
      requests
    };
  }

  throw new Error(
    'JSON tidak dikenali sebagai OpenAPI 3.x, Swagger 2.0, atau Postman Collection v2.1.'
  );
}

export function generateHttpClientSnippet(
  payload: HttpSendPayload,
  target: 'php-curl' | 'php-guzzle' | 'js-fetch'
): string {
  const activeHeaders = (payload.headers ?? []).filter((h) => h.enabled && h.key.trim());
  const activeForm = (payload.formFields ?? []).filter((f) => f.enabled && f.key.trim());
  const url = payload.url.trim() || 'https://example.com/api';

  if (target === 'js-fetch') {
    const headerLines = activeHeaders.map(
      (h) => `    ${JSON.stringify(h.key)}: ${JSON.stringify(h.value)}`
    );
    if (payload.cookieSession?.trim()) {
      headerLines.push(`    "Cookie": ${JSON.stringify(payload.cookieSession.trim())}`);
    }
    let bodyLine = '';
    if (payload.bodyMode === 'json' && payload.rawBody?.trim()) {
      bodyLine = `,\n  body: JSON.stringify(${payload.rawBody.trim()})`;
    } else if (payload.bodyMode === 'raw' && payload.rawBody?.trim()) {
      bodyLine = `,\n  body: ${JSON.stringify(payload.rawBody)}`;
    } else if (payload.bodyMode === 'urlencoded' && activeForm.length > 0) {
      const pairs = activeForm.map((f) => `[${JSON.stringify(f.key)}, ${JSON.stringify(f.value)}]`).join(', ');
      bodyLine = `,\n  body: new URLSearchParams([${pairs}])`;
    }
    return `const response = await fetch(${JSON.stringify(url)}, {\n  method: ${JSON.stringify(
      payload.method
    )},\n  headers: {\n${headerLines.join(',\n')}\n  }${bodyLine}\n});\nconst data = await response.json();\nconsole.log(data);`;
  }

  if (target === 'php-guzzle') {
    const lines: string[] = [
      '<?php',
      'use Illuminate\\Support\\Facades\\Http;',
      ''
    ];
    let chain = '$response = Http::';
    if (payload.insecureTls) {
      chain += 'withoutVerifying()->';
    }
    if (activeHeaders.length > 0) {
      const hPairs = activeHeaders
        .map((h) => `  '${h.key.replace(/'/g, "\\'")}' => '${h.value.replace(/'/g, "\\'")}'`)
        .join(",\n");
      chain += `withHeaders([\n${hPairs}\n])->`;
    }
    if (payload.bodyMode === 'urlencoded') {
      chain += 'asForm()->';
    }
    const methodLower = payload.method.toLowerCase();
    if (payload.bodyMode === 'urlencoded' && activeForm.length > 0) {
      const fPairs = activeForm
        .map((f) => `  '${f.key.replace(/'/g, "\\'")}' => '${f.value.replace(/'/g, "\\'")}'`)
        .join(",\n");
      chain += `${methodLower}('${url.replace(/'/g, "\\'")}', [\n${fPairs}\n]);`;
    } else if (payload.bodyMode === 'json' && payload.rawBody?.trim()) {
      chain += `withBody(${JSON.stringify(payload.rawBody)}, 'application/json')->${methodLower}('${url.replace(/'/g, "\\'")}');`;
    } else {
      chain += `${methodLower}('${url.replace(/'/g, "\\'")}');`;
    }
    lines.push(chain, '$data = $response->json();');
    return lines.join('\n');
  }

  // Native PHP cURL
  const lines: string[] = [
    '<?php',
    `$ch = curl_init('${url.replace(/'/g, "\\'")}');`,
    'curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);',
    `curl_setopt($ch, CURLOPT_CUSTOMREQUEST, '${payload.method}');`
  ];
  if (payload.insecureTls) {
    lines.push('curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);');
  }
  const hdrs = activeHeaders.map((h) => `'${h.key.replace(/'/g, "\\'")}: ${h.value.replace(/'/g, "\\'")}'`);
  if (payload.cookieSession?.trim()) {
    lines.push(`curl_setopt($ch, CURLOPT_COOKIE, '${payload.cookieSession.trim().replace(/'/g, "\\'")}');`);
  }
  if (hdrs.length > 0) {
    lines.push(`curl_setopt($ch, CURLOPT_HTTPHEADER, [\n  ${hdrs.join(',\n  ')}\n]);`);
  }
  if (payload.bodyMode === 'urlencoded' && activeForm.length > 0) {
    const fPairs = activeForm
      .map((f) => `'${f.key.replace(/'/g, "\\'")}' => '${f.value.replace(/'/g, "\\'")}'`)
      .join(', ');
    lines.push(`curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query([${fPairs}]));`);
  } else if ((payload.bodyMode === 'json' || payload.bodyMode === 'raw') && payload.rawBody?.trim()) {
    lines.push(`curl_setopt($ch, CURLOPT_POSTFIELDS, ${JSON.stringify(payload.rawBody)});`);
  }
  lines.push('$response = curl_exec($ch);', 'curl_close($ch);', 'echo $response;');
  return lines.join('\n');
}
