import type { HttpBodyMode, HttpKeyValueItem, HttpMethod } from './types';

export interface ExtractedEndpointDraft {
  name: string;
  method: HttpMethod;
  suggestedUrl: string;
  bodyMode: HttpBodyMode;
  formFields: HttpKeyValueItem[];
  queryParams: HttpKeyValueItem[];
  headers: HttpKeyValueItem[];
  cookieSession?: string;
  rawBody?: string;
}

/**
 * Scans PHP / Wisanggeni (`*_save.php`, `*_ajax.php`) / Laravel Controller code
 * to auto-populate HTTP Tester fields (`$_POST`, `$_GET`, `$_REQUEST`, `$request->input`).
 */
export function extractPhpHttpEndpointSpec(
  code: string,
  relativePath: string,
  basePreviewUrl = 'http://localhost:8080'
): ExtractedEndpointDraft {
  const postKeys = new Set<string>();
  const getKeys = new Set<string>();

  // 1. Classic PHP superglobals: $_POST['nip'], $_GET["act"], $_REQUEST['id']
  const postRegex = /\$_POST\s*\[\s*['"]([A-Za-z0-9_.\-[\]]+)['"]\s*\]/g;
  for (const m of code.matchAll(postRegex)) {
    if (m[1]) postKeys.add(m[1]);
  }

  const getRegex = /\$_GET\s*\[\s*['"]([A-Za-z0-9_.\-[\]]+)['"]\s*\]/g;
  for (const m of code.matchAll(getRegex)) {
    if (m[1]) getKeys.add(m[1]);
  }

  const reqRegex = /\$_REQUEST\s*\[\s*['"]([A-Za-z0-9_.\-[\]]+)['"]\s*\]/g;
  for (const m of code.matchAll(reqRegex)) {
    if (m[1]) postKeys.add(m[1]);
  }

  // 2. Laravel $request->input('...'), $request->post('...'), $request->boolean('...'), $request->date('...')
  const lvPostRegex =
    /\$request\s*->\s*(?:input|post|string|integer|float|boolean|date|file)\s*\(\s*['"]([A-Za-z0-9_.\-]+)['"]/g;
  for (const m of code.matchAll(lvPostRegex)) {
    if (m[1]) postKeys.add(m[1]);
  }

  const lvQueryRegex = /\$request\s*->\s*query\s*\(\s*['"]([A-Za-z0-9_.\-]+)['"]/g;
  for (const m of code.matchAll(lvQueryRegex)) {
    if (m[1]) getKeys.add(m[1]);
  }

  // 3. Laravel validation rules array: $request->validate(['email' => 'required|email', ...])
  const valBlockRegex = /->\s*validate\s*\(\s*\[([\s\S]*?)\]/g;
  for (const bm of code.matchAll(valBlockRegex)) {
    const inner = bm[1] ?? '';
    for (const km of inner.matchAll(/['"]([A-Za-z0-9_.\-]+)['"]\s*=>/g)) {
      if (km[1]) postKeys.add(km[1]);
    }
  }

  // 4. Wisanggeni $query->setParam(':nama_kolom', $_POST[...]) or HTML <input name="...">
  for (const im of code.matchAll(/<(?:input|select|textarea)\b[^>]*\bname\s*=\s*['"]([A-Za-z0-9_.\-[\]]+)['"]/gi)) {
    if (im[1]) postKeys.add(im[1]);
  }

  const normPath = (relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const isSaveOrPost =
    postKeys.size > 0 || /_(?:save|simpan|act|aksi|proses|proc|del|hapus)\.php$/i.test(normPath);

  const method: HttpMethod = isSaveOrPost ? 'POST' : 'GET';
  const cleanBase = basePreviewUrl.replace(/\/+$/, '');
  const querySuffix =
    getKeys.size > 0
      ? `?${Array.from(getKeys)
          .map((k) => `${encodeURIComponent(k)}=`)
          .join('&')}`
      : '';
  const suggestedUrl = `${cleanBase}/${normPath}${querySuffix}`;

  const guessDefaultVal = (key: string): string => {
    const low = key.toLowerCase();
    if (low === 'act' || low === 'aksi' || low === 'action') return 'save';
    if (low.includes('aktif') || low.includes('status')) return '1';
    if (low.includes('tgl') || low.includes('tanggal') || low.includes('date')) {
      return new Date().toISOString().slice(0, 10);
    }
    return '';
  };

  const formFields: HttpKeyValueItem[] = Array.from(postKeys).map((k) => ({
    key: k,
    value: guessDefaultVal(k),
    enabled: true
  }));

  if (formFields.length === 0 && method === 'POST') {
    formFields.push({ key: 'act', value: 'save', enabled: true });
  }

  const queryParams: HttpKeyValueItem[] = Array.from(getKeys).map((k) => ({
    key: k,
    value: guessDefaultVal(k),
    enabled: true
  }));

  return {
    name: `${method} ${normPath.split('/').pop() || normPath}`,
    method,
    suggestedUrl,
    bodyMode: 'urlencoded',
    formFields,
    queryParams,
    headers: [{ key: 'X-Requested-With', value: 'XMLHttpRequest', enabled: true }]
  };
}

function tokenizeCurlArgs(raw: string): string[] {
  // Normalize multi-line bash (`\`) and Windows CMD (`^`) line continuations
  const normalized = raw
    .replace(/\\\r?\n/g, ' ')
    .replace(/\^\r?\n/g, ' ')
    .replace(/\^"/g, '"')
    .replace(/\^%/g, '%')
    .replace(/\^&/g, '&')
    .trim();

  const tokens: string[] = [];
  let buf = '';
  let inSingle = false;
  let inDouble = false;
  let ansiDollarSingle = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    const next = normalized[i + 1] ?? '';

    if (!inSingle && !inDouble && ch === '$' && next === "'") {
      inSingle = true;
      ansiDollarSingle = true;
      i++;
      continue;
    }

    if (inSingle) {
      if (ansiDollarSingle && ch === '\\') {
        const esc = next;
        if (esc === 'n') buf += '\n';
        else if (esc === 'r') buf += '\r';
        else if (esc === 't') buf += '\t';
        else buf += esc;
        i++;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
        ansiDollarSingle = false;
        continue;
      }
      buf += ch;
      continue;
    }

    if (inDouble) {
      if (ch === '\\') {
        buf += next;
        i++;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
        continue;
      }
      buf += ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (buf.length > 0) {
        tokens.push(buf);
        buf = '';
      }
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '\\') {
      buf += next;
      i++;
      continue;
    }

    buf += ch;
  }

  if (buf.length > 0) tokens.push(buf);
  return tokens;
}

/**
 * Parses Chrome DevTools / Firefox / Postman `Copy as cURL` (bash or cmd)
 * into structured URL, Method, Headers, PHPSESSID Cookie, and Form/JSON Body.
 */
export function parseCurlCommand(curlText: string): ExtractedEndpointDraft | null {
  const tokens = tokenizeCurlArgs(curlText);
  if (tokens.length === 0) return null;

  let startIdx = 0;
  if (tokens[0].toLowerCase().replace(/\.exe$/i, '') === 'curl') {
    startIdx = 1;
  }

  let url = '';
  let explicitMethod: HttpMethod | null = null;
  const headers: HttpKeyValueItem[] = [];
  let cookieSession = '';
  const dataParts: string[] = [];

  for (let i = startIdx; i < tokens.length; i++) {
    const tok = tokens[i];
    const next = tokens[i + 1] ?? '';

    if ((tok === '-X' || tok === '--request') && next) {
      const mUpper = next.toUpperCase();
      if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(mUpper)) {
        explicitMethod = mUpper as HttpMethod;
      }
      i++;
      continue;
    }

    if ((tok === '-H' || tok === '--header') && next) {
      const colonIdx = next.indexOf(':');
      if (colonIdx > 0) {
        const hKey = next.slice(0, colonIdx).trim();
        const hVal = next.slice(colonIdx + 1).trim();
        if (hKey.toLowerCase() === 'cookie') {
          cookieSession = cookieSession ? `${cookieSession}; ${hVal}` : hVal;
        } else {
          headers.push({ key: hKey, value: hVal, enabled: true });
        }
      }
      i++;
      continue;
    }

    if ((tok === '-b' || tok === '--cookie') && next) {
      cookieSession = cookieSession ? `${cookieSession}; ${next}` : next;
      i++;
      continue;
    }

    if (
      (tok === '-d' ||
        tok === '--data' ||
        tok === '--data-raw' ||
        tok === '--data-binary' ||
        tok === '--data-urlencode') &&
      next !== undefined
    ) {
      dataParts.push(next);
      i++;
      continue;
    }

    if (tok === '--url' && next) {
      url = next;
      i++;
      continue;
    }

    if (tok.startsWith('-')) {
      continue;
    }

    if (!url && /^https?:\/\//i.test(tok)) {
      url = tok;
    }
  }

  if (!url) return null;

  const combinedBody = dataParts.join('&');
  const method: HttpMethod =
    explicitMethod ?? (dataParts.length > 0 ? 'POST' : 'GET');

  const contentTypeHeader =
    headers.find((h) => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() ?? '';

  let bodyMode: HttpBodyMode = 'none';
  let formFields: HttpKeyValueItem[] = [];
  let rawBody = '';

  if (dataParts.length > 0) {
    const trimmedBody = combinedBody.trim();
    if (
      contentTypeHeader.includes('application/json') ||
      (trimmedBody.startsWith('{') && trimmedBody.endsWith('}')) ||
      (trimmedBody.startsWith('[') && trimmedBody.endsWith(']'))
    ) {
      bodyMode = 'json';
      rawBody = combinedBody;
    } else if (
      contentTypeHeader.includes('urlencoded') ||
      (combinedBody.includes('=') && !combinedBody.includes('\n'))
    ) {
      bodyMode = 'urlencoded';
      const params = new URLSearchParams(combinedBody);
      params.forEach((val, key) => {
        formFields.push({ key, value: val, enabled: true });
      });
    } else {
      bodyMode = 'raw';
      rawBody = combinedBody;
    }
  }

  if (formFields.length === 0) {
    formFields = [{ key: '', value: '', enabled: true }];
  }

  let shortLabel = url;
  try {
    const u = new URL(url);
    shortLabel = u.pathname.split('/').filter(Boolean).pop() || u.pathname || u.host;
  } catch {
    // ignore
  }

  return {
    name: `cURL: ${method} ${shortLabel}`,
    method,
    suggestedUrl: url,
    bodyMode,
    formFields,
    queryParams: [],
    headers,
    cookieSession: cookieSession || undefined,
    rawBody: rawBody || undefined
  };
}
