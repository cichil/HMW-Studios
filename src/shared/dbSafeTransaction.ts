import type { DbEngine } from './types';

export type PendingGridMutation =
  | {
      id: string;
      kind: 'update';
      table: string;
      database?: string;
      column: string;
      oldValue: unknown;
      newValue: unknown;
      primaryKeyValues: Record<string, unknown>;
      rowKey: string;
    }
  | {
      id: string;
      kind: 'insert';
      table: string;
      database?: string;
      values: Record<string, unknown>;
      rowKey: string;
    }
  | {
      id: string;
      kind: 'delete';
      table: string;
      database?: string;
      primaryKeyValues: Record<string, unknown>;
      deletedRowSnapshot?: Record<string, unknown>;
      rowKey: string;
    };

function quoteIdent(name: string, engine: DbEngine): string {
  if (engine === 'postgres') {
    return `"${name.replace(/"/g, '""')}"`;
  }
  return `\`${name.replace(/`/g, '``')}\``;
}

export function formatSqlLiteral(value: unknown, engine: DbEngine): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') {
    return engine === 'postgres' ? (value ? 'TRUE' : 'FALSE') : value ? '1' : '0';
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return Number.isFinite(Number(value)) ? String(value) : 'NULL';
  }
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `'${str.replace(/'/g, "''")}'`;
}

function buildQualifiedTable(table: string, database: string | undefined, engine: DbEngine): string {
  if (database && database.trim()) {
    return `${quoteIdent(database.trim(), engine)}.${quoteIdent(table, engine)}`;
  }
  return quoteIdent(table, engine);
}

function buildWhereClause(pkValues: Record<string, unknown>, engine: DbEngine): string {
  const parts = Object.entries(pkValues).map(([k, v]) => {
    const col = quoteIdent(k, engine);
    if (v === null || v === undefined) return `${col} IS NULL`;
    return `${col} = ${formatSqlLiteral(v, engine)}`;
  });
  return parts.join(' AND ');
}

export function buildSqlForPendingMutation(
  mutation: PendingGridMutation,
  engine: DbEngine
): string {
  const target = buildQualifiedTable(mutation.table, mutation.database, engine);
  if (mutation.kind === 'update') {
    const whereSql = buildWhereClause(mutation.primaryKeyValues, engine);
    const limitSuffix = engine === 'mysql' ? ' LIMIT 1' : '';
    return `UPDATE ${target} SET ${quoteIdent(mutation.column, engine)} = ${formatSqlLiteral(
      mutation.newValue,
      engine
    )} WHERE ${whereSql}${limitSuffix};`;
  }
  if (mutation.kind === 'delete') {
    const whereSql = buildWhereClause(mutation.primaryKeyValues, engine);
    const limitSuffix = engine === 'mysql' ? ' LIMIT 1' : '';
    return `DELETE FROM ${target} WHERE ${whereSql}${limitSuffix};`;
  }
  const entries = Object.entries(mutation.values).filter(([, v]) => v !== undefined);
  if (entries.length === 0) {
    return engine === 'postgres'
      ? `INSERT INTO ${target} DEFAULT VALUES;`
      : `INSERT INTO ${target} () VALUES ();`;
  }
  const cols = entries.map(([k]) => quoteIdent(k, engine)).join(', ');
  const vals = entries.map(([, v]) => formatSqlLiteral(v, engine)).join(', ');
  return `INSERT INTO ${target} (${cols}) VALUES (${vals});`;
}

export function buildPendingMutationsBatch(
  mutations: PendingGridMutation[],
  engine: DbEngine
): { statements: string[]; previewSql: string } {
  const statements = mutations.map((m) => buildSqlForPendingMutation(m, engine));
  const previewSql =
    statements.length === 0
      ? '-- Tidak ada perubahan tertunda.'
      : ['START TRANSACTION;', ...statements, 'COMMIT;'].join('\n');
  return { statements, previewSql };
}

/**
 * Checks whether a SQL query attempts to mutate data or schema,
 * so Read-Only Lock Mode can safely reject it before it reaches the DB.
 */
export function isWriteSqlBlockedInReadOnly(sql: string): { blocked: boolean; keyword?: string } {
  const cleaned = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/#[^\r\n]*/g, ' ')
    .trim();

  if (!cleaned) return { blocked: false };

  const segments = cleaned.split(';').map((s) => s.trim()).filter(Boolean);
  const mutatingRe =
    /^(INSERT|UPDATE|DELETE|REPLACE|DROP|TRUNCATE|ALTER|CREATE|RENAME|GRANT|REVOKE|LOAD|LOCK|CALL|DO|SET\s+GLOBAL|SET\s+PERSIST|OPTIMIZE|REPAIR|FLUSH)\b/i;

  for (const seg of segments) {
    const m = seg.match(mutatingRe);
    if (m) {
      return { blocked: true, keyword: m[1].toUpperCase() };
    }
    // CTE writing queries like `WITH x AS (...) DELETE FROM ...`
    if (/^WITH\b/i.test(seg) && /\b(INSERT\s+INTO|UPDATE\s+\w+|DELETE\s+FROM)\b/i.test(seg)) {
      const m2 = seg.match(/\b(INSERT|UPDATE|DELETE)\b/i);
      return { blocked: true, keyword: (m2?.[1] ?? 'WRITE').toUpperCase() };
    }
  }
  return { blocked: false };
}
