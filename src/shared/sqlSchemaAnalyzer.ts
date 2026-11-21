import type { DbColumnMeta, DbSchemaSnapshot, DbTableMeta } from './types';

export const SYSTEM_DB_NAMES_LOWER = new Set([
  'information_schema',
  'performance_schema',
  'mysql',
  'sys',
  'pg_catalog'
]);

const SQL_ALIAS_STOPWORDS = new Set([
  'where',
  'join',
  'left',
  'right',
  'inner',
  'outer',
  'cross',
  'full',
  'natural',
  'on',
  'using',
  'order',
  'group',
  'having',
  'limit',
  'offset',
  'union',
  'set',
  'values',
  'value',
  'select',
  'from',
  'into',
  'and',
  'or',
  'when',
  'then',
  'else',
  'end'
]);

const SQL_COMMON_STOPWORDS = new Set([
  ...SQL_ALIAS_STOPWORDS,
  'distinct',
  'all',
  'as',
  'asc',
  'desc',
  'null',
  'not',
  'is',
  'in',
  'like',
  'ilike',
  'between',
  'exists',
  'case',
  'true',
  'false',
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'coalesce',
  'ifnull',
  'nullif',
  'if',
  'concat',
  'group_concat',
  'substring',
  'substr',
  'length',
  'char_length',
  'trim',
  'ltrim',
  'rtrim',
  'lower',
  'upper',
  'date',
  'now',
  'curdate',
  'date_format',
  'year',
  'month',
  'day',
  'cast',
  'convert',
  'primary',
  'key',
  'unique',
  'index',
  'foreign',
  'references',
  'constraint',
  'default',
  'auto_increment',
  'unsigned',
  'varchar',
  'char',
  'text',
  'longtext',
  'mediumtext',
  'tinytext',
  'int',
  'integer',
  'bigint',
  'smallint',
  'tinyint',
  'decimal',
  'numeric',
  'float',
  'double',
  'boolean',
  'bool',
  'datetime',
  'timestamp',
  'time',
  'json',
  'enum'
]);

export interface SqlTableRef {
  schema?: string;
  schemaLower?: string;
  table: string;
  tableLower: string;
  alias?: string;
  aliasLower?: string;
}

export type SqlTableReference = SqlTableRef;

