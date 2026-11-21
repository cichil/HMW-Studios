import type {
  DbSchemaSnapshot,
  DbTableMeta,
  PhpWorkspaceSymbols,
  SavedSqlQueryItem,
  WebSymbolCatalog
} from './types';

export type IslandSearchTabMode = 'all' | 'files' | 'content' | 'symbols';
export type IslandSearchScope = 'all' | 'remote' | 'local';

export interface IslandFileCandidate {
  key: string;
  source: 'local' | 'remote';
  name: string;
  relativePath: string;
  localPath?: string;
  connectionId?: string;
  connectionName?: string;
}

export type IslandSymbolKind =
  | 'php-fn'
  | 'php-class'
  | 'js-fn'
  | 'js-class'
  | 'css-class'
  | 'css-var';

export interface IslandSymbolCandidate {
  key: string;
  source: 'local' | 'remote';
  kind: IslandSymbolKind;
  name: string;
  detail: string;
  relativePath: string;
  localPath?: string;
  connectionId?: string;
  connectionName?: string;
  line: number;
}

export interface IslandDbTableCandidate {
  key: string;
  name: string;
  schema?: string;
  kind: 'table' | 'view';
  columnCount: number;
  primaryKeys: string[];
  rowEstimate?: number;
  tableMeta: DbTableMeta;
}

export interface IslandCommandCandidate {
  id: string;
  label: string;
  keywords?: string;
}

export interface ParsedIslandQuery {
  raw: string;
  cleanQuery: string;
  tokens: string[];
  lineJump: number | null;
  isPureLineJump: boolean;
  prefixHint: 'symbol' | 'css' | 'table' | 'command' | null;
}

export interface IslandSearchResultItem {
  id: string;
  category: 'line-jump' | 'file' | 'symbol' | 'db-table' | 'saved-query' | 'command';
  source: 'remote' | 'local' | 'db' | 'ide';
  title: string;
  subtitle: string;
  badge: string;
  score: number;
  jumpLine?: number;
  file?: IslandFileCandidate;
  symbol?: IslandSymbolCandidate;
  dbTable?: IslandDbTableCandidate;
  savedQuery?: SavedSqlQueryItem;
  commandId?: string;
}

const KNOWN_EXT_QUERIES = new Set([
  '.php',
  '.phtml',
  '.blade.php',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.css',
  '.scss',
  '.less',
  '.html',
  '.htm',
  '.sql',
  '.json',
  '.xml',
  '.yml',
  '.yaml',
  '.env',
  '.htaccess',
  '.md',
  '.txt',
  '.sh'
]);

export function isVendorOrMinifiedPath(relPath: string): boolean {
  const norm = (relPath ?? '').toLowerCase().replace(/\\/g, '/');
  if (
    /(?:^|\/)(?:vendor|node_modules|bower_components|packages|dist|\.git|storage\/framework)(?:\/|$)/.test(
      norm
    )
  ) {
    return true;
  }
  return /\.(?:min\.(?:js|css)|bundle\.js|map|lock)$/.test(norm);
}

export function parseIslandSearchQuery(rawInput: string): ParsedIslandQuery {
  const raw = rawInput ?? '';
  let working = raw.trim();

  if (!working) {
    return {
      raw,
      cleanQuery: '',
      tokens: [],
      lineJump: null,
      isPureLineJump: false,
      prefixHint: null
    };
  }

  // Pure line jump, e.g. ":85"
  const pureLineMatch = working.match(/^:(\d{1,7})$/);
  if (pureLineMatch) {
    const lineNum = Math.max(1, parseInt(pureLineMatch[1], 10));
    return {
      raw,
      cleanQuery: '',
      tokens: [],
      lineJump: lineNum,
      isPureLineJump: true,
      prefixHint: null
    };
  }

  let prefixHint: ParsedIslandQuery['prefixHint'] = null;
  if (working.startsWith('>')) {
    prefixHint = 'command';
    working = working.slice(1).trim();
  } else if (working.startsWith('@')) {
    prefixHint = 'symbol';
    working = working.slice(1).trim();
  } else if (working.startsWith('#')) {
    prefixHint = 'table';
    working = working.slice(1).trim();
  } else if (
    working.startsWith('.') &&
    working.length > 1 &&
    !KNOWN_EXT_QUERIES.has(working.toLowerCase()) &&
    !/^\.[a-z0-9]+$/i.test(working.split(/\s+/)[0])
  ) {
    // e.g. ".btn-primary" or ".card-header" has hyphen/underscore -> CSS class hint
    prefixHint = 'css';
  }

  // Check file:line suffix, e.g. "siswa_save.php:120"
  let lineJump: number | null = null;
  const lineSuffixMatch = working.match(/^(.+?):(\d{1,7})$/);
  if (lineSuffixMatch && lineSuffixMatch[1].trim().length > 0) {
    working = lineSuffixMatch[1].trim();
    lineJump = Math.max(1, parseInt(lineSuffixMatch[2], 10));
  }

  const cleanQuery = working;
  const tokens = cleanQuery
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  return {
    raw,
    cleanQuery,
    tokens,
    lineJump,
    isPureLineJump: false,
    prefixHint
  };
}

