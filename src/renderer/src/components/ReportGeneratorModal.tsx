import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CloudUpload,
  Copy,
  FileSpreadsheet,
  FolderPlus,
  Printer,
  X
} from 'lucide-react';
import {
  generatePhpReportBundle,
  type PhpReportFlavor
} from '@shared/phpReportGenerator';
import { normalizeRemoteRelPath, useIdeStore } from '../store/useIdeStore';

export const ReportGeneratorModal: React.FC = () => {
  const {
    reportGeneratorDraft,
    closeReportGenerator,
    workspacePath,
    connections,
    selectedConnectionId,
    remoteSubPath,
    wisanggeniSummary,
    laravelSummary,
    openFileInTab,
    openRemoteFileInTab,
    refreshTree,
    browseRemoteDir,
    showToast
  } = useIdeStore();

  const [moduleSlug, setModuleSlug] = useState('laporan_rekap');
  const [reportTitle, setReportTitle] = useState('Laporan Rekapitulasi Data');
  const [instansi, setInstansi] = useState('Pemerintah Daerah / Instansi');
  const [flavor, setFlavor] = useState<PhpReportFlavor>('wisanggeni');
  const [sqlText, setSqlText] = useState('');
  const [previewTab, setPreviewTab] = useState<'cetak' | 'excel' | 'snippet'>('cetak');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const selectedConn = useMemo(
    () => connections.find((c) => c.id === selectedConnectionId) ?? null,
    [connections, selectedConnectionId]
  );

  useEffect(() => {
    if (!reportGeneratorDraft) return;
    setSqlText(reportGeneratorDraft.sqlQuery);
    if (reportGeneratorDraft.suggestedSlug) {
      setModuleSlug(reportGeneratorDraft.suggestedSlug);
    }
    if (reportGeneratorDraft.suggestedTitle) {
      setReportTitle(reportGeneratorDraft.suggestedTitle);
    }
    if (laravelSummary?.isLaravelProject) {
      setFlavor('laravel');
    } else if (wisanggeniSummary?.available) {
      setFlavor('wisanggeni');
    } else {
      setFlavor('wisanggeni');
    }
  }, [reportGeneratorDraft, laravelSummary?.isLaravelProject, wisanggeniSummary?.available]);

  const bundle = useMemo(() => {
    if (!reportGeneratorDraft) return null;
    return generatePhpReportBundle({
      moduleSlug,
      reportTitle,
      subtitleOrInstansi: instansi,
      sqlQuery: sqlText,
      columns: reportGeneratorDraft.columns ?? [],
      flavor
    });
  }, [reportGeneratorDraft, moduleSlug, reportTitle, instansi, sqlText, flavor]);

  if (!reportGeneratorDraft || !bundle) return null;

  const activePreviewCode =
    previewTab === 'cetak'
      ? bundle.cetakContent
      : previewTab === 'excel'
        ? bundle.excelContent
        : bundle.buttonSnippetHtml;

  const handleSaveToLocal = async (): Promise<void> => {
    if (!workspacePath) {
      showToast('Buka folder proyek lokal terlebih dahulu.');
      return;
    }
    setSaving(true);
    try {
      const sep = workspacePath.includes('\\') ? '\\' : '/';
      const base = workspacePath.replace(/[/\\]+$/, '');
      const cetakPath = `${base}${sep}${bundle.cetakFileName}`;
      const excelPath = `${base}${sep}${bundle.excelFileName}`;

      await window.aptana.workspace.createEntry(cetakPath, false, bundle.cetakContent);
      await window.aptana.workspace.createEntry(excelPath, false, bundle.excelContent);
      await refreshTree();
      await openFileInTab(cetakPath, bundle.cetakFileName);
      await openFileInTab(excelPath, bundle.excelFileName);
      showToast(`📊 File ${bundle.cetakFileName} & ${bundle.excelFileName} berhasil dibuat!`);
      closeReportGenerator();
    } catch (err) {
      showToast(`Gagal menyimpan file laporan: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveToRemote = async (): Promise<void> => {
    if (!selectedConnectionId) {
      showToast('Pilih koneksi Server Remote SFTP terlebih dahulu.');
      return;
    }
    setSaving(true);
    try {
      const sub = normalizeRemoteRelPath(remoteSubPath);
      const cetakRel = sub ? `${sub}/${bundle.cetakFileName}` : bundle.cetakFileName;
      const excelRel = sub ? `${sub}/${bundle.excelFileName}` : bundle.excelFileName;

      await window.aptana.connections.writeRemoteFile(
        selectedConnectionId,
        cetakRel,
        bundle.cetakContent
      );
      await window.aptana.connections.writeRemoteFile(
        selectedConnectionId,
        excelRel,
        bundle.excelContent
      );
      await browseRemoteDir(remoteSubPath);
      await openRemoteFileInTab(selectedConnectionId, cetakRel);
      await openRemoteFileInTab(selectedConnectionId, excelRel);
      showToast(
        `☁ File laporan diunggah ke ${selectedConn?.name || 'Server'}: ${cetakRel} & ${excelRel}`
      );
      closeReportGenerator();
    } catch (err) {
      showToast(`Gagal mengunggah laporan ke server: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        style={{
          width: 'min(920px, 95vw)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <FileSpreadsheet size={18} color="#34d399" style={{ flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                📊 Generator Otomatis Modul Laporan PHP (`*_cetak.php` &amp; `*_excel.php`)
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Dilengkapi Kop Laporan, tanggal Bahasa Indonesia, baris <code>TOTAL (SUM)</code> otomatis, &amp; proteksi NIP 18-digit anti-rusak di Excel.
              </div>
            </div>
          </div>
          <button type="button" className="btn-modal-exit" onClick={closeReportGenerator}>
            <X size={14} />
            <span>Keluar</span>
          </button>
        </div>

        <div className="modal-body" style={{ gap: 11 }}>
          {/* Inputs */}
        <div style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.2fr 1.1fr 0.9fr', gap: 8 }}>
          <div>
            <label className="form-label">Nama Dasar Modul</label>
            <input
              className="form-input"
              style={{ fontFamily: 'var(--font-mono)' }}
              value={moduleSlug}
              onChange={(e) => setModuleSlug(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">Judul Laporan</label>
            <input
              className="form-input"
              value={reportTitle}
              onChange={(e) => setReportTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">Nama Instansi / Kop</label>
            <input
              className="form-input"
              value={instansi}
              onChange={(e) => setInstansi(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">Gaya Framework PHP</label>
            <select
              className="form-input"
              value={flavor}
              onChange={(e) => setFlavor(e.target.value as PhpReportFlavor)}
            >
              <option value="wisanggeni">Wisanggeni ($query-&gt;dosql)</option>
              <option value="mysqli-native">PHP Native (mysqli)</option>
              <option value="laravel">Laravel (Controller + Blade)</option>
            </select>
          </div>
        </div>

        <div>
          <label className="form-label">Query SQL Sumber Laporan</label>
          <textarea
            className="form-input"
            rows={3}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, resize: 'vertical' }}
            value={sqlText}
            onChange={(e) => setSqlText(e.target.value)}
          />
        </div>

        {/* Preview Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 5 }}>
            <button
              type="button"
              className={`btn ${previewTab === 'cetak' ? 'btn-accent' : ''}`}
              style={{ padding: '4px 10px', fontSize: 11.5 }}
              onClick={() => setPreviewTab('cetak')}
            >
              <Printer size={12.5} />
              <span>{bundle.cetakFileName}</span>
            </button>
            <button
              type="button"
              className={`btn ${previewTab === 'excel' ? 'btn-accent' : ''}`}
              style={{ padding: '4px 10px', fontSize: 11.5 }}
              onClick={() => setPreviewTab('excel')}
            >
              <FileSpreadsheet size={12.5} />
              <span>{bundle.excelFileName}</span>
            </button>
            <button
              type="button"
              className={`btn ${previewTab === 'snippet' ? 'btn-accent' : ''}`}
              style={{ padding: '4px 10px', fontSize: 11.5 }}
              onClick={() => setPreviewTab('snippet')}
            >
              <span>Tombol Halaman Index</span>
            </button>
          </div>

          <button
            type="button"
            className="btn btn-xs"
            onClick={() => {
              void navigator.clipboard?.writeText(activePreviewCode);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            <span>{copied ? 'Disalin' : 'Salin Kode Tab Ini'}</span>
          </button>
        </div>

        <pre
          style={{
            flex: 1,
            minHeight: 190,
            maxHeight: 280,
            overflowY: 'auto',
            margin: 0,
            padding: 10,
            borderRadius: 8,
            background: 'var(--bg-app)',
            border: '1px solid var(--border-subtle)',
            fontSize: 11.5,
            fontFamily: 'var(--font-mono)',
            color: '#e2e8f0',
            whiteSpace: 'pre-wrap'
          }}
        >
          {activePreviewCode}
        </pre>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={closeReportGenerator}>
            Tutup
          </button>
          {workspacePath && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => void handleSaveToLocal()}
            >
              <FolderPlus size={13} />
              <span>Simpan &amp; Buka di Folder Lokal</span>
            </button>
          )}
          {selectedConn && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => void handleSaveToRemote()}
            >
              <CloudUpload size={13} />
              <span>
                Unggah &amp; Buka di Server {selectedConn.name}
                {remoteSubPath ? ` (/${remoteSubPath})` : ''}
              </span>
            </button>
          )}
          </div>
        </div>
      </div>
    </div>
  );
};
