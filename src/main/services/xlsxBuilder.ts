import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { ParsedXlsxSheet, ParsedXlsxWorkbook } from '../../shared/xlsxReader';

// Precomputed CRC-32 lookup table for standard PKZIP archives
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntryInput {
  fileName: string;
  content: Buffer;
}

function packZipArchive(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.fileName, 'utf-8');
    const uncompressed = entry.content;
    const compressed = deflateRawSync(uncompressed, { level: 6 });
    const checksum = crc32(uncompressed);

    // Local file header (30 bytes + filename)
    const localHdr = Buffer.alloc(30);
    localHdr.writeUInt32LE(0x04034b50, 0); // signature PK\x03\x04
    localHdr.writeUInt16LE(20, 4); // version needed (2.0)
    localHdr.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHdr.writeUInt16LE(8, 8); // compression method: 8 = deflate
    localHdr.writeUInt16LE(0, 10); // mod time
    localHdr.writeUInt16LE(0x21, 12); // mod date
    localHdr.writeUInt32LE(checksum, 14);
    localHdr.writeUInt32LE(compressed.length, 18);
    localHdr.writeUInt32LE(uncompressed.length, 22);
    localHdr.writeUInt16LE(nameBuf.length, 26);
    localHdr.writeUInt16LE(0, 28); // extra length

    localParts.push(localHdr, nameBuf, compressed);

    // Central directory header (46 bytes + filename)
    const centralHdr = Buffer.alloc(46);
    centralHdr.writeUInt32LE(0x02014b50, 0); // signature PK\x01\x02
    centralHdr.writeUInt16LE(20, 4); // version made by
    centralHdr.writeUInt16LE(20, 6); // version needed
    centralHdr.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHdr.writeUInt16LE(8, 10); // compression method: deflate
    centralHdr.writeUInt16LE(0, 12);
    centralHdr.writeUInt16LE(0x21, 14);
    centralHdr.writeUInt32LE(checksum, 16);
    centralHdr.writeUInt32LE(compressed.length, 20);
    centralHdr.writeUInt32LE(uncompressed.length, 24);
    centralHdr.writeUInt16LE(nameBuf.length, 28);
    centralHdr.writeUInt16LE(0, 30); // extra length
    centralHdr.writeUInt16LE(0, 32); // comment length
    centralHdr.writeUInt16LE(0, 34); // disk number
    centralHdr.writeUInt16LE(0, 36); // internal attrs
    centralHdr.writeUInt32LE(0, 38); // external attrs
    centralHdr.writeUInt32LE(localOffset, 42);

    centralParts.push(centralHdr, nameBuf);
    localOffset += localHdr.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature PK\x05\x06
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

