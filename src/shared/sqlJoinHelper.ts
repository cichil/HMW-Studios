import type { DbForeignKeyMeta, DbTableMeta } from './types';
import {
  extractPhpEmbeddedSqlStatements,
  extractReferencedSqlTables,
  offsetToLineCol,
  type SqlQuickFixOption,
  type SqlSchemaDiagnostic,
  type SqlTableReference
} from './sqlSchemaAnalyzer';

export interface LearnedJoinEdge {
  leftSchema?: string;
  leftTable: string;
  leftColumn: string;
  rightSchema?: string;
  rightTable: string;
  rightColumn: string;
  frequency: number;
}

export interface JoinCandidateSuggestion {
  targetSchema?: string;
  targetTable: string;
  suggestedAlias: string;
  sourceAliasOrTable: string;
  sourceTable: string;
  sourceColumn: string;
  targetColumn: string;
  onExpression: string;
  fullJoinTail: string;
  reason: 'learned-code' | 'foreign-key' | 'primary-key-match' | 'column-name-match';
  reasonLabel: string;
  score: number;
}

export type SqlJoinType = 'LEFT JOIN' | 'INNER JOIN' | 'RIGHT JOIN';

export type SqlJoinOperator = '=' | '!=' | '<' | '<=' | '>' | '>=';

export type SqlAggregateFunc =
  | ''
  | 'COUNT'
  | 'COUNT_DISTINCT'
  | 'SUM'
  | 'AVG'
  | 'MIN'
  | 'MAX'
  | 'GROUP_CONCAT';

export type SqlWhereOperator =
  | '='
  | '!='
  | 'LIKE_CONTAINS'
  | 'LIKE_PREFIX'
  | 'NOT_LIKE'
  | '>'
  | '>='
  | '<'
  | '<='
  | 'IN'
  | 'NOT_IN'
  | 'IS_NULL'
  | 'IS_NOT_NULL'
  | 'RAW';

export interface VisualWhereRule {
  id: string;
  conjunction: 'AND' | 'OR';
  columnRef: string;
  operator: SqlWhereOperator;
  value: string;
  enabled?: boolean;
}

export interface VisualOrderByRule {
  id: string;
  columnRef: string;
  direction: 'ASC' | 'DESC';
}

export interface VisualJoinExtraCondition {
  leftRef: string;
  operator?: SqlJoinOperator;
  rightColumn: string;
}

export interface VisualJoinSelectedColumn {
  tableAlias: string;
  columnName: string;
  outputAlias?: string;
  aggregate?: SqlAggregateFunc;
}

export interface VisualJoinStep {
  id: string;
  joinType: SqlJoinType;
  targetSchema?: string;
  targetTable: string;
  alias: string;
  leftRef: string; // e.g. "p.kd_unitkerja"
  operator?: SqlJoinOperator;
  rightColumn: string; // e.g. "kd_unitkerja"
  extraConditions?: VisualJoinExtraCondition[];
}

export interface VisualJoinQuerySpec {
  baseSchema?: string;
  baseTable: string;
  baseAlias: string;
  joins: VisualJoinStep[];
  selectedColumns: VisualJoinSelectedColumn[];
  distinct?: boolean;
  autoAliasCollisions?: boolean;
  whereRules?: VisualWhereRule[];
  whereClause?: string;
  groupByColumns?: string[];
  havingClause?: string;
  orderByRules?: VisualOrderByRule[];
  orderByClause?: string;
  limit?: number;
  offset?: number;
  activeDatabase?: string;
}

export interface GeneratedJoinQueryOutputs {
  sql: string;
  phpMysql: string;
  phpWisanggeni: string;
  laravelQueryBuilder: string;
}

export interface AmbiguousColumnDiagnostic {
  column: string;
  sqlStartOffset: number;
  sqlEndOffset: number;
  candidateTables: Array<{ aliasOrTable: string; tableName: string }>;
  message: string;
  quickFixes: SqlQuickFixOption[];
}

const SQL_RESERVED_ALIASES = new Set([
  'on',
  'as',
  'in',
  'is',
  'or',
  'by',
  'to',
  'do',
  'if',
  'no',
  'of',
  'at',
  'go',
  'up',
  'and',
  'not',
  'set',
  'all',
  'any',
  'end',
  'for',
  'key',
  'row',
  'use',
  'asc',
  'desc',
  'from',
  'join',
  'left',
  'right',
  'inner',
  'outer',
  'cross',
  'where',
  'group',
  'order',
  'limit',
  'union',
  'select',
  'insert',
  'update',
  'delete',
  'having',
  'values',
  'into',
  'null',
  'true',
  'false',
  'case',
  'when',
  'then',
  'else'
]);

// Generic columns that appear on many unrelated tables and must NOT trigger join suggestions on their own
const GENERIC_NON_JOIN_COLUMNS = new Set([
  'id',
  'uuid',
  'nama',
  'name',
  'judul',
  'title',
  'uraian',
  'keterangan',
  'ket',
  'deskripsi',
  'description',
  'catatan',
  'notes',
  'status',
  'aktif',
  'is_active',
  'flag',
  'urutan',
  'urut',
  'no_urut',
  'level',
  'tipe',
  'type',
  'jenis',
  'kategori',
  'tahun',
  'bulan',
  'tanggal',
  'tgl',
  'alamat',
  'email',
  'password',
  'username',
  'telepon',
  'no_hp',
  'hp',
  'foto',
  'file',
  'lampiran',
  'nilai',
  'jumlah',
  'total',
  'nominal',
  'created_at',
  'updated_at',
  'deleted_at',
  'created_by',
  'updated_by',
  'tgl_input',
  'tgl_update',
  'user_input',
  'user_update'
]);

const SQL_NON_COLUMN_KEYWORDS = new Set([
  ...Array.from(SQL_RESERVED_ALIASES),
  'distinct',
  'between',
  'like',
  'ilike',
  'exists',
  'isnull',
  'notnull',
  'offset',
  'fetch',
  'next',
  'rows',
  'only',
  'interval',
  'day',
  'month',
  'year',
  'hour',
  'minute',
  'second',
  'cast',
  'unsigned',
  'signed',
  'char',
  'date',
  'datetime',
  'decimal',
  'integer',
  'int',
  'separator'
]);

function stripTablePrefix(tableName: string): string {
  return tableName.replace(/^(?:mst|ms|ref|trx|tr|tb|tbl|tm|td|sys|app|m|t)_+/i, '');
}

function singularizeSimple(name: string): string {
  const low = name.toLowerCase();
  if (low.endsWith('ies') && low.length > 4) {
    return `${low.slice(0, -3)}y`;
  }
  if (low.endsWith('ses') && low.length > 4) {
    return low.slice(0, -2);
  }
  if (low.endsWith('s') && !low.endsWith('ss') && low.length > 3) {
    return low.slice(0, -1);
  }
  return low;
}

export function suggestUniqueTableAlias(
  tableName: string,
  usedAliases: Iterable<string>
): string {
  const used = new Set(Array.from(usedAliases, (a) => a.toLowerCase()));
  const cleanCore = stripTablePrefix(tableName)
    .replace(/[^A-Za-z0-9_]/g, '')
    .toLowerCase();
  const words = cleanCore.split('_').filter(Boolean);
  const rawWords = tableName
    .toLowerCase()
    .replace(/[^A-Za-z0-9_]/g, '')
    .split('_')
    .filter(Boolean);

  const candidates: string[] = [];

  if (words.length >= 2) {
    candidates.push(words.map((w) => w[0]).join(''));
  }
  if (words[0]?.[0]) {
    candidates.push(words[0][0]);
  }
  if (rawWords.length >= 2) {
    candidates.push(rawWords.map((w) => w[0]).join(''));
  }
  if (cleanCore.length >= 2) {
    candidates.push(cleanCore.slice(0, 2));
  }
  if (cleanCore.length >= 3) {
    candidates.push(cleanCore.slice(0, 3));
  }

  for (const cand of candidates) {
    if (cand && !SQL_RESERVED_ALIASES.has(cand) && !used.has(cand)) {
      return cand;
    }
  }

  const base =
    candidates.find((c) => c && !SQL_RESERVED_ALIASES.has(c)) || 't';
  let idx = 2;
  while (used.has(`${base}${idx}`)) {
    idx++;
  }
  return `${base}${idx}`;
}