export function matchesAllSearchTokens(haystackLower: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  for (const tok of tokens) {
    if (!haystackLower.includes(tok)) return false;
  }
  return true;
}

export function buildIslandSymbolsFromCatalogs(opts: {
  localPhp?: PhpWorkspaceSymbols | null;
  localWeb?: WebSymbolCatalog | null;
  remotePhp?: PhpWorkspaceSymbols | null;
  remoteWeb?: WebSymbolCatalog | null;
  remoteConnectionId?: string | null;
  remoteConnectionName?: string | null;
}): IslandSymbolCandidate[] {
  const out: IslandSymbolCandidate[] = [];
  const seen = new Set<string>();

  const pushSym = (sym: IslandSymbolCandidate): void => {
    if (!sym.name || !sym.relativePath || seen.has(sym.key)) return;
    seen.add(sym.key);
    out.push(sym);
  };

  const ingestPhp = (
    php: PhpWorkspaceSymbols | null | undefined,
    source: 'local' | 'remote',
    connId?: string,
    connName?: string
  ): void => {
    if (!php) return;
    for (const fn of php.functions ?? []) {
      const rel = fn.relativePath || fn.filePath || '';
      if (!rel) continue;
      const paramsSig = (fn.params ?? []).map((p) => p.name).join(', ');
      pushSym({
        key: `${source}:php-fn:${connId ?? ''}:${rel}:${fn.name}:${fn.line ?? 1}`,
        source,
        kind: 'php-fn',
        name: fn.name,
        detail: `function ${fn.name}(${paramsSig})`,
        relativePath: rel,
        localPath: source === 'local' ? fn.filePath : undefined,
        connectionId: connId,
        connectionName: connName,
        line: fn.line ?? 1
      });
    }
    for (const cls of php.classes ?? []) {
      const rel = cls.relativePath || cls.filePath || '';
      if (!rel) continue;
      pushSym({
        key: `${source}:php-class:${connId ?? ''}:${rel}:${cls.name}:${cls.line ?? 1}`,
        source,
        kind: 'php-class',
        name: cls.name,
        detail: cls.extendsClass ? `class ${cls.name} extends ${cls.extendsClass}` : `class ${cls.name}`,
        relativePath: rel,
        localPath: source === 'local' ? cls.filePath : undefined,
        connectionId: connId,
        connectionName: connName,
        line: cls.line ?? 1
      });
    }
  };

  const ingestWeb = (
    web: WebSymbolCatalog | null | undefined,
    source: 'local' | 'remote',
    connId?: string,
    connName?: string
  ): void => {
    if (!web) return;
    for (const fn of web.jsFunctions ?? []) {
      const rel = fn.relativePath || fn.filePath || '';
      if (!rel) continue;
      const paramsSig = (fn.params ?? []).join(', ');
      pushSym({
        key: `${source}:js-fn:${connId ?? ''}:${rel}:${fn.name}:${fn.line}`,
        source,
        kind: 'js-fn',
        name: fn.name,
        detail: `${fn.isAsync ? 'async ' : ''}${fn.name}(${paramsSig})`,
        relativePath: rel,
        localPath: source === 'local' ? fn.filePath : undefined,
        connectionId: connId,
        connectionName: connName,
        line: fn.line || 1
      });
    }
    for (const cls of web.jsClasses ?? []) {
      const rel = cls.relativePath || cls.filePath || '';
      if (!rel) continue;
      pushSym({
        key: `${source}:js-class:${connId ?? ''}:${rel}:${cls.name}:${cls.line}`,
        source,
        kind: 'js-class',
        name: cls.name,
        detail: `class ${cls.name} (${cls.methods?.length ?? 0} method)`,
        relativePath: rel,
        localPath: source === 'local' ? cls.filePath : undefined,
        connectionId: connId,
        connectionName: connName,
        line: cls.line || 1
      });
    }
    for (const css of web.cssClasses ?? []) {
      const rel = css.relativePath || css.filePath || '';
      if (!rel) continue;
      const dotName = css.name.startsWith('.') ? css.name : `.${css.name}`;
      pushSym({
        key: `${source}:css-class:${connId ?? ''}:${rel}:${dotName}:${css.line}`,
        source,
        kind: 'css-class',
        name: dotName,
        detail: css.declarationsPreview || 'CSS Class Selector',
        relativePath: rel,
        localPath: source === 'local' ? css.filePath : undefined,
        connectionId: connId,
        connectionName: connName,
        line: css.line || 1
      });
    }
    for (const v of web.cssVariables ?? []) {
      const rel = v.relativePath || v.filePath || '';
      if (!rel) continue;
      pushSym({
        key: `${source}:css-var:${connId ?? ''}:${rel}:${v.name}:${v.line}`,
        source,
        kind: 'css-var',
        name: v.name,
        detail: v.value,
        relativePath: rel,
        localPath: source === 'local' ? v.filePath : undefined,
        connectionId: connId,
        connectionName: connName,
        line: v.line || 1
      });
    }
  };

  if (opts.remoteConnectionId) {
    ingestPhp(
      opts.remotePhp,
      'remote',
      opts.remoteConnectionId,
      opts.remoteConnectionName || 'Server'
    );
    ingestWeb(
      opts.remoteWeb,
      'remote',
      opts.remoteConnectionId,
      opts.remoteConnectionName || 'Server'
    );
  }
  ingestPhp(opts.localPhp, 'local');
  ingestWeb(opts.localWeb, 'local');

  return out;
}

