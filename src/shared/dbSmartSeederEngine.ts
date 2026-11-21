import type { DbColumnMeta, DbEngine, DbTableMeta } from './types';
import { buildBatchUpsertSql } from './dbDataSyncEngine';

const FIRST_NAMES = [
  'Budi',
  'Siti',
  'Andi',
  'Dewi',
  'Rizky',
  'Ayu',
  'Dimas',
  'Nadia',
  'Hendra',
  'Putri',
  'Fajar',
  'Ratna',
  'Agus',
  'Lestari',
  'Wahyu',
  'Fitri'
];

const LAST_NAMES = [
  'Santoso',
  'Rahmawati',
  'Pratama',
  'Wijaya',
  'Saputra',
  'Kurniawan',
  'Hidayat',
  'Permata',
  'Nugroho',
  'Susanti',
  'Ramadhan',
  'Setiawan'
];

const CITIES = [
  'Jakarta Pusat',
  'Bandung',
  'Surabaya',
  'Semarang',
  'Yogyakarta',
  'Malang',
  'Makassar',
  'Denpasar',
  'Medan',
  'Balikpapan'
];

const JABATAN_LIST = [
  'Pranata Komputer Ahli Pertama',
  'Analis Kepegawaian Muda',
  'Bendahara Pengeluaran',
  'Pengelola Sistem Informasi',
  'Auditor Internal',
  'Analis Kebijakan Publik',
  'Staf Administrasi Umum'
];

const UNIT_NAMES = [
  'Sekretariat Utama',
  'Biro Sumber Daya Manusia',
  'Pusat Data & Teknologi Informasi',
  'Biro Keuangan & Perlengkapan',
  'Inspektorat Wilayah I',
  'Direktorat Layanan Publik'
];

function parseEnumOptions(columnType: string): string[] | null {
  const m = columnType.match(/^enum\s*\((.+)\)$/i);
  if (!m) return null;
  const opts: string[] = [];
  const re = /'((?:[^']|'')*)'/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(m[1])) !== null) {
    opts.push(hit[1].replace(/''/g, "'"));
  }
  return opts.length > 0 ? opts : null;
}

