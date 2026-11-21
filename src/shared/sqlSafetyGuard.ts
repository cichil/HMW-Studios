export type SqlHazardLevel = 'safe' | 'high' | 'critical';

export interface SqlHazardReport {
  hazardous: boolean;
  level: SqlHazardLevel;
  kind?:
    | 'delete-without-where'
    | 'update-without-where'
    | 'drop-object'
    | 'truncate-table'
    | 'alter-drop'
    | 'production-write';
  title: string;
  reasons: string[];
}

function stripSqlCommentsAndLiterals(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .replace(/#.*$/gm, ' ')
    .replace(/'(?:\\.|''|[^'])*'/g, "''")
    .replace(/"(?:\\.|""|[^"])*"/g, '""');
}

/**
 * Inspects SQL statements before execution to guard against accidental destructive queries
 * (`UPDATE` / `DELETE` without `WHERE`, `DROP TABLE`, `TRUNCATE`, or write queries on Production DBs).
 */
export function analyzeDangerousSql(
  sql: string,
  isProductionDb = false
): SqlHazardReport {
  const masked = stripSqlCommentsAndLiterals(sql);
  const statements = masked
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  const reasons: string[] = [];
  let highestLevel: SqlHazardLevel = 'safe';
  let primaryKind: SqlHazardReport['kind'] = undefined;

  const elevate = (lvl: SqlHazardLevel, kind: NonNullable<SqlHazardReport['kind']>): void => {
    const rank = { safe: 0, high: 1, critical: 2 };
    if (rank[lvl] > rank[highestLevel]) {
      highestLevel = lvl;
      primaryKind = kind;
    }
  };

  for (const stmt of statements) {
    if (/^drop\s+(?:table|database|schema|view|index)\b/i.test(stmt)) {
      elevate('critical', 'drop-object');
      reasons.push('Perintah DROP akan menghapus permanen struktur beserta seluruh data di dalamnya.');
      continue;
    }

    if (/^truncate\b/i.test(stmt)) {
      elevate('critical', 'truncate-table');
      reasons.push('Perintah TRUNCATE akan mengosongkan seluruh isi tabel tanpa bisa di-ROLLBACK.');
      continue;
    }

    if (/^delete\s+from\b/i.test(stmt) || /^delete\b/i.test(stmt)) {
      if (!/\bwhere\b/i.test(stmt)) {
        elevate('critical', 'delete-without-where');
        reasons.push('Perintah DELETE dijalankan TANPA klausa WHERE — seluruh baris di tabel akan terhapus!');
      } else if (isProductionDb) {
        elevate('high', 'production-write');
        reasons.push('Perintah DELETE akan menghapus baris pada Database berlabel PRODUKSI.');
      }
      continue;
    }

    if (/^update\b/i.test(stmt)) {
      if (!/\bwhere\b/i.test(stmt)) {
        elevate('critical', 'update-without-where');
        reasons.push('Perintah UPDATE dijalankan TANPA klausa WHERE — seluruh baris di tabel akan tertimpa!');
      } else if (isProductionDb) {
        elevate('high', 'production-write');
        reasons.push('Perintah UPDATE akan mengubah data langsung pada Database berlabel PRODUKSI.');
      }
      continue;
    }

    if (/^alter\s+table\b/i.test(stmt) && /\bdrop\b/i.test(stmt)) {
      elevate('critical', 'alter-drop');
      reasons.push('Perintah ALTER TABLE ... DROP akan menghapus kolom/constraint secara permanen.');
      continue;
    }

    if (
      isProductionDb &&
      /^(?:insert|replace|alter|create|grant|revoke)\b/i.test(stmt)
    ) {
      elevate('high', 'production-write');
      reasons.push('Perintah modifikasi data/skema ditujukan ke Database berlabel PRODUKSI.');
    }
  }

  const finalLevel = highestLevel as SqlHazardLevel;

  return {
    hazardous: finalLevel !== 'safe',
    level: finalLevel,
    kind: primaryKind,
    title:
      finalLevel === 'critical'
        ? 'Peringatan Kritis: Query SQL Berisiko Tinggi Terdeteksi!'
        : finalLevel === 'high'
          ? 'Konfirmasi Pengaman Database PRODUKSI'
          : 'Aman',
    reasons: Array.from(new Set(reasons))
  };
}