export function columnIndexToExcelName(zeroBasedIdx: number): string {
  let n = zeroBasedIdx + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function escapeXmlText(raw: string): string {
  // Strip invalid XML 1.0 control characters while preserving \t, \r, \n
  const cleaned = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  return cleaned
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeSheetName(name?: string): string {
  const cleaned = (name || 'Data HMW Studio')
    .replace(/[\\/*?:[\]]/g, ' ')
    .trim()
    .slice(0, 31);
  return cleaned || 'Sheet1';
}

export interface BuildXlsxOptions {
  sheetName?: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

/**
 * Generates a 100% genuine Microsoft Excel OpenXML (.xlsx) workbook buffer.
 * Preserves string columns (such as 18-digit NIP/NIK or leading-zero kd_unitkerja '020100')
 * as text cells so Excel never strips leading zeros or rounds long identifiers.
 */
export function buildXlsxBuffer(options: BuildXlsxOptions): Buffer {
  const sheetTitle = sanitizeSheetName(options.sheetName);
  const cols = options.columns.length > 0 ? options.columns : ['Data'];
  const rows = options.rows ?? [];

  const maxCharsPerCol = cols.map((c) => Math.max(10, Math.min(48, c.length + 4)));

  const xmlRows: string[] = [];

  // Row 1: Styled Header Row (style s="1")
  const headerCells = cols.map((colName, cIdx) => {
    const ref = `${columnIndexToExcelName(cIdx)}1`;
    const needsPreserve = /^\s|\s$|\n/.test(colName);
    return `<c r="${ref}" s="1" t="inlineStr"><is><t${
      needsPreserve ? ' xml:space="preserve"' : ''
    }>${escapeXmlText(colName)}</t></is></c>`;
  });
  xmlRows.push(`<row r="1" ht="22" customHeight="1">${headerCells.join('')}</row>`);

  // Data Rows (starting at row 2, style s="2")
  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const excelRowNum = rIdx + 2;
    const rowObj = rows[rIdx];
    const cellXmlParts: string[] = [];

    for (let cIdx = 0; cIdx < cols.length; cIdx++) {
      const colName = cols[cIdx];
      const rawVal = rowObj[colName];
      const ref = `${columnIndexToExcelName(cIdx)}${excelRowNum}`;

      if (rawVal === null || rawVal === undefined) {
        cellXmlParts.push(`<c r="${ref}" s="2"/>`);
        continue;
      }

      if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
        const numStr = String(rawVal);
        if (numStr.length + 2 > maxCharsPerCol[cIdx]) {
          maxCharsPerCol[cIdx] = Math.min(48, numStr.length + 2);
        }
        cellXmlParts.push(`<c r="${ref}" s="2"><v>${numStr}</v></c>`);
        continue;
      }

      if (typeof rawVal === 'boolean') {
        cellXmlParts.push(`<c r="${ref}" s="2" t="b"><v>${rawVal ? '1' : '0'}</v></c>`);
        continue;
      }

      const strVal =
        rawVal instanceof Date
          ? rawVal.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')
          : typeof rawVal === 'object'
            ? JSON.stringify(rawVal)
            : String(rawVal);

      if (strVal.length + 2 > maxCharsPerCol[cIdx]) {
        maxCharsPerCol[cIdx] = Math.min(52, strVal.length + 2);
      }
      const needsPreserve = /^\s|\s$|\n|\r/.test(strVal);
      cellXmlParts.push(
        `<c r="${ref}" s="2" t="inlineStr"><is><t${
          needsPreserve ? ' xml:space="preserve"' : ''
        }>${escapeXmlText(strVal)}</t></is></c>`
      );
    }

    xmlRows.push(`<row r="${excelRowNum}">${cellXmlParts.join('')}</row>`);
  }

  const lastColRef = columnIndexToExcelName(cols.length - 1);
  const lastRowNum = Math.max(1, rows.length + 1);
  const dimensionRef = `A1:${lastColRef}${lastRowNum}`;

  const colsXml = `<cols>${maxCharsPerCol
    .map(
      (w, idx) =>
        `<col min="${idx + 1}" max="${idx + 1}" width="${w}" bestFit="1" customWidth="1"/>`
    )
    .join('')}</cols>`;

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${dimensionRef}"/>
  <sheetViews>
    <sheetView tabSelected="1" workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  ${colsXml}
  <sheetData>${xmlRows.join('')}</sheetData>
  <autoFilter ref="${dimensionRef}"/>
</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="10"/><color rgb="FF111827"/><name val="Calibri"/></font>
    <font><b/><sz val="10.5"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD1D5DB"/></left>
      <right style="thin"><color rgb="FFD1D5DB"/></right>
      <top style="thin"><color rgb="FFD1D5DB"/></top>
      <bottom style="thin"><color rgb="FFD1D5DB"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
  </cellXfs>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXmlText(sheetTitle)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  return packZipArchive([
    { fileName: '[Content_Types].xml', content: Buffer.from(contentTypesXml, 'utf-8') },
    { fileName: '_rels/.rels', content: Buffer.from(rootRelsXml, 'utf-8') },
    { fileName: 'xl/workbook.xml', content: Buffer.from(workbookXml, 'utf-8') },
    { fileName: 'xl/_rels/workbook.xml.rels', content: Buffer.from(workbookRelsXml, 'utf-8') },
    { fileName: 'xl/styles.xml', content: Buffer.from(stylesXml, 'utf-8') },
    { fileName: 'xl/worksheets/sheet1.xml', content: Buffer.from(sheetXml, 'utf-8') }
  ]);
}

/**
 * RFC-4180 CSV parser with automatic ',' vs ';' delimiter detection (for regional Excel CSVs).
 */
export function parseCsvRecords(csvText: string): {
  headers: string[];
  rows: string[][];
  delimiter: ',' | ';';
} {
  const cleaned = csvText.replace(/^\uFEFF/, ''); // strip UTF-8 BOM
  const firstLineEnd = cleaned.indexOf('\n');
  const sampleLine = firstLineEnd >= 0 ? cleaned.slice(0, firstLineEnd) : cleaned;
  const commaCount = (sampleLine.match(/,/g) || []).length;
  const semiCount = (sampleLine.match(/;/g) || []).length;
  const delimiter: ',' | ';' = semiCount > commaCount ? ';' : ',';

  const records: string[][] = [];
  let curRow: string[] = [];
  let curField = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    const next = cleaned[i + 1] ?? '';

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        curField += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        curField += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      curRow.push(curField);
      curField = '';
      continue;
    }
    if (ch === '\r' && next === '\n') {
      curRow.push(curField);
      records.push(curRow);
      curRow = [];
      curField = '';
      i++;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      curRow.push(curField);
      records.push(curRow);
      curRow = [];
      curField = '';
      continue;
    }
    curField += ch;
  }

  if (curField.length > 0 || curRow.length > 0) {
    curRow.push(curField);
    records.push(curRow);
  }

  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim().length > 0));
  if (nonEmpty.length === 0) {
    return { headers: [], rows: [], delimiter };
  }

  const headers = nonEmpty[0].map((h) => h.trim());
  const dataRows = nonEmpty.slice(1);
  return { headers, rows: dataRows, delimiter };
}

