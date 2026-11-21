import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  Check,
  CloudUpload,
  Copy,
  Database,
  FilePlus2,
  GitCompare,
  KeyRound,
  MessageSquare,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wand2
} from 'lucide-react';
import type {
  GeminiDocGenResponse,
  GeminiModelId,
  GeminiSqlAuditResponse,
  GeminiWisanggeniCrudResponse
} from '@shared/types';
import { normalizeRemoteRelPath, useIdeStore } from '../store/useIdeStore';

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  model?: string;
}

interface ParsedMessageSegment {
  kind: 'text' | 'code';
  content: string;
  language?: string;
}

function splitMarkdownCodeBlocks(raw: string): ParsedMessageSegment[] {
  const segments: ParsedMessageSegment[] = [];
  const regex = /```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null = regex.exec(raw);

  while (match) {
    if (match.index > lastIdx) {
      segments.push({
        kind: 'text',
        content: raw.slice(lastIdx, match.index)
      });
    }
    segments.push({
      kind: 'code',
      language: match[1] || 'php',
      content: match[2].replace(/\r?\n$/, '')
    });
    lastIdx = match.index + match[0].length;
    match = regex.exec(raw);
  }

  if (lastIdx < raw.length) {
    segments.push({
      kind: 'text',
      content: raw.slice(lastIdx)
    });
  }
  return segments;
}

export const GeminiSidebar: React.FC = () => {
  const {
    tabs,
    activeTabId,
    workspacePath,
    connections,
    selectedConnectionId,
    remoteSubPath,
    browseRemoteDir,
    refreshTree,
    openFileInTab,
    openRemoteFileInTab,
    insertTextIntoActiveTab,
    wisanggeniSummary,
    geminiConfig,
    geminiSubTab,
    setGeminiSubTab,
    saveGeminiConfig,
    selectedEditorText,
    applyAiCodeToTab,
    pendingCrudFromDb,
    consumePendingCrudFromDb,
    showToast
  } = useIdeStore();

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeCodeTab = useMemo(() => {
    if (activeTab?.kind === 'code') return activeTab;
    if (activeTab?.applyTargetTabId) {
      return tabs.find((t) => t.id === activeTab.applyTargetTabId && t.kind === 'code') ?? null;
    }
    return tabs.find((t) => t.kind === 'code') ?? null;
  }, [activeTab, tabs]);

  const activeConn = connections.find((c) => c.id === selectedConnectionId) ?? null;

  // ---------------- #1 CHAT STATE ----------------
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [lastInteractionId, setLastInteractionId] = useState<string | null>(null);
  const [chatPrompt, setChatPrompt] = useState('');
  const [includeActiveFile, setIncludeActiveFile] = useState(true);
  const [chatBusy, setChatBusy] = useState(false);

  // ---------------- #2 WISANGGENI CRUD STATE ----------------
  const [crudModuleName, setCrudModuleName] = useState('jenis_komoditi');
  const [crudModuleTitle, setCrudModuleTitle] = useState('Master Jenis Komoditi');
  const [crudSqlSpec, setCrudSqlSpec] = useState(
    `CREATE TABLE ref_jenis_komoditi (
  id_komoditi INT AUTO_INCREMENT PRIMARY KEY,
  kode_komoditi VARCHAR(20) NOT NULL,
  nama_komoditi VARCHAR(120) NOT NULL,
  satuan VARCHAR(30) DEFAULT 'Ton',
  aktif TINYINT(1) DEFAULT 1
);`
  );
  const [crudBusy, setCrudBusy] = useState(false);
  const [crudResult, setCrudResult] = useState<GeminiWisanggeniCrudResponse | null>(null);
  const [crudPreviewTab, setCrudPreviewTab] = useState<'idx' | 'form' | 'save'>('idx');

  // ---------------- #5 SQL & SECURITY AUDIT STATE ----------------
  const [auditMode, setAuditMode] = useState<'security-audit' | 'generate-sql' | 'explain-sql'>(
    'security-audit'
  );
  const [sqlPromptInput, setSqlPromptInput] = useState('');
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditResult, setAuditResult] = useState<GeminiSqlAuditResponse | null>(null);

  // ---------------- #7 DOCS GENERATOR STATE ----------------
  const [docSymbol, setDocSymbol] = useState('');
  const [docBusy, setDocBusy] = useState(false);
  const [docResult, setDocResult] = useState<GeminiDocGenResponse | null>(null);

  // ---------------- SETTINGS STATE ----------------
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [selectedModel, setSelectedModel] = useState<GeminiModelId>(
    geminiConfig?.model ?? 'gemini-4-hydrogen'
  );
  const [ghostEnabled, setGhostEnabled] = useState<boolean>(
    geminiConfig?.ghostTextEnabled ?? false
  );
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [testResultMsg, setTestResultMsg] = useState<string | null>(null);

  React.useEffect(() => {
    if (geminiConfig) {
      setSelectedModel(geminiConfig.model);
      setGhostEnabled(geminiConfig.ghostTextEnabled);
    }
  }, [geminiConfig]);

  React.useEffect(() => {
    if (!pendingCrudFromDb) return;
    const item = consumePendingCrudFromDb();
    if (item) {
      const cleanMod = item.tableName
        .replace(/^(ref_|mst_|tbl_|tb_|m_|t_)/i, '')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .toLowerCase();
      const prettyTitle = cleanMod
        .split('_')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      setCrudModuleName(cleanMod || item.tableName);
      setCrudModuleTitle(`Data ${prettyTitle || item.tableName}`);
      setCrudSqlSpec(item.ddl);
    }
  }, [pendingCrudFromDb, consumePendingCrudFromDb]);

  const ensureConfigured = (): boolean => {
    if (!geminiConfig?.hasApiKey) {
      setGeminiSubTab('settings');
      showToast('Masukkan GEMINI_API_KEY Anda terlebih dahulu pada tab Setelan AI.');
      return false;
    }
    return true;
  };

  const copyText = (txt: string, label = 'Kode'): void => {
    void navigator.clipboard.writeText(txt);
    showToast(`${label} disalin ke clipboard.`);
  };

  // ---------------- HANDLER #1: CHAT ----------------
  const handleSendChat = async (customPrompt?: string): Promise<void> => {
    const text = (customPrompt ?? chatPrompt).trim();
    if (!text || chatBusy) return;
    if (!ensureConfigured()) return;

    if (!customPrompt) setChatPrompt('');
    const userTurn: ChatTurn = { id: `u-${Date.now()}`, role: 'user', text };
    setChatTurns((prev) => [...prev, userTurn]);
    setChatBusy(true);

    try {
      const wsgSummary = wisanggeniSummary?.available
        ? `Framework Wisanggeni aktif (${wisanggeniSummary.classCount} Class, ${wisanggeniSummary.methodCount} Method, ${wisanggeniSummary.functionCount} Helper; objek global: $page:TPage, $query:TQuery, $pegawai:TPegawai, $db_conn:TConn).`
        : null;

      const res = await window.aptana.ai.chat({
        prompt: text,
        previousInteractionId: lastInteractionId,
        wisanggeniContextSummary: wsgSummary,
        activeFile:
          includeActiveFile && activeCodeTab
            ? {
                title: activeCodeTab.title,
                relativePath: activeCodeTab.relativePath,
                language: activeCodeTab.language,
                content: activeCodeTab.content,
                selectedCode: selectedEditorText || undefined,
                isRemote: Boolean(activeCodeTab.remoteConnectionId),
                connectionName: activeCodeTab.remoteConnectionName
              }
            : null
      });

      if (res.interactionId) {
        setLastInteractionId(res.interactionId);
      }
      setChatTurns((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: res.text || '(Tidak ada teks balasan)',
          model: res.model
        }
      ]);
    } catch (err) {
      setChatTurns((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          text: `⚠️ Gagal memanggil Gemini API: ${err instanceof Error ? err.message : String(err)}`
        }
      ]);
    } finally {
      setChatBusy(false);
    }
  };

  // ---------------- HANDLER #2: WISANGGENI 3-FILE CRUD ----------------
  const handleGenerateCrud = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!crudModuleName.trim() || !crudSqlSpec.trim() || crudBusy) return;
    if (!ensureConfigured()) return;

    setCrudBusy(true);
    try {
      const generated = await window.aptana.ai.generateWisanggeniCrud({
        moduleName: crudModuleName,
        moduleTitle: crudModuleTitle,
        sqlOrSpec: crudSqlSpec
      });
      setCrudResult(generated);
      setCrudPreviewTab('idx');
      showToast(`✨ 3 file CRUD Wisanggeni (${generated.idxFileName}, dll.) selesai dibuat!`);
    } catch (err) {
      showToast(`Gagal membuat CRUD: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCrudBusy(false);
    }
  };

  const handleSaveCrudToLocal = async (): Promise<void> => {
    if (!crudResult) return;
    if (!workspacePath) {
      showToast('Buka folder proyek lokal terlebih dahulu, atau gunakan tombol Buat di Server Remote.');
      return;
    }
    const sep = workspacePath.includes('\\') ? '\\' : '/';
    const files = [
      { name: crudResult.idxFileName, content: crudResult.idxContent },
      { name: crudResult.formFileName, content: crudResult.formContent },
      { name: crudResult.saveFileName, content: crudResult.saveContent }
    ];
    try {
      for (const f of files) {
        const targetPath = `${workspacePath}${sep}${f.name}`;
        await window.aptana.workspace.writeFile(targetPath, f.content);
        await openFileInTab(targetPath, f.name);
      }
      await refreshTree();
      showToast(`3 file CRUD disimpan ke folder lokal & dibuka di Editor.`);
    } catch (err) {
      showToast(`Gagal menyimpan CRUD ke lokal: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleSaveCrudToRemote = async (): Promise<void> => {
    if (!crudResult) return;
    if (!selectedConnectionId || !activeConn) {
      showToast('Pilih koneksi server remote terlebih dahulu.');
      return;
    }
    const baseSub = normalizeRemoteRelPath(remoteSubPath);
    const files = [
      { name: crudResult.idxFileName, content: crudResult.idxContent },
      { name: crudResult.formFileName, content: crudResult.formContent },
      { name: crudResult.saveFileName, content: crudResult.saveContent }
    ];
    try {
      for (const f of files) {
        const relPath = baseSub ? `${baseSub}/${f.name}` : f.name;
        await window.aptana.connections.writeRemoteFile(selectedConnectionId, relPath, f.content);
        await openRemoteFileInTab(selectedConnectionId, relPath);
      }
      await browseRemoteDir(remoteSubPath);
      showToast(`✨ 3 file CRUD berhasil dibuat langsung di server ${activeConn.name}!`);
    } catch (err) {
      showToast(`Gagal menyimpan CRUD ke server: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // ---------------- HANDLER #5: SQL & SECURITY AUDIT ----------------
  const handleRunSqlOrAudit = async (): Promise<void> => {
    if (auditBusy) return;
    if (!ensureConfigured()) return;

    const sourceInput =
      auditMode === 'security-audit'
        ? activeCodeTab?.content || sqlPromptInput
        : sqlPromptInput || selectedEditorText || activeCodeTab?.content || '';

    if (!sourceInput.trim()) {
      showToast(
        auditMode === 'security-audit'
          ? 'Buka file PHP/SQL di editor terlebih dahulu untuk diaudit.'
          : 'Masukkan deskripsi kebutuhan SQL atau query yang ingin dianalisis.'
      );
      return;
    }

    setAuditBusy(true);
    try {
      const res = await window.aptana.ai.sqlAndSecurityAudit({
        mode: auditMode,
        input: sourceInput,
        fileName: activeCodeTab?.relativePath
      });
      setAuditResult(res);
      showToast('✨ Analisis Gemini selesai.');
    } catch (err) {
      showToast(`Gagal menjalankan analisis: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAuditBusy(false);
    }
  };

  // ---------------- HANDLER #7: DOCS GENERATOR ----------------
  const handleGenerateDocs = async (): Promise<void> => {
    if (docBusy) return;
    if (!ensureConfigured()) return;

    const targetCode = selectedEditorText.trim() || activeCodeTab?.content || '';
    if (!targetCode.trim()) {
      showToast('Buka file kode atau blok fungsi/class yang ingin dibuatkan dokumentasinya.');
      return;
    }

    setDocBusy(true);
    try {
      const res = await window.aptana.ai.generateDocs({
        code: targetCode,
        fileName: activeCodeTab?.relativePath || 'kode.php',
        targetSymbol: docSymbol.trim() || undefined
      });
      setDocResult(res);
      showToast('✨ Dokumentasi PHPDoc & SQL wisanggeni_docs berhasil dibuat.');
    } catch (err) {
      showToast(`Gagal membuat dokumentasi: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDocBusy(false);
    }
  };

  // ---------------- HANDLER: SETTINGS ----------------
  const handleSaveSettings = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSettingsBusy(true);
    setTestResultMsg(null);
    try {
      await saveGeminiConfig({
        apiKey: apiKeyInput.trim() ? apiKeyInput.trim() : undefined,
        model: selectedModel,
        ghostTextEnabled: ghostEnabled,
        ghostTextModel: 'gemini-3.5-flash-lite'
      });
      setApiKeyInput('');
      showToast('Pengaturan Gemini AI berhasil disimpan secara terenkripsi.');
    } catch (err) {
      showToast(`Gagal menyimpan setelan: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSettingsBusy(false);
    }
  };

  const handleTestConnection = async (): Promise<void> => {
    setSettingsBusy(true);
    setTestResultMsg('Menguji koneksi ke Google Gemini Interactions API...');
    try {
      if (apiKeyInput.trim()) {
        await saveGeminiConfig({
          apiKey: apiKeyInput.trim(),
          model: selectedModel,
          ghostTextEnabled: ghostEnabled
        });
        setApiKeyInput('');
      }
      const res = await window.aptana.ai.testConnection();
      setTestResultMsg(
        res.ok
          ? `✓ Terhubung (${res.model} • ${res.latencyMs} ms): "${res.message}"`
          : `✕ Gagal (${res.model}): ${res.message}`
      );
    } catch (err) {
      setTestResultMsg(`✕ Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSettingsBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header */}
      <div className="sidebar-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sparkles size={14} color="#a855f7" />
          <span>Gemini AI Studio</span>
        </span>
        <span
          className="badge-pill"
          style={{
            cursor: 'pointer',
            background: geminiConfig?.hasApiKey ? 'rgba(74, 222, 128, 0.14)' : 'var(--accent-soft)',
            color: geminiConfig?.hasApiKey ? '#4ade80' : 'var(--accent)',
            border: `1px solid ${geminiConfig?.hasApiKey ? '#4ade80' : 'var(--accent)'}`
          }}
          onClick={() => setGeminiSubTab('settings')}
          title="Klik untuk membuka Pengaturan API Key & Model Gemini"
        >
          {geminiConfig?.hasApiKey ? geminiConfig.model : 'Atur API Key'}
        </span>
      </div>

      {/* Sub-Navigation Pills */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: 3,
          padding: '6px 7px',
          background: 'var(--bg-elevated)',
          borderBottom: '1px solid var(--border-subtle)'
        }}
      >
        {[
          { id: 'chat' as const, label: 'Chat', icon: <MessageSquare size={11.5} style={{ flexShrink: 0 }} /> },
          { id: 'crud' as const, label: 'CRUD', icon: <FilePlus2 size={11.5} style={{ flexShrink: 0 }} /> },
          { id: 'sql-audit' as const, label: 'Audit', icon: <ShieldCheck size={11.5} style={{ flexShrink: 0 }} /> },
          { id: 'docs' as const, label: 'Docs', icon: <BookOpen size={11.5} style={{ flexShrink: 0 }} /> },
          { id: 'settings' as const, label: 'Key', icon: <Settings2 size={11.5} style={{ flexShrink: 0 }} /> }
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            className={geminiSubTab === item.id ? 'btn btn-accent' : 'btn-ghost'}
            style={{
              minWidth: 0,
              padding: '4px 2px',
              fontSize: 10.5,
              justifyContent: 'center',
              gap: 3,
              overflow: 'hidden'
            }}
            onClick={() => setGeminiSubTab(item.id)}
          >
            {item.icon}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.label}
            </span>
          </button>
        ))}
      </div>

      {/* ==================== TAB 1: CONTEXTUAL CHAT ==================== */}
      {geminiSubTab === 'chat' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div
            style={{
              padding: '7px 9px',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              fontSize: 11
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={includeActiveFile}
                  onChange={(e) => setIncludeActiveFile(e.target.checked)}
                />
                <span>Sertakan konteks file aktif</span>
              </label>
              {chatTurns.length > 0 && (
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ padding: '2px 6px', fontSize: 10.5 }}
                  onClick={() => {
                    setChatTurns([]);
                    setLastInteractionId(null);
                  }}
                  title="Mulai sesi percakapan baru"
                >
                  <RotateCcw size={11} />
                  <span>Reset</span>
                </button>
              )}
            </div>

            {activeCodeTab && includeActiveFile && (
              <div
                style={{
                  color: '#38bdf8',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
                title={activeCodeTab.relativePath}
              >
                📄 {activeCodeTab.title}
                {selectedEditorText.trim()
                  ? ` (${selectedEditorText.split('\n').length} baris dipilih)`
                  : ''}
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {[
                'Jelaskan alur file ini',
                'Amankan SQL ke $query->setParam()',
                'Cek kompatibilitas PHP 8.2'
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="btn"
                  style={{ padding: '2px 6px', fontSize: 10.5 }}
                  disabled={chatBusy}
                  onClick={() => void handleSendChat(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div
            className="sidebar-scroll"
            style={{ flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            {chatTurns.length === 0 ? (
              <div style={{ padding: 8, color: 'var(--text-muted)', lineHeight: 1.55, fontSize: 12 }}>
                Tanyakan apa saja seputar kode lokal/remote yang sedang dibuka, query SQL, maupun class{' '}
                <strong>Wisanggeni Framework</strong> (<code>TTabel</code>, <code>TForm</code>,{' '}
                <code>TQuery</code>, <code>encid/decid</code>).
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
                  💡 Tip: Blok kode di editor lalu tekan <strong>Ctrl+I</strong> untuk melakukan{' '}
                  <em>Inline Refactor</em> cepat!
                </div>
              </div>
            ) : (
              chatTurns.map((turn) => (
                <div
                  key={turn.id}
                  style={{
                    padding: '8px 9px',
                    borderRadius: 8,
                    background:
                      turn.role === 'user' ? 'rgba(249, 115, 22, 0.12)' : 'var(--bg-elevated)',
                    border:
                      turn.role === 'user'
                        ? '1px solid rgba(249, 115, 22, 0.35)'
                        : '1px solid var(--border-subtle)',
                    fontSize: 12,
                    lineHeight: 1.5
                  }}
                >
                  <div
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      marginBottom: 4,
                      color: turn.role === 'user' ? 'var(--accent)' : '#a855f7'
                    }}
                  >
                    {turn.role === 'user' ? 'Anda' : `✨ Gemini (${turn.model ?? 'AI'})`}
                  </div>

                  {splitMarkdownCodeBlocks(turn.text).map((seg, i) =>
                    seg.kind === 'text' ? (
                      <div key={i} style={{ whiteSpace: 'pre-wrap' }}>
                        {seg.content}
                      </div>
                    ) : (
                      <div
                        key={i}
                        style={{
                          margin: '6px 0',
                          borderRadius: 6,
                          overflow: 'hidden',
                          border: '1px solid var(--border-strong)',
                          background: '#0f1219'
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '3px 7px',
                            background: 'var(--bg-surface)',
                            borderBottom: '1px solid var(--border-subtle)',
                            fontSize: 10.5
                          }}
                        >
                          <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>
                            {(seg.language || 'code').toUpperCase()}
                          </span>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              type="button"
                              className="btn-ghost"
                              style={{ padding: '1px 5px', fontSize: 10 }}
                              onClick={() => copyText(seg.content, 'Blok kode')}
                              title="Salin kode"
                            >
                              <Copy size={11} />
                              <span>Salin</span>
                            </button>
                            {activeCodeTab && (
                              <>
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  style={{ padding: '1px 5px', fontSize: 10, color: '#38bdf8' }}
                                  onClick={() =>
                                    void applyAiCodeToTab(
                                      activeCodeTab.id,
                                      seg.content,
                                      'Saran Chat Gemini',
                                      true
                                    )
                                  }
                                  title="Bandingkan Side-by-Side Diff sebelum diterapkan"
                                >
                                  <GitCompare size={11} />
                                  <span>Diff</span>
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-accent"
                                  style={{ padding: '1px 6px', fontSize: 10 }}
                                  onClick={() =>
                                    void applyAiCodeToTab(
                                      activeCodeTab.id,
                                      seg.content,
                                      'Saran Chat Gemini',
                                      false
                                    )
                                  }
                                  title="Terapkan ke file aktif (otomatis menyimpan backup Local History)"
                                >
                                  <Check size={11} />
                                  <span>Terapkan</span>
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                        <pre
                          style={{
                            margin: 0,
                            padding: 8,
                            overflowX: 'auto',
                            fontFamily: 'Consolas, monospace',
                            fontSize: 11.5
                          }}
                        >
                          {seg.content}
                        </pre>
                      </div>
                    )
                  )}
                </div>
              ))
            )}
            {chatBusy && (
              <div style={{ fontSize: 11.5, color: '#a855f7', padding: '4px 6px' }}>
                ✨ Gemini sedang menganalisis konteks &amp; menyusun jawaban...
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSendChat();
            }}
            style={{
              padding: 8,
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6
            }}
          >
            <textarea
              rows={2}
              value={chatPrompt}
              onChange={(e) => setChatPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSendChat();
                }
              }}
              placeholder="Ketik instruksi atau pertanyaan (Enter kirim, Shift+Enter baris baru)..."
            />
            <button
              type="submit"
              className="btn btn-accent"
              disabled={chatBusy || !chatPrompt.trim()}
              style={{ justifyContent: 'center' }}
            >
              <Send size={13} />
              <span>{chatBusy ? 'Memproses...' : 'Kirim ke Gemini'}</span>
            </button>
          </form>
        </div>
      )}

      {/* ==================== TAB 2: WISANGGENI 3-FILE CRUD GENERATOR ==================== */}
      {geminiSubTab === 'crud' && (
        <div className="sidebar-scroll" style={{ flex: 1, padding: 10 }}>
          <form
            onSubmit={(e) => void handleGenerateCrud(e)}
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
              Hasilkan otomatis 3 file standar <strong>Wisanggeni Framework</strong> (
              <code>_idx.php</code>, <code>_form.php</code>, <code>_save.php</code>) lengkap dengan{' '}
              <code>TTabel</code>, <code>TForm</code>, <code>$query-&gt;setParam()</code>, dan{' '}
              <code>encid/decid</code>.
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Nama Dasar Modul (tanpa .php)
              </label>
              <input
                value={crudModuleName}
                onChange={(e) => setCrudModuleName(e.target.value)}
                placeholder="contoh: jenis_komoditi"
                style={{ width: '100%', marginTop: 3 }}
              />
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Judul Halaman</label>
              <input
                value={crudModuleTitle}
                onChange={(e) => setCrudModuleTitle(e.target.value)}
                placeholder="contoh: Master Jenis Komoditi"
                style={{ width: '100%', marginTop: 3 }}
              />
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Skema SQL CREATE TABLE / Deskripsi Kolom
              </label>
              <textarea
                rows={6}
                value={crudSqlSpec}
                onChange={(e) => setCrudSqlSpec(e.target.value)}
                style={{ width: '100%', marginTop: 3, fontFamily: 'Consolas, monospace', fontSize: 11.5 }}
              />
            </div>

            <button
              type="submit"
              className="btn btn-accent"
              disabled={crudBusy}
              style={{ justifyContent: 'center' }}
            >
              <Wand2 size={14} />
              <span>
                {crudBusy ? 'Menyusun 3 File CRUD Wisanggeni...' : '✨ Generate 3 File CRUD'}
              </span>
            </button>
          </form>

          {crudResult && (
            <div
              style={{
                marginTop: 12,
                paddingTop: 10,
                borderTop: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}
            >
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                {crudResult.explanation}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {workspacePath && (
                  <button
                    type="button"
                    className="btn"
                    style={{ justifyContent: 'center' }}
                    onClick={() => void handleSaveCrudToLocal()}
                  >
                    <FilePlus2 size={13} color="#38bdf8" />
                    <span>Simpan &amp; Buka ke Folder Lokal</span>
                  </button>
                )}
                {activeConn && (
                  <button
                    type="button"
                    className="btn btn-accent"
                    style={{ justifyContent: 'center' }}
                    onClick={() => void handleSaveCrudToRemote()}
                  >
                    <CloudUpload size={13} />
                    <span>
                      Buat Langsung di Server {activeConn.name}:/{remoteSubPath}
                    </span>
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: 4 }}>
                {(
                  [
                    { key: 'idx', label: crudResult.idxFileName },
                    { key: 'form', label: crudResult.formFileName },
                    { key: 'save', label: crudResult.saveFileName }
                  ] as const
                ).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={crudPreviewTab === item.key ? 'btn btn-accent' : 'btn'}
                    style={{ flex: 1, fontSize: 10.5, padding: '3px 4px', justifyContent: 'center' }}
                    onClick={() => setCrudPreviewTab(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {(() => {
                const activeContent =
                  crudPreviewTab === 'idx'
                    ? crudResult.idxContent
                    : crudPreviewTab === 'form'
                      ? crudResult.formContent
                      : crudResult.saveContent;
                return (
                  <div
                    style={{
                      border: '1px solid var(--border-strong)',
                      borderRadius: 6,
                      overflow: 'hidden',
                      background: '#0f1219'
                    }}
                  >
                    <div
                      style={{
                        padding: '4px 8px',
                        background: 'var(--bg-surface)',
                        display: 'flex',
                        justifyContent: 'flex-end'
                      }}
                    >
                      <button
                        type="button"
                        className="btn-ghost"
                        style={{ padding: '2px 6px', fontSize: 10.5 }}
                        onClick={() => copyText(activeContent, 'Kode CRUD')}
                      >
                        <Copy size={11} />
                        <span>Salin File Ini</span>
                      </button>
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        padding: 8,
                        maxHeight: 240,
                        overflow: 'auto',
                        fontFamily: 'Consolas, monospace',
                        fontSize: 11
                      }}
                    >
                      {activeContent}
                    </pre>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 3: SQL ASSISTANT & SECURITY AUDITOR ==================== */}
      {geminiSubTab === 'sql-audit' && (
        <div className="sidebar-scroll" style={{ flex: 1, padding: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Pilih Mode Analisis</label>
            <select
              value={auditMode}
              onChange={(e) =>
                setAuditMode(
                  e.target.value as 'security-audit' | 'generate-sql' | 'explain-sql'
                )
              }
            >
              <option value="security-audit">
                🛡 Audit Keamanan PHP/SQL (SQLi, XSS, IDOR encid/decid)
              </option>
              <option value="generate-sql">
                🗄 Buat Query SQL + $query-&gt;setParam() dari Bahasa Indonesia
              </option>
              <option value="explain-sql">🔍 Jelaskan &amp; Optimasi Query SQL</option>
            </select>

            {auditMode === 'security-audit' ? (
              <div
                style={{
                  padding: 8,
                  borderRadius: 6,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: 11.5,
                  color: 'var(--text-secondary)'
                }}
              >
                Target Audit:{' '}
                <strong>
                  {activeCodeTab ? activeCodeTab.title : 'Belum ada file kode terbuka'}
                </strong>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                  Memeriksa celah SQL Injection, XSS, IDOR (<code>encid/decid</code>), dan kompatibilitas PHP 8.2 sebelum deploy.
                </div>
              </div>
            ) : (
              <textarea
                rows={4}
                value={sqlPromptInput}
                onChange={(e) => setSqlPromptInput(e.target.value)}
                placeholder={
                  auditMode === 'generate-sql'
                    ? 'Contoh: Rekap jumlah pengajuan rekomendasi per jenis komoditi bulan ini beserta nama perusahaan...'
                    : 'Tempel query SQL yang ingin dijelaskan dan dioptimasi...'
                }
                style={{ fontFamily: 'Consolas, monospace', fontSize: 11.5 }}
              />
            )}

            <button
              type="button"
              className="btn btn-accent"
              disabled={auditBusy}
              onClick={() => void handleRunSqlOrAudit()}
              style={{ justifyContent: 'center' }}
            >
              {auditMode === 'security-audit' ? (
                <ShieldCheck size={14} />
              ) : (
                <Database size={14} />
              )}
              <span>
                {auditBusy
                  ? 'Menganalisis dengan Gemini...'
                  : auditMode === 'security-audit'
                    ? '✨ Audit Keamanan File Aktif'
                    : '✨ Jalankan Asisten SQL'}
              </span>
            </button>

            {auditResult && (
              <div
                style={{
                  marginTop: 6,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  paddingTop: 8,
                  borderTop: '1px solid var(--border-subtle)'
                }}
              >
                <div
                  style={{
                    padding: 8,
                    borderRadius: 6,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    whiteSpace: 'pre-wrap',
                    fontSize: 11.5,
                    lineHeight: 1.5
                  }}
                >
                  {auditResult.markdownReport}
                </div>

                {auditResult.suggestedCode && (
                  <div
                    style={{
                      border: '1px solid var(--border-strong)',
                      borderRadius: 6,
                      overflow: 'hidden',
                      background: '#0f1219'
                    }}
                  >
                    <div
                      style={{
                        padding: '4px 8px',
                        background: 'var(--bg-surface)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: 11
                      }}
                    >
                      <span style={{ fontWeight: 700, color: '#4ade80' }}>
                        Kode / Query Rekomendasi
                      </span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{ padding: '2px 5px', fontSize: 10.5 }}
                          onClick={() => copyText(auditResult.suggestedCode, 'Kode aman')}
                        >
                          <Copy size={11} />
                          <span>Salin</span>
                        </button>
                        {activeCodeTab && auditMode === 'security-audit' && (
                          <button
                            type="button"
                            className="btn btn-accent"
                            style={{ padding: '2px 6px', fontSize: 10.5 }}
                            onClick={() =>
                              void applyAiCodeToTab(
                                activeCodeTab.id,
                                auditResult.suggestedCode,
                                'Audit Keamanan Gemini',
                                true
                              )
                            }
                          >
                            <GitCompare size={11} />
                            <span>Preview Diff &amp; Terapkan</span>
                          </button>
                        )}
                      </div>
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        padding: 8,
                        maxHeight: 220,
                        overflow: 'auto',
                        fontFamily: 'Consolas, monospace',
                        fontSize: 11
                      }}
                    >
                      {auditResult.suggestedCode}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== TAB 4: AUTO DOCUMENTATION GENERATOR ==================== */}
      {geminiSubTab === 'docs' && (
        <div className="sidebar-scroll" style={{ flex: 1, padding: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
              Hasilkan dokumentasi Bahasa Indonesia, komentar blok <code>PHPDoc</code>, serta query{' '}
              <code>INSERT INTO wisanggeni_docs</code> otomatis dari file atau kode yang diblok.
            </div>

            <input
              value={docSymbol}
              onChange={(e) => setDocSymbol(e.target.value)}
              placeholder="Opsional: nama class/fungsi spesifik..."
            />

            <button
              type="button"
              className="btn btn-accent"
              disabled={docBusy}
              onClick={() => void handleGenerateDocs()}
              style={{ justifyContent: 'center' }}
            >
              <BookOpen size={14} />
              <span>
                {docBusy ? 'Menyusun Dokumentasi...' : '✨ Buat PHPDoc & SQL wisanggeni_docs'}
              </span>
            </button>

            {docResult && (
              <div
                style={{
                  marginTop: 6,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  paddingTop: 8,
                  borderTop: '1px solid var(--border-subtle)'
                }}
              >
                <div
                  style={{
                    padding: 8,
                    borderRadius: 6,
                    background: 'var(--bg-elevated)',
                    whiteSpace: 'pre-wrap',
                    fontSize: 11.5,
                    lineHeight: 1.5
                  }}
                >
                  {docResult.markdownDoc}
                </div>

                <div
                  style={{
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 6,
                    overflow: 'hidden',
                    background: '#0f1219'
                  }}
                >
                  <div
                    style={{
                      padding: '4px 8px',
                      background: 'var(--bg-surface)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 10.5
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>Komentar PHPDoc</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        className="btn-ghost"
                        style={{ padding: '1px 5px', fontSize: 10 }}
                        onClick={() => copyText(docResult.phpDocComment, 'PHPDoc')}
                      >
                        Salin
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        style={{ padding: '1px 5px', fontSize: 10, color: 'var(--accent)' }}
                        onClick={() => insertTextIntoActiveTab(docResult.phpDocComment)}
                      >
                        Sisipkan
                      </button>
                    </div>
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: 8,
                      overflowX: 'auto',
                      fontFamily: 'Consolas, monospace',
                      fontSize: 11
                    }}
                  >
                    {docResult.phpDocComment}
                  </pre>
                </div>

                <div
                  style={{
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 6,
                    overflow: 'hidden',
                    background: '#0f1219'
                  }}
                >
                  <div
                    style={{
                      padding: '4px 8px',
                      background: 'var(--bg-surface)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 10.5
                    }}
                  >
                    <span style={{ fontWeight: 700, color: '#4ade80' }}>
                      SQL wisanggeni_docs
                    </span>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ padding: '1px 5px', fontSize: 10 }}
                      onClick={() =>
                        copyText(docResult.wisanggeniSqlInsert, 'SQL wisanggeni_docs')
                      }
                    >
                      Salin SQL
                    </button>
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: 8,
                      overflowX: 'auto',
                      fontFamily: 'Consolas, monospace',
                      fontSize: 11
                    }}
                  >
                    {docResult.wisanggeniSqlInsert}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== TAB 5: ENCRYPTED SETTINGS & MODEL VAULT ==================== */}
      {geminiSubTab === 'settings' && (
        <div className="sidebar-scroll" style={{ flex: 1, padding: 10 }}>
          <form
            onSubmit={(e) => void handleSaveSettings(e)}
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <div
              style={{
                padding: 9,
                borderRadius: 8,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                fontSize: 11.5,
                lineHeight: 1.5
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                <KeyRound size={13} color="var(--accent)" />
                <span>Status Kredensial Gemini API</span>
              </div>
              <div style={{ marginTop: 4, color: 'var(--text-secondary)' }}>
                {geminiConfig?.hasApiKey ? (
                  <>
                    Aktif ({geminiConfig.maskedKey}) — Sumber:{' '}
                    <strong>
                      {geminiConfig.apiKeySource === 'vault'
                        ? 'Brankas Terenkripsi DPAPI'
                        : 'Environment Variable OS'}
                    </strong>
                  </>
                ) : (
                  'Belum ada API Key tersimpan. Dapatkan API Key di Google AI Studio lalu simpan di bawah.'
                )}
              </div>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                GEMINI_API_KEY Baru (Kosongkan jika tidak ingin mengubah)
              </label>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="AIzaSy..."
                style={{ width: '100%', marginTop: 4 }}
              />
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Model Utama Gemini (Interactions API)
              </label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value as GeminiModelId)}
                style={{ width: '100%', marginTop: 4 }}
              >
                <option value="gemini-4-hydrogen">
                  gemini-4-hydrogen (Default • Cepat &amp; Seimbang • 1M Token)
                </option>
                <option value="gemini-4-argon">
                  gemini-4-argon (Penalaran Coding Interaktif • 1M Token)
                </option>
                <option value="gemini-4-carbon">
                  gemini-4-carbon (Penalaran &amp; Audit Keamanan Terkuat • 1M Token)
                </option>
                <option value="gemini-3.5-flash-lite">
                  gemini-3.5-flash-lite (Super Cepat &amp; Hemat Kuota • 1M Token)
                </option>
              </select>
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 7,
                padding: 8,
                borderRadius: 6,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                cursor: 'pointer',
                fontSize: 11.5
              }}
            >
              <input
                type="checkbox"
                checked={ghostEnabled}
                onChange={(e) => setGhostEnabled(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <div>
                <div style={{ fontWeight: 700 }}>
                  Aktifkan AI Ghost-Text Autocomplete di Editor
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                  Menampilkan saran kelanjutan baris otomatis (abu-abu, tekan Tab untuk menerima) menggunakan{' '}
                  <code>gemini-3.5-flash-lite</code>.
                </div>
              </div>
            </label>

            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="submit"
                className="btn btn-accent"
                disabled={settingsBusy}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                Simpan Setelan
              </button>
              <button
                type="button"
                className="btn"
                disabled={settingsBusy}
                onClick={() => void handleTestConnection()}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                Tes Koneksi
              </button>
            </div>

            {geminiConfig?.apiKeySource === 'vault' && (
              <button
                type="button"
                className="btn-ghost"
                style={{ fontSize: 11, color: 'var(--danger)', justifyContent: 'center' }}
                onClick={async () => {
                  await saveGeminiConfig({ clearApiKey: true });
                  showToast('API Key tersimpan dihapus dari brankas lokal.');
                }}
              >
                Hapus API Key dari Brankas Lokal
              </button>
            )}

            {testResultMsg && (
              <div
                style={{
                  padding: 8,
                  borderRadius: 6,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: 11.5,
                  lineHeight: 1.45
                }}
              >
                {testResultMsg}
              </div>
            )}

            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              🔒 <strong>Proteksi Rahasia Otomatis:</strong> File <code>connect_db.php</code>,{' '}
              <code>.env</code>, private key SSH, serta variabel password database disensor otomatis dan tidak pernah dikirim ke Gemini API.
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
