/**
 * Pure Xdebug DBGp (Port 9003) protocol parser & command builder.
 * Handles null-terminated length-prefixed DBGp XML packets with zero native dependencies.
 */

export interface XdebugStackFrame {
  level: number;
  type: string;
  filename: string;
  lineno: number;
  where: string;
}

export interface XdebugVariableItem {
  name: string;
  fullname: string;
  type: string;
  value: string;
  numChildren: number;
  children?: XdebugVariableItem[];
}

export interface XdebugBreakpointItem {
  id: string;
  filePath: string; // local or remote path key
  line: number;
  enabled: boolean;
  dbgpId?: string;
}

export interface XdebugInitInfo {
  fileuri: string;
  language: string;
  idekey: string;
  engineName: string;
  engineVersion: string;
}

export interface XdebugParsedResponse {
  kind: 'init' | 'response' | 'unknown';
  transactionId?: number;
  command?: string;
  status?: string;
  reason?: string;
  breakpointId?: string;
  init?: XdebugInitInfo;
  stack?: XdebugStackFrame[];
  properties?: XdebugVariableItem[];
  evalValue?: string;
  errorMessage?: string;
  rawXml: string;
}

const utf8Decoder = new TextDecoder('utf-8');
const utf8Encoder = new TextEncoder();

function encodeUtf8Base64(text: string): string {
  const bytes = utf8Encoder.encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function decodeUtf8Base64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return utf8Decoder.decode(bytes);
}

export function extractDbgpPacketsFromBuffer(buffer: Uint8Array): {
  packets: string[];
  remainder: Uint8Array;
} {
  const packets: string[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const firstNull = buffer.indexOf(0, offset);
    if (firstNull === -1) break;

    const lenStr = utf8Decoder.decode(buffer.subarray(offset, firstNull)).trim();
    const byteLen = Number.parseInt(lenStr, 10);
    if (!Number.isFinite(byteLen) || byteLen <= 0) {
      // Malformed prefix — skip past this null byte
      offset = firstNull + 1;
      continue;
    }

    const xmlStart = firstNull + 1;
    const xmlEnd = xmlStart + byteLen;
    if (xmlEnd >= buffer.length) {
      // Wait for trailing \0 and full payload
      break;
    }

    const xml = utf8Decoder.decode(buffer.subarray(xmlStart, xmlEnd));
    packets.push(xml);
    // DBGp appends a trailing \0 after the XML payload
    offset = buffer[xmlEnd] === 0 ? xmlEnd + 1 : xmlEnd;
  }

  return {
    packets,
    remainder: offset > 0 ? buffer.subarray(offset) : buffer
  };
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function getXmlAttr(tagAttrs: string, attrName: string): string {
  const re = new RegExp(`\\b${attrName}="([^"]*)"`);
  const m = tagAttrs.match(re);
  return m ? decodeXmlEntities(m[1]) : '';
}

function decodeDbgpTextContent(rawInner: string, encoding: string): string {
  const cleaned = rawInner.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
  if (encoding.toLowerCase() === 'base64') {
    try {
      return decodeUtf8Base64(cleaned);
    } catch {
      return cleaned;
    }
  }
  return decodeXmlEntities(cleaned);
}

function parsePropertyNodes(xmlFragment: string): XdebugVariableItem[] {
  const items: XdebugVariableItem[] = [];
  const propRe = /<property\b([^>]*?)(?:\/>|>([\s\S]*?)<\/property>)/g;
  let m: RegExpExecArray | null;
  while ((m = propRe.exec(xmlFragment)) !== null) {
    const attrs = m[1] || '';
    const inner = m[2] || '';
    const name = getXmlAttr(attrs, 'name') || '(anon)';
    const fullname = getXmlAttr(attrs, 'fullname') || name;
    const type = getXmlAttr(attrs, 'type') || 'string';
    const encoding = getXmlAttr(attrs, 'encoding');
    const numChildren = Number.parseInt(getXmlAttr(attrs, 'numchildren') || '0', 10) || 0;

    let value = '';
    if (inner.includes('<property')) {
      const childProps = parsePropertyNodes(inner);
      items.push({
        name,
        fullname,
        type,
        value: `${type}(${childProps.length || numChildren})`,
        numChildren: numChildren || childProps.length,
        children: childProps
      });
      continue;
    } else {
      value = decodeDbgpTextContent(inner, encoding);
      if (type === 'null') value = 'null';
      else if (type === 'bool') value = value === '1' ? 'true' : 'false';
      else if (type === 'uninitialized') value = '(uninitialized)';
    }

    items.push({
      name,
      fullname,
      type,
      value,
      numChildren
    });
  }
  return items;
}

export function parseDbgpXml(xml: string): XdebugParsedResponse {
  const trimmed = xml.trim();
  const initMatch = trimmed.match(/<init\b([^>]*)>/);
  if (initMatch) {
    const attrs = initMatch[1] || '';
    const engineMatch = trimmed.match(/<engine[^>]*version="([^"]*)"[^>]*>([^<]*)<\/engine>/);
    return {
      kind: 'init',
      init: {
        fileuri: getXmlAttr(attrs, 'fileuri'),
        language: getXmlAttr(attrs, 'language') || 'PHP',
        idekey: getXmlAttr(attrs, 'idekey'),
        engineName: engineMatch ? decodeXmlEntities(engineMatch[2]) : 'Xdebug',
        engineVersion: engineMatch ? decodeXmlEntities(engineMatch[1]) : ''
      },
      rawXml: trimmed
    };
  }

  const respMatch = trimmed.match(/<response\b([^>]*)>/);
  if (respMatch) {
    const attrs = respMatch[1] || '';
    const txId = Number.parseInt(getXmlAttr(attrs, 'transaction_id'), 10);
    const command = getXmlAttr(attrs, 'command');
    const status = getXmlAttr(attrs, 'status') || undefined;
    const reason = getXmlAttr(attrs, 'reason') || undefined;
    const breakpointId = getXmlAttr(attrs, 'id') || undefined;

    const errMatch = trimmed.match(/<error\b[^>]*>[\s\S]*?<message>([\s\S]*?)<\/message>/);
    const errorMessage = errMatch ? decodeXmlEntities(errMatch[1].trim()) : undefined;

    let stack: XdebugStackFrame[] | undefined;
    if (command === 'stack_get') {
      stack = [];
      const stackRe = /<stack\b([^>]*)\/?>/g;
      let sm: RegExpExecArray | null;
      while ((sm = stackRe.exec(trimmed)) !== null) {
        const sAttrs = sm[1] || '';
        stack.push({
          level: Number.parseInt(getXmlAttr(sAttrs, 'level') || '0', 10) || 0,
          type: getXmlAttr(sAttrs, 'type') || 'file',
          filename: getXmlAttr(sAttrs, 'filename'),
          lineno: Number.parseInt(getXmlAttr(sAttrs, 'lineno') || '1', 10) || 1,
          where: getXmlAttr(sAttrs, 'where') || '{main}'
        });
      }
    }

    let properties: XdebugVariableItem[] | undefined;
    let evalValue: string | undefined;
    if (command === 'context_get') {
      properties = parsePropertyNodes(trimmed);
    } else if (command === 'eval') {
      const evalProps = parsePropertyNodes(trimmed);
      if (evalProps.length > 0) {
        evalValue = `${evalProps[0].type}: ${evalProps[0].value}`;
      }
    }

    return {
      kind: 'response',
      transactionId: Number.isFinite(txId) ? txId : undefined,
      command,
      status,
      reason,
      breakpointId,
      stack,
      properties,
      evalValue,
      errorMessage,
      rawXml: trimmed
    };
  }

  return { kind: 'unknown', rawXml: trimmed };
}

