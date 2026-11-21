import type { DbEngine } from './types';

function quoteIdent(ident: string, engine: DbEngine): string {
  if (engine === 'postgres') {
    return `"${ident.replace(/"/g, '""')}"`;
  }
  return `\`${ident.replace(/`/g, '``')}\``;
}

export function formatSqlLiteralValue(val: unknown, engine: DbEngine): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number' && Number.isFinite(val)) return String(val);
  if (typeof val === 'boolean') {
    return engine === 'postgres' ? (val ? 'TRUE' : 'FALSE') : val ? '1' : '0';
  }
  const str =
    val instanceof Date
      ? val.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')
      : typeof val === 'object'
        ? JSON.stringify(val)
        : String(val);
  if (engine === 'postgres') {
    return `'${str.replace(/'/g, "''")}'`;
  }
  return `'${str.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

export function buildCellUpdateUndoSql(opts: {
  engine: DbEngine;
  database?: string;
  table: string;
  column: string;
  oldValue: unknown;
  primaryKeyValues: Record<string, unknown>;
}): string {
  const { engine, database, table, column, oldValue, primaryKeyValues } = opts;
  const qualifiedTbl =
    database && engine === 'mysql'
      ? `${quoteIdent(database, engine)}.${quoteIdent(table, engine)}`
      : quoteIdent(table, engine);
  const whereParts = Object.entries(primaryKeyValues).map(([pkCol, pkVal]) =>
    pkVal === null || pkVal === undefined
      ? `${quoteIdent(pkCol, engine)} IS NULL`
      : `${quoteIdent(pkCol, engine)} = ${formatSqlLiteralValue(pkVal, engine)}`
  );
  return `UPDATE ${qualifiedTbl} SET ${quoteIdent(column, engine)} = ${formatSqlLiteralValue(
    oldValue,
    engine
  )} WHERE ${whereParts.join(' AND ')};`;
}

export function buildRowDeleteUndoSql(opts: {
  engine: DbEngine;
  database?: string;
  table: string;
  deletedRow: Record<string, unknown>;
}): string {
  const { engine, database, table, deletedRow } = opts;
  const cols = Object.keys(deletedRow);
  if (cols.length === 0) return '';
  const qualifiedTbl =
    database && engine === 'mysql'
      ? `${quoteIdent(database, engine)}.${quoteIdent(table, engine)}`
      : quoteIdent(table, engine);
  const colList = cols.map((c) => quoteIdent(c, engine)).join(', ');
  const valList = cols.map((c) => formatSqlLiteralValue(deletedRow[c], engine)).join(', ');
  return `INSERT INTO ${qualifiedTbl} (${colList}) VALUES (${valList});`;
}

export function isMutatingSqlStatement(sql: string): boolean {
  const cleaned = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .trim();
  return /^(insert|update|delete|replace|alter|drop|truncate|create|rename)\b/i.test(cleaned);
}

/**
 * Splits a multi-statement SQL script on top-level `;` delimiters while safely ignoring
 * semicolons inside `'...'`, `"..."`, `` `...` ``, `--` line comments, and `/* ... *\/` block comments.
 */
export function splitSqlStatements(sqlText: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  const len = sqlText.length;
  let quoteChar: "'" | '"' | '`' | null = null;

  while (i < len) {
    const ch = sqlText[i];
    const next = i + 1 < len ? sqlText[i + 1] : '';

    if (quoteChar) {
      current += ch;
      if (ch === '\\' && quoteChar !== '`' && i + 1 < len) {
        current += sqlText[i + 1];
        i += 2;
        continue;
      }
      if (ch === quoteChar) {
        if (next === quoteChar) {
          current += next;
          i += 2;
          continue;
        }
        quoteChar = null;
      }
      i++;
      continue;
    }

    // Line comment `--` or `#`
    if ((ch === '-' && next === '-') || ch === '#') {
      const nlIdx = sqlText.indexOf('\n', i);
      if (nlIdx === -1) {
        current += sqlText.slice(i);
        break;
      }
      current += sqlText.slice(i, nlIdx + 1);
      i = nlIdx + 1;
      continue;
    }

    // Block comment `/* ... */`
    if (ch === '/' && next === '*') {
      const closeIdx = sqlText.indexOf('*/', i + 2);
      if (closeIdx === -1) {
        current += sqlText.slice(i);
        break;
      }
      current += sqlText.slice(i, closeIdx + 2);
      i = closeIdx + 2;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quoteChar = ch;
      current += ch;
      i++;
      continue;
    }

    if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed && trimmed.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '').trim()) {
        statements.push(trimmed);
      }
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  const tail = current.trim();
  if (tail && tail.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '').trim()) {
    statements.push(tail);
  }

  return statements;
}