export function formatQualifiedTableForQuery(
  schema: string | undefined,
  tableName: string,
  activeDatabase?: string
): string {
  if (!schema) return tableName;
  if (activeDatabase && schema.toLowerCase() === activeDatabase.toLowerCase()) {
    return tableName;
  }
  return `${schema}.${tableName}`;
}

/**
 * Feature #3: Codebase JOIN Learner
 * Scans PHP (`mysql_query`, `$query->dosql`, Laravel `->join`/`->leftJoin`) and `.sql` sources
 * to learn real `JOIN ... ON a.col = b.col` pairs used in the project (even without DB Foreign Keys).
 */
export function learnJoinEdgesFromSources(sources: string[]): LearnedJoinEdge[] {
  const edgeMap = new Map<string, LearnedJoinEdge>();

  const recordEdge = (
    schemaA: string | undefined,
    tableA: string,
    colA: string,
    schemaB: string | undefined,
    tableB: string,
    colB: string
  ): void => {
    if (!tableA || !tableB || !colA || !colB) return;
    if (
      tableA.toLowerCase() === tableB.toLowerCase() &&
      (schemaA ?? '').toLowerCase() === (schemaB ?? '').toLowerCase() &&
      colA.toLowerCase() === colB.toLowerCase()
    ) {
      return;
    }

    // Canonical order so A=B and B=A merge cleanly
    const side1 = `${(schemaA ?? '').toLowerCase()}.${tableA.toLowerCase()}.${colA.toLowerCase()}`;
    const side2 = `${(schemaB ?? '').toLowerCase()}.${tableB.toLowerCase()}.${colB.toLowerCase()}`;
    const swap = side1 > side2;

    const key = swap ? `${side2}<->${side1}` : `${side1}<->${side2}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.frequency += 1;
      if (!existing.leftSchema && (swap ? schemaB : schemaA)) {
        existing.leftSchema = swap ? schemaB : schemaA;
      }
      if (!existing.rightSchema && (swap ? schemaA : schemaB)) {
        existing.rightSchema = swap ? schemaA : schemaB;
      }
      return;
    }

    edgeMap.set(
      key,
      swap
        ? {
            leftSchema: schemaB || undefined,
            leftTable: tableB,
            leftColumn: colB,
            rightSchema: schemaA || undefined,
            rightTable: tableA,
            rightColumn: colA,
            frequency: 1
          }
        : {
            leftSchema: schemaA || undefined,
            leftTable: tableA,
            leftColumn: colA,
            rightSchema: schemaB || undefined,
            rightTable: tableB,
            rightColumn: colB,
            frequency: 1
          }
    );
  };

  const parseSqlStatementJoins = (rawSql: string): void => {
    if (!/\bjoin\b/i.test(rawSql)) return;
    const cleanSql = rawSql.replace(/\{\{p\d+\}\}/g, '1');
    const refData = extractReferencedSqlTables(cleanSql);
    if (refData.refs.length < 2) return;

    const byIdent = new Map<string, { schema?: string; table: string }>();
    for (const r of refData.refs) {
      byIdent.set(r.tableLower, { schema: r.schema, table: r.table });
      if (r.aliasLower) {
        byIdent.set(r.aliasLower, { schema: r.schema, table: r.table });
      }
    }

    // Extract `ON ...` equality expressions (including `LEFT(a.col, 4) = LEFT(b.col, 4)` or `a.col = b.col`)
    const eqRegex =
      /`?([A-Za-z_][A-Za-z0-9_]*)`?\.`?([A-Za-z_][A-Za-z0-9_]*)`?(?:\s*,\s*\d+\s*\))?\s*=\s*(?:[A-Za-z_]+\s*\(\s*)?`?([A-Za-z_][A-Za-z0-9_]*)`?\.`?([A-Za-z_][A-Za-z0-9_]*)`?/g;

    for (const m of cleanSql.matchAll(eqRegex)) {
      const ref1 = byIdent.get(m[1].toLowerCase());
      const col1 = m[2];
      const ref2 = byIdent.get(m[3].toLowerCase());
      const col2 = m[4];
      if (ref1 && ref2 && (ref1.table.toLowerCase() !== ref2.table.toLowerCase() || m[1].toLowerCase() !== m[3].toLowerCase())) {
        recordEdge(ref1.schema, ref1.table, col1, ref2.schema, ref2.table, col2);
      }
    }
  };

  for (const src of sources) {
    if (!src || src.length === 0) continue;

    if (src.includes('<?')) {
      // 1. Embedded SQL strings in PHP
      const stmts = extractPhpEmbeddedSqlStatements(src);
      const coveredSpans: Array<{ start: number; end: number }> = [];
      for (const st of stmts) {
        parseSqlStatementJoins(st.sqlTemplate);
        for (const seg of st.segments) {
          coveredSpans.push({
            start: Math.max(0, seg.docStartOffset - 2),
            end: seg.docStartOffset + seg.text.length + 2
          });
        }
      }

      // Also catch inline string literals containing JOIN that might be built inside helper arrays (not already parsed above)
      for (const strMatch of src.matchAll(/['"]([^'"]{16,2500}\bjoin\b[^'"]{6,2500})['"]/gi)) {
        const mStart = strMatch.index ?? 0;
        const mEnd = mStart + strMatch[0].length;
        const alreadyParsed = coveredSpans.some(
          (sp) => mStart < sp.end && mEnd > sp.start
        );
        if (!alreadyParsed) {
          parseSqlStatementJoins(strMatch[1]);
        }
      }

      // 2. Laravel Query Builder `DB::table('sipegi.mst_pegawai as p')->leftJoin('sipegi.mst_unitkerja as u', 'u.kd_unitkerja', '=', 'p.kd_unitkerja')`
      const aliasToTable = new Map<string, { schema?: string; table: string }>();
      for (const tm of src.matchAll(
        /\b(?:DB::table|from)\s*\(\s*['"]([A-Za-z0-9_.]+)(?:\s+(?:as\s+)?([A-Za-z_][A-Za-z0-9_]*))?['"]\s*\)/gi
      )) {
        const rawTbl = tm[1];
        const dotIdx = rawTbl.indexOf('.');
        const schema = dotIdx > 0 ? rawTbl.slice(0, dotIdx) : undefined;
        const table = dotIdx > 0 ? rawTbl.slice(dotIdx + 1) : rawTbl;
        aliasToTable.set(table.toLowerCase(), { schema, table });
        if (tm[2]) {
          aliasToTable.set(tm[2].toLowerCase(), { schema, table });
        }
      }

      const lvJoinRegex =
        /->\s*(?:join|leftJoin|rightJoin)\s*\(\s*['"]([A-Za-z0-9_.]+)(?:\s+(?:as\s+)?([A-Za-z_][A-Za-z0-9_]*))?['"]\s*,\s*['"]([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)['"]\s*,\s*(?:['"]=['"]\s*,\s*)?['"]([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)['"]/g;
      for (const jm of src.matchAll(lvJoinRegex)) {
        const rawJoinTbl = jm[1];
        const dotIdx = rawJoinTbl.indexOf('.');
        const jSchema = dotIdx > 0 ? rawJoinTbl.slice(0, dotIdx) : undefined;
        const jTable = dotIdx > 0 ? rawJoinTbl.slice(dotIdx + 1) : rawJoinTbl;
        aliasToTable.set(jTable.toLowerCase(), { schema: jSchema, table: jTable });
        if (jm[2]) {
          aliasToTable.set(jm[2].toLowerCase(), { schema: jSchema, table: jTable });
        }

        const sideA = aliasToTable.get(jm[3].toLowerCase()) ?? { table: jm[3] };
        const sideB = aliasToTable.get(jm[5].toLowerCase()) ?? { table: jm[5] };
        recordEdge(sideA.schema, sideA.table, jm[4], sideB.schema, sideB.table, jm[6]);
      }
    } else {
      // Raw .sql text
      for (const chunk of src.split(';')) {
        parseSqlStatementJoins(chunk);
      }
    }
  }

  return Array.from(edgeMap.values()).sort((a, b) => b.frequency - a.frequency);
}

function isKeyLikeColumnName(colLower: string): boolean {
  return (
    colLower === 'nip' ||
    colLower === 'nik' ||
    colLower === 'nrk' ||
    colLower === 'npwp' ||
    colLower === 'kode' ||
    colLower.startsWith('kd_') ||
    colLower.startsWith('kode_') ||
    colLower.startsWith('id_') ||
    colLower.endsWith('_id') ||
    colLower.startsWith('no_')
  );
}

interface PairKeyCandidate {
  sourceCol: string;
  targetCol: string;
  reason: JoinCandidateSuggestion['reason'];
  reasonLabel: string;
  score: number;
}

function findBestColumnPairsBetweenTables(
  srcSchema: string | undefined,
  srcTableName: string,
  srcMeta: DbTableMeta | undefined,
  tgtSchema: string | undefined,
  tgtTableName: string,
  tgtMeta: DbTableMeta | undefined,
  learnedEdges: LearnedJoinEdge[]
): PairKeyCandidate[] {
  const results: PairKeyCandidate[] = [];
  const seenPair = new Set<string>();

  const pushPair = (cand: PairKeyCandidate): void => {
    const key = `${cand.sourceCol.toLowerCase()}=${cand.targetCol.toLowerCase()}`;
    const existingIdx = results.findIndex(
      (r) => `${r.sourceCol.toLowerCase()}=${r.targetCol.toLowerCase()}` === key
    );
    if (existingIdx >= 0) {
      if (cand.score > results[existingIdx].score) {
        results[existingIdx] = cand;
      }
      return;
    }
    seenPair.add(key);
    results.push(cand);
  };

  const srcLow = srcTableName.toLowerCase();
  const tgtLow = tgtTableName.toLowerCase();
  const srcSchLow = (srcSchema ?? '').toLowerCase();
  const tgtSchLow = (tgtSchema ?? '').toLowerCase();

  // 1. Learned edges from project PHP/SQL code
  for (const edge of learnedEdges) {
    const eLeftTbl = edge.leftTable.toLowerCase();
    const eRightTbl = edge.rightTable.toLowerCase();
    const eLeftSch = (edge.leftSchema ?? '').toLowerCase();
    const eRightSch = (edge.rightSchema ?? '').toLowerCase();

    const forwardMatch =
      eLeftTbl === srcLow &&
      eRightTbl === tgtLow &&
      (!eLeftSch || !srcSchLow || eLeftSch === srcSchLow) &&
      (!eRightSch || !tgtSchLow || eRightSch === tgtSchLow);

    if (forwardMatch) {
      pushPair({
        sourceCol: edge.leftColumn,
        targetCol: edge.rightColumn,
        reason: 'learned-code',
        reasonLabel: `Pola Kode Proyek (${edge.frequency}x)`,
        score: 115 + Math.min(edge.frequency * 4, 25)
      });
    }

    const reverseMatch =
      eRightTbl === srcLow &&
      eLeftTbl === tgtLow &&
      (!eRightSch || !srcSchLow || eRightSch === srcSchLow) &&
      (!eLeftSch || !tgtSchLow || eLeftSch === tgtSchLow);

    if (reverseMatch) {
      pushPair({
        sourceCol: edge.rightColumn,
        targetCol: edge.leftColumn,
        reason: 'learned-code',
        reasonLabel: `Pola Kode Proyek (${edge.frequency}x)`,
        score: 115 + Math.min(edge.frequency * 4, 25)
      });
    }
  }

  if (!srcMeta || !tgtMeta) {
    return results.sort((a, b) => b.score - a.score);
  }

  // 2. Explicit Foreign Keys (either direction)
  for (const fk of srcMeta.foreignKeys ?? ([] as DbForeignKeyMeta[])) {
    const fkRefSch = (fk.referencedSchema ?? srcSchema ?? '').toLowerCase();
    if (
      fk.referencedTable.toLowerCase() === tgtLow &&
      (!tgtSchLow || !fkRefSch || fkRefSch === tgtSchLow)
    ) {
      pushPair({
        sourceCol: fk.column,
        targetCol: fk.referencedColumn,
        reason: 'foreign-key',
        reasonLabel: 'Foreign Key Resmi',
        score: 98
      });
    }
  }

  for (const fk of tgtMeta.foreignKeys ?? ([] as DbForeignKeyMeta[])) {
    const fkRefSch = (fk.referencedSchema ?? tgtSchema ?? '').toLowerCase();
    if (
      fk.referencedTable.toLowerCase() === srcLow &&
      (!srcSchLow || !fkRefSch || fkRefSch === srcSchLow)
    ) {
      pushPair({
        sourceCol: fk.referencedColumn,
        targetCol: fk.column,
        reason: 'foreign-key',
        reasonLabel: 'Foreign Key Resmi',
        score: 98
      });
    }
  }

  const srcColsByLow = new Map(srcMeta.columns.map((c) => [c.name.toLowerCase(), c]));
  const tgtColsByLow = new Map(tgtMeta.columns.map((c) => [c.name.toLowerCase(), c]));

  // 3. Exact Column Name Match (PK / key-like `nip`, `kd_*`, `id_*`, `*_id`, or domain column)
  for (const [colLow, srcCol] of srcColsByLow.entries()) {
    const tgtCol = tgtColsByLow.get(colLow);
    if (!tgtCol) continue;

    if (GENERIC_NON_JOIN_COLUMNS.has(colLow)) {
      // Never suggest joining `users.id = posts.id` or `a.nama = b.nama`!
      continue;
    }

    const eitherPk = Boolean(srcCol.isPrimaryKey || tgtCol.isPrimaryKey);
    const keyLike = isKeyLikeColumnName(colLow);

    if (eitherPk || keyLike) {
      pushPair({
        sourceCol: srcCol.name,
        targetCol: tgtCol.name,
        reason: 'primary-key-match',
        reasonLabel: eitherPk ? `Kunci Utama (${srcCol.name})` : `Kolom Kunci (${srcCol.name})`,
        score: eitherPk ? 88 : 80
      });
    } else {
      pushPair({
        sourceCol: srcCol.name,
        targetCol: tgtCol.name,
        reason: 'column-name-match',
        reasonLabel: `Kolom Sama (${srcCol.name})`,
        score: 62
      });
    }
  }

  // 4. Laravel / Indonesian convention match: `pegawai_id = pegawais.id` or `id_pegawai = mst_pegawai.id`
  const srcCoreSing = singularizeSimple(stripTablePrefix(srcTableName));
  const tgtCoreSing = singularizeSimple(stripTablePrefix(tgtTableName));

  const checkEntityIdMatch = (
    fkTableCols: Map<string, DbTableMeta['columns'][number]>,
    pkTableCols: Map<string, DbTableMeta['columns'][number]>,
    entitySing: string,
    fkIsSource: boolean
  ): void => {
    if (!entitySing || entitySing.length < 2) return;
    const pkIdCol = pkTableCols.get('id');
    if (!pkIdCol) return;

    const fkCol =
      fkTableCols.get(`${entitySing}_id`) ?? fkTableCols.get(`id_${entitySing}`);
    if (!fkCol) return;

    pushPair({
      sourceCol: fkIsSource ? fkCol.name : pkIdCol.name,
      targetCol: fkIsSource ? pkIdCol.name : fkCol.name,
      reason: 'primary-key-match',
      reasonLabel: `Relasi Konvensi (${fkCol.name} → id)`,
      score: 84
    });
  };

  checkEntityIdMatch(srcColsByLow, tgtColsByLow, tgtCoreSing, true);
  checkEntityIdMatch(tgtColsByLow, srcColsByLow, srcCoreSing, false);

  return results.sort((a, b) => b.score - a.score);
}

function buildTableLookup(
  allTables: DbTableMeta[],
  activeDatabase?: string
): {
  resolveRef: (schema: string | undefined, tableName: string) => DbTableMeta | undefined;
} {
  const byFull = new Map<string, DbTableMeta>();
  const byName = new Map<string, DbTableMeta[]>();
  const activeLow = (activeDatabase ?? '').toLowerCase();

  for (const t of allTables) {
    const sLow = (t.schema ?? '').toLowerCase();
    const tLow = t.name.toLowerCase();
    byFull.set(`${sLow}.${tLow}`, t);
    const arr = byName.get(tLow) ?? [];
    arr.push(t);
    byName.set(tLow, arr);
  }

  return {
    resolveRef(schema, tableName) {
      const tLow = tableName.toLowerCase();
      if (schema) {
        const exact = byFull.get(`${schema.toLowerCase()}.${tLow}`);
        if (exact) return exact;
      }
      if (activeLow) {
        const inActive = byFull.get(`${activeLow}.${tLow}`);
        if (inActive) return inActive;
      }
      return byName.get(tLow)?.[0];
    }
  };
}

/**
 * Feature #1a & #2: Suggests complete `table alias ON alias.col = src.col` candidates
 * right after `JOIN ` / `LEFT JOIN ` / `INNER JOIN ` or inside the Visual JOIN Builder!
 */
export function suggestJoinCandidatesForQuery(params: {
  existingRefs: SqlTableReference[];
  allTables: DbTableMeta[];
  activeDatabase?: string;
  learnedEdges?: LearnedJoinEdge[];
  maxResults?: number;
}): JoinCandidateSuggestion[] {
  const {
    existingRefs,
    allTables,
    activeDatabase,
    learnedEdges = [],
    maxResults = 24
  } = params;

  if (existingRefs.length === 0) return [];

  const { resolveRef } = buildTableLookup(allTables, activeDatabase);
  const usedAliases = new Set<string>();
  const alreadyJoinedKeys = new Set<string>();

  for (const r of existingRefs) {
    usedAliases.add(r.tableLower);
    if (r.aliasLower) usedAliases.add(r.aliasLower);
    const resolved = resolveRef(r.schema, r.table);
    const schLow = (r.schema ?? resolved?.schema ?? activeDatabase ?? '').toLowerCase();
    alreadyJoinedKeys.add(`${schLow}.${r.tableLower}`);
  }

  // Synthesize virtual tables from `learnedEdges` if a table isn't in `allTables` (e.g. offline mode)
  const candidateTables: DbTableMeta[] = [...allTables];
  const knownKeys = new Set(
    allTables.map((t) => `${(t.schema ?? '').toLowerCase()}.${t.name.toLowerCase()}`)
  );
  for (const edge of learnedEdges) {
    const k1 = `${(edge.leftSchema ?? '').toLowerCase()}.${edge.leftTable.toLowerCase()}`;
    if (!knownKeys.has(k1)) {
      knownKeys.add(k1);
      candidateTables.push({
        schema: edge.leftSchema,
        name: edge.leftTable,
        kind: 'table',
        primaryKeys: [],
        columns: []
      });
    }
    const k2 = `${(edge.rightSchema ?? '').toLowerCase()}.${edge.rightTable.toLowerCase()}`;
    if (!knownKeys.has(k2)) {
      knownKeys.add(k2);
      candidateTables.push({
        schema: edge.rightSchema,
        name: edge.rightTable,
        kind: 'table',
        primaryKeys: [],
        columns: []
      });
    }
  }

  const suggestions: JoinCandidateSuggestion[] = [];

  for (const tgt of candidateTables) {
    const tgtSchLow = (tgt.schema ?? activeDatabase ?? '').toLowerCase();
    const tgtKey = `${tgtSchLow}.${tgt.name.toLowerCase()}`;
    const isSelfJoin = alreadyJoinedKeys.has(tgtKey);
    if (isSelfJoin) continue; // Keep top join suggestions crisp and non-redundant

    const suggestedAlias = suggestUniqueTableAlias(tgt.name, usedAliases);
    const qualifiedTarget = formatQualifiedTableForQuery(
      tgt.schema,
      tgt.name,
      activeDatabase
    );

    for (const srcRef of existingRefs) {
      const srcMeta = resolveRef(srcRef.schema, srcRef.table);
      const srcSchema = srcRef.schema ?? srcMeta?.schema;
      const srcIdent = srcRef.alias ?? srcRef.table;

      const pairs = findBestColumnPairsBetweenTables(
        srcSchema,
        srcRef.table,
        srcMeta,
        tgt.schema,
        tgt.name,
        tgt,
        learnedEdges
      );

      // Boost slightly when target table is in the same schema as activeDatabase or source table
      const sameSchemaBonus =
        tgtSchLow &&
        (tgtSchLow === (activeDatabase ?? '').toLowerCase() ||
          tgtSchLow === (srcSchema ?? '').toLowerCase())
          ? 3
          : 0;

      for (const p of pairs.slice(0, 2)) {
        const onExpression = `${suggestedAlias}.${p.targetCol} = ${srcIdent}.${p.sourceCol}`;
        suggestions.push({
          targetSchema: tgt.schema,
          targetTable: tgt.name,
          suggestedAlias,
          sourceAliasOrTable: srcIdent,
          sourceTable: srcRef.table,
          sourceColumn: p.sourceCol,
          targetColumn: p.targetCol,
          onExpression,
          fullJoinTail: `${qualifiedTarget} ${suggestedAlias} ON ${onExpression}`,
          reason: p.reason,
          reasonLabel: p.reasonLabel,
          score: p.score + sameSchemaBonus
        });
      }
    }
  }

  suggestions.sort(
    (a, b) =>
      b.score - a.score || a.targetTable.localeCompare(b.targetTable)
  );

  return suggestions.slice(0, maxResults);
}

/**
 * Feature #1b: Suggests exact `ON u.kd_unitkerja = p.kd_unitkerja` expressions
 * when the user has already typed `LEFT JOIN sipegi.mst_unitkerja u ON `!
 */
export function suggestOnConditionsForLastJoin(params: {
  existingRefs: SqlTableReference[];
  allTables: DbTableMeta[];
  activeDatabase?: string;
  learnedEdges?: LearnedJoinEdge[];
}): JoinCandidateSuggestion[] {
  const { existingRefs, allTables, activeDatabase, learnedEdges = [] } = params;
  if (existingRefs.length < 2) return [];

  const lastRef = existingRefs[existingRefs.length - 1];
  const priorRefs = existingRefs.slice(0, -1);
  const { resolveRef } = buildTableLookup(allTables, activeDatabase);

  const tgtMeta = resolveRef(lastRef.schema, lastRef.table);
  const tgtSchema = lastRef.schema ?? tgtMeta?.schema;
  const tgtIdent = lastRef.alias ?? formatQualifiedTableForQuery(tgtSchema, lastRef.table, activeDatabase);
  const qualifiedTarget = formatQualifiedTableForQuery(tgtSchema, lastRef.table, activeDatabase);

  const out: JoinCandidateSuggestion[] = [];

  for (const srcRef of priorRefs) {
    const srcMeta = resolveRef(srcRef.schema, srcRef.table);
    const srcSchema = srcRef.schema ?? srcMeta?.schema;
    const srcIdent = srcRef.alias ?? formatQualifiedTableForQuery(srcSchema, srcRef.table, activeDatabase);

    const pairs = findBestColumnPairsBetweenTables(
      srcSchema,
      srcRef.table,
      srcMeta,
      tgtSchema,
      lastRef.table,
      tgtMeta,
      learnedEdges
    );

    for (const p of pairs) {
      const onExpression = `${tgtIdent}.${p.targetCol} = ${srcIdent}.${p.sourceCol}`;
      out.push({
        targetSchema: tgtSchema,
        targetTable: lastRef.table,
        suggestedAlias: lastRef.alias ?? lastRef.table,
        sourceAliasOrTable: srcIdent,
        sourceTable: srcRef.table,
        sourceColumn: p.sourceCol,
        targetColumn: p.targetCol,
        onExpression,
        fullJoinTail: `${qualifiedTarget} ${tgtIdent} ON ${onExpression}`,
        reason: p.reason,
        reasonLabel: p.reasonLabel,
        score: p.score
      });
    }
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}

function formatWhereScalarValue(rawVal: string): string {
  const v = rawVal.trim();
  if (!v) return "''";
  if (/^-?\d+(?:\.\d+)?$/.test(v)) return v;
  if (/^(?:NULL|TRUE|FALSE|NOW\(\)|CURDATE\(\)|CURRENT_TIMESTAMP)$/i.test(v)) return v.toUpperCase();
  if (/^'.*'$/.test(v)) return v;
  // Column reference `u.kd_unitkerja` (not email/filename)
  if (/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(v)) return v;
  // PHP variable `$nip` or `$_POST['nip']` -> wrap in single quotes so PHP double-quoted SQL interpolates naturally
  if (v.startsWith('$')) return `'${v}'`;
  return `'${v.replace(/'/g, "''")}'`;
}