function buildWorksheetXmlForSheet(spec: BuildXlsxOptions, tabSelected: boolean): string {
  const cols = spec.columns.length > 0 ? spec.columns : ['Data'];
  const rows = spec.rows ?? [];
  const maxCharsPerCol = cols.map((c) => Math.max(10, Math.min(48, c.length + 4)));
  const xmlRows: string[] = [];

  const headerCells = cols.map((colName, cIdx) => {
    const ref = `${columnIndexToExcelName(cIdx)}1`;
    const needsPreserve = /^\s|\s$|\n/.test(colName);
    return `<c r="${ref}" s="1" t="inlineStr"><is><t${
      needsPreserve ? ' xml:space="preserve"' : ''
    }>${escapeXmlText(colName)}</t></is></c>`;
  });
  xmlRows.push(`<row r="1" ht="22" customHeight="1">${headerCells.join('')}</row>`);

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const excelRowNum = rIdx + 2;
    const rowObj = rows[rIdx];
    const cellXmlParts: string[] = [];

    for (let cIdx = 0; cIdx < cols.length; cIdx++) {
      const colName = cols[cIdx];
      const rawVal = rowObj[colName];
      const ref = `${columnIndexToExcelName(cIdx)}${excelRowNum}`;

      if (rawVal === null || rawVal === undefined) {
        cellXmlParts.push(`<c r="${ref}" s="2"/>`);
        continue;
      }
      if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
        const numStr = String(rawVal);
        if (numStr.length + 2 > maxCharsPerCol[cIdx]) {
          maxCharsPerCol[cIdx] = Math.min(48, numStr.length + 2);
        }
        cellXmlParts.push(`<c r="${ref}" s="2"><v>${numStr}</v></c>`);
        continue;
      }
      if (typeof rawVal === 'boolean') {
        cellXmlParts.push(`<c r="${ref}" s="2" t="b"><v>${rawVal ? '1' : '0'}</v></c>`);
        continue;
      }

      const strVal =
        rawVal instanceof Date
          ? rawVal.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')
          : typeof rawVal === 'object'
            ? JSON.stringify(rawVal)
            : String(rawVal);

      if (strVal.length + 2 > maxCharsPerCol[cIdx]) {
        maxCharsPerCol[cIdx] = Math.min(52, strVal.length + 2);
      }
      const needsPreserve = /^\s|\s$|\n|\r/.test(strVal);
      cellXmlParts.push(
        `<c r="${ref}" s="2" t="inlineStr"><is><t${
          needsPreserve ? ' xml:space="preserve"' : ''
        }>${escapeXmlText(strVal)}</t></is></c>`
      );
    }

    xmlRows.push(`<row r="${excelRowNum}">${cellXmlParts.join('')}</row>`);
  }

  const lastColRef = columnIndexToExcelName(cols.length - 1);
  const lastRowNum = Math.max(1, rows.length + 1);
  const dimensionRef = `A1:${lastColRef}${lastRowNum}`;
  const colsXml = `<cols>${maxCharsPerCol
    .map(
      (w, idx) =>
        `<col min="${idx + 1}" max="${idx + 1}" width="${w}" bestFit="1" customWidth="1"/>`
    )
    .join('')}</cols>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${dimensionRef}"/>
  <sheetViews>
    <sheetView tabSelected="${tabSelected ? '1' : '0'}" workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  ${colsXml}
  <sheetData>${xmlRows.join('')}</sheetData>
  <autoFilter ref="${dimensionRef}"/>
</worksheet>`;
}

