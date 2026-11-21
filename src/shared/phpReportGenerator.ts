export type PhpReportFlavor = 'wisanggeni' | 'mysqli-native' | 'laravel';

export interface PhpReportGeneratorInput {
  moduleSlug: string;
  reportTitle: string;
  subtitleOrInstansi?: string;
  sqlQuery: string;
  columns: string[];
  flavor: PhpReportFlavor;
}

export interface GeneratedPhpReportBundle {
  cetakFileName: string;
  cetakContent: string;
  excelFileName: string;
  excelContent: string;
  buttonSnippetHtml: string;
}

function humanizeColumnLabel(col: string): string {
  const clean = col.replace(/^.*\./, '').trim();
  const special: Record<string, string> = {
    nip: 'NIP',
    nik: 'NIK',
    npwp: 'NPWP',
    id: 'ID',
    kd_unitkerja: 'Kode Unit',
    nm_unitkerja: 'Unit Kerja',
    tgl_lahir: 'Tgl. Lahir',
    created_at: 'Tanggal Input'
  };
  if (special[clean.toLowerCase()]) return special[clean.toLowerCase()];
  return clean
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function classifyReportColumn(col: string): 'text-code' | 'numeric-sum' | 'numeric' | 'text' {
  const low = col.replace(/^.*\./, '').toLowerCase();
  // Text codes that must NEVER become scientific notation in Excel (NIP 18-digit, NIK, Kode 020100, Telepon)
  if (
    /(?:^|_)(?:nip|nik|npwp|nrp|nis|nisn|no_hp|hp|telp|telepon|no_rek|rekening|kode|kd|id_pegawai)(?:$|_)/.test(
      low
    ) ||
    low.startsWith('kd_') ||
    low.startsWith('no_')
  ) {
    return 'text-code';
  }
  // Monetary / countable totals that deserve thousand-separator + SUM row at the bottom
  if (
    /(?:^|_)(?:gaji|tunjangan|nominal|total|jumlah|jml|nilai|harga|biaya|pagu|realisasi|potongan|bruto|netto|saldo|honor)(?:$|_)/.test(
      low
    )
  ) {
    return 'numeric-sum';
  }
  if (/^(?:count|sum|avg)_/i.test(low)) {
    return 'numeric-sum';
  }
  return 'text';
}

function extractColumnsFromSqlFallback(sql: string): string[] {
  const m = sql.match(/SELECT\s+(?:DISTINCT\s+)?([\s\S]+?)\s+FROM\s/i);
  if (!m) return ['id', 'nama', 'keterangan'];
  const rawList = m[1];
  if (rawList.trim() === '*' || /\.\*\s*$/.test(rawList.trim())) {
    return ['nip', 'nama', 'unit_kerja', 'total'];
  }
  const parts = rawList
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const cols: string[] = [];
  for (const p of parts) {
    const aliasMatch = p.match(/\bAS\s+[`"']?([A-Za-z0-9_]+)[`"']?$/i);
    if (aliasMatch) {
      cols.push(aliasMatch[1]);
      continue;
    }
    const bareMatch = p.match(/([A-Za-z0-9_]+)\s*$/);
    if (bareMatch) cols.push(bareMatch[1]);
  }
  return cols.length > 0 ? cols : ['id', 'nama'];
}

export function generatePhpReportBundle(
  input: PhpReportGeneratorInput
): GeneratedPhpReportBundle {
  const slug =
    input.moduleSlug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'laporan_data';

  const title = input.reportTitle.trim() || 'Laporan Rekapitulasi Data';
  const instansi = input.subtitleOrInstansi?.trim() || 'Sistem Informasi Manajemen';
  const cleanSql = input.sqlQuery.trim().replace(/;+\s*$/, '');
  const escapedPhpSql = cleanSql.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const cols = (
    input.columns.length > 0 ? input.columns : extractColumnsFromSqlFallback(cleanSql)
  ).map((c) => c.replace(/^.*\./, '').trim());

  const sumCols = cols.filter((c) => classifyReportColumn(c) === 'numeric-sum');

  if (input.flavor === 'laravel') {
    const controllerClass =
      slug
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join('') + 'ReportController';

    const cetakFileName = `${slug}_cetak.blade.php`;
    const excelFileName = `${controllerClass}.php`;

    const thRows = cols.map((c) => `            <th>${humanizeColumnLabel(c)}</th>`).join('\n');
    const tdRows = cols
      .map((c) => {
        const kind = classifyReportColumn(c);
        if (kind === 'numeric-sum') {
          return `            <td class="num">{{ number_format((float) ($row->${c} ?? 0), 0, ',', '.') }}</td>`;
        }
        if (kind === 'text-code') {
          return `            <td class="str">{{ $row->${c} ?? '' }}</td>`;
        }
        return `            <td>{{ $row->${c} ?? '' }}</td>`;
      })
      .join('\n');

    const cetakContent = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>{{ $judul ?? '${title}' }}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 18px; }
    .kop { text-align: center; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 14px; }
    .kop h2 { margin: 0 0 4px; font-size: 15px; text-transform: uppercase; }
    .kop p { margin: 0; font-size: 11px; color: #444; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #333; padding: 5px 7px; }
    th { background: #e2e8f0; text-align: center; font-weight: bold; }
    td.num { text-align: right; }
    td.str { mso-number-format: "\\@"; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body onload="{{ !empty($isPrint) ? 'window.print()' : '' }}">
  <div class="kop">
    <h2>{{ $instansi ?? '${instansi}' }}</h2>
    <p><strong>{{ $judul ?? '${title}' }}</strong> • Dicetak: {{ now()->translatedFormat('d F Y H:i') }}</p>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:36px;">No</th>
${thRows}
      </tr>
    </thead>
    <tbody>
      @forelse ($rows as $i => $row)
        <tr>
          <td style="text-align:center;">{{ $i + 1 }}</td>
${tdRows}
        </tr>
      @empty
        <tr><td colspan="${cols.length + 1}" style="text-align:center;">Tidak ada data.</td></tr>
      @endforelse
    </tbody>
  </table>
</body>
</html>
`;

    const excelContent = `<?php

namespace App\\Http\\Controllers;

use Illuminate\\Http\\Request;
use Illuminate\\Support\\Facades\\DB;

class ${controllerClass} extends Controller
{
    private function ambilData(Request $request): array
    {
        $sql = "${escapedPhpSql}";
        return DB::select($sql);
    }

    public function cetak(Request $request)
    {
        $rows = $this->ambilData($request);
        return view('${slug}_cetak', [
            'judul' => '${title}',
            'instansi' => '${instansi}',
            'rows' => $rows,
            'isPrint' => true,
        ]);
    }

    public function exportExcel(Request $request)
    {
        $rows = $this->ambilData($request);
        $fileName = '${slug}_' . date('Ymd_His') . '.xls';
        $html = view('${slug}_cetak', [
            'judul' => '${title}',
            'instansi' => '${instansi}',
            'rows' => $rows,
            'isPrint' => false,
        ])->render();

        return response("\\xEF\\xBB\\xBF" . $html, 200, [
            'Content-Type' => 'application/vnd.ms-excel; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="' . $fileName . '"',
        ]);
    }
}
`;

    return {
      cetakFileName,
      cetakContent,
      excelFileName,
      excelContent,
      buttonSnippetHtml: `<a href="{{ route('${slug}.cetak') }}" target="_blank" class="btn btn-primary btn-sm">🖨️ Cetak Laporan</a>\n<a href="{{ route('${slug}.excel') }}" class="btn btn-success btn-sm">📊 Export Excel</a>`
    };
  }

  // Wisanggeni OR Native PHP (`*_cetak.php` + `*_excel.php`)
  const isWsg = input.flavor === 'wisanggeni';
  const cetakFileName = `${slug}_cetak.php`;
  const excelFileName = `${slug}_excel.php`;

  const dbFetchBlock = isWsg
    ? `// Koneksi & query menggunakan helper Wisanggeni / MySQL aktif
$sql = "${escapedPhpSql}";
$rows = [];
if (isset($query) && method_exists($query, 'dosql')) {
    $res = $query->dosql($sql);
    while ($r = mysql_fetch_assoc($res)) {
        $rows[] = $r;
    }
} elseif (function_exists('mysql_query')) {
    $res = mysql_query($sql);
    while ($res && ($r = mysql_fetch_assoc($res))) {
        $rows[] = $r;
    }
}`
    : `// Pastikan variabel koneksi $conn (mysqli) sudah tersedia dari connect_db.php
$sql = "${escapedPhpSql}";
$rows = [];
if (isset($conn) && $conn instanceof mysqli) {
    $res = mysqli_query($conn, $sql);
    while ($res && ($r = mysqli_fetch_assoc($res))) {
        $rows[] = $r;
    }
}`;

  const sumInitPhp =
    sumCols.length > 0
      ? `$totals = [${sumCols.map((c) => `'${c}' => 0`).join(', ')}];`
      : '';
  const sumAccumPhp = sumCols
    .map((c) => `        $totals['${c}'] += (float) ($row['${c}'] ?? 0);`)
    .join('\n');

  const thHtml = cols.map((c) => `      <th>${humanizeColumnLabel(c)}</th>`).join('\n');
  const tdPhp = cols
    .map((c) => {
      const kind = classifyReportColumn(c);
      if (kind === 'numeric-sum') {
        return `        <td class="num"><?= number_format((float) ($row['${c}'] ?? 0), 0, ',', '.') ?></td>`;
      }
      if (kind === 'text-code') {
        return `        <td class="str"><?= htmlspecialchars((string) ($row['${c}'] ?? ''), ENT_QUOTES, 'UTF-8') ?></td>`;
      }
      return `        <td><?= htmlspecialchars((string) ($row['${c}'] ?? ''), ENT_QUOTES, 'UTF-8') ?></td>`;
    })
    .join('\n');

  const tfootHtml =
    sumCols.length > 0
      ? `    <tfoot>
      <tr class="total-row">
        <td style="text-align:center;font-weight:bold;">TOTAL</td>
${cols
  .map((c) =>
    sumCols.includes(c)
      ? `        <td class="num"><strong><?= number_format($totals['${c}'], 0, ',', '.') ?></strong></td>`
      : `        <td></td>`
  )
  .join('\n')}
      </tr>
    </tfoot>`
      : '';

  const buildBodyHtml = (isExcel: boolean): string => `<?php
${
  isExcel
    ? `header("Content-Type: application/vnd.ms-excel; charset=UTF-8");
header("Content-Disposition: attachment; filename=\\"${slug}_" . date('Ymd_His') . ".xls\\"");
header("Pragma: no-cache");
header("Expires: 0");
echo "\\xEF\\xBB\\xBF"; // UTF-8 BOM agar karakter Indonesia & format teks terbaca rapi di Microsoft Excel
`
    : ''
}${dbFetchBlock}
${sumInitPhp}
$bulanIndo = [1 => 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
$tglCetak = date('d') . ' ' . $bulanIndo[(int) date('n')] . ' ' . date('Y') . ' ' . date('H:i');
?>
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111827; margin: ${isExcel ? '0' : '18px'}; }
    .kop-laporan { text-align: center; margin-bottom: 12px; border-bottom: 2px solid #1f2937; padding-bottom: 8px; }
    .kop-laporan h2 { margin: 0 0 3px; font-size: 15px; text-transform: uppercase; }
    .kop-laporan h3 { margin: 0 0 4px; font-size: 13px; }
    .kop-laporan .meta { font-size: 10.5px; color: #4b5563; }
    table.tabel-data { width: 100%; border-collapse: collapse; }
    table.tabel-data th, table.tabel-data td { border: 1px solid #374151; padding: 5px 7px; vertical-align: top; }
    table.tabel-data th { background-color: #1e3a8a; color: #ffffff; font-weight: bold; text-align: center; }
    td.num { text-align: right; mso-number-format: "#,##0"; }
    td.str { mso-number-format: "\\@"; } /* Anti-rusak NIP 18 digit & kode diawali angka 0 di Excel */
    tr.total-row td { background-color: #f3f4f6; font-weight: bold; }
    .baris-aksi { margin-bottom: 12px; display: flex; gap: 8px; }
    .btn-cetak { padding: 6px 12px; background: #2563eb; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; text-decoration: none; }
    .ttd-wrap { margin-top: 24px; width: 100%; display: flex; justify-content: flex-end; }
    .ttd-box { width: 240px; text-align: center; }
    @media print {
      .no-print { display: none !important; }
      body { margin: 8mm; }
    }
  </style>
</head>
<body${isExcel ? '' : ' onload="window.print()"'}>
${
  isExcel
    ? ''
    : `  <div class="baris-aksi no-print">
    <button type="button" class="btn-cetak" onclick="window.print()">🖨️ Cetak / Simpan PDF</button>
    <a class="btn-cetak" style="background:#059669;" href="${excelFileName}">📊 Download Excel (.xls)</a>
  </div>\n`
}  <div class="kop-laporan">
    <h2>${instansi}</h2>
    <h3>${title}</h3>
    <div class="meta">Dicetak pada: <?= $tglCetak ?> • Jumlah Data: <?= count($rows) ?> baris</div>
  </div>

  <table class="tabel-data" border="1">
    <thead>
      <tr>
        <th style="width:38px;">No</th>
${thHtml}
      </tr>
    </thead>
    <tbody>
      <?php if (empty($rows)): ?>
      <tr>
        <td colspan="${cols.length + 1}" style="text-align:center;padding:14px;">Tidak ada data yang ditampilkan.</td>
      </tr>
      <?php else: ?>
      <?php foreach ($rows as $idx => $row): ?>
      <?php
${sumAccumPhp || '        // Baris data'}
      ?>
      <tr>
        <td style="text-align:center;"><?= $idx + 1 ?></td>
${tdPhp}
      </tr>
      <?php endforeach; ?>
      <?php endif; ?>
    </tbody>
${tfootHtml}
  </table>
${
  isExcel
    ? ''
    : `\n  <div class="ttd-wrap">
    <div class="ttd-box">
      <div>Mengetahui,</div>
      <div style="margin-bottom:58px;">Pejabat Berwenang</div>
      <div><strong>( ........................................ )</strong></div>
    </div>
  </div>`
}
</body>
</html>
`;

  return {
    cetakFileName,
    cetakContent: buildBodyHtml(false),
    excelFileName,
    excelContent: buildBodyHtml(true),
    buttonSnippetHtml: `<!-- Tempel tombol ini pada halaman ${slug}_idx.php -->
<button type="button" class="btn btn-primary btn-sm" onclick="window.open('${cetakFileName}', '_blank')">
  🖨️ Cetak Laporan
</button>
<button type="button" class="btn btn-success btn-sm" onclick="window.location.href='${excelFileName}'">
  📊 Export Excel
</button>`
  };
}