export function compileWhereRulesToSql(
  rules: VisualWhereRule[] = [],
  manualWhereClause?: string
): string {
  const parts: string[] = [];

  for (const r of rules) {
    if (r.enabled === false) continue;
    const col = r.columnRef.trim();
    if (!col) continue;

    let expr = '';
    const val = r.value.trim();

    switch (r.operator) {
      case 'IS_NULL':
        expr = `${col} IS NULL`;
        break;
      case 'IS_NOT_NULL':
        expr = `${col} IS NOT NULL`;
        break;
      case 'LIKE_CONTAINS': {
        const clean = val.replace(/^['"]|['"]$/g, '').replace(/'/g, "''");
        expr = `${col} LIKE '%${clean}%'`;
        break;
      }
      case 'LIKE_PREFIX': {
        const clean = val.replace(/^['"]|['"]$/g, '').replace(/'/g, "''");
        expr = `${col} LIKE '${clean}%'`;
        break;
      }
      case 'NOT_LIKE': {
        const clean = val.replace(/^['"]|['"]$/g, '').replace(/'/g, "''");
        expr = `${col} NOT LIKE '%${clean}%'`;
        break;
      }
      case 'IN':
      case 'NOT_IN': {
        const inner = val.replace(/^\(|\)$/g, '').trim();
        const items = inner
          ? inner
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .map((item) => formatWhereScalarValue(item))
              .join(', ')
          : "''";
        expr = `${col} ${r.operator === 'NOT_IN' ? 'NOT IN' : 'IN'} (${items})`;
        break;
      }
      case 'RAW':
        expr = val ? `${col} ${val}` : '';
        break;
      default:
        expr = `${col} ${r.operator} ${formatWhereScalarValue(val)}`;
        break;
    }

    if (!expr) continue;
    if (parts.length === 0) {
      parts.push(expr);
    } else {
      parts.push(`${r.conjunction === 'OR' ? 'OR' : 'AND'} ${expr}`);
    }
  }

  const manual = (manualWhereClause ?? '').trim().replace(/^where\s+/i, '');
  if (manual) {
    if (parts.length === 0) {
      parts.push(manual);
    } else {
      parts.push(`AND (${manual})`);
    }
  }

  return parts.join(' ');
}

export function inferSmartJoinBetweenTables(params: {
  existingTables: Array<{ schema?: string; name: string; alias: string }>;
  targetTable: { schema?: string; name: string };
  allTables: DbTableMeta[];
  activeDatabase?: string;
  learnedEdges?: LearnedJoinEdge[];
}): {
  sourceAlias: string;
  sourceColumn: string;
  targetColumn: string;
  reasonLabel: string;
} | null {
  const {
    existingTables,
    targetTable,
    allTables,
    activeDatabase,
    learnedEdges = []
  } = params;
  if (existingTables.length === 0) return null;

  const { resolveRef } = buildTableLookup(allTables, activeDatabase);
  const tgtMeta = resolveRef(targetTable.schema, targetTable.name);

  let best: {
    sourceAlias: string;
    sourceColumn: string;
    targetColumn: string;
    reasonLabel: string;
    score: number;
  } | null = null;

  for (const src of existingTables) {
    const srcMeta = resolveRef(src.schema, src.name);
    const pairs = findBestColumnPairsBetweenTables(
      src.schema,
      src.name,
      srcMeta,
      targetTable.schema,
      targetTable.name,
      tgtMeta,
      learnedEdges
    );
    if (pairs.length > 0 && (!best || pairs[0].score > best.score)) {
      best = {
        sourceAlias: src.alias,
        sourceColumn: pairs[0].sourceCol,
        targetColumn: pairs[0].targetCol,
        reasonLabel: pairs[0].reasonLabel,
        score: pairs[0].score
      };
    }
  }

  return best
    ? {
        sourceAlias: best.sourceAlias,
        sourceColumn: best.sourceColumn,
        targetColumn: best.targetColumn,
        reasonLabel: best.reasonLabel
      }
    : null;
}

/**
 * Feature #2: Builds clean SQL, Classic PHP, Wisanggeni PHP, and Laravel Query Builder code
 * from a Visual JOIN specification (including Navicat-style aggregates, WHERE criteria, GROUP BY, ORDER BY, & composite ON)!
 */
export function buildJoinQueryOutputs(
  spec: VisualJoinQuerySpec,
  allTables: DbTableMeta[] = []
): GeneratedJoinQueryOutputs {
  const autoAlias = spec.autoAliasCollisions ?? true;
  const { resolveRef } = buildTableLookup(allTables, spec.activeDatabase);

  const aliasToTableName = new Map<string, string>();
  aliasToTableName.set(spec.baseAlias, spec.baseTable);
  for (const j of spec.joins) {
    aliasToTableName.set(j.alias, j.targetTable);
  }

  const effectiveCols = [...spec.selectedColumns];

  // If no columns explicitly checked yet, pick up to 5 columns per table from schema (or fallback `alias.*`)
  if (effectiveCols.length === 0) {
    const baseMeta = resolveRef(spec.baseSchema, spec.baseTable);
    if (baseMeta && baseMeta.columns.length > 0) {
      for (const c of baseMeta.columns.slice(0, 6)) {
        effectiveCols.push({ tableAlias: spec.baseAlias, columnName: c.name });
      }
      for (const j of spec.joins) {
        const jMeta = resolveRef(j.targetSchema, j.targetTable);
        if (jMeta && jMeta.columns.length > 0) {
          const nonKeyCols = jMeta.columns.filter(
            (c) => c.name.toLowerCase() !== j.rightColumn.toLowerCase()
          );
          for (const c of (nonKeyCols.length > 0 ? nonKeyCols : jMeta.columns).slice(0, 4)) {
            effectiveCols.push({ tableAlias: j.alias, columnName: c.name });
          }
        }
      }
    }
  }

  // Detect colliding column names across plain selected columns (e.g. `p.nama` + `u.nama`)
  const colNameCounts = new Map<string, number>();
  for (const c of effectiveCols) {
    if (!c.outputAlias && !c.aggregate && c.columnName !== '*') {
      const k = c.columnName.toLowerCase();
      colNameCounts.set(k, (colNameCounts.get(k) ?? 0) + 1);
    }
  }

  const seenBareName = new Set<string>();
  const selectExpressions: string[] = [];
  const laravelSelectArgs: string[] = [];
  let samplePhpFieldKey = 'id';
  let hasSamplePhpKey = false;

  if (effectiveCols.length === 0) {
    selectExpressions.push(`${spec.baseAlias}.*`);
    laravelSelectArgs.push(`'${spec.baseAlias}.*'`);
    for (const j of spec.joins) {
      selectExpressions.push(`${j.alias}.*`);
      laravelSelectArgs.push(`'${j.alias}.*'`);
    }
  } else {
    for (const col of effectiveCols) {
      const agg = col.aggregate || '';

      if (col.columnName === '*' && !agg) {
        selectExpressions.push(`${col.tableAlias}.*`);
        laravelSelectArgs.push(`'${col.tableAlias}.*'`);
        continue;
      }

      if (agg) {
        const innerRef =
          col.columnName === '*'
            ? '*'
            : `${col.tableAlias}.${col.columnName}`;
        const rawAggExpr =
          agg === 'COUNT_DISTINCT'
            ? `COUNT(DISTINCT ${innerRef === '*' ? `${col.tableAlias}.id` : innerRef})`
            : `${agg}(${innerRef})`;
        const defaultAggAlias =
          agg === 'COUNT' || agg === 'COUNT_DISTINCT'
            ? `jml_${col.columnName === '*' ? 'baris' : col.columnName}`
            : `${agg.toLowerCase()}_${col.columnName === '*' ? 'data' : col.columnName}`;
        const finalAggAlias = (col.outputAlias?.trim() || defaultAggAlias).replace(/\s+/g, '_');

        selectExpressions.push(`${rawAggExpr} AS ${finalAggAlias}`);
        laravelSelectArgs.push(`DB::raw('${rawAggExpr} AS ${finalAggAlias}')`);
        if (!hasSamplePhpKey) {
          samplePhpFieldKey = finalAggAlias;
          hasSamplePhpKey = true;
        }
        continue;
      }

      const colLow = col.columnName.toLowerCase();
      let finalAlias = col.outputAlias?.trim() || '';

      if (!finalAlias && autoAlias && (colNameCounts.get(colLow) ?? 0) > 1) {
        if (!seenBareName.has(colLow) && col.tableAlias === spec.baseAlias) {
          seenBareName.add(colLow);
        } else {
          const ownerTbl = aliasToTableName.get(col.tableAlias) ?? col.tableAlias;
          const shortOwner = stripTablePrefix(ownerTbl).toLowerCase() || col.tableAlias;
          finalAlias = `${shortOwner}_${col.columnName}`;
        }
      } else {
        seenBareName.add(colLow);
      }

      if (finalAlias && finalAlias.toLowerCase() !== colLow) {
        selectExpressions.push(`${col.tableAlias}.${col.columnName} AS ${finalAlias}`);
        laravelSelectArgs.push(`'${col.tableAlias}.${col.columnName} as ${finalAlias}'`);
        if (!hasSamplePhpKey) {
          samplePhpFieldKey = finalAlias;
          hasSamplePhpKey = true;
        }
      } else {
        selectExpressions.push(`${col.tableAlias}.${col.columnName}`);
        laravelSelectArgs.push(`'${col.tableAlias}.${col.columnName}'`);
        if (!hasSamplePhpKey) {
          samplePhpFieldKey = col.columnName;
          hasSamplePhpKey = true;
        }
      }
    }
  }

  const baseTableFormatted = formatQualifiedTableForQuery(
    spec.baseSchema,
    spec.baseTable,
    spec.activeDatabase
  );

  const selectHeader = spec.distinct ? 'SELECT DISTINCT' : 'SELECT';
  const sqlLines: string[] = [
    selectHeader,
    `  ${selectExpressions.join(',\n  ')}`,
    `FROM ${baseTableFormatted} ${spec.baseAlias}`
  ];

  for (const j of spec.joins) {
    const jTableFormatted = formatQualifiedTableForQuery(
      j.targetSchema,
      j.targetTable,
      spec.activeDatabase
    );
    const primaryOp = j.operator || '=';
    const leftExpr = j.leftRef.includes('.') ? j.leftRef : `${spec.baseAlias}.${j.leftRef}`;
    const onParts = [`${j.alias}.${j.rightColumn} ${primaryOp} ${leftExpr}`];
    for (const ex of j.extraConditions ?? []) {
      const exLeft = ex.leftRef.includes('.') ? ex.leftRef : `${spec.baseAlias}.${ex.leftRef}`;
      onParts.push(`${j.alias}.${ex.rightColumn} ${ex.operator || '='} ${exLeft}`);
    }
    sqlLines.push(`${j.joinType} ${jTableFormatted} ${j.alias} ON ${onParts.join(' AND ')}`);
  }

  const cleanWhere = compileWhereRulesToSql(spec.whereRules, spec.whereClause);
  if (cleanWhere) {
    sqlLines.push(`WHERE ${cleanWhere}`);
  }

  const groupCols = (spec.groupByColumns ?? []).map((g) => g.trim()).filter(Boolean);
  if (groupCols.length > 0) {
    sqlLines.push(`GROUP BY ${groupCols.join(', ')}`);
  }

  const cleanHaving = (spec.havingClause ?? '').trim().replace(/^having\s+/i, '');
  if (cleanHaving) {
    sqlLines.push(`HAVING ${cleanHaving}`);
  }

  const orderParts: string[] = [];
  for (const r of spec.orderByRules ?? []) {
    if (r.columnRef.trim()) {
      orderParts.push(`${r.columnRef.trim()} ${r.direction}`);
    }
  }
  const manualOrder = (spec.orderByClause ?? '').trim().replace(/^order\s+by\s+/i, '');
  if (manualOrder) {
    orderParts.push(manualOrder);
  }
  const cleanOrder = orderParts.join(', ');
  if (cleanOrder) {
    sqlLines.push(`ORDER BY ${cleanOrder}`);
  }

  if (spec.limit && spec.limit > 0) {
    sqlLines.push(
      spec.offset && spec.offset > 0
        ? `LIMIT ${spec.limit} OFFSET ${spec.offset}`
        : `LIMIT ${spec.limit}`
    );
  }

  const rawSql = `${sqlLines.join('\n')};`;
  const sqlNoSemi = sqlLines.join('\n');
  const escapedPhpSql = sqlNoSemi.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const phpMysql = [
    `$sql = "${escapedPhpSql}";`,
    `$res = mysqli_query($conn, $sql);`,
    `while ($row = mysqli_fetch_assoc($res)) {`,
    `  // Contoh akses field: $row['${samplePhpFieldKey}']`,
    `}`
  ].join('\n');

  const phpWisanggeni = [
    `$sql = "${escapedPhpSql}";`,
    `$q_data = $query->dosql($sql);`,
    `while ($row = mysql_fetch_array($q_data)) {`,
    `  // Contoh akses field: $row['${samplePhpFieldKey}']`,
    `}`
  ].join('\n');

  // Laravel Query Builder
  const lvLines: string[] = [
    `$rows = DB::table('${baseTableFormatted} as ${spec.baseAlias}')`
  ];
  if (spec.distinct) {
    lvLines.push(`    ->distinct()`);
  }
  for (const j of spec.joins) {
    const jTableFormatted = formatQualifiedTableForQuery(
      j.targetSchema,
      j.targetTable,
      spec.activeDatabase
    );
    const method =
      j.joinType === 'LEFT JOIN'
        ? 'leftJoin'
        : j.joinType === 'RIGHT JOIN'
          ? 'rightJoin'
          : 'join';
    const primaryOp = j.operator || '=';
    const leftExpr = j.leftRef.includes('.') ? j.leftRef : `${spec.baseAlias}.${j.leftRef}`;
    const extras = j.extraConditions ?? [];
    if (extras.length === 0) {
      lvLines.push(
        `    ->${method}('${jTableFormatted} as ${j.alias}', '${j.alias}.${j.rightColumn}', '${primaryOp}', '${leftExpr}')`
      );
    } else {
      const closureOns = [
        `$join->on('${j.alias}.${j.rightColumn}', '${primaryOp}', '${leftExpr}')`,
        ...extras.map((ex) => {
          const exLeft = ex.leftRef.includes('.') ? ex.leftRef : `${spec.baseAlias}.${ex.leftRef}`;
          return `->on('${j.alias}.${ex.rightColumn}', '${ex.operator || '='}', '${exLeft}')`;
        })
      ].join('');
      lvLines.push(
        `    ->${method}('${jTableFormatted} as ${j.alias}', function ($join) { ${closureOns}; })`
      );
    }
  }
  lvLines.push(`    ->select([${laravelSelectArgs.join(', ')}])`);
  if (cleanWhere) {
    lvLines.push(`    ->whereRaw(${JSON.stringify(cleanWhere)})`);
  }
  if (groupCols.length > 0) {
    lvLines.push(`    ->groupBy(${groupCols.map((g) => `'${g}'`).join(', ')})`);
  }
  if (cleanHaving) {
    lvLines.push(`    ->havingRaw(${JSON.stringify(cleanHaving)})`);
  }
  if (cleanOrder) {
    lvLines.push(`    ->orderByRaw(${JSON.stringify(cleanOrder)})`);
  }
  if (spec.limit && spec.limit > 0) {
    lvLines.push(`    ->limit(${spec.limit})`);
    if (spec.offset && spec.offset > 0) {
      lvLines.push(`    ->offset(${spec.offset})`);
    }
  }
  lvLines.push(`    ->get();`);

  return {
    sql: rawSql,
    phpMysql,
    phpWisanggeni,
    laravelQueryBuilder: lvLines.join('\n')
  };
}

/**
 * Feature #4: Given 2..N tables clicked in the ER Diagram, automatically chains them
 * in optimal relationship order and populates `LEFT JOIN ... ON ...` keys!
 */
export function buildJoinSpecFromSelectedTables(
  selectedTables: Array<{ schema?: string; name: string }>,
  allTables: DbTableMeta[],
  activeDatabase?: string,
  learnedEdges: LearnedJoinEdge[] = []
): VisualJoinQuerySpec {
  if (selectedTables.length === 0) {
    return {
      baseTable: 'nama_tabel',
      baseAlias: 't',
      joins: [],
      selectedColumns: [],
      autoAliasCollisions: true,
      limit: 100,
      activeDatabase
    };
  }

  const { resolveRef } = buildTableLookup(allTables, activeDatabase);
  const usedAliases = new Set<string>();

  const first = selectedTables[0];
  const baseAlias = suggestUniqueTableAlias(first.name, usedAliases);
  usedAliases.add(baseAlias);

  const placed: Array<{ schema?: string; name: string; alias: string }> = [
    { schema: first.schema, name: first.name, alias: baseAlias }
  ];
  const remaining = selectedTables.slice(1);
  const joins: VisualJoinStep[] = [];

  let stepIdx = 1;
  while (remaining.length > 0) {
    let bestRemIdx = 0;
    let bestPair: {
      srcAlias: string;
      sourceCol: string;
      targetCol: string;
      score: number;
    } | null = null;

    for (let rIdx = 0; rIdx < remaining.length; rIdx++) {
      const candTbl = remaining[rIdx];
      const candMeta = resolveRef(candTbl.schema, candTbl.name);

      for (const src of placed) {
        const srcMeta = resolveRef(src.schema, src.name);
        const pairs = findBestColumnPairsBetweenTables(
          src.schema,
          src.name,
          srcMeta,
          candTbl.schema,
          candTbl.name,
          candMeta,
          learnedEdges
        );
        if (pairs.length > 0 && (!bestPair || pairs[0].score > bestPair.score)) {
          bestRemIdx = rIdx;
          bestPair = {
            srcAlias: src.alias,
            sourceCol: pairs[0].sourceCol,
            targetCol: pairs[0].targetCol,
            score: pairs[0].score
          };
        }
      }
    }

    const chosen = remaining.splice(bestRemIdx, 1)[0];
    const chosenAlias = suggestUniqueTableAlias(chosen.name, usedAliases);
    usedAliases.add(chosenAlias);

    const chosenMeta = resolveRef(chosen.schema, chosen.name);
    const baseMeta = resolveRef(placed[0].schema, placed[0].name);
    const fallbackLeftCol = baseMeta?.primaryKeys[0] ?? baseMeta?.columns[0]?.name ?? 'id';
    const fallbackRightCol = chosenMeta?.primaryKeys[0] ?? chosenMeta?.columns[0]?.name ?? 'id';

    joins.push({
      id: `join-${stepIdx++}`,
      joinType: 'LEFT JOIN',
      targetSchema: chosen.schema,
      targetTable: chosen.name,
      alias: chosenAlias,
      leftRef: bestPair
        ? `${bestPair.srcAlias}.${bestPair.sourceCol}`
        : `${placed[0].alias}.${fallbackLeftCol}`,
      rightColumn: bestPair ? bestPair.targetCol : fallbackRightCol
    });

    placed.push({ schema: chosen.schema, name: chosen.name, alias: chosenAlias });
  }

  return {
    baseSchema: first.schema,
    baseTable: first.name,
    baseAlias,
    joins,
    selectedColumns: [],
    autoAliasCollisions: true,
    limit: 100,
    activeDatabase
  };
}

function maskSqlPreservingOffsets(sql: string): string {
  const chars = sql.split('');
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1] ?? '';

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
      } else {
        chars[i] = ' ';
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        inBlockComment = false;
        i++;
      } else if (ch !== '\n') {
        chars[i] = ' ';
      }
      continue;
    }

    if (inSingle) {
      if (ch === '\\' && i + 1 < chars.length) {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        i++;
        continue;
      }
      if (ch === "'" && next === "'") {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        i++;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
      }
      if (ch !== '\n') chars[i] = ' ';
      continue;
    }

    if (inDouble) {
      if (ch === '\\' && i + 1 < chars.length) {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        i++;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      }
      if (ch !== '\n') chars[i] = ' ';
      continue;
    }

    if (ch === '-' && next === '-') {
      inLineComment = true;
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i++;
      continue;
    }
    if (ch === '#') {
      inLineComment = true;
      chars[i] = ' ';
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      chars[i] = ' ';
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      chars[i] = ' ';
      continue;
    }
  }

  // Also blank out `{{p0}}` template placeholders from PHP SQL extractor while keeping exact offsets
  return chars.join('').replace(/\{\{p\d+\}\}/g, (m) => '1'.padEnd(m.length, ' '));
}

/**
 * Feature #5: Detects unqualified column names in multi-table JOIN queries
 * that exist in 2+ joined tables (`Column 'nama' in field list is ambiguous`)
 * and returns 1-click `Ctrl+.` Quick Fixes (`p.nama` vs `u.nama`)!
 */
export function detectAmbiguousJoinColumns(
  sql: string,
  allTables: DbTableMeta[],
  activeDatabase?: string
): AmbiguousColumnDiagnostic[] {
  if (!sql || allTables.length === 0) return [];

  const maskedFull = maskSqlPreservingOffsets(sql);
  const { resolveRef } = buildTableLookup(allTables, activeDatabase);
  const diagnostics: AmbiguousColumnDiagnostic[] = [];

  // Split statements by `;` while tracking exact start offset
  let stmtStart = 0;
  const segments: Array<{ start: number; text: string }> = [];
  for (let i = 0; i <= maskedFull.length; i++) {
    if (i === maskedFull.length || maskedFull[i] === ';') {
      const slice = maskedFull.slice(stmtStart, i);
      if (slice.trim().length > 0) {
        segments.push({ start: stmtStart, text: slice });
      }
      stmtStart = i + 1;
    }
  }

  for (const seg of segments) {
    const refResult = extractReferencedSqlTables(seg.text);
    if (refResult.refs.length < 2) continue;

    // Build column -> owners map across the joined tables in this statement
    const colOwners = new Map<
      string,
      Array<{ aliasOrTable: string; tableName: string }>
    >();

    let resolvedTableCount = 0;
    for (const ref of refResult.refs) {
      const meta = resolveRef(ref.schema, ref.table);
      if (!meta) continue;
      resolvedTableCount++;
      const aliasOrTable = ref.alias ?? ref.table;
      const fullLabel = meta.schema ? `${meta.schema}.${meta.name}` : meta.name;

      for (const col of meta.columns) {
        const cLow = col.name.toLowerCase();
        const list = colOwners.get(cLow) ?? [];
        if (!list.some((item) => item.aliasOrTable.toLowerCase() === aliasOrTable.toLowerCase())) {
          list.push({ aliasOrTable, tableName: fullLabel });
        }
        colOwners.set(cLow, list);
      }
    }

    if (resolvedTableCount < 2) continue;

    const ambiguousCols = new Map<
      string,
      Array<{ aliasOrTable: string; tableName: string }>
    >();
    for (const [colLow, owners] of colOwners.entries()) {
      if (owners.length >= 2) {
        ambiguousCols.set(colLow, owners);
      }
    }
    if (ambiguousCols.size === 0) continue;

    // Collect explicit `AS <alias>` names defined in SELECT so `ORDER BY <alias>` isn't falsely flagged
    const selectDefinedAliases = new Set<string>();
    for (const am of seg.text.matchAll(/\bas\s+`?([A-Za-z_][A-Za-z0-9_]*)`?/gi)) {
      if (am[1]) selectDefinedAliases.add(am[1].toLowerCase());
    }

    // Blank out FROM/JOIN table declaration headers and `USING (...)` column lists so they aren't scanned as expressions
    const scanTextChars = seg.text.split('');
    const blankSpan = (s: number, e: number): void => {
      for (let k = s; k < e && k < scanTextChars.length; k++) {
        if (scanTextChars[k] !== '\n') scanTextChars[k] = ' ';
      }
    };

    const tableDeclRegex =
      /\b(?:from|join|update|into)\s+`?[A-Za-z_][A-Za-z0-9_]*`?(?:\s*\.\s*`?[A-Za-z_][A-Za-z0-9_]*`?)?(?:\s+(?:as\s+)?(?!(?:where|on|using|left|right|inner|outer|cross|join|set|group|order|having|limit|union)\b)`?[A-Za-z_][A-Za-z0-9_]*`?)?/gi;
    for (const tm of seg.text.matchAll(tableDeclRegex)) {
      if (tm.index !== undefined) {
        blankSpan(tm.index, tm.index + tm[0].length);
      }
    }

    for (const um of seg.text.matchAll(/\busing\s*\([^)]*\)/gi)) {
      if (um.index !== undefined) {
        blankSpan(um.index, um.index + um[0].length);
      }
    }

    const scanText = scanTextChars.join('');
    const orderOrGroupMatch = scanText.match(/\b(?:group\s+by|order\s+by)\b/i);
    const orderOrGroupStart = orderOrGroupMatch?.index ?? Infinity;

    const identRegex = /`?([A-Za-z_][A-Za-z0-9_]*)`?/g;
    for (const im of scanText.matchAll(identRegex)) {
      const tokenFull = im[0];
      const ident = im[1];
      const identLow = ident.toLowerCase();
      const relStart = im.index ?? 0;
      const relEnd = relStart + tokenFull.length;

      if (SQL_NON_COLUMN_KEYWORDS.has(identLow)) continue;
      const owners = ambiguousCols.get(identLow);
      if (!owners) continue;

      // Check preceding non-whitespace character
      const beforeTrimmed = scanText.slice(0, relStart).trimEnd();
      if (beforeTrimmed.endsWith('.')) {
        // Already qualified (`p.nama`)
        continue;
      }

      // Check preceding word (skip if `AS <ident>` or implicit alias right after another identifier/literal)
      const prevWordMatch = beforeTrimmed.match(/([A-Za-z_][A-Za-z0-9_]*|`[^`]+`|\))$/);
      if (prevWordMatch) {
        const prevWord = prevWordMatch[1].replace(/`/g, '').toLowerCase();
        if (prevWord === 'as') continue;
        // If previous token is `)` or a non-keyword identifier, `<ident>` is an implicit output alias (`SELECT p.nama nama`)!
        if (prevWord === ')' || !SQL_NON_COLUMN_KEYWORDS.has(prevWord)) {
          continue;
        }
      }

      // Check following non-whitespace character
      const afterTrimmed = scanText.slice(relEnd).trimStart();
      if (afterTrimmed.startsWith('.') || afterTrimmed.startsWith('(')) {
        // Table prefix (`nama.col`) or SQL function (`LEFT(...)`)
        continue;
      }

      // Allow `ORDER BY <alias>` / `GROUP BY <alias>` if explicitly aliased in SELECT (`SELECT p.nama AS nama ... ORDER BY nama`)
      if (relStart > orderOrGroupStart && selectDefinedAliases.has(identLow)) {
        continue;
      }

      const ownerSummary = owners
        .map((o) => `${o.aliasOrTable} (${o.tableName})`)
        .join(', ');

      diagnostics.push({
        column: ident,
        sqlStartOffset: seg.start + relStart,
        sqlEndOffset: seg.start + relEnd,
        candidateTables: owners,
        message: `Kolom "${ident}" ambigu karena ada di beberapa tabel JOIN: ${ownerSummary}. Gunakan prefix alias tabel.`,
        quickFixes: owners.map((o) => ({
          title: `Gunakan '${o.aliasOrTable}.${ident}' (dari ${o.tableName})`,
          replacement: `${o.aliasOrTable}.${ident}`
        }))
      });
    }
  }

  return diagnostics;
}