/**
 * Generates a Multi-Sheet Microsoft Excel OpenXML (.xlsx) workbook buffer (e.g. for Kamus Data).
 */
export function buildMultiSheetXlsxBuffer(sheets: BuildXlsxOptions[]): Buffer {
  const validSheets = sheets.length > 0 ? sheets : [{ sheetName: 'Sheet1', columns: ['Data'], rows: [] }];

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="10"/><color rgb="FF111827"/><name val="Calibri"/></font>
    <font><b/><sz val="10.5"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD1D5DB"/></left>
      <right style="thin"><color rgb="FFD1D5DB"/></right>
      <top style="thin"><color rgb="FFD1D5DB"/></top>
      <bottom style="thin"><color rgb="FFD1D5DB"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
  </cellXfs>
</styleSheet>`;

  const usedNames = new Set<string>();
  const sheetEntriesXml: string[] = [];
  const wbRelsParts: string[] = [];
  const ctOverrides: string[] = [];
  const zipEntries: ZipEntryInput[] = [];

  validSheets.forEach((sh, idx) => {
    const num = idx + 1;
    let title = sanitizeSheetName(sh.sheetName);
    if (usedNames.has(title.toLowerCase())) {
      title = `${title.slice(0, 27)}_${num}`;
    }
    usedNames.add(title.toLowerCase());

    sheetEntriesXml.push(
      `    <sheet name="${escapeXmlText(title)}" sheetId="${num}" r:id="rId${num}"/>`
    );
    wbRelsParts.push(
      `  <Relationship Id="rId${num}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${num}.xml"/>`
    );
    ctOverrides.push(
      `  <Override PartName="/xl/worksheets/sheet${num}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    );
    zipEntries.push({
      fileName: `xl/worksheets/sheet${num}.xml`,
      content: Buffer.from(buildWorksheetXmlForSheet(sh, idx === 0), 'utf-8')
    });
  });

  const styleRelId = validSheets.length + 1;
  wbRelsParts.push(
    `  <Relationship Id="rId${styleRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
  );

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
${sheetEntriesXml.join('\n')}
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${wbRelsParts.join('\n')}
</Relationships>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${ctOverrides.join('\n')}
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  return packZipArchive([
    { fileName: '[Content_Types].xml', content: Buffer.from(contentTypesXml, 'utf-8') },
    { fileName: '_rels/.rels', content: Buffer.from(rootRelsXml, 'utf-8') },
    { fileName: 'xl/workbook.xml', content: Buffer.from(workbookXml, 'utf-8') },
    { fileName: 'xl/_rels/workbook.xml.rels', content: Buffer.from(workbookRelsXml, 'utf-8') },
    { fileName: 'xl/styles.xml', content: Buffer.from(stylesXml, 'utf-8') },
    ...zipEntries
  ]);
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, '&');
}

function unpackZipEntries(zipBuf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let eocdOffset = -1;
  const minPos = Math.max(0, zipBuf.length - 65558);
  for (let p = zipBuf.length - 22; p >= minPos; p--) {
    if (zipBuf.readUInt32LE(p) === 0x06054b50) {
      eocdOffset = p;
      break;
    }
  }

  if (eocdOffset >= 0) {
    const totalEntries = zipBuf.readUInt16LE(eocdOffset + 10);
    let cdOffset = zipBuf.readUInt32LE(eocdOffset + 16);
    for (let idx = 0; idx < totalEntries && cdOffset + 46 <= zipBuf.length; idx++) {
      if (zipBuf.readUInt32LE(cdOffset) !== 0x02014b50) break;
      const method = zipBuf.readUInt16LE(cdOffset + 10);
      const compSize = zipBuf.readUInt32LE(cdOffset + 20);
      const nameLen = zipBuf.readUInt16LE(cdOffset + 28);
      const extraLen = zipBuf.readUInt16LE(cdOffset + 30);
      const commentLen = zipBuf.readUInt16LE(cdOffset + 32);
      const localHdrOffset = zipBuf.readUInt32LE(cdOffset + 42);

      const fileName = zipBuf
        .subarray(cdOffset + 46, cdOffset + 46 + nameLen)
        .toString('utf-8')
        .replace(/^\/+/, '');

      if (
        localHdrOffset + 30 <= zipBuf.length &&
        zipBuf.readUInt32LE(localHdrOffset) === 0x04034b50
      ) {
        const lNameLen = zipBuf.readUInt16LE(localHdrOffset + 26);
        const lExtraLen = zipBuf.readUInt16LE(localHdrOffset + 28);
        const dataStart = localHdrOffset + 30 + lNameLen + lExtraLen;
        const rawSlice = zipBuf.subarray(dataStart, dataStart + compSize);
        if (method === 0) {
          entries.set(fileName, rawSlice);
        } else if (method === 8) {
          entries.set(fileName, inflateRawSync(rawSlice));
        }
      }

      cdOffset += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  let offset = 0;
  while (offset + 30 <= zipBuf.length && zipBuf.readUInt32LE(offset) === 0x04034b50) {
    const method = zipBuf.readUInt16LE(offset + 8);
    const compSize = zipBuf.readUInt32LE(offset + 18);
    const nameLen = zipBuf.readUInt16LE(offset + 26);
    const extraLen = zipBuf.readUInt16LE(offset + 28);
    const name = zipBuf
      .subarray(offset + 30, offset + 30 + nameLen)
      .toString('utf-8')
      .replace(/^\/+/, '');
    const dataStart = offset + 30 + nameLen + extraLen;
    const rawSlice = zipBuf.subarray(dataStart, dataStart + compSize);
    if (method === 0) {
      entries.set(name, rawSlice);
    } else if (method === 8) {
      entries.set(name, inflateRawSync(rawSlice));
    }
    offset = dataStart + compSize;
  }

  return entries;
}

function excelColLettersToIndex(letters: string): number {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.toUpperCase().charCodeAt(i) - 64);
  }
  return Math.max(0, idx - 1);
}

function excelSerialToIsoDate(serial: number): string {
  const utcDays = Math.floor(serial - 25569);
  const d = new Date(utcDays * 86400 * 1000);
  if (Number.isNaN(d.getTime())) return String(serial);
  return d.toISOString().slice(0, 10);
}

function extractDateStyleIndexes(stylesXml: string): Set<number> {
  const dateStyleIndexes = new Set<number>();
  if (!stylesXml) return dateStyleIndexes;

  const customDateNumFmts = new Set<number>();
  const fmtRegex = /<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/gi;
  let fm: RegExpExecArray | null;
  while ((fm = fmtRegex.exec(stylesXml)) !== null) {
    const id = Number(fm[1]);
    const code = fm[2].toLowerCase().replace(/\[[^\]]*\]/g, '');
    if (/[ymd]/.test(code) && !/[#0]/.test(code)) {
      customDateNumFmts.add(id);
    }
  }

  const builtInDateIds = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47]);
  const cellXfsMatch = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/i);
  if (!cellXfsMatch) return dateStyleIndexes;

  const xfRegex = /<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/gi;
  let xm: RegExpExecArray | null;
  let xfIdx = 0;
  while ((xm = xfRegex.exec(cellXfsMatch[1])) !== null) {
    const nfMatch = xm[1].match(/\bnumFmtId="(\d+)"/i);
    if (nfMatch) {
      const nfId = Number(nfMatch[1]);
      if (builtInDateIds.has(nfId) || customDateNumFmts.has(nfId)) {
        dateStyleIndexes.add(xfIdx);
      }
    }
    xfIdx++;
  }

  return dateStyleIndexes;
}

/**
 * Pure Node OOXML `.xlsx` Workbook Parser — supports multiple sheets, sharedStrings, inlineStr,
 * Excel serial dates, and preserves leading zeros (`01111`, 18-digit NIP, 16-digit NIK) intact!
 */
export function parseXlsxBuffer(xlsxBuffer: Buffer, filePath?: string): ParsedXlsxWorkbook {
  const files = unpackZipEntries(xlsxBuffer);
  const workbookXml = files.get('xl/workbook.xml')?.toString('utf-8') ?? '';
  const relsXml = files.get('xl/_rels/workbook.xml.rels')?.toString('utf-8') ?? '';
  const sharedStringsXml = files.get('xl/sharedStrings.xml')?.toString('utf-8') ?? '';
  const stylesXml = files.get('xl/styles.xml')?.toString('utf-8') ?? '';

  const dateStyleSet = extractDateStyleIndexes(stylesXml);

  const sharedStrings: string[] = [];
  if (sharedStringsXml) {
    const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
    let sm: RegExpExecArray | null;
    while ((sm = siRegex.exec(sharedStringsXml)) !== null) {
      const tParts: string[] = [];
      const tRegex = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/gi;
      let tm: RegExpExecArray | null;
      while ((tm = tRegex.exec(sm[1])) !== null) {
        tParts.push(decodeXmlEntities(tm[1]));
      }
      sharedStrings.push(tParts.join(''));
    }
  }

  const relMap = new Map<string, string>();
  const relRegex = /<Relationship\b[^>]*>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = relRegex.exec(relsXml)) !== null) {
    const tag = rm[0];
    const idMatch = tag.match(/\bId="([^"]+)"/i);
    const targetMatch = tag.match(/\bTarget="([^"]+)"/i);
    if (idMatch && targetMatch) {
      const cleanTarget = targetMatch[1].replace(/^\/+/, '');
      relMap.set(idMatch[1], cleanTarget.startsWith('xl/') ? cleanTarget : `xl/${cleanTarget}`);
    }
  }

  const sheetDefs: Array<{ name: string; path: string }> = [];
  const sheetTagRegex = /<sheet\b[^>]*>/gi;
  let shMatch: RegExpExecArray | null;
  let sheetFallbackIdx = 1;
  while ((shMatch = sheetTagRegex.exec(workbookXml)) !== null) {
    const tag = shMatch[0];
    const nameMatch = tag.match(/\bname="([^"]+)"/i);
    const rIdMatch = tag.match(/\br:id="([^"]+)"/i);
    const name = nameMatch ? decodeXmlEntities(nameMatch[1]) : `Sheet${sheetFallbackIdx}`;
    const mappedPath =
      (rIdMatch ? relMap.get(rIdMatch[1]) : undefined) ??
      `xl/worksheets/sheet${sheetFallbackIdx}.xml`;
    sheetDefs.push({ name, path: mappedPath });
    sheetFallbackIdx++;
  }

  if (sheetDefs.length === 0 && files.has('xl/worksheets/sheet1.xml')) {
    sheetDefs.push({ name: 'Sheet1', path: 'xl/worksheets/sheet1.xml' });
  }

  const sheets: ParsedXlsxSheet[] = [];

  for (const def of sheetDefs) {
    const xml = files.get(def.path)?.toString('utf-8');
    if (!xml) continue;

    const matrix: string[][] = [];
    let maxColCount = 0;

    const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
    let rMatch: RegExpExecArray | null;
    while ((rMatch = rowRegex.exec(xml)) !== null) {
      const rowArr: string[] = [];
      let autoColIdx = 0;

      const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi;
      let cMatch: RegExpExecArray | null;
      while ((cMatch = cellRegex.exec(rMatch[1])) !== null) {
        const attrs = cMatch[1];
        const inner = cMatch[2] ?? '';
        const refMatch = attrs.match(/\br="([A-Za-z]+)\d+"/i);
        const colIdx = refMatch ? excelColLettersToIndex(refMatch[1]) : autoColIdx;
        autoColIdx = colIdx + 1;

        const typeMatch = attrs.match(/\bt="([^"]+)"/i);
        const styleMatch = attrs.match(/\bs="(\d+)"/i);
        const cellType = typeMatch ? typeMatch[1] : '';
        const styleIdx = styleMatch ? Number(styleMatch[1]) : -1;

        let val = '';
        if (cellType === 'inlineStr') {
          const tParts: string[] = [];
          const tRegex = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/gi;
          let tm: RegExpExecArray | null;
          while ((tm = tRegex.exec(inner)) !== null) {
            tParts.push(decodeXmlEntities(tm[1]));
          }
          val = tParts.join('');
        } else {
          const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/i);
          const rawV = vMatch ? decodeXmlEntities(vMatch[1].trim()) : '';
          if (cellType === 's') {
            val = sharedStrings[Number(rawV)] ?? '';
          } else if (cellType === 'b') {
            val = rawV === '1' ? '1' : '0';
          } else if (rawV && dateStyleSet.has(styleIdx) && /^\d+(\.\d+)?$/.test(rawV)) {
            val = excelSerialToIsoDate(Number(rawV));
          } else {
            val = rawV;
          }
        }

        rowArr[colIdx] = val;
        if (colIdx + 1 > maxColCount) maxColCount = colIdx + 1;
      }

      if (rowArr.some((v) => v !== undefined && String(v).trim() !== '')) {
        matrix.push(rowArr);
      }
    }

    if (matrix.length === 0) {
      sheets.push({ name: def.name, headers: [], rows: [] });
      continue;
    }

    const headers = Array.from({ length: maxColCount }, (_, c) => {
      const h = (matrix[0][c] ?? '').trim();
      return h || `Kolom_${c + 1}`;
    });
    const dataRows = matrix
      .slice(1)
      .map((r) => Array.from({ length: maxColCount }, (_, c) => r[c] ?? ''));
    sheets.push({ name: def.name, headers, rows: dataRows });
  }

  return { filePath, sheets };
}
