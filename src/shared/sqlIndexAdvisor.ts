import type { DbEngine, DbTableMeta } from './types';
import { extractReferencedSqlTables } from './sqlSchemaAnalyzer';

export interface SqlIndexRecommendation {
  id: string;
  schema?: string;
  table: string;
  columns: string[];
  indexName: string;
  reason: string;
  severity: 'high' | 'medium';
  createIndexSql: string;
}

function quoteIdent(id: string, engine: DbEngine): string {
  return engine === 'postgres' ? `"${id.replace(/"/g, '""')}"` : `\`${id.replace(/`/g, '``')}\``;
}

/**
 * Analyzes a SELECT SQL query + optional EXPLAIN output rows against DbTableMeta[]
 * to detect missing indexes on JOIN, WHERE, and ORDER BY columns.
 */
export function analyzeQueryIndexRecommendations(opts: {
  sql: string;
  engine: DbEngine;
  defaultSchema?: string;
  tables: DbTableMeta[];
  explainRows?: Array<Record<string, unknown>>;
}): SqlIndexRecommendation[] {
  const { sql, engine, defaultSchema, tables, explainRows = [] } = opts;
  const cleaned = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .trim();

  if (!/^\s*select\b/i.test(cleaned)) return [];

  const { refs } = extractReferencedSqlTables(cleaned);
  if (refs.length === 0) return [];

  // Map aliasLower & tableLower -> DbTableMeta
  const aliasMap = new Map<string, { schema?: string; tableName: string; meta?: DbTableMeta }>();
  for (const r of refs) {
    const effSchema = r.schema || defaultSchema;
    const meta = tables.find(
      (t) =>
        t.name.toLowerCase() === r.tableLower &&
        (!effSchema || !t.schema || t.schema.toLowerCase() === effSchema.toLowerCase())
    );
    const entry = { schema: effSchema, tableName: meta?.name || r.table, meta };
    aliasMap.set(r.tableLower, entry);
    if (r.aliasLower) aliasMap.set(r.aliasLower, entry);
  }

  // Detect tables flagged by EXPLAIN as Full Table Scan (`type = 'ALL'` in MySQL, `Seq Scan` in PG)
  const fullScanTablesLower = new Set<string>();
  const explainRowEstByTable = new Map<string, number>();

  for (const er of explainRows) {
    // MySQL EXPLAIN columns: table, type, possible_keys, key, rows
    const mysqlTbl = String(er.table ?? er.TABLE ?? '').trim();
    const mysqlType = String(er.type ?? er.TYPE ?? '').trim().toUpperCase();
    const mysqlKey = er.key ?? er.KEY;
    const mysqlRows = Number(er.rows ?? er.ROWS ?? 0);
    if (mysqlTbl && (mysqlType === 'ALL' || (!mysqlKey && mysqlRows >= 50))) {
      const resolved = aliasMap.get(mysqlTbl.toLowerCase());
      const canonical = (resolved?.tableName ?? mysqlTbl).toLowerCase();
      fullScanTablesLower.add(canonical);
      explainRowEstByTable.set(canonical, mysqlRows);
    }

    // Postgres EXPLAIN column: "QUERY PLAN"
    const pgPlan = String(er['QUERY PLAN'] ?? er['query plan'] ?? '');
    const seqMatch = pgPlan.match(/Seq Scan on\s+"?([A-Za-z0-9_]+)"?/i);
    if (seqMatch) {
      fullScanTablesLower.add(seqMatch[1].toLowerCase());
    }
  }

  // Collect candidate columns used in ON / WHERE / ORDER BY per table
  const candidateColsByTable = new Map<
    string,
    {
      schema?: string;
      tableName: string;
      meta?: DbTableMeta;
      joinCols: Set<string>;
      whereCols: Set<string>;
      orderCols: Set<string>;
    }
  >();

  const registerCol = (
    qualifierRaw: string | undefined,
    colRaw: string,
    role: 'join' | 'where' | 'order'
  ): void => {
    const colClean = colRaw.replace(/[`"']/g, '').trim();
    if (!colClean || colClean === '*') return;

    let target: { schema?: string; tableName: string; meta?: DbTableMeta } | undefined;
    if (qualifierRaw) {
      target = aliasMap.get(qualifierRaw.replace(/[`"']/g, '').toLowerCase());
    } else if (refs.length === 1) {
      target = aliasMap.get(refs[0].tableLower);
    } else {
      // Find unique table owning this column
      const owners = Array.from(new Set(Array.from(aliasMap.values()))).filter((e) =>
        e.meta?.columns.some((c) => c.name.toLowerCase() === colClean.toLowerCase())
      );
      if (owners.length === 1) target = owners[0];
    }

    if (!target) return;

    // Verify column exists if schema metadata is loaded
    let exactColName = colClean;
    if (target.meta) {
      const foundCol = target.meta.columns.find(
        (c) => c.name.toLowerCase() === colClean.toLowerCase()
      );
      if (!foundCol) return;
      exactColName = foundCol.name;
    }

    const key = `${(target.schema ?? '').toLowerCase()}.${target.tableName.toLowerCase()}`;
    let bucket = candidateColsByTable.get(key);
    if (!bucket) {
      bucket = {
        schema: target.schema,
        tableName: target.tableName,
        meta: target.meta,
        joinCols: new Set(),
        whereCols: new Set(),
        orderCols: new Set()
      };
      candidateColsByTable.set(key, bucket);
    }
    if (role === 'join') bucket.joinCols.add(exactColName);
    else if (role === 'where') bucket.whereCols.add(exactColName);
    else bucket.orderCols.add(exactColName);
  };

  // Extract `ON a.col = b.col`
  const onRe =
    /\bON\s+(?:([`"']?[A-Za-z0-9_]+[`"']?)\.)?([`"']?[A-Za-z0-9_]+[`"']?)\s*=\s*(?:([`"']?[A-Za-z0-9_]+[`"']?)\.)?([`"']?[A-Za-z0-9_]+[`"']?)/gi;
  let m: RegExpExecArray | null;
  while ((m = onRe.exec(cleaned)) !== null) {
    registerCol(m[1], m[2], 'join');
    registerCol(m[3], m[4], 'join');
  }

  // Extract `WHERE ...` predicates
  const whereMatch = cleaned.match(
    /\bWHERE\s+([\s\S]+?)(?=\bGROUP\s+BY\b|\bHAVING\b|\bORDER\s+BY\b|\bLIMIT\b|;|$)/i
  );
  if (whereMatch) {
    const colPredRe =
      /(?:([`"']?[A-Za-z0-9_]+[`"']?)\.)?([`"']?[A-Za-z0-9_]+[`"']?)\s*(?:=|!=|<>|>=|<=|>|<|\bIN\b|\bLIKE\b|\bBETWEEN\b|\bIS\b)/gi;
    while ((m = colPredRe.exec(whereMatch[1])) !== null) {
      const tokenUpper = m[2].toUpperCase();
      if (['AND', 'OR', 'NOT', 'NULL', 'TRUE', 'FALSE'].includes(tokenUpper)) continue;
      registerCol(m[1], m[2], 'where');
    }
  }

  // Extract `ORDER BY ...`
  const orderMatch = cleaned.match(/\bORDER\s+BY\s+([\s\S]+?)(?=\bLIMIT\b|;|$)/i);
  if (orderMatch) {
    const parts = orderMatch[1].split(',');
    for (const p of parts) {
      const om = p.trim().match(/^(?:([`"']?[A-Za-z0-9_]+[`"']?)\.)?([`"']?[A-Za-z0-9_]+[`"']?)/);
      if (om) registerCol(om[1], om[2], 'order');
    }
  }

  const recommendations: SqlIndexRecommendation[] = [];

  for (const [, bucket] of candidateColsByTable.entries()) {
    const pkLowerSet = new Set((bucket.meta?.primaryKeys ?? []).map((k) => k.toLowerCase()));
    const fkIndexedLowerSet = new Set(
      (bucket.meta?.foreignKeys ?? []).map((fk) => fk.column.toLowerCase())
    );

    const priorityCols = [
      ...Array.from(bucket.joinCols),
      ...Array.from(bucket.whereCols),
      ...Array.from(bucket.orderCols)
    ];

    const unindexedCols: string[] = [];
    for (const col of priorityCols) {
      const low = col.toLowerCase();
      if (pkLowerSet.has(low)) continue;
      // In PostgreSQL, FK columns do NOT automatically get an index! In MySQL InnoDB they usually do unless legacy MyISAM/implicit relation.
      if (engine === 'mysql' && fkIndexedLowerSet.has(low) && !fullScanTablesLower.has(bucket.tableName.toLowerCase())) {
        continue;
      }
      if (!unindexedCols.includes(col)) {
        unindexedCols.push(col);
      }
    }

    if (unindexedCols.length === 0) continue;

    // Recommend composite index of up to 2 leading filter/join columns
    const chosenCols = unindexedCols.slice(0, 2);
    const isFullScan = fullScanTablesLower.has(bucket.tableName.toLowerCase());
    const estRows =
      explainRowEstByTable.get(bucket.tableName.toLowerCase()) ??
      bucket.meta?.rowEstimate ??
      0;

    const rawIdxName = `idx_${bucket.tableName}_${chosenCols.join('_')}`
      .replace(/[^A-Za-z0-9_]/g, '_')
      .slice(0, 60);

    const qualTbl =
      bucket.schema && bucket.schema.trim()
        ? `${quoteIdent(bucket.schema, engine)}.${quoteIdent(bucket.tableName, engine)}`
        : quoteIdent(bucket.tableName, engine);
    const colsSql = chosenCols.map((c) => quoteIdent(c, engine)).join(', ');
    const createIndexSql = `CREATE INDEX ${quoteIdent(rawIdxName, engine)} ON ${qualTbl} (${colsSql});`;

    const rolesUsed: string[] = [];
    if (chosenCols.some((c) => bucket.joinCols.has(c))) rolesUsed.push('JOIN');
    if (chosenCols.some((c) => bucket.whereCols.has(c))) rolesUsed.push('WHERE');
    if (chosenCols.some((c) => bucket.orderCols.has(c))) rolesUsed.push('ORDER BY');

    const reason = isFullScan
      ? `Terdeteksi Full Table Scan${estRows > 0 ? ` (~${estRows.toLocaleString('id-ID')} baris)` : ''} pada tabel "${bucket.tableName}" untuk klausa ${rolesUsed.join(' + ')}.`
      : `Kolom (${chosenCols.join(', ')}) dipakai pada klausa ${rolesUsed.join(' + ')} namun bukan Primary Key${estRows > 500 ? ` (~${estRows.toLocaleString('id-ID')} baris)` : ''}.`;

    recommendations.push({
      id: `${bucket.schema ?? ''}.${bucket.tableName}:${chosenCols.join(',')}`,
      schema: bucket.schema,
      table: bucket.tableName,
      columns: chosenCols,
      indexName: rawIdxName,
      reason,
      severity: isFullScan || estRows >= 1000 ? 'high' : 'medium',
      createIndexSql
    });
  }

  return recommendations.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1;
    return a.table.localeCompare(b.table);
  });
}