function parseMaxCharLength(col: DbColumnMeta): number {
  const m = (col.columnType || '').match(/\((\d+)/);
  if (m) return Math.max(1, parseInt(m[1], 10));
  return 255;
}

function clampStr(val: string, maxLen: number): string {
  return val.length > maxLen ? val.slice(0, maxLen) : val;
}

export function isAutoIncrementColumn(col: DbColumnMeta): boolean {
  const ex = (col.extra ?? '').toLowerCase();
  const def = (col.defaultValue ?? '').toLowerCase();
  return (
    ex.includes('auto_increment') ||
    ex.includes('identity') ||
    def.includes('nextval(') ||
    /^serial|bigserial$/i.test(col.dataType)
  );
}

export interface GenerateIndonesianSeedOptions {
  table: DbTableMeta;
  rowCount: number;
  foreignKeyPools?: Record<string, unknown[]>;
  startSequence?: number;
}

export function generateIndonesianSeedRows(
  opts: GenerateIndonesianSeedOptions
): {
  columns: string[];
  rows: Array<Record<string, unknown>>;
} {
  const {
    table,
    rowCount,
    foreignKeyPools = {},
    startSequence = 1
  } = opts;

  const insertableCols = table.columns.filter((c) => !isAutoIncrementColumn(c));
  const colNames = insertableCols.map((c) => c.name);
  const rows: Array<Record<string, unknown>> = [];

  for (let i = 0; i < rowCount; i++) {
    const seq = startSequence + i;
    const firstName = FIRST_NAMES[i % FIRST_NAMES.length];
    const lastName = LAST_NAMES[(i * 3 + 1) % LAST_NAMES.length];
    const fullName = `${firstName} ${lastName}`;
    const birthYear = 1978 + (i % 24);
    const birthMonth = String((i % 12) + 1).padStart(2, '0');
    const birthDay = String(((i * 5) % 27) + 1).padStart(2, '0');
    const hireYear = birthYear + 23;

    const row: Record<string, unknown> = {};

    for (const col of insertableCols) {
      const nameLow = col.name.toLowerCase();
      const dtLow = (col.dataType || col.columnType || '').toLowerCase();
      const maxLen = parseMaxCharLength(col);

      // 1. Foreign key pool takes top priority so relational integrity always holds!
      const fkPool = foreignKeyPools[col.name];
      if (fkPool && fkPool.length > 0) {
        row[col.name] = fkPool[i % fkPool.length];
        continue;
      }

      // 2. ENUM column
      const enumOpts = parseEnumOptions(col.columnType || '');
      if (enumOpts && enumOpts.length > 0) {
        row[col.name] = enumOpts[i % enumOpts.length];
        continue;
      }

      // 3. Date / Timestamp / Year types
      if (dtLow.includes('datetime') || dtLow.includes('timestamp')) {
        row[col.name] = `2026-${birthMonth}-${birthDay} 08:${String(i % 60).padStart(2, '0')}:00`;
        continue;
      }
      if (dtLow === 'date') {
        row[col.name] = nameLow.includes('lahir')
          ? `${birthYear}-${birthMonth}-${birthDay}`
          : `2026-${birthMonth}-${birthDay}`;
        continue;
      }
      if (dtLow === 'time') {
        row[col.name] = `08:${String(i % 60).padStart(2, '0')}:00`;
        continue;
      }
      if (dtLow === 'year') {
        row[col.name] = 2020 + (i % 7);
        continue;
      }

      // 4. Boolean / Tinyint(1)
      if (dtLow === 'boolean' || dtLow === 'bool' || col.columnType.toLowerCase() === 'tinyint(1)') {
        row[col.name] = i % 5 === 0 ? 0 : 1;
        continue;
      }

      // 5. Numeric types (INT / BIGINT / DECIMAL / FLOAT / DOUBLE)
      if (
        /^(?:int|integer|bigint|smallint|tinyint|mediumint|decimal|numeric|float|double|real)/i.test(
          dtLow
        )
      ) {
        if (/(?:gaji|tunjangan|nominal|harga|biaya|pagu|total|nilai|saldo|honor)/.test(nameLow)) {
          row[col.name] = 3500000 + (i % 12) * 450000;
        } else if (/(?:tahun|thn)/.test(nameLow)) {
          row[col.name] = 2026;
        } else if (/(?:bulan|bln)/.test(nameLow)) {
          row[col.name] = (i % 12) + 1;
        } else if (col.isPrimaryKey) {
          row[col.name] = 1000 + seq;
        } else {
          row[col.name] = (i % 25) + 1;
        }
        continue;
      }

      // 6. JSON type
      if (dtLow === 'json' || dtLow === 'jsonb') {
        row[col.name] = JSON.stringify({ sumber: 'hmw_seeder', urut: seq });
        continue;
      }

      // 7. String / Text columns with Indonesian domain awareness
      if (/(?:^|_)(?:nip|nip_baru)(?:$|_)/.test(nameLow)) {
        const nip18 = `${birthYear}${birthMonth}${birthDay}${hireYear}03${(i % 2) + 1}${String(seq).padStart(3, '0')}`;
        row[col.name] = clampStr(nip18, maxLen);
      } else if (/(?:^|_)(?:nik|no_ktp|ktp)(?:$|_)/.test(nameLow)) {
        const nik16 = `327301${birthDay}${birthMonth}${String(birthYear).slice(2)}${String(seq).padStart(4, '0')}`;
        row[col.name] = clampStr(nik16, maxLen);
      } else if (/(?:email|surel)/.test(nameLow)) {
        const mail = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${seq}@instansi.go.id`;
        row[col.name] = clampStr(mail, maxLen);
      } else if (/(?:no_hp|hp|telp|telepon|wa|whatsapp)/.test(nameLow)) {
        row[col.name] = clampStr(`0812${String(20000000 + seq).slice(0, 8)}`, maxLen);
      } else if (/(?:unit|bagian|satker|divisi)/.test(nameLow) && /(?:nama|nm)/.test(nameLow)) {
        row[col.name] = clampStr(UNIT_NAMES[i % UNIT_NAMES.length], maxLen);
      } else if (/(?:jabatan|posisi)/.test(nameLow)) {
        row[col.name] = clampStr(JABATAN_LIST[i % JABATAN_LIST.length], maxLen);
      } else if (/(?:alamat|domisili)/.test(nameLow)) {
        row[col.name] = clampStr(
          `Jl. Merdeka Raya No. ${seq}, ${CITIES[i % CITIES.length]}`,
          maxLen
        );
      } else if (/(?:kota|kabupaten|tempat_lahir)/.test(nameLow)) {
        row[col.name] = clampStr(CITIES[i % CITIES.length], maxLen);
      } else if (/(?:nama|nm_)/.test(nameLow)) {
        row[col.name] = clampStr(fullName, maxLen);
      } else if (/(?:status|aktif)/.test(nameLow)) {
        row[col.name] = maxLen <= 2 ? 'Y' : clampStr('Aktif', maxLen);
      } else if (/(?:^|_)(?:kd|kode)(?:$|_)/.test(nameLow) || nameLow.startsWith('kd_')) {
        const padW = Math.min(maxLen, 6);
        row[col.name] =
          padW <= 3
            ? String(seq).padStart(padW, '0')
            : `0${(i % 5) + 1}0${(i % 4) + 1}${String(seq % 99).padStart(2, '0')}`.slice(0, maxLen);
      } else if (/(?:password|passwd|pwd)/.test(nameLow)) {
        row[col.name] = clampStr(
          '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
          maxLen
        );
      } else {
        row[col.name] = clampStr(`Data Uji ${seq}`, maxLen);
      }
    }

    rows.push(row);
  }

  return { columns: colNames, rows };
}

export function buildSeedSqlStatements(opts: {
  table: DbTableMeta;
  schema?: string;
  engine: DbEngine;
  rowCount: number;
  foreignKeyPools?: Record<string, unknown[]>;
}): {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  statements: string[];
} {
  const { columns, rows } = generateIndonesianSeedRows({
    table: opts.table,
    rowCount: opts.rowCount,
    foreignKeyPools: opts.foreignKeyPools
  });

  const statements = buildBatchUpsertSql({
    table: opts.table.name,
    schema: opts.schema || opts.table.schema,
    columns,
    primaryKeys: opts.table.primaryKeys ?? [],
    rows,
    engine: opts.engine,
    writeMode: 'insert-ignore',
    batchSize: 100
  });

  return { columns, rows, statements };
}
