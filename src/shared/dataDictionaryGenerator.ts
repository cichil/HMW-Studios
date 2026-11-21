import type { DbSchemaSnapshot, DbTableMeta } from './types';

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface DataDictionarySheetSpec {
  sheetName: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

export function buildDataDictionarySheets(snap: DbSchemaSnapshot): DataDictionarySheetSpec[] {
  const tables = snap.tables;

  const summaryRows = tables.map((t, idx) => ({
    No: idx + 1,
    Database: t.schema || snap.currentDatabase,
    'Nama Tabel / View': t.name,
    Jenis: t.kind.toUpperCase(),
    'Jumlah Kolom': t.columns.length,
    'Primary Key': t.primaryKeys.join(', ') || '-',
    'Jumlah Foreign Key': t.foreignKeys?.length ?? 0,
    'Estimasi Baris': t.rowEstimate ?? '-'
  }));

  const columnRows: Array<Record<string, unknown>> = [];
  const fkRows: Array<Record<string, unknown>> = [];

  for (const t of tables) {
    const fkByCol = new Map<string, string>();
    for (const fk of t.foreignKeys ?? []) {
      const refTarget = `${fk.referencedSchema ? `${fk.referencedSchema}.` : ''}${fk.referencedTable}(${fk.referencedColumn})`;
      fkByCol.set(fk.column.toLowerCase(), refTarget);
      fkRows.push({
        'Tabel Asal': t.name,
        'Kolom FK': fk.column,
        'Tabel Referensi': fk.referencedTable,
        'Database Referensi': fk.referencedSchema || snap.currentDatabase,
        'Kolom Referensi': fk.referencedColumn,
        'Nama Constraint': fk.constraintName || '-'
      });
    }

    t.columns.forEach((col, cIdx) => {
      columnRows.push({
        Tabel: t.name,
        No: cIdx + 1,
        'Nama Kolom': col.name,
        'Tipe Data': col.columnType || col.dataType,
        'Wajib Isi': col.nullable ? 'NULLABLE' : 'NOT NULL',
        Kunci: col.isPrimaryKey
          ? 'PK'
          : fkByCol.has(col.name.toLowerCase())
            ? 'FK'
            : '-',
        'Nilai Default': col.defaultValue ?? '-',
        Atribut: col.extra || '-',
        'Relasi Foreign Key': fkByCol.get(col.name.toLowerCase()) ?? '-'
      });
    });
  }

  return [
    {
      sheetName: '1. Daftar Tabel',
      columns: [
        'No',
        'Database',
        'Nama Tabel / View',
        'Jenis',
        'Jumlah Kolom',
        'Primary Key',
        'Jumlah Foreign Key',
        'Estimasi Baris'
      ],
      rows: summaryRows
    },
    {
      sheetName: '2. Kamus Kolom',
      columns: [
        'Tabel',
        'No',
        'Nama Kolom',
        'Tipe Data',
        'Wajib Isi',
        'Kunci',
        'Nilai Default',
        'Atribut',
        'Relasi Foreign Key'
      ],
      rows: columnRows
    },
    {
      sheetName: '3. Relasi Foreign Key',
      columns: [
        'Tabel Asal',
        'Kolom FK',
        'Tabel Referensi',
        'Database Referensi',
        'Kolom Referensi',
        'Nama Constraint'
      ],
      rows:
        fkRows.length > 0
          ? fkRows
          : [
              {
                'Tabel Asal': '-',
                'Kolom FK': '-',
                'Tabel Referensi': 'Belum ada constraint Foreign Key eksplisit',
                'Database Referensi': '-',
                'Kolom Referensi': '-',
                'Nama Constraint': '-'
              }
            ]
    }
  ];
}

export function buildDataDictionaryHtml(
  snap: DbSchemaSnapshot,
  opts?: { organizationName?: string; projectTitle?: string }
): string {
  const org = opts?.organizationName?.trim() || 'Dokumentasi Arsitektur Sistem Informasi';
  const title =
    opts?.projectTitle?.trim() ||
    `Kamus Data (Data Dictionary) — Database ${snap.currentDatabase || snap.profileName}`;
  const tables: DbTableMeta[] = snap.tables;
  const totalCols = tables.reduce((acc, t) => acc + t.columns.length, 0);
  const totalFks = tables.reduce((acc, t) => acc + (t.foreignKeys?.length ?? 0), 0);
  const generatedDate = new Date().toLocaleString('id-ID', {
    dateStyle: 'full',
    timeStyle: 'short'
  });

  const tocItems = tables
    .map(
      (t, i) =>
        `<a class="toc-link" href="#tbl-${escapeHtml(t.name)}" data-name="${escapeHtml(
          t.name.toLowerCase()
        )}"><span>${i + 1}. ${escapeHtml(t.name)}</span><small>${t.columns.length} kol</small></a>`
    )
    .join('\n');

  const tableSections = tables
    .map((t, idx) => {
      const fkMap = new Map<string, string>();
      for (const fk of t.foreignKeys ?? []) {
        fkMap.set(
          fk.column.toLowerCase(),
          `${fk.referencedTable}.${fk.referencedColumn}`
        );
      }

      const rowsHtml = t.columns
        .map((c, cIdx) => {
          const fkRef = fkMap.get(c.name.toLowerCase());
          return `<tr>
            <td class="num">${cIdx + 1}</td>
            <td class="mono"><strong>${escapeHtml(c.name)}</strong></td>
            <td class="mono">${escapeHtml(c.columnType || c.dataType)}</td>
            <td>${
              c.isPrimaryKey
                ? '<span class="badge pk">PRIMARY KEY</span>'
                : fkRef
                  ? `<span class="badge fk">FK → ${escapeHtml(fkRef)}</span>`
                  : '-'
            }</td>
            <td>${c.nullable ? 'YA (NULL)' : '<strong>TIDAK (NOT NULL)</strong>'}</td>
            <td class="mono">${c.defaultValue !== null && c.defaultValue !== undefined ? escapeHtml(String(c.defaultValue)) : '<em>-</em>'}</td>
            <td class="mono">${c.extra ? escapeHtml(c.extra) : '-'}</td>
          </tr>`;
        })
        .join('\n');

      return `<section class="tbl-card" id="tbl-${escapeHtml(t.name)}" data-search="${escapeHtml(
        `${t.name} ${t.columns.map((c) => c.name).join(' ')}`.toLowerCase()
      )}">
        <div class="tbl-hdr">
          <div>
            <h2>${idx + 1}. ${escapeHtml(t.name)} <span class="kind">${t.kind.toUpperCase()}</span></h2>
            <div class="meta">Primary Key: <code>${escapeHtml(
              t.primaryKeys.join(', ') || '-'
            )}</code> • Kolom: <strong>${t.columns.length}</strong>${
              t.rowEstimate !== undefined ? ` • Estimasi Baris: <strong>${t.rowEstimate.toLocaleString('id-ID')}</strong>` : ''
            }</div>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width:44px">No</th>
              <th>Nama Kolom</th>
              <th>Tipe Data</th>
              <th>Kunci / Relasi</th>
              <th>Nullable</th>
              <th>Default</th>
              <th>Atribut</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --ink:#0f172a; --muted:#475569; --line:#cbd5e1; --accent:#1d4ed8; --bg:#f8fafc; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:'Segoe UI',system-ui,-apple-system,sans-serif; color:var(--ink); background:var(--bg); display:flex; min-height:100vh; }
    aside { width:280px; flex-shrink:0; background:#0f172a; color:#f8fafc; padding:18px 14px; position:sticky; top:0; height:100vh; overflow-y:auto; }
    aside h3 { margin:0 0 10px; font-size:14px; color:#38bdf8; }
    aside input { width:100%; padding:7px 10px; border-radius:6px; border:1px solid #334155; background:#1e293b; color:#fff; font-size:12px; margin-bottom:10px; }
    .toc-link { display:flex; justify-content:space-between; gap:6px; color:#cbd5e1; text-decoration:none; font-size:12px; padding:5px 7px; border-radius:5px; }
    .toc-link:hover { background:#1e293b; color:#fff; }
    .toc-link small { color:#64748b; }
    main { flex:1; padding:28px 36px; max-width:1200px; }
    header.doc-cover { background:#fff; border:1px solid var(--line); border-left:6px solid var(--accent); border-radius:10px; padding:20px 24px; margin-bottom:22px; }
    header.doc-cover .org { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.6px; color:var(--accent); }
    header.doc-cover h1 { margin:6px 0 8px; font-size:22px; }
    .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-top:14px; }
    .stat-box { background:#f1f5f9; border-radius:8px; padding:10px 14px; }
    .stat-box .lbl { font-size:11px; color:var(--muted); }
    .stat-box .val { font-size:18px; font-weight:800; color:var(--ink); }
    .print-btn { float:right; padding:7px 14px; border-radius:6px; border:none; background:var(--accent); color:#fff; font-weight:700; cursor:pointer; }
    .tbl-card { background:#fff; border:1px solid var(--line); border-radius:10px; margin-bottom:20px; overflow:hidden; page-break-inside:avoid; }
    .tbl-hdr { padding:12px 16px; background:#f8fafc; border-bottom:1px solid var(--line); }
    .tbl-hdr h2 { margin:0 0 4px; font-size:15.5px; }
    .tbl-hdr .kind { font-size:10px; padding:2px 6px; border-radius:4px; background:#dbeafe; color:#1e40af; vertical-align:middle; }
    .tbl-hdr .meta { font-size:12px; color:var(--muted); }
    table { width:100%; border-collapse:collapse; font-size:12px; }
    th, td { padding:7px 10px; border-bottom:1px solid #e2e8f0; text-align:left; }
    th { background:#f1f5f9; font-weight:700; color:#334155; }
    td.num { text-align:center; color:var(--muted); }
    td.mono { font-family:Consolas,'Courier New',monospace; font-size:11.5px; }
    .badge { display:inline-block; padding:2px 6px; border-radius:4px; font-size:10.5px; font-weight:700; }
    .badge.pk { background:#fef3c7; color:#92400e; }
    .badge.fk { background:#e0f2fe; color:#075985; }
    @media print {
      aside, .print-btn { display:none !important; }
      body { background:#fff; }
      main { padding:0; max-width:100%; }
    }
  </style>
</head>
<body>
  <aside>
    <h3>📘 Daftar Tabel (${tables.length})</h3>
    <input type="text" id="q" placeholder="Cari tabel atau kolom..." oninput="filterDictionary(this.value)" />
    <div id="toc">${tocItems}</div>
  </aside>
  <main>
    <header class="doc-cover">
      <button class="print-btn" onclick="window.print()">🖨️ Cetak / Simpan PDF</button>
      <div class="org">${escapeHtml(org)}</div>
      <h1>${escapeHtml(title)}</h1>
      <div style="font-size:12.5px;color:#475569">Engine: <strong>${escapeHtml(
        snap.engine.toUpperCase()
      )}</strong> • Server Profile: <strong>${escapeHtml(
        snap.profileName
      )}</strong> • Dicetak otomatis oleh <strong>HMW Studio</strong> pada ${escapeHtml(generatedDate)}</div>
      <div class="stats">
        <div class="stat-box"><div class="lbl">Database</div><div class="val">${escapeHtml(
          snap.currentDatabase || '-'
        )}</div></div>
        <div class="stat-box"><div class="lbl">Total Tabel &amp; View</div><div class="val">${tables.length.toLocaleString(
          'id-ID'
        )}</div></div>
        <div class="stat-box"><div class="lbl">Total Kolom</div><div class="val">${totalCols.toLocaleString(
          'id-ID'
        )}</div></div>
        <div class="stat-box"><div class="lbl">Relasi Foreign Key</div><div class="val">${totalFks.toLocaleString(
          'id-ID'
        )}</div></div>
      </div>
    </header>
    ${tableSections}
  </main>
  <script>
    function filterDictionary(val) {
      var q = (val || '').toLowerCase().trim();
      document.querySelectorAll('.tbl-card').forEach(function(el) {
        el.style.display = !q || el.getAttribute('data-search').indexOf(q) !== -1 ? '' : 'none';
      });
      document.querySelectorAll('.toc-link').forEach(function(el) {
        el.style.display = !q || el.getAttribute('data-name').indexOf(q) !== -1 ? '' : 'none';
      });
    }
  </script>
</body>
</html>`;
}