export function extractReferencedSqlTables(sqlSource: string): {
  refs: SqlTableRef[];
  tableNamesLower: Set<string>;
  fullKeysLower: Set<string>;
  aliasToRef: Map<string, SqlTableRef>;
} {
  const refs: SqlTableRef[] = [];
  const tableNamesLower = new Set<string>();
  const fullKeysLower = new Set<string>();
  const aliasToRef = new Map<string, SqlTableRef>();

  const registerRef = (schemaRaw: string | undefined, tableRaw: string, aliasRaw?: string): void => {
    const table = tableRaw.trim();
    if (!table || SQL_ALIAS_STOPWORDS.has(table.toLowerCase())) return;
    const schema = schemaRaw?.trim() || undefined;
    const schemaLower = schema?.toLowerCase();
    const tableLower = table.toLowerCase();
    const aliasTrimmed = aliasRaw?.trim();
    const maybeAlias = aliasTrimmed?.toLowerCase();
    const validAlias = Boolean(maybeAlias && !SQL_ALIAS_STOPWORDS.has(maybeAlias));
    const alias = validAlias ? aliasTrimmed : undefined;
    const aliasLower = validAlias ? maybeAlias : undefined;

    const ref: SqlTableRef = {
      schema,
      schemaLower,
      table,
      tableLower,
      alias,
      aliasLower
    };
    refs.push(ref);
    tableNamesLower.add(tableLower);
    if (schemaLower) {
      fullKeysLower.add(`${schemaLower}.${tableLower}`);
      aliasToRef.set(`${schemaLower}.${tableLower}`, ref);
    }
    if (!aliasToRef.has(tableLower)) {
      aliasToRef.set(tableLower, ref);
    }
    if (aliasLower) {
      aliasToRef.set(aliasLower, ref);
    }
  };

  // Standard SQL clauses: FROM / JOIN / UPDATE / INTO / DESCRIBE / TABLE
  const clauseRegex =
    /\b(?:from|join|update|into|describe|truncate(?:\s+table)?|alter\s+table|create\s+table(?:\s+if\s+not\s+exists)?)\s+(?:[`"']?([A-Za-z_][A-Za-z0-9_]*)[`"']?\s*\.\s*)?[`"']?([A-Za-z_][A-Za-z0-9_]*)[`"']?(?:\s+(?:as\s+)?([A-Za-z_][A-Za-z0-9_]*))?/gi;
  for (const m of sqlSource.matchAll(clauseRegex)) {
    registerRef(m[1], m[2], m[3]);
  }

  // Comma-separated FROM list: `FROM db1.t1 a, db2.t2 b WHERE ...`
  const fromBlockRegex =
    /\bfrom\s+([^\n;]+?)(?=\b(?:where|left|right|inner|outer|cross|join|group|order|having|limit|union)\b|;|$)/gi;
  for (const bm of sqlSource.matchAll(fromBlockRegex)) {
    const block = bm[1] ?? '';
    if (!block.includes(',')) continue;
    for (const part of block.split(',')) {
      const pm = part
        .trim()
        .match(
          /^(?:[`"']?([A-Za-z_][A-Za-z0-9_]*)[`"']?\s*\.\s*)?[`"']?([A-Za-z_][A-Za-z0-9_]*)[`"']?(?:\s+(?:as\s+)?([A-Za-z_][A-Za-z0-9_]*))?$/i
        );
      if (pm) {
        registerRef(pm[1], pm[2], pm[3]);
      }
    }
  }

  // PHP Builder / Wisanggeni helpers: DB::table('...'), Schema::table('...'), combobox_db('...')
  const phpTableHelperRegex =
    /\b(?:DB::table|Schema::(?:table|create|hasTable)|combobox_db)\s*\(\s*['"](?:([A-Za-z_][A-Za-z0-9_]*)\.)?([A-Za-z_][A-Za-z0-9_]*)(?:\s+(?:as\s+)?([A-Za-z_][A-Za-z0-9_]*))?['"]/gi;
  for (const pm of sqlSource.matchAll(phpTableHelperRegex)) {
    registerRef(pm[1], pm[2], pm[3]);
  }

  return { refs, tableNamesLower, fullKeysLower, aliasToRef };
}

export interface DetectedPhpSqlContext {
  mode: 'sql' | 'table-only';
  activeSqlText: string;
}

export function detectPhpSqlContext(
  textBeforeCursor: string,
  linePrefix: string
): DetectedPhpSqlContext | null {
  // Let PHP variable/superglobal/object-member/array-key IntelliSense handle `$var`, `$obj->`, `$arr['`
  if (
    /\$[A-Za-z_0-9]*$/.test(linePrefix) ||
    /->\s*[A-Za-z_0-9]*$/.test(linePrefix) ||
    /\[\s*['"][A-Za-z0-9_-]*$/.test(linePrefix)
  ) {
    return null;
  }

  // Quick single-line check for table-name-only helpers: DB::table('...'), Schema::table('...'), combobox_db('...'), protected $table = '...'
  if (
    /(?:\b(?:DB::table|Schema::(?:table|hasTable|dropIfExists)|combobox_db)\s*\(\s*['"]|\$table\s*=\s*['"]|->(?:from|join|leftJoin|rightJoin)\s*\(\s*['"])[A-Za-z0-9_.]*$/.test(
      linePrefix
    )
  ) {
    return {
      mode: 'table-only',
      activeSqlText: `FROM ${linePrefix.match(/['"]([A-Za-z0-9_.]*)$/)?.[1] ?? ''}`
    };
  }

  // Multi-line lexical scan across textBeforeCursor to track PHP quotes, comments, and statement boundaries accurately
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let stmtCodeOutsideStrings = '';
  const stmtStringParts: string[] = [];
  let currentStringBuf = '';

  for (let i = 0; i < textBeforeCursor.length; i++) {
    const ch = textBeforeCursor[i];
    const next = textBeforeCursor[i + 1] ?? '';

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (ch === '\\') {
        currentStringBuf += textBeforeCursor.slice(i, i + 2);
        i++;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
        stmtStringParts.push(currentStringBuf);
        currentStringBuf = '';
        continue;
      }
      currentStringBuf += ch;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') {
        currentStringBuf += textBeforeCursor.slice(i, i + 2);
        i++;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
        stmtStringParts.push(currentStringBuf);
        currentStringBuf = '';
        continue;
      }
      currentStringBuf += ch;
      continue;
    }

    // Outside strings & comments
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '#') {
      inLineComment = true;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      currentStringBuf = '';
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      currentStringBuf = '';
      continue;
    }

    // Statement boundary outside strings resets statement accumulator
    if (ch === ';' || ch === '{' || ch === '}') {
      stmtCodeOutsideStrings = '';
      stmtStringParts.length = 0;
      continue;
    }

    stmtCodeOutsideStrings += ch;
  }

  if (!inSingle && !inDouble) {
    return null;
  }

  const stitchedSql = [...stmtStringParts, currentStringBuf].join('__php__');
  const trimmedSql = stitchedSql.trimStart();

  const isSqlExecutorCall =
    /\b(?:mysql|mysqli_query|pg_query|pg_query_params|dosql|sqlite_query)\s*\(/i.test(
      stmtCodeOutsideStrings
    ) ||
    /->\s*(?:query|prepare|exec|loadData|whereRaw|orWhereRaw|selectRaw|orderByRaw|havingRaw|joinRaw)\s*\(/i.test(
      stmtCodeOutsideStrings
    ) ||
    /\bDB::(?:select|selectOne|insert|update|delete|statement|unprepared|raw)\s*\(/i.test(
      stmtCodeOutsideStrings
    ) ||
    /\$[A-Za-z0-9_]*(?:sql|query|qry)[A-Za-z0-9_]*\s*\.?=/i.test(stmtCodeOutsideStrings);

  const looksLikeSqlContent =
    /^(?:select|insert\s+into|update|delete\s+from|replace\s+into|with\s+[a-z0-9_]+\s+as|show\s+|describe\s+|desc\s+|explain\s+|alter\s+table|create\s+table|drop\s+table|truncate\s+|use\s+)\b/i.test(
      trimmedSql
    ) ||
    /\b(?:select\s+[\s\S]+?\bfrom|insert\s+into\s+[`"']?[a-z0-9_.]+|update\s+[`"']?[a-z0-9_.]+\s+set|delete\s+from\s+[`"']?[a-z0-9_.]+|left\s+join\s+[`"']?[a-z0-9_.]+|inner\s+join\s+[`"']?[a-z0-9_.]+)\b/i.test(
      stitchedSql
    );

  if (!isSqlExecutorCall && !looksLikeSqlContent) {
    return null;
  }

  return {
    mode: 'sql',
    activeSqlText: stitchedSql
  };
}

export interface FallbackCodeSqlCatalog {
  databases: string[];
  tables: DbTableMeta[];
  columns: string[];
}

export function extractFallbackSqlEntities(sources: string[]): FallbackCodeSqlCatalog {
  const dbMap = new Map<string, string>();
  const tableMap = new Map<string, { name: string; schema?: string; cols: Map<string, string> }>();
  const globalCols = new Map<string, string>();

  const addCol = (colRaw: string, tblKey?: string): void => {
    const col = colRaw.trim();
    if (col.length < 2 || col.length > 64) return;
    const low = col.toLowerCase();
    if (SQL_COMMON_STOPWORDS.has(low) || /^\d/.test(col) || low.includes('__php__')) return;
    if (!globalCols.has(low)) globalCols.set(low, col);
    if (tblKey && tableMap.has(tblKey)) {
      const t = tableMap.get(tblKey)!;
      if (!t.cols.has(low)) t.cols.set(low, col);
    }
  };

  for (const src of sources) {
    if (!src) continue;
    const { refs, aliasToRef } = extractReferencedSqlTables(src);
    for (const r of refs) {
      if (r.schema && !SYSTEM_DB_NAMES_LOWER.has(r.schema.toLowerCase())) {
        dbMap.set(r.schema.toLowerCase(), r.schema);
      }
      const key = r.schemaLower ? `${r.schemaLower}.${r.tableLower}` : r.tableLower;
      if (!tableMap.has(key)) {
        tableMap.set(key, { name: r.table, schema: r.schema, cols: new Map() });
      }
    }

    // Extract SELECT column lists paired with their immediate FROM table: `SELECT a, b FROM db.tbl`
    for (const sm of src.matchAll(
      /\bselect\s+(?:distinct\s+)?([\s\S]{1,600}?)\bfrom\s+(?:[`"']?([A-Za-z_][A-Za-z0-9_]*)[`"']?\.)?[`"']?([A-Za-z_][A-Za-z0-9_]*)[`"']?/gi
    )) {
      const selectList = sm[1] ?? '';
      const fromSchemaLow = sm[2]?.toLowerCase();
      const fromTblLow = sm[3]?.toLowerCase();
      const tblKey = fromTblLow
        ? fromSchemaLow
          ? `${fromSchemaLow}.${fromTblLow}`
          : fromTblLow
        : undefined;
      for (const item of selectList.split(',')) {
        const cleaned = item
          .replace(/\bas\s+[`"']?[A-Za-z_][A-Za-z0-9_]*[`"']?\s*$/i, '')
          .trim();
        const plainId = cleaned.match(/^(?:[A-Za-z_][A-Za-z0-9_]*\.)?[`"]?([A-Za-z_][A-Za-z0-9_]*)[`"]?$/);
        if (plainId) {
          addCol(plainId[1], tblKey);
        }
      }
    }

    // Qualified column references `alias.col` or `table.col`
    for (const qm of src.matchAll(
      /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g
    )) {
      const leftLow = qm[1].toLowerCase();
      const right = qm[2];
      const rightLow = right.toLowerCase();
      if (dbMap.has(leftLow) && tableMap.has(`${leftLow}.${rightLow}`)) continue;
      if (['php', 'sql', 'js', 'ts', 'css', 'html', 'json', 'blade', 'png', 'jpg'].includes(rightLow)) {
        continue;
      }
      const mapped = aliasToRef.get(leftLow);
      if (mapped) {
        const key = mapped.schemaLower
          ? `${mapped.schemaLower}.${mapped.tableLower}`
          : mapped.tableLower;
        addCol(right, key);
      }
    }

    // Columns compared in WHERE / AND / OR / HAVING / SET clauses inside SQL fragments
    for (const wm of src.matchAll(
      /\b(?:where|and|or|having|set|order\s+by|group\s+by)\s+[`"]?([A-Za-z_][A-Za-z0-9_]*)[`"]?\s*(?:=|<|>|!=|<>|\blike\b|\bin\b|\bis\b|,|$)/gi
    )) {
      const primaryRef = refs[0];
      const key = primaryRef
        ? primaryRef.schemaLower
          ? `${primaryRef.schemaLower}.${primaryRef.tableLower}`
          : primaryRef.tableLower
        : undefined;
      addCol(wm[1], key);
    }

    // PHP row fetch array keys `$row['kd_unitkerja']`, `$spt['nama']` when SQL tables exist in same file
    if (refs.length > 0) {
      const primaryRef = refs[0];
      const key = primaryRef.schemaLower
        ? `${primaryRef.schemaLower}.${primaryRef.tableLower}`
        : primaryRef.tableLower;
      for (const akm of src.matchAll(
        /\$(?!_(?:GET|POST|SESSION|SERVER|FILES|COOKIE|REQUEST|ENV)\b)[A-Za-z_][A-Za-z0-9_]*\s*\[\s*['"]([A-Za-z_][A-Za-z0-9_]{1,48})['"]\s*\]/g
      )) {
        addCol(akm[1], key);
      }
    }
  }

  const tables: DbTableMeta[] = Array.from(tableMap.values()).map((t) => {
    const columns: DbColumnMeta[] = Array.from(t.cols.values()).map((c) => ({
      name: c,
      dataType: 'column',
      columnType: 'SQL kode proyek',
      nullable: true,
      isPrimaryKey: false
    }));
    return {
      name: t.name,
      schema: t.schema,
      kind: 'table',
      columns,
      primaryKeys: []
    };
  });

  return {
    databases: Array.from(dbMap.values()),
    tables,
    columns: Array.from(globalCols.values())
  };
}

// ============================================================================
// #1. SQL Statement & PHP Embedded SQL Extractor (CodeLens + Test Parameter Runner)
// ============================================================================

export interface SqlTemplateParam {
  key: string;
  expr: string;
  defaultValue: string;
  surroundedByQuotes: boolean;
  startOffset: number;
  endOffset: number;
}

export interface SqlStringSegment {
  text: string;
  docStartOffset: number;
  sqlStartOffset: number;
  quoteChar: "'" | '"';
}

export interface ExtractedSqlStatement {
  id: string;
  startLine: number;
  endLine: number;
  sqlTemplate: string;
  params: SqlTemplateParam[];
  primaryTable: { schema?: string; table: string } | null;
  segments: SqlStringSegment[];
}

function buildLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
}

export function offsetToLineCol(
  lineStarts: number[],
  offset: number
): { line: number; col: number } {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= offset) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const lineIdx = Math.max(0, hi);
  return {
    line: lineIdx + 1,
    col: offset - lineStarts[lineIdx] + 1
  };
}

function mapSqlOffsetToDocOffset(
  segments: SqlStringSegment[],
  sqlOffset: number
): number | null {
  for (const seg of segments) {
    const segEnd = seg.sqlStartOffset + seg.text.length;
    if (sqlOffset >= seg.sqlStartOffset && sqlOffset <= segEnd) {
      return seg.docStartOffset + (sqlOffset - seg.sqlStartOffset);
    }
  }
  return null;
}

export interface SqlInlineParamToken {
  key: string;
  displayToken: string;
  rawTokens: string[];
  surroundedByQuotes: boolean;
}

/**
 * Automatically detects reusable SQL parameter placeholders in any query text:
 * - PHP braced: `{$id}`, `{$nip}`
 * - Mustache: `{{id}}`
 * - JS/Shell: `${id}`
 * - Named PDO/DataGrip: `:id`, `:kd_unitkerja` (ignores `::cast`, `:=`, and `HH:MM:SS`)
 * - Bare PHP var: `$id`
 */
export function extractSqlInlineParams(sql: string): SqlInlineParamToken[] {
  if (!sql || !sql.trim()) return [];

  // Mask line comments and block comments preserving offsets
  const masked = sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/--[^\r\n]*/g, (m) => ' '.repeat(m.length));

  const map = new Map<string, SqlInlineParamToken>();

  const register = (key: string, rawToken: string, startIdx: number, endIdx: number): void => {
    const cleanKey = key.trim();
    if (!cleanKey) return;
    // Check if immediately wrapped inside matching single or double quotes (or inside a quoted LIKE pattern like '%{$id}%')
    let surrounded = false;
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < startIdx; i++) {
      const ch = masked[i];
      if (ch === "'" && !inDouble) {
        if (masked[i + 1] === "'") {
          i++;
          continue;
        }
        inSingle = !inSingle;
      } else if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
      }
    }
    if (inSingle || inDouble) {
      surrounded = true;
    } else {
      const before = masked[startIdx - 1];
      const after = masked[endIdx];
      if ((before === "'" && after === "'") || (before === '"' && after === '"')) {
        surrounded = true;
      }
    }

    const existing = map.get(cleanKey);
    if (existing) {
      if (!existing.rawTokens.includes(rawToken)) {
        existing.rawTokens.push(rawToken);
      }
      if (surrounded) existing.surroundedByQuotes = true;
    } else {
      map.set(cleanKey, {
        key: cleanKey,
        displayToken: rawToken,
        rawTokens: [rawToken],
        surroundedByQuotes: surrounded
      });
    }
  };

  // Match all 5 placeholder forms in a single left-to-right pass so `{$id}` doesn't also trigger bare `$id`
  const tokenRe =
    /\{\$([a-zA-Z_][a-zA-Z0-9_]*)\}|\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}|\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}|(?<![a-zA-Z0-9_:])\:([a-zA-Z_][a-zA-Z0-9_]*)(?!=)|(?<![a-zA-Z0-9_{$])\$([a-zA-Z_][a-zA-Z0-9_]*)/g;

  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(masked)) !== null) {
    const rawToken = m[0];
    const key = m[1] || m[2] || m[3] || m[4] || m[5];
    if (!key) continue;
    // Skip `:named` if it looks like a URL scheme (http://) or MySQL JSON path / time
    if (rawToken.startsWith(':')) {
      const after = masked[m.index + rawToken.length];
      if (after === '/' || after === ':') continue;
    }
    register(key, rawToken, m.index, m.index + rawToken.length);
  }

  return Array.from(map.values());
}

export function applySqlInlineParams(
  sql: string,
  params: SqlInlineParamToken[],
  values: Record<string, string>
): { sql: string; missingKeys: string[] } {
  if (params.length === 0) {
    return { sql, missingKeys: [] };
  }

  const missingKeys: string[] = [];
  let out = sql;

  for (const p of params) {
    const rawVal = values[p.key];
    if (rawVal === undefined || rawVal === '') {
      missingKeys.push(p.key);
      continue;
    }
    const trimmed = rawVal.trim();
    const escapedVal = rawVal.replace(/'/g, "''");
    const replacement = p.surroundedByQuotes
      ? escapedVal
      : /^null$/i.test(trimmed)
        ? 'NULL'
        : /^-?\d+(?:\.\d+)?$/.test(trimmed)
          ? trimmed
          : `'${escapedVal}'`;

    for (const tok of p.rawTokens) {
      out = out.split(tok).join(replacement);
    }
  }

  return { sql: out, missingKeys };
}

export function substituteSqlTestParams(
  sqlTemplate: string,
  params: SqlTemplateParam[],
  values: Record<string, string>
): string {
  let out = sqlTemplate;
  for (const p of params) {
    const rawVal = values[p.key] ?? p.defaultValue ?? '';
    const escapedVal = rawVal.replace(/'/g, "''");
    const replacement = p.surroundedByQuotes
      ? escapedVal
      : /^-?\d+(?:\.\d+)?$/.test(rawVal.trim())
        ? rawVal.trim()
        : `'${escapedVal}'`;
    out = out.split(`{{${p.key}}}`).join(replacement);
  }
  return out;
}

export function extractPhpEmbeddedSqlStatements(source: string): ExtractedSqlStatement[] {
  const lineStarts = buildLineStarts(source);
  const results: ExtractedSqlStatement[] = [];

  interface RawLitPart {
    text: string;
    docContentStart: number;
    docTokenStart: number;
    docTokenEnd: number;
    quoteChar: "'" | '"';
  }

  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let litStartTokenOffset = 0;
  let litContentStartOffset = 0;
  let currentLitBuf = '';

  let stmtStartOffset = -1;
  let stmtCodeOutside = '';
  const stmtLiterals: RawLitPart[] = [];
  const stmtBetweenCode: Array<{ code: string; startOffset: number; endOffset: number }> = [];
  let lastLitEndOffset = -1;
  let bracketDepth = 0;

  const extractBalancedLeadingPhpExpr = (rawAfterDot: string): string => {
    let pDepth = 0;
    let bDepth = 0;
    let qChar = '';
    for (let k = 0; k < rawAfterDot.length; k++) {
      const c = rawAfterDot[k];
      if (qChar) {
        if (c === '\\') {
          k++;
          continue;
        }
        if (c === qChar) qChar = '';
        continue;
      }
      if (c === "'" || c === '"') {
        qChar = c;
        continue;
      }
      if (c === '(') {
        pDepth++;
        continue;
      }
      if (c === '[') {
        bDepth++;
        continue;
      }
      if (c === ']') {
        if (bDepth > 0) bDepth--;
        continue;
      }
      if (c === ')') {
        if (pDepth === 0 && bDepth === 0) {
          return rawAfterDot.slice(0, k).trim();
        }
        pDepth--;
        continue;
      }
      if (c === ',' && pDepth === 0 && bDepth === 0) {
        return rawAfterDot.slice(0, k).trim();
      }
    }
    return rawAfterDot.trim();
  };

  const flushStatement = (stmtEndOffset: number): void => {
    if (stmtLiterals.length === 0) {
      stmtStartOffset = -1;
      stmtCodeOutside = '';
      stmtBetweenCode.length = 0;
      lastLitEndOffset = -1;
      bracketDepth = 0;
      return;
    }

    const combinedRaw = stmtLiterals.map((l) => l.text).join(' ');
    const trimmedRaw = combinedRaw.trimStart();

    const isSqlCall =
      /\b(?:mysql_query|mysql|mysqli_query|pg_query|pg_query_params|dosql|sqlite_query)\s*\(/i.test(
        stmtCodeOutside
      ) ||
      /->\s*(?:query|prepare|exec|loadData|whereRaw|orWhereRaw|selectRaw)\s*\(/i.test(
        stmtCodeOutside
      ) ||
      /\bDB::(?:select|selectOne|insert|update|delete|statement|unprepared)\s*\(/i.test(
        stmtCodeOutside
      ) ||
      /\$[A-Za-z0-9_]*(?:sql|query|qry)[A-Za-z0-9_]*\s*\.?=/i.test(stmtCodeOutside);

    const looksSql =
      /^(?:select|insert\s+into|update|delete\s+from|replace\s+into|with\s+[a-z0-9_]+\s+as|show\s+|describe\s+|explain\s+|alter\s+table|create\s+table)\b/i.test(
        trimmedRaw
      );

    if (isSqlCall && looksSql) {
      const params: SqlTemplateParam[] = [];
      const segments: SqlStringSegment[] = [];
      let sqlBuilder = '';

      for (let idx = 0; idx < stmtLiterals.length; idx++) {
        const lit = stmtLiterals[idx];
        let segText = lit.text;

        // Also detect interpolated PHP variables inside double-quoted SQL strings: `"SELECT * FROM tbl WHERE nip='$nip'"`
        if (lit.quoteChar === '"') {
          segText = segText.replace(
            /\{\$[^}]+\}|\$_(?:GET|POST|SESSION|REQUEST|COOKIE|SERVER)\s*\[\s*['"]?[A-Za-z0-9_]+['"]?\s*\]|\$[A-Za-z_][A-Za-z0-9_]*(?:->[A-Za-z_][A-Za-z0-9_]*)?/g,
            (match, matchRelIdx: number) => {
              const pKey = `p${params.length}`;
              const beforeChar = lit.text[matchRelIdx - 1] ?? '';
              const afterChar = lit.text[matchRelIdx + match.length] ?? '';
              const surrounded =
                (beforeChar === "'" && afterChar === "'") ||
                (beforeChar === '%' || afterChar === '%');
              params.push({
                key: pKey,
                expr: match.replace(/^\{|\}$/g, ''),
                defaultValue: '1',
                surroundedByQuotes: surrounded || beforeChar === "'",
                startOffset: lit.docContentStart + matchRelIdx,
                endOffset: lit.docContentStart + matchRelIdx + match.length
              });
              return `{{${pKey}}}`;
            }
          );
        }

        segments.push({
          text: lit.text,
          docStartOffset: lit.docContentStart,
          sqlStartOffset: sqlBuilder.length,
          quoteChar: lit.quoteChar
        });
        sqlBuilder += segText;

        if (idx < stmtLiterals.length - 1) {
          const between = stmtBetweenCode[idx];
          const cleanedExpr = (between?.code ?? '')
            .replace(/^\s*\.\s*/, '')
            .replace(/\s*\.\s*$/, '')
            .trim();
          if (cleanedExpr) {
            const pKey = `p${params.length}`;
            const prevEndsWithQuote = /['"]\s*$/.test(lit.text) || /%$/.test(lit.text);
            const nextStartsWithQuote =
              /^\s*['"]/.test(stmtLiterals[idx + 1].text) ||
              /^%/.test(stmtLiterals[idx + 1].text);
            const rawSlice = between?.code ?? '';
            const exprLeadTrim = rawSlice.search(/\S/);
            const exprDocStart =
              between && exprLeadTrim >= 0
                ? between.startOffset +
                  rawSlice.indexOf(cleanedExpr)
                : lit.docTokenEnd;
            const exprDocEnd = exprDocStart + cleanedExpr.length;

            params.push({
              key: pKey,
              expr: cleanedExpr,
              defaultValue: '1',
              surroundedByQuotes: prevEndsWithQuote || nextStartsWithQuote,
              startOffset: exprDocStart,
              endOffset: exprDocEnd
            });
            sqlBuilder += `{{${pKey}}}`;
          }
        }
      }

      // Also capture trailing concatenated PHP expression after the final SQL string literal (e.g. `" ... and aktif=" . intval($status)`)
      const lastLit = stmtLiterals[stmtLiterals.length - 1];
      if (lastLit && lastLit.docTokenEnd < stmtEndOffset) {
        const tailRaw = source.slice(lastLit.docTokenEnd, stmtEndOffset);
        const dotMatch = tailRaw.match(/^\s*\.\s*/);
        if (dotMatch) {
          const afterDotOffset = lastLit.docTokenEnd + dotMatch[0].length;
          const afterDotRaw = source.slice(afterDotOffset, stmtEndOffset);
          const cleanedTail = extractBalancedLeadingPhpExpr(afterDotRaw);
          if (cleanedTail) {
            const pKey = `p${params.length}`;
            const prevEndsWithQuote = /['"]\s*$/.test(lastLit.text) || /%$/.test(lastLit.text);
            const relPos = afterDotRaw.indexOf(cleanedTail);
            const exprDocStart = afterDotOffset + (relPos >= 0 ? relPos : 0);
            const exprDocEnd = exprDocStart + cleanedTail.length;
            params.push({
              key: pKey,
              expr: cleanedTail,
              defaultValue: '1',
              surroundedByQuotes: prevEndsWithQuote,
              startOffset: exprDocStart,
              endOffset: exprDocEnd
            });
            sqlBuilder += `{{${pKey}}}`;
          }
        }
      }

      const firstTokenOffset =
        stmtStartOffset >= 0 ? stmtStartOffset : stmtLiterals[0].docTokenStart;
      const startPos = offsetToLineCol(lineStarts, firstTokenOffset);
      const endPos = offsetToLineCol(
        lineStarts,
        Math.max(firstTokenOffset, stmtEndOffset)
      );
      const refs = extractReferencedSqlTables(sqlBuilder.replace(/\{\{p\d+\}\}/g, '1'));
      const firstRef = refs.refs[0];

      results.push({
        id: `php-sql-${startPos.line}-${results.length}`,
        startLine: startPos.line,
        endLine: endPos.line,
        sqlTemplate: sqlBuilder.trim(),
        params,
        primaryTable: firstRef
          ? { schema: firstRef.schema, table: firstRef.table }
          : null,
        segments
      });
    }

    stmtStartOffset = -1;
    stmtCodeOutside = '';
    stmtLiterals.length = 0;
    stmtBetweenCode.length = 0;
    lastLitEndOffset = -1;
    bracketDepth = 0;
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1] ?? '';

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (ch === '\\') {
        currentLitBuf += source.slice(i, i + 2);
        i++;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
        if (lastLitEndOffset >= 0) {
          stmtBetweenCode.push({
            code: source.slice(lastLitEndOffset, litStartTokenOffset),
            startOffset: lastLitEndOffset,
            endOffset: litStartTokenOffset
          });
        }
        stmtLiterals.push({
          text: currentLitBuf,
          docContentStart: litContentStartOffset,
          docTokenStart: litStartTokenOffset,
          docTokenEnd: i + 1,
          quoteChar: "'"
        });
        lastLitEndOffset = i + 1;
        currentLitBuf = '';
        continue;
      }
      currentLitBuf += ch;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') {
        currentLitBuf += source.slice(i, i + 2);
        i++;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
        if (lastLitEndOffset >= 0) {
          stmtBetweenCode.push({
            code: source.slice(lastLitEndOffset, litStartTokenOffset),
            startOffset: lastLitEndOffset,
            endOffset: litStartTokenOffset
          });
        }
        stmtLiterals.push({
          text: currentLitBuf,
          docContentStart: litContentStartOffset,
          docTokenStart: litStartTokenOffset,
          docTokenEnd: i + 1,
          quoteChar: '"'
        });
        lastLitEndOffset = i + 1;
        currentLitBuf = '';
        continue;
      }
      currentLitBuf += ch;
      continue;
    }

    // Outside strings/comments
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '#') {
      inLineComment = true;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '[') {
      bracketDepth++;
      if (stmtStartOffset < 0) stmtStartOffset = i;
      stmtCodeOutside += ch;
      continue;
    }
    if (ch === ']') {
      if (bracketDepth > 0) bracketDepth--;
      stmtCodeOutside += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let prevIdx = i - 1;
      while (prevIdx >= 0 && /\s/.test(source[prevIdx])) prevIdx--;
      const prevNonWs = prevIdx >= 0 ? source[prevIdx] : '';
      const isInnerPhpExprQuote =
        bracketDepth > 0 ||
        (stmtLiterals.length > 0 && prevNonWs !== '.' && prevNonWs !== '=');

      if (isInnerPhpExprQuote) {
        if (stmtStartOffset < 0) stmtStartOffset = i;
        const q = ch;
        let endQ = i + 1;
        while (endQ < source.length) {
          if (source[endQ] === '\\') {
            endQ += 2;
            continue;
          }
          if (source[endQ] === q) {
            endQ++;
            break;
          }
          endQ++;
        }
        stmtCodeOutside += source.slice(i, endQ);
        i = endQ - 1;
        continue;
      }

      if (stmtStartOffset < 0) stmtStartOffset = i;
      if (ch === "'") {
        inSingle = true;
      } else {
        inDouble = true;
      }
      litStartTokenOffset = i;
      litContentStartOffset = i + 1;
      currentLitBuf = '';
      continue;
    }
    if (ch === ';' || ch === '{' || ch === '}') {
      flushStatement(i);
      continue;
    }

    if (!/\s/.test(ch) && stmtStartOffset < 0) {
      stmtStartOffset = i;
    }
    stmtCodeOutside += ch;
  }

  flushStatement(source.length);
  return results;
}

export function extractSqlFileStatements(source: string): ExtractedSqlStatement[] {
  const lineStarts = buildLineStarts(source);
  const results: ExtractedSqlStatement[] = [];
  let chunkStart = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  const pushChunk = (endIdx: number): void => {
    const raw = source.slice(chunkStart, endIdx);
    const leadMatch = raw.match(/^\s*/);
    const leadLen = leadMatch ? leadMatch[0].length : 0;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const strippedComments = trimmed
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*--.*$/gm, '')
      .trim();
    if (!strippedComments) return;
    if (
      !/^(?:select|insert|update|delete|replace|with|show|describe|desc|explain|alter|create)\b/i.test(
        strippedComments
      )
    ) {
      return;
    }
    const realStart = chunkStart + leadLen;
    const startPos = offsetToLineCol(lineStarts, realStart);
    const endPos = offsetToLineCol(lineStarts, Math.max(realStart, endIdx));
    const refs = extractReferencedSqlTables(strippedComments);
    const firstRef = refs.refs[0];

    results.push({
      id: `sql-stmt-${startPos.line}-${results.length}`,
      startLine: startPos.line,
      endLine: endPos.line,
      sqlTemplate: trimmed,
      params: [],
      primaryTable: firstRef
        ? { schema: firstRef.schema, table: firstRef.table }
        : null,
      segments: [
        {
          text: raw,
          docStartOffset: chunkStart,
          sqlStartOffset: 0,
          quoteChar: "'"
        }
      ]
    });
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1] ?? '';
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (ch === "'" && next === "'") {
        i++;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === '-' && next === '-') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
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
    if (ch === ';') {
      pushChunk(i + 1);
      chunkStart = i + 1;
    }
  }
  pushChunk(source.length);
  return results;
}

// ============================================================================
// #2. Real-Time SQL Schema Typo Validator + Fuzzy QuickFix (`Ctrl+.`)
// ============================================================================

export function levenshteinDistance(aRaw: string, bRaw: string): number {
  const a = aRaw.toLowerCase();
  const b = bRaw.toLowerCase();
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

export function findClosestIdentifiers(
  typo: string,
  candidates: string[],
  maxSuggestions = 3
): string[] {
  const cleanTypo = typo.trim().toLowerCase();
  if (!cleanTypo) return [];
  const maxDist = Math.max(2, Math.min(4, Math.ceil(cleanTypo.length * 0.4)));

  const scored: Array<{ item: string; score: number }> = [];
  const seen = new Set<string>();

  for (const cand of candidates) {
    const low = cand.toLowerCase();
    if (seen.has(low) || low === cleanTypo) continue;
    seen.add(low);

    const dist = levenshteinDistance(cleanTypo, low);
    const substringBonus =
      low.includes(cleanTypo) || cleanTypo.includes(low) ? -1.5 : 0;
    const prefixBonus = low.startsWith(cleanTypo.slice(0, 3)) ? -0.5 : 0;
    const effective = dist + substringBonus + prefixBonus;

    if (dist <= maxDist || (cleanTypo.length >= 4 && (low.includes(cleanTypo) || cleanTypo.includes(low)))) {
      scored.push({ item: cand, score: effective });
    }
  }

  scored.sort((a, b) => a.score - b.score || a.item.localeCompare(b.item));
  return scored.slice(0, maxSuggestions).map((s) => s.item);
}

export interface SqlQuickFixOption {
  title: string;
  replacement: string;
}

export interface SqlSchemaDiagnostic {
  line: number;
  startColumn: number;
  endColumn: number;
  severity: 'warning' | 'error';
  message: string;
  quickFixes: SqlQuickFixOption[];
}

export function validateSqlAgainstSchema(
  source: string,
  lang: 'sql' | 'php',
  snapshot: DbSchemaSnapshot | null | undefined
): SqlSchemaDiagnostic[] {
  if (!snapshot) return [];
  const allTables = snapshot.allTables ?? snapshot.tables;
  if (allTables.length === 0) return [];

  const lineStarts = buildLineStarts(source);
  const dbSetLower = new Set(snapshot.databases.map((d) => d.toLowerCase()));
  const curDb = snapshot.currentDatabase || '';
  const curDbLower = curDb.toLowerCase();

  const tablesByDb = new Map<string, DbTableMeta[]>();
  const tablesByName = new Map<string, DbTableMeta[]>();
  const tableByFull = new Map<string, DbTableMeta>();

  for (const t of allTables) {
    const sLow = (t.schema ?? curDb).toLowerCase();
    const tLow = t.name.toLowerCase();
    const byDbList = tablesByDb.get(sLow) ?? [];
    byDbList.push(t);
    tablesByDb.set(sLow, byDbList);

    const byNameList = tablesByName.get(tLow) ?? [];
    byNameList.push(t);
    tablesByName.set(tLow, byNameList);

    tableByFull.set(`${sLow}.${tLow}`, t);
  }

  const diagnostics: SqlSchemaDiagnostic[] = [];
  const seenDiagKey = new Set<string>();

  const pushDiag = (
    docStart: number,
    length: number,
    message: string,
    quickFixes: SqlQuickFixOption[]
  ): void => {
    if (docStart < 0 || length <= 0) return;
    const start = offsetToLineCol(lineStarts, docStart);
    const end = offsetToLineCol(lineStarts, docStart + length);
    if (start.line !== end.line) return;
    const key = `${start.line}:${start.col}:${end.col}:${message}`;
    if (seenDiagKey.has(key)) return;
    seenDiagKey.add(key);
    diagnostics.push({
      line: start.line,
      startColumn: start.col,
      endColumn: end.col,
      severity: 'warning',
      message,
      quickFixes
    });
  };

  const statements: Array<{ rawSql: string; segments: SqlStringSegment[] }> =
    lang === 'php'
      ? extractPhpEmbeddedSqlStatements(source).map((s) => ({
          rawSql: s.segments.map((seg) => seg.text).join('__php__'),
          segments: []
        }))
      : [
          {
            rawSql: source,
            segments: [
              {
                text: source,
                docStartOffset: 0,
                sqlStartOffset: 0,
                quoteChar: "'"
              }
            ]
          }
        ];

  // Recompute exact segment offsets with `__php__` joiner for PHP statements
  if (lang === 'php') {
    const phpStmts = extractPhpEmbeddedSqlStatements(source);
    statements.length = 0;
    for (const ps of phpStmts) {
      let cursor = 0;
      const joinedSegs: SqlStringSegment[] = [];
      let rawJoined = '';
      ps.segments.forEach((seg, idx) => {
        joinedSegs.push({
          text: seg.text,
          docStartOffset: seg.docStartOffset,
          sqlStartOffset: cursor,
          quoteChar: seg.quoteChar
        });
        rawJoined += seg.text;
        cursor += seg.text.length;
        if (idx < ps.segments.length - 1) {
          rawJoined += '__php__';
          cursor += '__php__'.length;
        }
      });
      statements.push({ rawSql: rawJoined, segments: joinedSegs });
    }
  }

  // Mask SQL single-quoted string literals & comments with spaces of identical length so offsets stay 100% aligned!
  const maskSqlLiteralsAndComments = (sql: string): string => {
    let out = '';
    let i = 0;
    while (i < sql.length) {
      const ch = sql[i];
      const next = sql[i + 1] ?? '';
      if (ch === '-' && next === '-') {
        while (i < sql.length && sql[i] !== '\n') {
          out += ' ';
          i++;
        }
        continue;
      }
      if (ch === '/' && next === '*') {
        out += '  ';
        i += 2;
        while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
          out += sql[i] === '\n' ? '\n' : ' ';
          i++;
        }
        if (i < sql.length) {
          out += '  ';
          i += 2;
        }
        continue;
      }
      if (ch === "'") {
        out += ' ';
        i++;
        while (i < sql.length) {
          if (sql[i] === "'" && sql[i + 1] === "'") {
            out += '  ';
            i += 2;
            continue;
          }
          if (sql[i] === '\\') {
            out += '  ';
            i += 2;
            continue;
          }
          if (sql[i] === "'") {
            out += ' ';
            i++;
            break;
          }
          out += sql[i] === '\n' ? '\n' : ' ';
          i++;
        }
        continue;
      }
      out += ch;
      i++;
    }
    return out;
  };

  for (const stmt of statements) {
    const maskedSql = maskSqlLiteralsAndComments(stmt.rawSql);

    // Collect CTE names (`WITH cte_name AS (...)`) and SELECT `AS alias_name` so we never flag them!
    const cteNamesLower = new Set<string>();
    for (const cm of maskedSql.matchAll(/\bwith\s+([A-Za-z_][A-Za-z0-9_]*)\s+as\s*\(/gi)) {
      cteNamesLower.add(cm[1].toLowerCase());
    }
    const selectAliasesLower = new Set<string>();
    for (const am of maskedSql.matchAll(/\bas\s+[`"]?([A-Za-z_][A-Za-z0-9_]*)[`"]?/gi)) {
      selectAliasesLower.add(am[1].toLowerCase());
    }

    const resolvedTablesInStmt: DbTableMeta[] = [];
    const aliasToTable = new Map<string, DbTableMeta>();
    let hasUnresolvedTableInStmt = false;

    // 1. Validate Table References in FROM / JOIN / UPDATE / INTO
    const tableRefRegex =
      /\b(?:from|join|update|into)\s+(?:([`"]?[A-Za-z_][A-Za-z0-9_]*[`"]?)\s*\.\s*)?([`"]?[A-Za-z_][A-Za-z0-9_]*[`"]?)(?:\s+(?:as\s+)?([A-Za-z_][A-Za-z0-9_]*))?/gi;

    for (const tm of maskedSql.matchAll(tableRefRegex)) {
      const fullMatch = tm[0];
      const schemaToken = tm[1];
      const tableToken = tm[2];
      const aliasToken = tm[3];
      if (!tableToken) continue;

      const cleanTable = tableToken.replace(/^[`"]|[`"]$/g, '');
      const cleanTableLow = cleanTable.toLowerCase();
      if (
        cleanTableLow.includes('__php__') ||
        SQL_ALIAS_STOPWORDS.has(cleanTableLow) ||
        cteNamesLower.has(cleanTableLow)
      ) {
        continue;
      }

      const matchStartSqlOffset = tm.index ?? 0;

      if (schemaToken) {
        const cleanSchema = schemaToken.replace(/^[`"]|[`"]$/g, '');
        const cleanSchemaLow = cleanSchema.toLowerCase();
        if (cleanSchemaLow.includes('__php__') || SYSTEM_DB_NAMES_LOWER.has(cleanSchemaLow)) {
          continue;
        }

        const schemaInMatchIdx = fullMatch.indexOf(schemaToken);
        const tableInMatchIdx = fullMatch.indexOf(
          tableToken,
          schemaInMatchIdx + schemaToken.length
        );

        if (dbSetLower.size > 0 && !dbSetLower.has(cleanSchemaLow)) {
          hasUnresolvedTableInStmt = true;
          const docOff = mapSqlOffsetToDocOffset(
            stmt.segments,
            matchStartSqlOffset + schemaInMatchIdx
          );
          if (docOff !== null) {
            const closestDbs = findClosestIdentifiers(cleanSchema, snapshot.databases);
            pushDiag(
              docOff,
              schemaToken.length,
              `Database "${cleanSchema}" tidak ditemukan di server${
                closestDbs.length > 0 ? `. Maksud Anda "${closestDbs[0]}"?` : '.'
              }`,
              closestDbs.map((d) => ({
                title: `Perbaiki nama database menjadi '${d}'`,
                replacement: d
              }))
            );
          }
          continue;
        }

        const exactTbl = tableByFull.get(`${cleanSchemaLow}.${cleanTableLow}`);
        if (exactTbl) {
          resolvedTablesInStmt.push(exactTbl);
          aliasToTable.set(cleanTableLow, exactTbl);
          aliasToTable.set(`${cleanSchemaLow}.${cleanTableLow}`, exactTbl);
          if (aliasToken && !SQL_ALIAS_STOPWORDS.has(aliasToken.toLowerCase())) {
            aliasToTable.set(aliasToken.toLowerCase(), exactTbl);
          }
        } else {
          hasUnresolvedTableInStmt = true;
          const docOff = mapSqlOffsetToDocOffset(
            stmt.segments,
            matchStartSqlOffset + tableInMatchIdx
          );
          if (docOff !== null) {
            const dbTableNames = (tablesByDb.get(cleanSchemaLow) ?? []).map((t) => t.name);
            const closest = findClosestIdentifiers(cleanTable, dbTableNames);
            pushDiag(
              docOff,
              tableToken.length,
              `Tabel "${cleanTable}" tidak ditemukan di database "${cleanSchema}"${
                closest.length > 0 ? `. Maksud Anda "${closest[0]}"?` : '.'
              }`,
              closest.map((c) => ({
                title: `Perbaiki menjadi '${c}'`,
                replacement: c
              }))
            );
          }
        }
      } else {
        // Unqualified table reference -> check current active database first
        const tableInMatchIdx = fullMatch.lastIndexOf(tableToken);
        const inCurDb = curDbLower ? tableByFull.get(`${curDbLower}.${cleanTableLow}`) : undefined;
        const anywhereMatches = tablesByName.get(cleanTableLow) ?? [];

        if (inCurDb) {
          resolvedTablesInStmt.push(inCurDb);
          aliasToTable.set(cleanTableLow, inCurDb);
          if (aliasToken && !SQL_ALIAS_STOPWORDS.has(aliasToken.toLowerCase())) {
            aliasToTable.set(aliasToken.toLowerCase(), inCurDb);
          }
        } else if (anywhereMatches.length > 0) {
          // Table exists in ANOTHER database on the same server!
          const otherTbl = anywhereMatches[0];
          resolvedTablesInStmt.push(otherTbl);
          aliasToTable.set(cleanTableLow, otherTbl);
          if (aliasToken && !SQL_ALIAS_STOPWORDS.has(aliasToken.toLowerCase())) {
            aliasToTable.set(aliasToken.toLowerCase(), otherTbl);
          }
          // In pure SQL editors where `currentDatabase` is active, offer 1-click prefix `otherDb.table`!
          if (lang === 'sql' && curDb && otherTbl.schema) {
            const docOff = mapSqlOffsetToDocOffset(
              stmt.segments,
              matchStartSqlOffset + tableInMatchIdx
            );
            if (docOff !== null) {
              pushDiag(
                docOff,
                tableToken.length,
                `Tabel "${cleanTable}" berada di database "${otherTbl.schema}" (DB aktif saat ini: "${curDb}").`,
                anywhereMatches.slice(0, 3).map((m) => ({
                  title: `Gunakan nama lintas-database '${m.schema}.${m.name}'`,
                  replacement: `${m.schema}.${m.name}`
                }))
              );
            }
          }
        } else {
          hasUnresolvedTableInStmt = true;
          const docOff = mapSqlOffsetToDocOffset(
            stmt.segments,
            matchStartSqlOffset + tableInMatchIdx
          );
          if (docOff !== null) {
            const curCandidates = (tablesByDb.get(curDbLower) ?? []).map((t) => t.name);
            const allCandidates = allTables.map((t) =>
              t.schema && t.schema.toLowerCase() !== curDbLower
                ? `${t.schema}.${t.name}`
                : t.name
            );
            const closest = findClosestIdentifiers(cleanTable, [
              ...curCandidates,
              ...allTables.map((t) => t.name)
            ]);
            const fixes: SqlQuickFixOption[] = [];
            for (const c of closest) {
              const inCur = curCandidates.find((x) => x.toLowerCase() === c.toLowerCase());
              if (inCur) {
                fixes.push({ title: `Perbaiki menjadi '${inCur}'`, replacement: inCur });
              } else {
                const cross = allTables.find((x) => x.name.toLowerCase() === c.toLowerCase());
                if (cross) {
                  const rep =
                    cross.schema && cross.schema.toLowerCase() !== curDbLower
                      ? `${cross.schema}.${cross.name}`
                      : cross.name;
                  fixes.push({ title: `Perbaiki menjadi '${rep}'`, replacement: rep });
                }
              }
            }
            // Dedupe quick fixes
            const uniqueFixes = fixes.filter(
              (f, idx) => fixes.findIndex((x) => x.replacement === f.replacement) === idx
            );
            void allCandidates;

            pushDiag(
              docOff,
              tableToken.length,
              `Tabel "${cleanTable}" tidak ditemukan di database${
                uniqueFixes.length > 0
                  ? `. Maksud Anda "${uniqueFixes[0].replacement}"?`
                  : '.'
              }`,
              uniqueFixes
            );
          }
        }
      }
    }

    // 2. Validate Qualified Column References (`alias.col`, `table.col`, `db.table.col`)
    // Negative lookbehind `(?<!\.)` avoids matching `table.col` twice when `db.table.col` is written
    const threePartRegex =
      /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\.([`"]?[A-Za-z_][A-Za-z0-9_]*[`"]?)/g;
    for (const m3 of maskedSql.matchAll(threePartRegex)) {
      const sLow = m3[1].toLowerCase();
      const tLow = m3[2].toLowerCase();
      const colToken = m3[3];
      const cleanCol = colToken.replace(/^[`"]|[`"]$/g, '');
      if (cleanCol.toLowerCase().includes('__php__')) continue;
      const targetTbl = tableByFull.get(`${sLow}.${tLow}`);
      if (targetTbl && targetTbl.columns.length > 0) {
        const exists = targetTbl.columns.some(
          (c) => c.name.toLowerCase() === cleanCol.toLowerCase()
        );
        if (!exists) {
          const colOffsetInSql = (m3.index ?? 0) + m3[0].lastIndexOf(colToken);
          const docOff = mapSqlOffsetToDocOffset(stmt.segments, colOffsetInSql);
          if (docOff !== null) {
            const closest = findClosestIdentifiers(
              cleanCol,
              targetTbl.columns.map((c) => c.name)
            );
            pushDiag(
              docOff,
              colToken.length,
              `Field "${cleanCol}" tidak ada di tabel "${targetTbl.schema ? `${targetTbl.schema}.` : ''}${targetTbl.name}"${
                closest.length > 0 ? `. Maksud Anda "${closest[0]}"?` : '.'
              }`,
              closest.map((c) => ({ title: `Perbaiki menjadi '${c}'`, replacement: c }))
            );
          }
        }
      }
    }

    const twoPartRegex =
      /(?<![A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_]*)\.([`"]?[A-Za-z_][A-Za-z0-9_]*[`"]?)(?!\s*\.)/g;
    for (const m2 of maskedSql.matchAll(twoPartRegex)) {
      const left = m2[1];
      const leftLow = left.toLowerCase();
      const rightToken = m2[2];
      const cleanRight = rightToken.replace(/^[`"]|[`"]$/g, '');
      const cleanRightLow = cleanRight.toLowerCase();
      if (leftLow.includes('__php__') || cleanRightLow.includes('__php__')) continue;
      // Skip if `left.right` is actually a `schema.table` reference!
      if (dbSetLower.has(leftLow) && tableByFull.has(`${leftLow}.${cleanRightLow}`)) {
        continue;
      }
      const targetTbl = aliasToTable.get(leftLow);
      if (targetTbl && targetTbl.columns.length > 0) {
        const exists = targetTbl.columns.some(
          (c) => c.name.toLowerCase() === cleanRightLow
        );
        if (!exists) {
          const colOffsetInSql = (m2.index ?? 0) + m2[0].lastIndexOf(rightToken);
          const docOff = mapSqlOffsetToDocOffset(stmt.segments, colOffsetInSql);
          if (docOff !== null) {
            const closest = findClosestIdentifiers(
              cleanRight,
              targetTbl.columns.map((c) => c.name)
            );
            pushDiag(
              docOff,
              rightToken.length,
              `Field "${cleanRight}" tidak ada di tabel "${targetTbl.name}"${
                closest.length > 0 ? `. Maksud Anda "${closest[0]}"?` : '.'
              }`,
              closest.map((c) => ({ title: `Perbaiki menjadi '${c}'`, replacement: c }))
            );
          }
        }
      }
    }

    // 3. Validate Unqualified Column Names when ALL referenced tables in the statement are resolved!
    if (
      resolvedTablesInStmt.length > 0 &&
      !hasUnresolvedTableInStmt &&
      !maskedSql.includes(',') // avoid legacy comma-join false positives if unparsed
    ) {
      const unionColsMap = new Map<string, string>();
      for (const t of resolvedTablesInStmt) {
        for (const c of t.columns) {
          unionColsMap.set(c.name.toLowerCase(), c.name);
        }
      }

      if (unionColsMap.size > 0) {
        const allValidColNames = Array.from(unionColsMap.values());
        const checkUnqualifiedCol = (colToken: string, sqlOffset: number): void => {
          const clean = colToken.replace(/^[`"]|[`"]$/g, '');
          const low = clean.toLowerCase();
          if (
            !clean ||
            low.includes('__php__') ||
            /^\d/.test(clean) ||
            SQL_COMMON_STOPWORDS.has(low) ||
            selectAliasesLower.has(low) ||
            aliasToTable.has(low) ||
            unionColsMap.has(low)
          ) {
            return;
          }
          const docOff = mapSqlOffsetToDocOffset(stmt.segments, sqlOffset);
          if (docOff === null) return;
          const closest = findClosestIdentifiers(clean, allValidColNames);
          const ownerNames = resolvedTablesInStmt.map((t) => t.name).join(', ');
          pushDiag(
            docOff,
            colToken.length,
            `Field "${clean}" tidak ditemukan pada tabel (${ownerNames})${
              closest.length > 0 ? `. Maksud Anda "${closest[0]}"?` : '.'
            }`,
            closest.map((c) => ({ title: `Perbaiki menjadi '${c}'`, replacement: c }))
          );
        };

        // Check `WHERE / AND / OR / ORDER BY / GROUP BY / SET <col> = ...`
        const clauseColRegex =
          /\b(?:where|and|or|having|set|order\s+by|group\s+by)\s+\(*\s*([`"]?[A-Za-z_][A-Za-z0-9_]*[`"]?)(?!\s*[\.(])/gi;
        for (const cm of maskedSql.matchAll(clauseColRegex)) {
          const tok = cm[1];
          if (!tok) continue;
          const tokOff = (cm.index ?? 0) + cm[0].lastIndexOf(tok);
          checkUnqualifiedCol(tok, tokOff);
        }
      }
    }
  }

  // Re- evaluate comma-less check above: let's also check simple `SELECT a, b FROM tbl` unqualified SELECT list!
  for (const stmt of statements) {
    const maskedSql = maskSqlLiteralsAndComments(stmt.rawSql);
    const { refs } = extractReferencedSqlTables(maskedSql);
    if (refs.length !== 1) continue;
    const onlyRef = refs[0];
    const targetTbl = onlyRef.schemaLower
      ? tableByFull.get(`${onlyRef.schemaLower}.${onlyRef.tableLower}`)
      : (curDbLower ? tableByFull.get(`${curDbLower}.${onlyRef.tableLower}`) : undefined) ??
        tablesByName.get(onlyRef.tableLower)?.[0];
    if (!targetTbl || targetTbl.columns.length === 0) continue;

    const colSet = new Set(targetTbl.columns.map((c) => c.name.toLowerCase()));
    const allColNames = targetTbl.columns.map((c) => c.name);
    const selectAliases = new Set<string>();
    for (const am of maskedSql.matchAll(/\bas\s+[`"]?([A-Za-z_][A-Za-z0-9_]*)[`"]?/gi)) {
      selectAliases.add(am[1].toLowerCase());
    }

    // Check simple identifiers in `SELECT ... FROM`
    const selectMatch = maskedSql.match(/\bselect\s+(?:distinct\s+)?([\s\S]+?)\bfrom\b/i);
    if (selectMatch && selectMatch.index !== undefined) {
      const selectBlock = selectMatch[1];
      const blockStartInSql =
        selectMatch.index + selectMatch[0].indexOf(selectBlock);

      let depth = 0;
      let itemStart = 0;
      const items: Array<{ text: string; relOffset: number }> = [];
      for (let i = 0; i <= selectBlock.length; i++) {
        const ch = selectBlock[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        if ((ch === ',' && depth === 0) || i === selectBlock.length) {
          items.push({
            text: selectBlock.slice(itemStart, i),
            relOffset: itemStart
          });
          itemStart = i + 1;
        }
      }

      for (const item of items) {
        const withoutAlias = item.text.replace(
          /\s+as\s+[`"]?[A-Za-z_][A-Za-z0-9_]*[`"]?\s*$/i,
          ''
        );
        const plainMatch = withoutAlias.match(
          /^\s*([`"]?[A-Za-z_][A-Za-z0-9_]*[`"]?)\s*$/
        );
        if (!plainMatch) continue;
        const tok = plainMatch[1];
        const clean = tok.replace(/^[`"]|[`"]$/g, '');
        const low = clean.toLowerCase();
        if (
          low.includes('__php__') ||
          SQL_COMMON_STOPWORDS.has(low) ||
          colSet.has(low) ||
          selectAliases.has(low)
        ) {
          continue;
        }
        const tokInItem = withoutAlias.indexOf(tok);
        const docOff = mapSqlOffsetToDocOffset(
          stmt.segments,
          blockStartInSql + item.relOffset + tokInItem
        );
        if (docOff !== null) {
          const closest = findClosestIdentifiers(clean, allColNames);
          pushDiag(
            docOff,
            tok.length,
            `Field "${clean}" tidak ada di tabel "${targetTbl.name}"${
              closest.length > 0 ? `. Maksud Anda "${closest[0]}"?` : '.'
            }`,
            closest.map((c) => ({ title: `Perbaiki menjadi '${c}'`, replacement: c }))
          );
        }
      }

      // Also check WHERE/AND/OR columns for single-table queries (even when SELECT list had commas!)
      const whereColRegex =
        /\b(?:where|and|or|having|set|order\s+by|group\s+by)\s+\(*\s*([`"]?[A-Za-z_][A-Za-z0-9_]*[`"]?)(?!\s*[\.(])/gi;
      for (const wm of maskedSql.matchAll(whereColRegex)) {
        const tok = wm[1];
        if (!tok) continue;
        const clean = tok.replace(/^[`"]|[`"]$/g, '');
        const low = clean.toLowerCase();
        if (
          low.includes('__php__') ||
          /^\d/.test(clean) ||
          SQL_COMMON_STOPWORDS.has(low) ||
          colSet.has(low) ||
          selectAliases.has(low)
        ) {
          continue;
        }
        const tokOff = (wm.index ?? 0) + wm[0].lastIndexOf(tok);
        const docOff = mapSqlOffsetToDocOffset(stmt.segments, tokOff);
        if (docOff !== null) {
          const closest = findClosestIdentifiers(clean, allColNames);
          pushDiag(
            docOff,
            tok.length,
            `Field "${clean}" tidak ada di tabel "${targetTbl.name}"${
              closest.length > 0 ? `. Maksud Anda "${closest[0]}"?` : '.'
            }`,
            closest.map((c) => ({ title: `Perbaiki menjadi '${c}'`, replacement: c }))
          );
        }
      }
    }
  }

  return diagnostics;
}

// ============================================================================
// #5A. Inline PHP SQL Injection Risk Detector + Safe Wrapper QuickFixes
// ============================================================================

export interface SqlSecurityWarning {
  line: number;
  startColumn: number;
  endColumn: number;
  rawExpr: string;
  superglobal: string;
  message: string;
  quickFixes: SqlQuickFixOption[];
}

const SAFE_SQL_SANITIZER_REGEX =
  /\b(?:mysql_real_escape_string|mysqli_real_escape_string|pg_escape_string|pg_escape_literal|addslashes|intval|floatval|boolval|decid|encid|filter_input|filter_var|clean|sanitize|escape|quote)\s*\(|\(\s*(?:int|integer|float|double|bool|boolean)\s*\)/i;

export function detectPhpSqlSecurityRisks(source: string): SqlSecurityWarning[] {
  const lineStarts = buildLineStarts(source);
  const stmts = extractPhpEmbeddedSqlStatements(source);
  const warnings: SqlSecurityWarning[] = [];

  for (const stmt of stmts) {
    for (const p of stmt.params) {
      const sgMatch = p.expr.match(/\$(_(?:GET|POST|REQUEST|COOKIE))\b/);
      if (!sgMatch) continue;
      if (SAFE_SQL_SANITIZER_REGEX.test(p.expr)) continue;

      const start = offsetToLineCol(lineStarts, p.startOffset);
      const end = offsetToLineCol(lineStarts, p.endOffset);
      if (start.line !== end.line) continue;

      const isInterpolatedInsideDoubleQuote =
        source.slice(p.startOffset, p.endOffset) === p.expr &&
        stmt.segments.some(
          (seg) =>
            seg.quoteChar === '"' &&
            p.startOffset >= seg.docStartOffset &&
            p.endOffset <= seg.docStartOffset + seg.text.length
        );

      const cleanExpr = p.expr.trim();
      const quickFixes: SqlQuickFixOption[] = isInterpolatedInsideDoubleQuote
        ? [
            {
              title: `Amankan dengan " . mysql_real_escape_string(${cleanExpr}) . "`,
              replacement: `" . mysql_real_escape_string(${cleanExpr}) . "`
            },
            {
              title: `Konversi angka aman " . intval(${cleanExpr}) . "`,
              replacement: `" . intval(${cleanExpr}) . "`
            },
            {
              title: `Dekripsi ID Wisanggeni " . decid(${cleanExpr}) . "`,
              replacement: `" . decid(${cleanExpr}) . "`
            }
          ]
        : [
            {
              title: `Bungkus dengan mysql_real_escape_string(${cleanExpr})`,
              replacement: `mysql_real_escape_string(${cleanExpr})`
            },
            {
              title: `Konversi angka aman intval(${cleanExpr})`,
              replacement: `intval(${cleanExpr})`
            },
            {
              title: `Dekripsi ID Wisanggeni decid(${cleanExpr})`,
              replacement: `decid(${cleanExpr})`
            }
          ];

      warnings.push({
        line: start.line,
        startColumn: start.col,
        endColumn: end.col,
        rawExpr: cleanExpr,
        superglobal: `$${sgMatch[1]}`,
        message: `Risiko SQL Injection: input mentah $${sgMatch[1]} (${cleanExpr}) masuk langsung ke query SQL tanpa filter/escape.`,
        quickFixes
      });
    }
  }

  return warnings;
}

// ============================================================================
// #5B. Reference Kind Classifier for Shift+F12 (Functions, Classes, & DB Tables)
// ============================================================================

export type ReferenceUsageKind =
  | 'SELECT'
  | 'INSERT'
  | 'UPDATE'
  | 'DELETE'
  | 'JOIN'
  | 'DDL'
  | 'DEF'
  | 'CALL';

export function classifyReferenceLineKind(
  lineText: string,
  symbolName: string
): ReferenceUsageKind {
  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const trimmed = lineText.trim();

  if (
    new RegExp(`\\b(?:function|class|interface|trait)\\s+&?\\s*${escaped}\\b`, 'i').test(trimmed)
  ) {
    return 'DEF';
  }
  if (
    new RegExp(`\\b(?:create|alter|drop|truncate)\\s+table\\b.*\\b${escaped}\\b`, 'i').test(
      trimmed
    )
  ) {
    return 'DDL';
  }
  if (new RegExp(`\\binsert\\s+into\\s+[\\w."'\`]*\\b${escaped}\\b`, 'i').test(trimmed)) {
    return 'INSERT';
  }
  if (new RegExp(`\\bupdate\\s+[\\w."'\`]*\\b${escaped}\\b`, 'i').test(trimmed)) {
    return 'UPDATE';
  }
  if (new RegExp(`\\bdelete\\b.*\\bfrom\\s+[\\w."'\`]*\\b${escaped}\\b`, 'i').test(trimmed)) {
    return 'DELETE';
  }
  if (new RegExp(`\\bjoin\\s+[\\w."'\`]*\\b${escaped}\\b`, 'i').test(trimmed)) {
    return 'JOIN';
  }
  if (
    new RegExp(
      `(?:\\bfrom\\s+[\\w."'\`]*\\b${escaped}\\b|\\bselect\\b.*\\b${escaped}\\b|\\bDB::table\\s*\\(\\s*['"][\\w.]*${escaped}['"]|\\bcombobox_db\\s*\\(\\s*['"][\\w.]*${escaped}['"])`,
      'i'
    ).test(trimmed)
  ) {
    return 'SELECT';
  }
  return 'CALL';
}