export function buildIslandDbTablesFromSchema(
  schema: DbSchemaSnapshot | null | undefined
): IslandDbTableCandidate[] {
  if (!schema) return [];
  const sourceTables = schema.allTables?.length ? schema.allTables : schema.tables ?? [];
  const out: IslandDbTableCandidate[] = [];
  const seen = new Set<string>();

  for (const t of sourceTables) {
    const key = `db:${t.schema || schema.currentDatabase || 'default'}.${t.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      name: t.name,
      schema: t.schema || schema.currentDatabase,
      kind: t.kind,
      columnCount: t.columns?.length ?? 0,
      primaryKeys: t.primaryKeys ?? [],
      rowEstimate: t.rowEstimate,
      tableMeta: t
    });
  }
  return out;
}

function getSymbolBadgeLabel(sym: IslandSymbolCandidate): string {
  const srcPrefix = sym.source === 'remote' ? '☁ ' : '';
  switch (sym.kind) {
    case 'php-fn':
      return `${srcPrefix}PHP fn`;
    case 'php-class':
      return `${srcPrefix}PHP class`;
    case 'js-fn':
      return `${srcPrefix}JS fn`;
    case 'js-class':
      return `${srcPrefix}JS class`;
    case 'css-class':
      return `${srcPrefix}CSS .class`;
    case 'css-var':
      return `${srcPrefix}CSS --var`;
  }
}

export interface RankIslandSearchOptions {
  rawQuery: string;
  mode: Exclude<IslandSearchTabMode, 'content'>;
  scope: IslandSearchScope;
  extFilter?: string | null;
  files: IslandFileCandidate[];
  openTabKeys?: Set<string>;
  pinnedFileKeys?: Set<string>;
  activeRemoteSubPath?: string;
  activeTabTitle?: string | null;
  symbols?: IslandSymbolCandidate[];
  dbTables?: IslandDbTableCandidate[];
  savedQueries?: SavedSqlQueryItem[];
  commands?: IslandCommandCandidate[];
  limit?: number;
}

export function rankIslandSearchResults(
  options: RankIslandSearchOptions
): IslandSearchResultItem[] {
  const {
    rawQuery,
    mode,
    scope,
    extFilter = null,
    files,
    openTabKeys = new Set<string>(),
    pinnedFileKeys = new Set<string>(),
    activeRemoteSubPath = '',
    activeTabTitle = null,
    symbols = [],
    dbTables = [],
    savedQueries = [],
    commands = [],
    limit = 60
  } = options;

  const parsed = parseIslandSearchQuery(rawQuery);
  const results: IslandSearchResultItem[] = [];

  if (parsed.isPureLineJump && parsed.lineJump) {
    results.push({
      id: `line-jump:${parsed.lineJump}`,
      category: 'line-jump',
      source: 'ide',
      title: `Lompat ke Baris ${parsed.lineJump}`,
      subtitle: activeTabTitle
        ? `Pada tab aktif: ${activeTabTitle}`
        : 'Buka file terlebih dahulu untuk melompat ke baris',
      badge: `:${parsed.lineJump}`,
      score: 10000,
      jumpLine: parsed.lineJump
    });
    return results;
  }

  const effectiveQueryLower = parsed.cleanQuery.toLowerCase();
  const tokens = parsed.tokens;
  const subPathPrefix = activeRemoteSubPath
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
  const extNorm = extFilter ? extFilter.toLowerCase() : null;

  const includeFiles =
    parsed.prefixHint === null && (mode === 'all' || mode === 'files');
  const includeSymbols =
    parsed.prefixHint === 'symbol' ||
    parsed.prefixHint === 'css' ||
    (parsed.prefixHint === null &&
      !extNorm &&
      (mode === 'symbols' || (mode === 'all' && tokens.length > 0)));
  const includeDbTables =
    parsed.prefixHint === 'table' ||
    (parsed.prefixHint === null &&
      !extNorm &&
      (mode === 'symbols' || (mode === 'all' && tokens.length > 0)));
  const includeCommands =
    parsed.prefixHint === 'command' ||
    (parsed.prefixHint === null && !extNorm && mode === 'all' && tokens.length > 0);

  // 1. Score Files (Remote SFTP + Local Workspace)
  if (includeFiles) {
    for (const f of files) {
      if (scope === 'remote' && f.source !== 'remote') continue;
      if (scope === 'local' && f.source !== 'local') continue;

      const nameLower = f.name.toLowerCase();
      const relNorm = f.relativePath.replace(/\\/g, '/');
      const relLower = relNorm.toLowerCase();

      if (extNorm && !nameLower.endsWith(extNorm)) continue;

      const haystack = `${nameLower} ${relLower}`;
      if (!matchesAllSearchTokens(haystack, tokens)) continue;

      const isVendor = isVendorOrMinifiedPath(relLower);
      const isOpen = openTabKeys.has(f.key);
      const isPinned = pinnedFileKeys.has(f.key);
      let score = isVendor ? -450 : 100;

      if (isPinned) score += 360;
      if (isOpen) score += 160;
      if (
        f.source === 'remote' &&
        subPathPrefix &&
        relLower.startsWith(`${subPathPrefix}/`)
      ) {
        score += 85;
      }

      if (tokens.length > 0) {
        const stemLower = nameLower.replace(/\.[^.]+$/, '');
        if (nameLower === effectiveQueryLower) {
          score += 520;
        } else if (stemLower === effectiveQueryLower) {
          score += 460;
        } else if (nameLower.startsWith(effectiveQueryLower)) {
          score += 340;
        } else if (nameLower.includes(effectiveQueryLower)) {
          score += 240;
        } else if (relLower.includes(effectiveQueryLower)) {
          score += 130;
        } else {
          // Multi-token match where some tokens hit filename
          let nameTokenHits = 0;
          for (const t of tokens) {
            if (nameLower.includes(t)) nameTokenHits++;
          }
          score += nameTokenHits * 95;
        }
      } else {
        // Empty query: prioritize open tabs, remote active folder, and shallow real files
        if (f.source === 'remote') score += 20;
      }

      // Slight bonus for shallower paths
      score -= Math.min(45, Math.floor(relLower.length * 0.35));

      const baseBadge = f.source === 'remote' ? `☁ ${f.connectionName || 'Server'}` : '📁 Lokal';
      results.push({
        id: `file:${f.key}`,
        category: 'file',
        source: f.source,
        title: parsed.lineJump ? `${f.name}:${parsed.lineJump}` : f.name,
        subtitle: relNorm,
        badge: isPinned ? `★ ${baseBadge}` : baseBadge,
        score,
        jumpLine: parsed.lineJump ?? undefined,
        file: f
      });
    }
  }

  // 2. Score Workspace / Remote Symbols (PHP, JS, CSS)
  if (includeSymbols) {
    for (const sym of symbols) {
      if (scope === 'remote' && sym.source !== 'remote') continue;
      if (scope === 'local' && sym.source !== 'local') continue;
      if (
        parsed.prefixHint === 'css' &&
        sym.kind !== 'css-class' &&
        sym.kind !== 'css-var'
      ) {
        continue;
      }

      const nameLower = sym.name.toLowerCase();
      const relLower = sym.relativePath.toLowerCase();
      const haystack = `${nameLower} ${sym.detail.toLowerCase()} ${relLower}`;
      if (!matchesAllSearchTokens(haystack, tokens)) continue;

      const isVendor = isVendorOrMinifiedPath(relLower);
      let score = isVendor ? -420 : 85;
      const bareSymLower = nameLower.replace(/^[.-]+/, '');
      const bareQueryLower = effectiveQueryLower.replace(/^[.-]+/, '');

      if (tokens.length > 0) {
        if (nameLower === effectiveQueryLower || bareSymLower === bareQueryLower) {
          score += 470;
        } else if (
          nameLower.startsWith(effectiveQueryLower) ||
          (bareQueryLower && bareSymLower.startsWith(bareQueryLower))
        ) {
          score += 310;
        } else if (nameLower.includes(effectiveQueryLower)) {
          score += 210;
        } else {
          score += 80;
        }
      }

      results.push({
        id: `sym:${sym.key}`,
        category: 'symbol',
        source: sym.source,
        title: sym.detail,
        subtitle: `${sym.relativePath.replace(/\\/g, '/')}:${sym.line}`,
        badge: getSymbolBadgeLabel(sym),
        score,
        jumpLine: sym.line,
        symbol: sym
      });
    }
  }

  // 3. Score Database Tables
  if (includeDbTables && scope !== 'local') {
    for (const tbl of dbTables) {
      const nameLower = tbl.name.toLowerCase();
      const schemaLower = (tbl.schema ?? '').toLowerCase();
      const haystack = `${nameLower} ${schemaLower} ${tbl.primaryKeys.join(' ').toLowerCase()}`;
      if (!matchesAllSearchTokens(haystack, tokens)) continue;

      let score = 90;
      if (tokens.length > 0) {
        if (nameLower === effectiveQueryLower) {
          score += 480;
        } else if (nameLower.startsWith(effectiveQueryLower)) {
          score += 320;
        } else if (nameLower.includes(effectiveQueryLower)) {
          score += 215;
        } else {
          score += 90;
        }
      }

      const schemaPart = tbl.schema ? `${tbl.schema} • ` : '';
      const pkPart = tbl.primaryKeys.length ? ` • PK: ${tbl.primaryKeys.join(', ')}` : '';
      results.push({
        id: `db:${tbl.key}`,
        category: 'db-table',
        source: 'db',
        title: tbl.name,
        subtitle: `${schemaPart}${tbl.columnCount} kolom${pkPart}`,
        badge: tbl.kind === 'view' ? '🗄️ View DB' : '🗄️ Tabel DB',
        score,
        dbTable: tbl
      });
    }

    // Saved SQL & Visual Diagram Queries
    for (const sq of savedQueries) {
      const nameLower = sq.name.toLowerCase();
      const folderLower = (sq.folder ?? '').toLowerCase();
      const sqlLower = sq.sql.toLowerCase();
      const haystack = `${nameLower} ${folderLower} ${sqlLower}`;
      if (!matchesAllSearchTokens(haystack, tokens)) continue;

      let score = sq.isFavorite ? 260 : 120;
      if (tokens.length > 0) {
        if (nameLower === effectiveQueryLower) {
          score += 500;
        } else if (nameLower.startsWith(effectiveQueryLower)) {
          score += 340;
        } else if (nameLower.includes(effectiveQueryLower)) {
          score += 230;
        } else {
          score += 95;
        }
      }

      const folderTag = sq.folder ? `[${sq.folder}] ` : '';
      const compactSql = sq.sql.replace(/\s+/g, ' ').trim().slice(0, 80);
      results.push({
        id: `saved-query:${sq.id}`,
        category: 'saved-query',
        source: 'db',
        title: sq.name,
        subtitle: `${folderTag}${compactSql}`,
        badge: sq.visualDiagramSpec
          ? `${sq.isFavorite ? '★ ' : ''}🕸️ Visual Query`
          : `${sq.isFavorite ? '★ ' : ''}📜 Query SQL`,
        score,
        savedQuery: sq
      });
    }
  }

  // 4. Score IDE Quick Actions / Commands
  if (includeCommands) {
    for (const cmd of commands) {
      const labelLower = cmd.label.toLowerCase();
      const haystack = `${labelLower} ${(cmd.keywords ?? '').toLowerCase()}`;
      if (!matchesAllSearchTokens(haystack, tokens)) continue;

      let score = parsed.prefixHint === 'command' ? 300 : 55;
      if (tokens.length > 0) {
        if (labelLower.startsWith(effectiveQueryLower)) {
          score += 220;
        } else if (labelLower.includes(effectiveQueryLower)) {
          score += 140;
        }
      }

      results.push({
        id: `cmd:${cmd.id}`,
        category: 'command',
        source: 'ide',
        title: cmd.label,
        subtitle: 'Perintah Cepat HMW Studio',
        badge: '⚡ Aksi',
        score,
        commandId: cmd.id
      });
    }
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.title.localeCompare(b.title);
  });

  return results.slice(0, limit);
}
