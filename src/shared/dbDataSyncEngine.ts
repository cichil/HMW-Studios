import type { DbEngine } from './types';

export type ColumnMaskStrategy =
  | 'none'
  | 'bcrypt-dummy'
  | 'masked-email'
  | 'masked-phone'
  | 'masked-digits'
  | 'masked-name'
  | 'zero';

export type DataSyncWriteMode = 'upsert' | 'insert-ignore' | 'truncate-insert';

// Standard bcrypt hash of "password" for safe dev/staging testing
const DUMMY_BCRYPT_HASH = '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';

export function detectSensitiveColumnMasks(
  columns: string[]
): Record<string, ColumnMaskStrategy> {
  const map: Record<string, ColumnMaskStrategy> = {};
  for (const col of columns) {
    const low = col.toLowerCase();
    if (/(?:^|_)(?:password|passwd|pwd|pass_hash|secret|pin|token)(?:$|_)/.test(low)) {
      map[col] = 'bcrypt-dummy';
    } else if (/(?:^|_)(?:email|surel)(?:$|_)/.test(low)) {
      map[col] = 'masked-email';
    } else if (/(?:^|_)(?:no_hp|hp|telp|telepon|no_telp|wa|whatsapp|handphone)(?:$|_)/.test(low)) {
      map[col] = 'masked-phone';
    } else if (/(?:^|_)(?:nik|no_ktp|ktp|npwp|no_rek|rekening)(?:$|_)/.test(low)) {
      map[col] = 'masked-digits';
    } else {
      map[col] = 'none';
    }
  }
  return map;
}

export function maskSingleValue(
  val: unknown,
  strategy: ColumnMaskStrategy,
  rowIndex: number
): unknown {
  if (strategy === 'none' || val === null || val === undefined) return val;
  if (strategy === 'zero') {
    return typeof val === 'number' ? 0 : '0';
  }
  if (strategy === 'bcrypt-dummy') {
    return DUMMY_BCRYPT_HASH;
  }
  if (strategy === 'masked-email') {
    return `pengguna_${rowIndex + 1}@simulasi.local`;
  }
  if (strategy === 'masked-phone') {
    const suffix = String(1000 + ((rowIndex + 1) % 8999));
    return `08120000${suffix}`;
  }
  if (strategy === 'masked-name') {
    return `Pengguna Uji #${rowIndex + 1}`;
  }
  if (strategy === 'masked-digits') {
    const s = String(val);
    if (s.length <= 4) return '9999';
    return `${s.slice(0, 4)}${'0'.repeat(Math.max(1, s.length - 6))}${String((rowIndex + 1) % 99).padStart(2, '0')}`;
  }
  return val;
}

export function applyRowAnonymization(
  row: Record<string, unknown>,
  masks: Record<string, ColumnMaskStrategy>,
  rowIndex: number
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const [col, strat] of Object.entries(masks)) {
    if (strat && strat !== 'none' && col in out) {
      out[col] = maskSingleValue(out[col], strat, rowIndex);
    }
  }
  return out;
}

function quoteId(id: string, engine: DbEngine): string {
  return engine === 'postgres' ? `"${id.replace(/"/g, '""')}"` : `\`${id.replace(/`/g, '``')}\``;
}

function formatSqlValueLiteral(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number' || typeof val === 'bigint') {
    return Number.isFinite(Number(val)) ? String(val) : 'NULL';
  }
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (val instanceof Date) {
    const iso = val.toISOString().slice(0, 19).replace('T', ' ');
    return `'${iso}'`;
  }
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  return `'${str.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/\0/g, '')}'`;
}

export interface BuildBatchUpsertOptions {
  table: string;
  schema?: string;
  columns: string[];
  primaryKeys: string[];
  rows: Array<Record<string, unknown>>;
  engine: DbEngine;
  writeMode: DataSyncWriteMode;
  batchSize?: number;
}

export function buildBatchUpsertSql(opts: BuildBatchUpsertOptions): string[] {
  const {
    table,
    schema,
    columns,
    primaryKeys,
    rows,
    engine,
    writeMode,
    batchSize = 100
  } = opts;

  if (columns.length === 0) return [];
  const targetRef =
    schema && schema.trim()
      ? `${quoteId(schema.trim(), engine)}.${quoteId(table, engine)}`
      : quoteId(table, engine);

  const statements: string[] = [];
  if (writeMode === 'truncate-insert') {
    statements.push(
      engine === 'postgres'
        ? `TRUNCATE TABLE ${targetRef} RESTART IDENTITY CASCADE;`
        : `TRUNCATE TABLE ${targetRef};`
    );
  }

  if (rows.length === 0) return statements;

  const colListSql = columns.map((c) => quoteId(c, engine)).join(', ');
  const pkSet = new Set(primaryKeys.map((k) => k.toLowerCase()));
  const updatableCols = columns.filter((c) => !pkSet.has(c.toLowerCase()));

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const chunk = rows.slice(offset, offset + batchSize);
    const valuesRows = chunk.map((r) => {
      const tuple = columns.map((c) => formatSqlValueLiteral(r[c])).join(', ');
      return `(${tuple})`;
    });

    if (engine === 'mysql') {
      if (writeMode === 'insert-ignore') {
        statements.push(
          `INSERT IGNORE INTO ${targetRef} (${colListSql}) VALUES\n${valuesRows.join(',\n')};`
        );
      } else if (writeMode === 'upsert' && updatableCols.length > 0) {
        const updateAssigns = updatableCols
          .map((c) => `${quoteId(c, engine)} = VALUES(${quoteId(c, engine)})`)
          .join(', ');
        statements.push(
          `INSERT INTO ${targetRef} (${colListSql}) VALUES\n${valuesRows.join(',\n')}\nON DUPLICATE KEY UPDATE ${updateAssigns};`
        );
      } else {
        statements.push(
          `INSERT INTO ${targetRef} (${colListSql}) VALUES\n${valuesRows.join(',\n')};`
        );
      }
    } else {
      // PostgreSQL
      const pkListSql = primaryKeys.map((k) => quoteId(k, engine)).join(', ');
      if (writeMode === 'insert-ignore') {
        statements.push(
          `INSERT INTO ${targetRef} (${colListSql}) VALUES\n${valuesRows.join(',\n')}\nON CONFLICT DO NOTHING;`
        );
      } else if (writeMode === 'upsert' && primaryKeys.length > 0 && updatableCols.length > 0) {
        const updateAssigns = updatableCols
          .map((c) => `${quoteId(c, engine)} = EXCLUDED.${quoteId(c, engine)}`)
          .join(', ');
        statements.push(
          `INSERT INTO ${targetRef} (${colListSql}) VALUES\n${valuesRows.join(',\n')}\nON CONFLICT (${pkListSql}) DO UPDATE SET ${updateAssigns};`
        );
      } else {
        statements.push(
          `INSERT INTO ${targetRef} (${colListSql}) VALUES\n${valuesRows.join(',\n')};`
        );
      }
    }
  }

  return statements;
}