export function buildDbgpCommand(
  command: string,
  transactionId: number,
  args: Record<string, string | number> = {},
  base64Payload?: string
): string {
  const parts = [command, `-i ${transactionId}`];
  for (const [k, v] of Object.entries(args)) {
    parts.push(`-${k} ${v}`);
  }
  if (base64Payload !== undefined) {
    parts.push(`-- ${encodeUtf8Base64(base64Payload)}`);
  }
  return `${parts.join(' ')}\0`;
}

export function localFilePathToDbgpUri(
  filePath: string,
  pathMapping?: { remoteRoot?: string; localRoot?: string }
): string {
  let normalized = filePath.replace(/\\/g, '/');
  if (pathMapping?.localRoot && pathMapping?.remoteRoot) {
    const locRoot = pathMapping.localRoot.replace(/\\/g, '/').replace(/\/+$/, '');
    const remRoot = pathMapping.remoteRoot.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normalized.toLowerCase().startsWith(locRoot.toLowerCase())) {
      normalized = remRoot + normalized.slice(locRoot.length);
    }
  }
  if (normalized.startsWith('file://')) return normalized;
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`;
  }
  const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `file://${encodeURI(prefixed)}`;
}

export function dbgpUriToLocalFilePath(
  fileUri: string,
  pathMapping?: { remoteRoot?: string; localRoot?: string }
): string {
  let decoded = fileUri;
  try {
    decoded = decodeURI(fileUri);
  } catch {
    // keep raw
  }
  decoded = decoded.replace(/^file:\/\//i, '');
  if (/^\/[A-Za-z]:\//.test(decoded)) {
    decoded = decoded.slice(1);
  }
  if (pathMapping?.remoteRoot && pathMapping?.localRoot) {
    const remRoot = pathMapping.remoteRoot.replace(/\\/g, '/').replace(/\/+$/, '');
    const locRoot = pathMapping.localRoot.replace(/\\/g, '/').replace(/\/+$/, '');
    if (decoded.startsWith(remRoot)) {
      return locRoot + decoded.slice(remRoot.length);
    }
  }
  return decoded;
}
