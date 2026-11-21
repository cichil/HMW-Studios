import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  FileSpreadsheet,
  FlaskConical,
  Upload,
  X
} from 'lucide-react';
import type { DbTabularImportResult } from '@shared/types';
import {
  normalizeImportCellValue,
  parseClipboardTabularText,
  type ParsedXlsxSheet,
  type ParsedXlsxWorkbook
} from '@shared/xlsxReader';
import { useIdeStore } from '../store/useIdeStore';

export const ExcelImportModal: React.FC = () => {
  const {
    excelImportModalOpen,
    excelImportTargetTable,
    closeExcelImportModal,
    selectedDbProfileId,
    dbSchema,
    loadDbSchema,
    showToast
  } = useIdeStore();

  const [workbook, setWorkbook] = useState<ParsedXlsxWorkbook | null>(null);
  const [selectedSheetIdx, setSelectedSheetIdx] = useState(0);
  const [targetTable, setTargetTable] = useState('');
  const [importMode, setImportMode] = useState<'insert' | 'upsert'>('insert');
  // Maps sourceHeader index -> target DB column name ('' means skip column)
  const [columnMapping, setColumnMapping] = useState<string[]>([]);
  const [pasteBoxOpen, setPasteBoxOpen] = useState(false);
  const [rawPasteText, setRawPasteText] = useState('');
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<DbTabularImportResult | null>(null);

  useEffect(() => {
    if (excelImportModalOpen) {
      setTargetTable(excelImportTargetTable || dbSchema?.tables[0]?.name || '');
      setLastResult(null);
      if (selectedDbProfileId && !dbSchema) {
        void loadDbSchema(selectedDbProfileId);
      }
    }
  }, [excelImportModalOpen, excelImportTargetTable, dbSchema, selectedDbProfileId, loadDbSchema]);

  const activeSheet: ParsedXlsxSheet | null = useMemo(
    () => workbook?.sheets[selectedSheetIdx] ?? null,
    [workbook, selectedSheetIdx]
  );

  const targetTableMeta = useMemo(
    () =>
      dbSchema?.tables.find((t) => t.name.toLowerCase() === targetTable.toLowerCase()) ?? null,
    [dbSchema, targetTable]
  );

  // Auto-match Excel headers to DB column names whenever sheet or target table changes
  useEffect(() => {
    if (!activeSheet) {
      setColumnMapping([]);
      return;
    }
    const dbCols = targetTableMeta?.columns ?? [];
    const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const auto = activeSheet.headers.map((hdr) => {
      const nh = norm(hdr);
      if (!nh) return '';
      const exact = dbCols.find((c) => c.name.toLowerCase() === hdr.trim().toLowerCase());
      if (exact) return exact.name;
      const fuzzy = dbCols.find((c) => norm(c.name) === nh);
      return fuzzy ? fuzzy.name : '';
    });
    setColumnMapping(auto);
  }, [activeSheet, targetTableMeta]);

  const handleOpenXlsxFile = async (): Promise<void> => {
    try {
      const res = await window.aptana.db.openXlsxWorkbook();
      if (!res.canceled && res.workbook) {
        setWorkbook(res.workbook);
        setSelectedSheetIdx(0);
        setPasteBoxOpen(false);
        setLastResult(null);
      }
    } catch (err) {
      showToast(`Gagal membaca file Excel: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleApplyClipboardText = (text: string): void => {
    const parsed = parseClipboardTabularText(text);
    if (parsed.headers.length === 0) {
      showToast('Data tempelan kosong. Salin sel beserta baris judul dari Excel terlebih dahulu.');
      return;
    }
    setWorkbook({ filePath: 'Clipboard Excel (Ctrl+V)', sheets: [parsed] });
    setSelectedSheetIdx(0);
    setPasteBoxOpen(false);
    setLastResult(null);
  };

  const handleRunImport = async (dryRun: boolean): Promise<void> => {
    if (!selectedDbProfileId) {
      showToast('Pilih profil koneksi Database terlebih dahulu.');
      return;
    }
    if (!targetTable) {
      showToast('Pilih tabel tujuan terlebih dahulu.');
      return;
    }
    if (!activeSheet || activeSheet.rows.length === 0) {
      showToast('Muat file .XLSX atau tempel data Excel terlebih dahulu.');
      return;
    }

    const activeIdxPairs = columnMapping
      .map((targetCol, srcIdx) => ({
        srcIdx,
        sourceHeader: activeSheet.headers[srcIdx] ?? `Kol_${srcIdx + 1}`,
        targetColumn: targetCol
      }))
      .filter((m) => m.targetColumn.trim().length > 0);

    if (activeIdxPairs.length === 0) {
      showToast('Petakan minimal 1 kolom Excel ke kolom Database tujuan.');
      return;
    }

    if (!dryRun) {
      const ok = window.confirm(
        `Impor permanen ${activeSheet.rows.length} baris ke tabel "${targetTable}" (Mode: ${importMode.toUpperCase()})?`
      );
      if (!ok) return;
    }

    setRunning(true);
    setLastResult(null);
    try {
      const projectedRows = activeSheet.rows.map((r) =>
        activeIdxPairs.map((pair) => r[pair.srcIdx] ?? '')
      );
      const res = await window.aptana.db.importTabular(selectedDbProfileId, {
        database: dbSchema?.currentDatabase,
        table: targetTable,
        mode: importMode,
        dryRun,
        columns: activeIdxPairs.map((p) => ({
          sourceHeader: p.sourceHeader,
          targetColumn: p.targetColumn
        })),
        rows: projectedRows
      });
      setLastResult(res);
      if (!res.errorMessage && !dryRun) {
        showToast(`✅ ${res.processedRows} baris berhasil diimpor ke "${targetTable}"!`);
      }
    } catch (err) {
      showToast(`Gagal menjalankan impor: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  if (!excelImportModalOpen) return null;

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        style={{
          width: 'min(1040px, 95vw)',
          minHeight: 460,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                background: 'rgba(16, 185, 129, 0.14)',
                border: '1px solid rgba(52, 211, 153, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <FileSpreadsheet size={18} color="#34d399" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--text-primary)' }}>
                Enterprise Excel (.XLSX) &amp; Clipboard Importer
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                Multi-Sheet .XLSX • Proteksi Leading-Zero NIP/NIK/KBLI • Tanggal Indonesia • Uji Transaksi Dry-Run Rollback
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn-modal-exit"
            onClick={closeExcelImportModal}
            title="Keluar / Tutup Jendela"
          >
            <X size={14} />
            <span>Keluar</span>
          </button>
        </div>

        <div style={{ flex: 1, padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Source & Target Controls */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              gap: 10,
              padding: 12,
              borderRadius: 8,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)'
            }}
          >
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                1. Sumber Data Excel
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-primary" onClick={() => void handleOpenXlsxFile()}>
                  <FileSpreadsheet size={13} /> Pilih File .XLSX
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setPasteBoxOpen((v) => !v)}
                >
                  <ClipboardPaste size={13} /> Paste Excel (Ctrl+V)
                </button>
              </div>
            </div>

            {workbook && workbook.sheets.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                  2. Lembar Kerja (Sheet)
                </div>
                <select
                  className="form-input"
                  style={{ width: '100%' }}
                  value={selectedSheetIdx}
                  onChange={(e) => setSelectedSheetIdx(Number(e.target.value))}
                >
                  {workbook.sheets.map((sh, idx) => (
                    <option key={sh.name + idx} value={idx}>
                      {sh.name} ({sh.rows.length} baris)
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                3. Tabel Database Tujuan ({dbSchema?.currentDatabase || 'Aktif'})
              </div>
              <select
                className="form-input"
                style={{ width: '100%' }}
                value={targetTable}
                onChange={(e) => setTargetTable(e.target.value)}
              >
                <option value="">-- Pilih Tabel Tujuan --</option>
                {(dbSchema?.tables ?? [])
                  .filter((t) => t.kind === 'table')
                  .map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name} ({t.columns.length} kolom)
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                4. Mode Penulisan
              </div>
              <select
                className="form-input"
                style={{ width: '100%' }}
                value={importMode}
                onChange={(e) => setImportMode(e.target.value as 'insert' | 'upsert')}
              >
                <option value="insert">INSERT Murni (Tambah Baris Baru)</option>
                <option value="upsert">UPSERT (Perbarui Jika PK Sudah Ada)</option>
              </select>
            </div>
          </div>

          {pasteBoxOpen && (
            <div
              style={{
                padding: 10,
                borderRadius: 8,
                background: 'var(--bg-surface)',
                border: '1px solid var(--accent)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}
            >
              <div style={{ fontSize: 11.5, fontWeight: 600 }}>
                Salin blok sel (termasuk baris Header) dari Microsoft Excel / Google Sheets lalu tekan Ctrl+V di bawah:
              </div>
              <textarea
                className="form-input"
                rows={5}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, width: '100%' }}
                placeholder="nip&#9;nama_pegawai&#9;tgl_lahir&#10;198504122010011009&#9;Budi Santoso&#9;12 Mei 1985"
                value={rawPasteText}
                onChange={(e) => setRawPasteText(e.target.value)}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <button type="button" className="btn" onClick={() => setPasteBoxOpen(false)}>
                  Batal
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleApplyClipboardText(rawPasteText)}
                >
                  Gunakan Data Tempelan
                </button>
              </div>
            </div>
          )}

          {/* Column Mapper & Normalized Preview */}
          {activeSheet && (
            <div
              style={{
                padding: 12,
                borderRadius: 8,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 12.5 }}>
                  Pemetaan Kolom Excel → Kolom Tabel &ldquo;{targetTable || '?'}&rdquo; ({activeSheet.rows.length.toLocaleString('id-ID')} baris siap diproses)
                </div>
                <span style={{ fontSize: 11, color: '#6ee7b7' }}>
                  ✓ Leading-zero (01111 / NIP / NIK) otomatis dijaga utuh pada kolom VARCHAR/CHAR
                </span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                  <thead>
                    <tr style={{ background: 'rgba(15, 23, 42, 0.65)', textAlign: 'left' }}>
                      <th style={{ padding: '6px 8px' }}>Header Excel</th>
                      <th style={{ padding: '6px 8px' }}>Petakan ke Kolom DB</th>
                      <th style={{ padding: '6px 8px' }}>Tipe DB</th>
                      <th style={{ padding: '6px 8px' }}>Contoh Nilai Asli</th>
                      <th style={{ padding: '6px 8px' }}>Hasil Normalisasi Aman</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeSheet.headers.map((hdr, idx) => {
                      const mappedCol = columnMapping[idx] ?? '';
                      const colMeta = targetTableMeta?.columns.find(
                        (c) => c.name === mappedCol
                      );
                      const sampleRaw = activeSheet.rows[0]?.[idx] ?? '';
                      const sampleNormalized = mappedCol
                        ? normalizeImportCellValue(
                            sampleRaw,
                            colMeta?.dataType || 'varchar',
                            colMeta?.nullable ?? true
                          )
                        : null;
                      return (
                        <tr
                          key={hdr + idx}
                          style={{ borderTop: '1px solid var(--border-subtle)' }}
                        >
                          <td style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                            {hdr}
                          </td>
                          <td style={{ padding: '5px 8px' }}>
                            <select
                              className="form-input"
                              style={{ fontSize: 11.5, padding: '3px 6px', minWidth: 180 }}
                              value={mappedCol}
                              onChange={(e) => {
                                const val = e.target.value;
                                setColumnMapping((prev) =>
                                  prev.map((old, i) => (i === idx ? val : old))
                                );
                              }}
                            >
                              <option value="">-- Abaikan Kolom Ini --</option>
                              {(targetTableMeta?.columns ?? []).map((c) => (
                                <option key={c.name} value={c.name}>
                                  {c.name} {c.isPrimaryKey ? '(PK)' : ''}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                            {colMeta ? `${colMeta.columnType}${colMeta.nullable ? '' : ' NOT NULL'}` : '-'}
                          </td>
                          <td style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)' }}>
                            {sampleRaw || <em style={{ color: 'var(--text-muted)' }}>(kosong)</em>}
                          </td>
                          <td style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)', color: '#7dd3fc' }}>
                            {mappedCol ? JSON.stringify(sampleNormalized) : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Dry-Run / Commit Result Banner */}
          {lastResult && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                background: lastResult.errorMessage
                  ? 'rgba(239, 68, 68, 0.14)'
                  : lastResult.dryRun
                    ? 'rgba(56, 189, 248, 0.14)'
                    : 'rgba(16, 185, 129, 0.14)',
                border: lastResult.errorMessage
                  ? '1px solid rgba(239, 68, 68, 0.45)'
                  : lastResult.dryRun
                    ? '1px solid rgba(56, 189, 248, 0.45)'
                    : '1px solid rgba(16, 185, 129, 0.45)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 12
              }}
            >
              {lastResult.errorMessage ? (
                <AlertTriangle size={18} color="#f87171" />
              ) : (
                <CheckCircle2 size={18} color={lastResult.dryRun ? '#38bdf8' : '#34d399'} />
              )}
              <div>
                {lastResult.errorMessage ? (
                  <>
                    <div style={{ fontWeight: 700, color: '#fca5a5' }}>
                      Gagal pada Baris ke-{lastResult.errorRowIndex} — Seluruh Transaksi Di-ROLLBACK Aman (0 baris bocor)!
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, marginTop: 2 }}>
                      {lastResult.errorMessage}
                    </div>
                  </>
                ) : lastResult.dryRun ? (
                  <div style={{ fontWeight: 700, color: '#bae6fd' }}>
                    🧪 Uji Dry-Run LULUS 100%! Seluruh {lastResult.processedRows} baris valid terhadap tipe kolom, NOT NULL, &amp; Foreign Key ({lastResult.durationMs}ms • Transaksi telah di-ROLLBACK otomatis). Siap diimpor permanen!
                  </div>
                ) : (
                  <div style={{ fontWeight: 700, color: '#a7f3d0' }}>
                    ✅ Impor Permanen (COMMIT) Berhasil! {lastResult.processedRows} baris masuk ke tabel &ldquo;{targetTable}&rdquo; dalam {lastResult.durationMs}ms.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Action Footer */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              className="btn"
              disabled={running || !activeSheet}
              onClick={() => void handleRunImport(true)}
            >
              <FlaskConical size={14} color="#38bdf8" />
              {running ? 'Memvalidasi...' : '🧪 Uji Dry-Run (Transaksi Rollback)'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={running || !activeSheet}
              onClick={() => void handleRunImport(false)}
            >
              <Upload size={14} />
              {running ? 'Mengimpor...' : '✅ Impor Permanen (Commit)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
