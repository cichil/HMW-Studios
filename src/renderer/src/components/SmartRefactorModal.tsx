import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Code2,
  FilePlus2,
  FolderSearch,
  Pencil,
  RefreshCw,
  X
} from 'lucide-react';
import {
  buildExtractedFunctionCode,
  buildExtractedIncludeResult,
  extractPhpVariablesForFunction,
  inferSymbolKind,
  previewSmartSymbolRename,
  type RefactorSymbolKind,
  type SmartRenameFileInput
} from '@shared/smartRefactorEngine';
import {
  getTabHistoryKey,
  normalizeRemoteRelPath,
  useIdeStore
} from '../store/useIdeStore';

export const SmartRefactorModal: React.FC = () => {
  const {
    smartRefactorRequest,
    closeSmartRefactor,
    tabs,
    workspacePath,
    selectedConnectionId,
    updateTabContent,
    openFileInTab,
    openRemoteFileInTab,
    showToast
  } = useIdeStore();

  const targetTab = useMemo(
    () => tabs.find((t) => t.id === smartRefactorRequest?.tabId) ?? null,
    [tabs, smartRefactorRequest?.tabId]
  );

  // Rename state
  const [oldSymbol, setOldSymbol] = useState('');
  const [newSymbol, setNewSymbol] = useState('');
  const [symbolKind, setSymbolKind] = useState<RefactorSymbolKind>('identifier');
  const [renameScope, setRenameScope] = useState<'open-tabs' | 'workspace'>('open-tabs');
  const [workspaceInputs, setWorkspaceInputs] = useState<SmartRenameFileInput[]>([]);
  const [scanningFiles, setScanningFiles] = useState(false);
  const [applying, setApplying] = useState(false);

  // Extract state
  const [extractKind, setExtractKind] = useState<'function' | 'include'>('function');
  const [fnName, setFnName] = useState('prosesData');
  const [returnVar, setReturnVar] = useState('');
  const [includeFileName, setIncludeFileName] = useState('partial_komponen.inc.php');

  useEffect(() => {
    if (!smartRefactorRequest) return;
    const initSym = smartRefactorRequest.initialSymbol?.trim() ?? '';
    setOldSymbol(initSym);
    setNewSymbol(initSym);
    setSymbolKind(inferSymbolKind(initSym || 'fungsi'));
    setRenameScope('open-tabs');
    setWorkspaceInputs([]);

    if (smartRefactorRequest.selectedCode) {
      const vars = extractPhpVariablesForFunction(smartRefactorRequest.selectedCode);
      setReturnVar(vars.assignedVars[0] ?? '');
      const baseTitle = (targetTab?.title ?? 'modul').replace(/\[.*?\]\s*/, '').replace(/\..*$/, '');
      setIncludeFileName(
        targetTab?.relativePath.toLowerCase().endsWith('.blade.php')
          ? `partials/${baseTitle}_bagian.blade.php`
          : `${baseTitle}_bagian.inc.php`
      );
    }
  }, [smartRefactorRequest, targetTab?.title, targetTab?.relativePath]);

  // Load workspace / remote files containing oldSymbol when scope === 'workspace'
  const scanProjectCandidates = async (): Promise<void> => {
    const cleanOld = oldSymbol.trim().replace(/^[.$]+/, '');
    if (cleanOld.length < 2) return;
    setScanningFiles(true);
    try {
      const inputs: SmartRenameFileInput[] = [];
      const openByRel = new Map<string, string>();
      for (const t of tabs) {
        if (t.kind !== 'code') continue;
        if (t.remoteConnectionId) {
          openByRel.set(
            `remote:${t.remoteConnectionId}:${normalizeRemoteRelPath(t.relativePath)}`,
            t.content
          );
        } else {
          openByRel.set(`local:${t.filePath}`, t.content);
        }
      }

      const activeConnId = targetTab?.remoteConnectionId ?? selectedConnectionId;
      if (targetTab?.remoteConnectionId && activeConnId) {
        const matches = await window.aptana.connections.searchRemoteFiles(
          activeConnId,
          '',
          cleanOld,
          true
        );
        const relSet = Array.from(new Set(matches.map((m) => normalizeRemoteRelPath(m.relativePath)))).slice(
          0,
          40
        );
        for (const rel of relSet) {
          const fKey = `remote:${activeConnId}:${rel}`;
          const content =
            openByRel.get(fKey) ??
            (await window.aptana.connections.readRemoteFile(activeConnId, rel));
          inputs.push({
            fileKey: fKey,
            displayPath: `☁ ${rel}`,
            content
          });
        }
      } else if (workspacePath) {
        const matches = await window.aptana.workspace.searchInFiles(workspacePath, cleanOld, true);
        const pathMap = new Map<string, string>();
        for (const m of matches) {
          if (!pathMap.has(m.filePath)) pathMap.set(m.filePath, m.relativePath);
        }
        const entries = Array.from(pathMap.entries()).slice(0, 60);
        for (const [fPath, rel] of entries) {
          const fKey = `local:${fPath}`;
          const content =
            openByRel.get(fKey) ?? (await window.aptana.workspace.readFile(fPath)).content;
          inputs.push({
            fileKey: fKey,
            displayPath: rel,
            content
          });
        }
      }
      setWorkspaceInputs(inputs);
    } catch (err) {
      showToast(`Gagal memindai proyek: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setScanningFiles(false);
    }
  };

  useEffect(() => {
    if (
      smartRefactorRequest?.mode === 'rename' &&
      renameScope === 'workspace' &&
      oldSymbol.trim().length >= 2
    ) {
      void scanProjectCandidates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renameScope, smartRefactorRequest?.mode]);

  const activeRenameInputs = useMemo<SmartRenameFileInput[]>(() => {
    if (renameScope === 'workspace') return workspaceInputs;
    return tabs
      .filter((t) => t.kind === 'code')
      .map((t) => ({
        fileKey: t.remoteConnectionId
          ? `remote:${t.remoteConnectionId}:${normalizeRemoteRelPath(t.relativePath)}`
          : `local:${t.filePath}`,
        displayPath: t.title,
        content: t.content
      }));
  }, [renameScope, workspaceInputs, tabs]);

  const renamePlan = useMemo(
    () =>
      previewSmartSymbolRename({
        oldSymbol,
        newSymbol,
        kind: symbolKind,
        files: activeRenameInputs
      }),
    [oldSymbol, newSymbol, symbolKind, activeRenameInputs]
  );

  const detectedVars = useMemo(
    () =>
      smartRefactorRequest?.selectedCode
        ? extractPhpVariablesForFunction(smartRefactorRequest.selectedCode)
        : { params: [], assignedVars: [] },
    [smartRefactorRequest?.selectedCode]
  );

  const extractPreview = useMemo(() => {
    const sel = smartRefactorRequest?.selectedCode ?? '';
    if (!sel) return null;
    if (extractKind === 'function') {
      return buildExtractedFunctionCode({
        selectedCode: sel,
        functionName: fnName,
        language: targetTab?.language ?? 'php',
        returnVar: returnVar || undefined
      });
    }
    const isBlade = Boolean(targetTab?.relativePath.toLowerCase().endsWith('.blade.php'));
    const inc = buildExtractedIncludeResult({
      selectedCode: sel,
      targetFileName: includeFileName,
      isBlade
    });
    return {
      callReplacement: inc.includeStatement,
      extractedDeclaration: inc.partialFileContent,
      suggestedIncludeFileName: inc.cleanFileName
    };
  }, [
    smartRefactorRequest?.selectedCode,
    extractKind,
    fnName,
    returnVar,
    includeFileName,
    targetTab?.language,
    targetTab?.relativePath
  ]);

  if (!smartRefactorRequest || !targetTab) return null;

  const handleApplyRename = async (): Promise<void> => {
    if (renamePlan.files.length === 0) return;
    setApplying(true);
    try {
      for (const fp of renamePlan.files) {
        if (fp.fileKey.startsWith('remote:')) {
          const rest = fp.fileKey.slice('remote:'.length);
          const sep = rest.indexOf(':');
          const connId = rest.slice(0, sep);
          const rel = rest.slice(sep + 1);
          const openTab = tabs.find(
            (t) =>
              t.remoteConnectionId === connId &&
              normalizeRemoteRelPath(t.relativePath) === rel
          );
          if (openTab) {
            const hKey = getTabHistoryKey(openTab);
            if (hKey) {
              await window.aptana.history
                .record({
                  fileKey: hKey,
                  label: `Sebelum Rename ${renamePlan.oldSymbol} -> ${renamePlan.newSymbol}`,
                  sourceKind: 'remote',
                  displayPath: openTab.filePath,
                  connectionId: connId,
                  relativePath: rel,
                  content: openTab.content
                })
                .catch(() => {});
            }
            updateTabContent(openTab.id, fp.newContent);
          }
          if (renameScope === 'workspace') {
            await window.aptana.connections.writeRemoteFile(connId, rel, fp.newContent);
          }
        } else if (fp.fileKey.startsWith('local:')) {
          const localPath = fp.fileKey.slice('local:'.length);
          const openTab = tabs.find((t) => !t.remoteConnectionId && t.filePath === localPath);
          if (openTab) {
            updateTabContent(openTab.id, fp.newContent);
          }
          if (renameScope === 'workspace') {
            await window.aptana.workspace.writeFile(localPath, fp.newContent);
          }
        }
      }
      showToast(
        `✏️ Smart Rename selesai: ${renamePlan.totalOccurrences} simbol diperbarui pada ${renamePlan.totalFilesModified} file.`
      );
      closeSmartRefactor();
    } catch (err) {
      showToast(`Gagal menerapkan Rename: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setApplying(false);
    }
  };

  const handleApplyExtract = async (): Promise<void> => {
    if (!extractPreview || !smartRefactorRequest.selectionRange) return;
    setApplying(true);
    try {
      const range = smartRefactorRequest.selectionRange;
      const lines = targetTab.content.split(/\r?\n/);
      const eol = targetTab.content.includes('\r\n') ? '\r\n' : '\n';

      const beforeStart = lines[range.startLineNumber - 1]?.slice(0, range.startColumn - 1) ?? '';
      const afterEnd = lines[range.endLineNumber - 1]?.slice(range.endColumn - 1) ?? '';

      const prefixLines = lines.slice(0, range.startLineNumber - 1);
      const suffixLines = lines.slice(range.endLineNumber);
      const middleReplaced = `${beforeStart}${extractPreview.callReplacement}${afterEnd}`;

      if (extractKind === 'function') {
        const rebuilt = [
          ...prefixLines,
          middleReplaced,
          ...suffixLines,
          extractPreview.extractedDeclaration
        ].join(eol);
        updateTabContent(targetTab.id, rebuilt);
        showToast(`🔧 Kode berhasil dipecah ke fungsi "${fnName}()"` );
        closeSmartRefactor();
        return;
      }

      // Extract to new include file in the same directory (Local or Remote SFTP!)
      const cleanName = extractPreview.suggestedIncludeFileName || 'partial.inc.php';
      const replacedSource = [...prefixLines, middleReplaced, ...suffixLines].join(eol);

      if (targetTab.remoteConnectionId) {
        const curRel = normalizeRemoteRelPath(targetTab.relativePath);
        const dirPart = curRel.includes('/') ? curRel.slice(0, curRel.lastIndexOf('/')) : '';
        const newRel = dirPart ? `${dirPart}/${cleanName}` : cleanName;
        await window.aptana.connections.writeRemoteFile(
          targetTab.remoteConnectionId,
          newRel,
          extractPreview.extractedDeclaration
        );
        updateTabContent(targetTab.id, replacedSource);
        await openRemoteFileInTab(targetTab.remoteConnectionId, newRel);
        showToast(`📄 File include remote dibuat & dibuka: ${newRel}`);
      } else {
        const sep = targetTab.filePath.includes('\\') ? '\\' : '/';
        const lastSep = Math.max(
          targetTab.filePath.lastIndexOf('\\'),
          targetTab.filePath.lastIndexOf('/')
        );
        const dirPath = lastSep >= 0 ? targetTab.filePath.slice(0, lastSep) : workspacePath ?? '';
        const newFullPath = `${dirPath}${sep}${cleanName.replace(/[/\\]/g, sep)}`;
        await window.aptana.workspace.createEntry(
          newFullPath,
          false,
          extractPreview.extractedDeclaration
        );
        updateTabContent(targetTab.id, replacedSource);
        await openFileInTab(newFullPath, cleanName);
        showToast(`📄 File include lokal dibuat & dibuka: ${cleanName}`);
      }
      closeSmartRefactor();
    } catch (err) {
      showToast(`Gagal mengekstrak kode: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        style={{
          width: 'min(720px, 95vw)',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, minHeight: 30 }}>
            {smartRefactorRequest.mode === 'rename' ? (
              <Pencil size={17} color="var(--accent)" style={{ flexShrink: 0 }} />
            ) : (
              <Code2 size={17} color="#34d399" style={{ flexShrink: 0 }} />
            )}
            <strong style={{ fontSize: 13.5 }}>
              {smartRefactorRequest.mode === 'rename'
                ? '✏️ Smart Rename Symbol Lintas File (Word-Boundary Presisi)'
                : '📦 Pecah Seleksi Kode ke Fungsi / File Include Baru'}
            </strong>
          </div>
          <button type="button" className="btn-modal-exit" onClick={closeSmartRefactor}>
            <X size={14} />
            <span>Keluar</span>
          </button>
        </div>

        <div className="modal-body">
          {smartRefactorRequest.mode === 'rename' ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.9fr', gap: 8 }}>
              <div>
                <label className="form-label">Nama Simbol Asal</label>
                <input
                  className="form-input"
                  style={{ fontFamily: 'var(--font-mono)' }}
                  value={oldSymbol}
                  onChange={(e) => {
                    setOldSymbol(e.target.value);
                    setSymbolKind(inferSymbolKind(e.target.value));
                  }}
                />
              </div>
              <div>
                <label className="form-label">Nama Simbol Baru</label>
                <input
                  className="form-input"
                  style={{ fontFamily: 'var(--font-mono)' }}
                  autoFocus
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value)}
                />
              </div>
              <div>
                <label className="form-label">Jenis Simbol</label>
                <select
                  className="form-input"
                  value={symbolKind}
                  onChange={(e) => setSymbolKind(e.target.value as RefactorSymbolKind)}
                >
                  <option value="identifier">Fungsi / Class / Kolom</option>
                  <option value="php-variable">Variabel PHP ($var)</option>
                  <option value="css-class">CSS Class (.class)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className={`btn ${renameScope === 'open-tabs' ? 'btn-accent' : ''}`}
                  style={{ padding: '4px 10px', fontSize: 11.5 }}
                  onClick={() => setRenameScope('open-tabs')}
                >
                  Tab Sedang Dibuka ({tabs.filter((t) => t.kind === 'code').length})
                </button>
                <button
                  type="button"
                  className={`btn ${renameScope === 'workspace' ? 'btn-accent' : ''}`}
                  style={{ padding: '4px 10px', fontSize: 11.5 }}
                  onClick={() => setRenameScope('workspace')}
                >
                  <FolderSearch size={12.5} />
                  <span>
                    {targetTab.remoteConnectionId
                      ? 'Seluruh Server Remote SFTP'
                      : 'Seluruh Proyek Lokal'}
                  </span>
                </button>
              </div>
              {renameScope === 'workspace' && (
                <button
                  type="button"
                  className="btn btn-xs"
                  disabled={scanningFiles}
                  onClick={() => void scanProjectCandidates()}
                >
                  <RefreshCw size={11} className={scanningFiles ? 'spin' : undefined} />
                  <span>Pindai Ulang</span>
                </button>
              )}
            </div>

            <div
              style={{
                flex: 1,
                minHeight: 160,
                maxHeight: 300,
                overflowY: 'auto',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-app)',
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}
            >
              {scanningFiles ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                  Memindai pemakaian simbol di seluruh file...
                </div>
              ) : renamePlan.files.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                  Ketik nama simbol baru yang berbeda untuk melihat pratinjau perubahan presisi.
                </div>
              ) : (
                renamePlan.files.map((fp) => (
                  <div
                    key={fp.fileKey}
                    style={{
                      padding: 8,
                      borderRadius: 7,
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>
                      {fp.displayPath} ({fp.occurrencesCount} kemunculan)
                    </div>
                    {fp.sampleOccurrences.map((s, idx) => (
                      <div
                        key={idx}
                        style={{
                          fontSize: 11,
                          fontFamily: 'var(--font-mono)',
                          padding: '2px 0',
                          color: 'var(--text-secondary)'
                        }}
                      >
                        <span style={{ color: 'var(--accent)' }}>:{s.line}</span>{' '}
                        <span style={{ color: '#fda4af', textDecoration: 'line-through' }}>
                          {s.beforeLine}
                        </span>{' '}
                        → <span style={{ color: '#86efac' }}>{s.afterLine}</span>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                Total perubahan: <strong>{renamePlan.totalOccurrences}</strong> titik pada{' '}
                <strong>{renamePlan.totalFilesModified}</strong> file
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn" onClick={closeSmartRefactor}>
                  Batal
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={applying || renamePlan.files.length === 0}
                  onClick={() => void handleApplyRename()}
                >
                  <Check size={13} />
                  <span>{applying ? 'Menerapkan...' : 'Terapkan Smart Rename'}</span>
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className={`btn ${extractKind === 'function' ? 'btn-accent' : ''}`}
                onClick={() => setExtractKind('function')}
              >
                <Code2 size={13} />
                <span>Pecah ke Fungsi Baru (`function`)</span>
              </button>
              <button
                type="button"
                className={`btn ${extractKind === 'include' ? 'btn-accent' : ''}`}
                onClick={() => setExtractKind('include')}
              >
                <FilePlus2 size={13} />
                <span>Pecah ke File `include` / Partial Baru</span>
              </button>
            </div>

            {extractKind === 'function' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 8 }}>
                <div>
                  <label className="form-label">Nama Fungsi Baru</label>
                  <input
                    className="form-input"
                    style={{ fontFamily: 'var(--font-mono)' }}
                    value={fnName}
                    onChange={(e) => setFnName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label">Variabel Return (Opsional)</label>
                  <select
                    className="form-input"
                    value={returnVar}
                    onChange={(e) => setReturnVar(e.target.value)}
                  >
                    <option value="">— Tanpa Return —</option>
                    {detectedVars.assignedVars.map((v) => (
                      <option key={v} value={v}>
                        return {v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div>
                <label className="form-label">
                  Nama File Include Baru (otomatis dibuat sefolder di{' '}
                  {targetTab.remoteConnectionId ? 'Server Remote SFTP' : 'Folder Lokal'})
                </label>
                <input
                  className="form-input"
                  style={{ fontFamily: 'var(--font-mono)' }}
                  value={includeFileName}
                  onChange={(e) => setIncludeFileName(e.target.value)}
                />
              </div>
            )}

            {extractPreview && (
              <div
                style={{
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-app)',
                  padding: 10,
                  maxHeight: 250,
                  overflowY: 'auto'
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Pengganti di baris seleksi: <code>{extractPreview.callReplacement}</code>
                </div>
                <pre
                  style={{
                    margin: 0,
                    fontSize: 11.5,
                    fontFamily: 'var(--font-mono)',
                    color: '#86efac',
                    whiteSpace: 'pre-wrap'
                  }}
                >
                  {extractPreview.extractedDeclaration}
                </pre>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={closeSmartRefactor}>
                Batal
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={applying || !extractPreview}
                onClick={() => void handleApplyExtract()}
              >
                <Check size={13} />
                <span>
                  {applying
                    ? 'Memproses...'
                    : extractKind === 'function'
                      ? 'Buat Fungsi & Ganti Seleksi'
                      : 'Buat File Include & Buka Tab'}
                </span>
              </button>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
};
