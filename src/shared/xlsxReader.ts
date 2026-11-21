export interface ParsedXlsxSheet {
  name: string;
  headers: string[];
  rows: string[][];
}

export interface ParsedXlsxWorkbook {
  filePath?: string;
  sheets: ParsedXlsxSheet[];
}

/**
 * Parses clipboard TSV (`Ctrl+C` from Microsoft Excel / Google Sheets) into headers & rows.
 */
export function parseClipboardTabularText(rawText: string): ParsedXlsxSheet {
  const lines = rawText
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { name: 'Clipboard Excel', headers: [], rows: [] };
  }
  const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const splitRows = lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
  const maxCols = Math.max(...splitRows.map((r) => r.length));
  const headers = Array.from({ length: maxCols }, (_, i) => splitRows[0][i] || `Kolom_${i + 1}`);
  const rows = splitRows
    .slice(1)
    .map((r) => Array.from({ length: maxCols }, (_, i) => r[i] ?? ''));
  return { name: 'Clipboard Excel', headers, rows };
}

const INDONESIAN_MONTHS: Record<string, string> = {
  jan: '01',
  januari: '01',
  feb: '02',
  februari: '02',
  mar: '03',
  maret: '03',
  apr: '04',
  april: '04',
  mei: '05',
  jun: '06',
  juni: '06',
  jul: '07',
  juli: '07',
  agu: '08',
  ags: '08',
  agustus: '08',
  sep: '09',
  september: '09',
  okt: '10',
  oktober: '10',
  nov: '11',
  november: '11',
  des: '12',
  desember: '12'
};

/**
 * Smart value normalizer for DB column import:
 * - Preserves leading zeros on VARCHAR/CHAR columns (`01111` KBLI, `1985...` 18-digit NIP, `0812...` phone)
 * - Converts Indonesian date formats (`16-11-2026`, `16/11/2026`, `16 November 2026`) -> `2026-11-16`
 * - Cleans Rupiah formatting (`Rp 5.250.000`) -> `5250000` on numeric columns
 */
export function normalizeImportCellValue(
  rawCell: string,
  targetDataType: string,
  nullable: boolean
): string | number | null {
  const trimmed = rawCell.trim();
  if (trimmed === '' || trimmed.toUpperCase() === 'NULL') {
    return nullable ? null : '';
  }

  const dt = targetDataType.toLowerCase();

  if (dt.includes('date') || dt.includes('timestamp')) {
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return trimmed;
    }
    const dmy = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:\s+(.*))?$/);
    if (dmy) {
      const dd = dmy[1].padStart(2, '0');
      const mm = dmy[2].padStart(2, '0');
      const yyyy = dmy[3];
      return dmy[4] ? `${yyyy}-${mm}-${dd} ${dmy[4]}` : `${yyyy}-${mm}-${dd}`;
    }
    const indoText = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (indoText) {
      const mm = INDONESIAN_MONTHS[indoText[2].toLowerCase()];
      if (mm) {
        return `${indoText[3]}-${mm}-${indoText[1].padStart(2, '0')}`;
      }
    }
    return trimmed;
  }

  if (/^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real)/.test(dt)) {
    const cleaned = trimmed
      .replace(/^rp\.?\s*/i, '')
      .replace(/\s+/g, '');
    let normalizedNum = cleaned;
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) {
      normalizedNum = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleaned)) {
      normalizedNum = cleaned.replace(/,/g, '');
    } else if (/^-?\d+,\d+$/.test(cleaned)) {
      normalizedNum = cleaned.replace(',', '.');
    }
    const num = Number(normalizedNum);
    if (Number.isFinite(num)) return num;
  }

  return trimmed;
}