export function detectAmbiguousJoinDiagnosticsInSource(
  source: string,
  lang: 'php' | 'sql',
  allTables: DbTableMeta[],
  activeDatabase?: string
): SqlSchemaDiagnostic[] {
  if (!source || allTables.length === 0) return [];

  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') lineStarts.push(i + 1);
  }

  const out: SqlSchemaDiagnostic[] = [];

  if (lang === 'sql') {
    const rawDiags = detectAmbiguousJoinColumns(source, allTables, activeDatabase);
    for (const d of rawDiags) {
      const sPos = offsetToLineCol(lineStarts, d.sqlStartOffset);
      const ePos = offsetToLineCol(lineStarts, d.sqlEndOffset);
      if (sPos.line !== ePos.line) continue;
      out.push({
        line: sPos.line,
        startColumn: sPos.col,
        endColumn: ePos.col,
        severity: 'warning',
        message: d.message,
        quickFixes: d.quickFixes
      });
    }
    return out;
  }

  // PHP: inspect embedded multi-line / concatenated SQL statements and map offsets back to PHP lines!
  const phpStmts = extractPhpEmbeddedSqlStatements(source);
  for (const ps of phpStmts) {
    let cursor = 0;
    let rawJoined = '';
    const mappedSegs: Array<{
      sqlStart: number;
      sqlEnd: number;
      docStart: number;
    }> = [];

    ps.segments.forEach((seg, idx) => {
      mappedSegs.push({
        sqlStart: cursor,
        sqlEnd: cursor + seg.text.length,
        docStart: seg.docStartOffset
      });
      rawJoined += seg.text;
      cursor += seg.text.length;
      if (idx < ps.segments.length - 1) {
        const joiner = ' 1 ';
        rawJoined += joiner;
        cursor += joiner.length;
      }
    });

    const rawDiags = detectAmbiguousJoinColumns(rawJoined, allTables, activeDatabase);
    for (const d of rawDiags) {
      const seg = mappedSegs.find(
        (ms) => d.sqlStartOffset >= ms.sqlStart && d.sqlEndOffset <= ms.sqlEnd
      );
      if (!seg) continue;
      const docStart = seg.docStart + (d.sqlStartOffset - seg.sqlStart);
      const docEnd = seg.docStart + (d.sqlEndOffset - seg.sqlStart);
      const sPos = offsetToLineCol(lineStarts, docStart);
      const ePos = offsetToLineCol(lineStarts, docEnd);
      if (sPos.line !== ePos.line) continue;
      out.push({
        line: sPos.line,
        startColumn: sPos.col,
        endColumn: ePos.col,
        severity: 'warning',
        message: d.message,
        quickFixes: d.quickFixes
      });
    }
  }

  return out;
}
