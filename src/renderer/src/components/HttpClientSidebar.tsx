import React, { useEffect, useMemo, useState } from 'react';
import {
  BookmarkPlus,
  ClipboardPaste,
  Code2,
  Copy,
  FileCode2,
  FolderOpen,
  Globe,
  Layers,
  Plus,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload
} from 'lucide-react';
import type {
  HttpBodyMode,
  HttpKeyValueItem,
  HttpMethod,
  HttpResponseData,
  SavedHttpRequest
} from '@shared/types';
import { parseCurlCommand } from '@shared/httpEndpointExtractor';
import {
  createDefaultHttpWorkspace,
  extractJsonPathValue,
  extractSessionCookieFromHeaders,
  generateHttpClientSnippet,
  importOpenApiOrPostmanJson,
  resolveHttpPayloadWithEnv,
  type HttpCollectionWorkspace
} from '@shared/apiCollectionEngine';
import { useIdeStore } from '../store/useIdeStore';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export const HttpClientSidebar: React.FC = () => {
  const {
    showToast,
    pushIslandActivity,
    pendingHttpEndpointDraft,
    consumePendingHttpEndpointDraft,
    sendTabToHttpTester
  } = useIdeStore();

  const [curlModalOpen, setCurlModalOpen] = useState(false);
  const [curlInput, setCurlInput] = useState('');

  const [method, setMethod] = useState<HttpMethod>('POST');
  const [url, setUrl] = useState('{{base_url}}/');
  const [activeSubTab, setActiveSubTab] = useState<'body' | 'headers' | 'saved' | 'env'>('body');

  // Phase 30 #6: Environments, Collections, Auto-Capture & OpenAPI/Postman Importer
  const [httpWorkspace, setHttpWorkspace] = useState<HttpCollectionWorkspace>(() =>
    createDefaultHttpWorkspace()
  );
  const [saveFolder, setSaveFolder] = useState('Umum');
  const [autoCaptureJsonPath, setAutoCaptureJsonPath] = useState('');
  const [autoCaptureTargetVar, setAutoCaptureTargetVar] = useState('token');
  const [autoCaptureCookie, setAutoCaptureCookie] = useState(true);
  const [specImportText, setSpecImportText] = useState('');
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvVal, setNewEnvVal] = useState('');
  const [codeLang, setCodeLang] = useState<'php-curl' | 'php-guzzle' | 'js-fetch'>('php-curl');
  const [showCodePreview, setShowCodePreview] = useState(false);

  const activeEnv = useMemo(
    () =>
      httpWorkspace.environments.find((e) => e.id === httpWorkspace.activeEnvId) ??
      httpWorkspace.environments[0],
    [httpWorkspace]
  );

  const [bodyMode, setBodyMode] = useState<HttpBodyMode>('urlencoded');
  const [formFields, setFormFields] = useState<HttpKeyValueItem[]>([
    { key: 'act', value: 'save', enabled: true },
    { key: 'nip', value: '', enabled: true }
  ]);
  const [rawBody, setRawBody] = useState('{\n  "id": 1\n}');

  const [cookieSession, setCookieSession] = useState('');
  const [insecureTls, setInsecureTls] = useState(true);
  const [headers, setHeaders] = useState<HttpKeyValueItem[]>([
    { key: 'X-Requested-With', value: 'XMLHttpRequest', enabled: true }
  ]);

  const [savedRequests, setSavedRequests] = useState<SavedHttpRequest[]>([]);
  const [saveName, setSaveName] = useState('');
  const [editingSavedId, setEditingSavedId] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [response, setResponse] = useState<HttpResponseData | null>(null);
  const [responseView, setResponseView] = useState<'body' | 'headers'>('body');

  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const refreshSaved = async (): Promise<void> => {
    try {
      const [list, ws] = await Promise.all([
        window.aptana.http.listSaved(),
        window.aptana.http.getWorkspace()
      ]);
      setSavedRequests(list);
      setHttpWorkspace(ws);
    } catch {
      // Ignore
    }
  };

  const persistHttpWorkspace = async (next: HttpCollectionWorkspace): Promise<void> => {
    setHttpWorkspace(next);
    try {
      await window.aptana.http.saveWorkspace(next);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void refreshSaved();
  }, []);

  useEffect(() => {
    if (!pendingHttpEndpointDraft) return;
    const draft = consumePendingHttpEndpointDraft();
    if (!draft) return;
    setEditingSavedId(null);
    setSaveName(draft.name);
    setMethod(draft.method);
    setUrl(draft.suggestedUrl);
    setBodyMode(draft.bodyMode);
    if (draft.formFields.length > 0) {
      setFormFields(draft.formFields);
    }
    if (draft.headers.length > 0) {
      setHeaders(draft.headers);
    }
    if (draft.cookieSession !== undefined) {
      setCookieSession(draft.cookieSession);
    }
    if (draft.rawBody !== undefined) {
      setRawBody(draft.rawBody);
    }
    setActiveSubTab('body');
  }, [pendingHttpEndpointDraft, consumePendingHttpEndpointDraft]);

  const handleImportCurl = (): void => {
    const parsed = parseCurlCommand(curlInput);
    if (!parsed) {
      showToast('Perintah cURL tidak dapat dikenali. Salin dengan "Copy as cURL" dari DevTools.');
      return;
    }
    setEditingSavedId(null);
    setSaveName(parsed.name);
    setMethod(parsed.method);
    setUrl(parsed.suggestedUrl);
    setBodyMode(parsed.bodyMode);
    if (parsed.formFields.length > 0) {
      setFormFields(parsed.formFields);
    }
    if (parsed.headers.length > 0) {
      setHeaders(parsed.headers);
    }
    if (parsed.cookieSession) {
      setCookieSession(parsed.cookieSession);
    }
    if (parsed.rawBody !== undefined) {
      setRawBody(parsed.rawBody);
    }
    setCurlModalOpen(false);
    setCurlInput('');
    showToast(
      `cURL berhasil diimpor (${parsed.method} • ${
        parsed.cookieSession ? 'Cookie sesi disertakan' : `${parsed.headers.length} header`
      })`
    );
  };

  const handleSend = async (): Promise<void> => {
    if (!url.trim()) {
      showToast('Masukkan URL endpoint terlebih dahulu.');
      return;
    }
    setSending(true);
    setSendError(null);
    setAiAnalysis(null);
    try {
      const rawPayload = {
        method,
        url: url.trim(),
        headers,
        cookieSession: cookieSession.trim() || undefined,
        bodyMode: method === 'GET' || method === 'HEAD' ? ('none' as HttpBodyMode) : bodyMode,
        formFields,
        rawBody,
        insecureTls,
        followRedirects: true,
        timeoutMs: 25000
      };
      const resolvedPayload = resolveHttpPayloadWithEnv(rawPayload, activeEnv?.variables ?? {});
      const res = await window.aptana.http.send(resolvedPayload);
      setResponse(res);

      // Phase 30 #6: Auto-Capture Token (JSON path) & Session Cookie (PHPSESSID)
      let capturedMsg = '';
      if (autoCaptureJsonPath.trim() && autoCaptureTargetVar.trim()) {
        const extracted = extractJsonPathValue(res.body, autoCaptureJsonPath);
        if (extracted && activeEnv) {
          const nextEnvs = httpWorkspace.environments.map((env) =>
            env.id === activeEnv.id
              ? {
                  ...env,
                  variables: { ...env.variables, [autoCaptureTargetVar.trim()]: extracted }
                }
              : env
          );
          void persistHttpWorkspace({ ...httpWorkspace, environments: nextEnvs });
          capturedMsg = `🔑 {{${autoCaptureTargetVar.trim()}}} ditangkap otomatis!`;
        }
      }
      if (autoCaptureCookie) {
        const sc = extractSessionCookieFromHeaders(res.headers);
        if (sc) {
          setCookieSession(sc);
          capturedMsg = capturedMsg ? `${capturedMsg} • Cookie sesi diperbarui` : '🍪 Cookie sesi (PHPSESSID) ditangkap otomatis!';
        }
      }
      if (capturedMsg) showToast(capturedMsg);

      pushIslandActivity({
        id: 'http-tester',
        tone: res.ok ? 'success' : 'warning',
        badge: `${method} ${res.status}`,
        title: `${res.status} ${res.statusText} • ${res.durationMs} ms`,
        subtitle: res.finalUrl,
        autoExpireMs: 3500
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSendError(msg);
      showToast(`Request Gagal: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  const handleSaveRequest = async (): Promise<void> => {
    const label =
      saveName.trim() || `${method} ${url.replace(/^https?:\/\/[^/]+/i, '') || url}`;
    try {
      const saved = await window.aptana.http.saveRequest({
        id: editingSavedId ?? undefined,
        name: label,
        method,
        url: url.trim(),
        headers,
        cookieSession: cookieSession.trim() || undefined,
        bodyMode,
        formFields,
        rawBody,
        insecureTls,
        followRedirects: true
      });
      setEditingSavedId(saved.id);
      setSaveName(saved.name);
      const folderClean = saveFolder.trim() || 'Umum';
      const nextFolders = httpWorkspace.folders.includes(folderClean)
        ? httpWorkspace.folders
        : [...httpWorkspace.folders, folderClean];
      const nextReqs = [
        {
          ...saved,
          folder: folderClean,
          autoCaptureJsonPath: autoCaptureJsonPath.trim() || undefined,
          autoCaptureTargetVar: autoCaptureTargetVar.trim() || undefined
        },
        ...httpWorkspace.requests.filter((r) => r.id !== saved.id)
      ];
      await persistHttpWorkspace({ ...httpWorkspace, folders: nextFolders, requests: nextReqs });
      await refreshSaved();
      showToast(`Request "${saved.name}" tersimpan ke folder [${folderClean}].`);
    } catch (err) {
      showToast(`Gagal menyimpan request: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const loadSavedRequest = (req: SavedHttpRequest): void => {
    setEditingSavedId(req.id);
    setSaveName(req.name);
    setMethod(req.method);
    setUrl(req.url);
    setBodyMode(req.bodyMode);
    setFormFields(req.formFields?.length ? req.formFields : [{ key: '', value: '', enabled: true }]);
    setRawBody(req.rawBody ?? '');
    setCookieSession(req.cookieSession ?? '');
    setInsecureTls(req.insecureTls ?? true);
    setHeaders(req.headers ?? []);
    setActiveSubTab('body');
    showToast(`Memuat request "${req.name}"`);
  };

  const handleDiagnoseWithAi = async (): Promise<void> => {
    if (!response) return;
    setAiBusy(true);
    try {
      const res = await window.aptana.ai.chat({
        prompt: `Analisis hasil HTTP/AJAX request berikut dan jelaskan penyebab masalah serta cara memperbaikinya di PHP (Wisanggeni / Laravel):\n\nRequest: ${method} ${url}\nStatus: ${response.status} ${response.statusText} (${response.durationMs} ms)\nContent-Type: ${response.contentType}\n\nResponse Body:\n${response.body.slice(0, 4000)}`
      });
      setAiAnalysis(res.text);
    } catch (err) {
      showToast(`Gagal analisis AI: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAiBusy(false);
    }
  };

  const updateKeyValueRow = (
    list: HttpKeyValueItem[],
    setter: React.Dispatch<React.SetStateAction<HttpKeyValueItem[]>>,
    idx: number,
    patch: Partial<HttpKeyValueItem>
  ): void => {
    setter(list.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="sidebar-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Globe size={13} /> HTTP / AJAX TESTER
        </span>
        <button
          className="icon-btn"
          title="Simpan Endpoint Request Ini"
          onClick={() => void handleSaveRequest()}
        >
          <BookmarkPlus size={14} />
        </button>
      </div>

      <div
        className="sidebar-scroll"
        style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        {/* Environment Selector Strip */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 8px',
            borderRadius: 6,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            fontSize: 11
          }}
        >
          <Layers size={12} color="#38bdf8" style={{ flexShrink: 0 }} />
          <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Env:</span>
          <select
            className="form-input"
            style={{ flex: 1, minWidth: 0, height: 24, fontSize: 11, padding: '0 6px' }}
            value={httpWorkspace.activeEnvId}
            onChange={(e) =>
              void persistHttpWorkspace({ ...httpWorkspace, activeEnvId: e.target.value })
            }
          >
            {httpWorkspace.environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`btn btn-xs ${showCodePreview ? 'btn-accent' : ''}`}
            onClick={() => setShowCodePreview((v) => !v)}
            title="Generate kode PHP cURL / Laravel Guzzle / JS Fetch dari request ini"
          >
            <Code2 size={11} /> Kode
          </button>
        </div>

        {showCodePreview && (
          <div
            style={{
              padding: 8,
              borderRadius: 6,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--accent)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
              <div style={{ display: 'flex', gap: 3 }}>
                {(
                  [
                    ['php-curl', 'PHP cURL'],
                    ['php-guzzle', 'Laravel'],
                    ['js-fetch', 'JS Fetch']
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`btn btn-xs ${codeLang === id ? 'btn-primary' : ''}`}
                    onClick={() => setCodeLang(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => {
                  const snippet = generateHttpClientSnippet(
                    resolveHttpPayloadWithEnv(
                      { method, url, headers, cookieSession, bodyMode, formFields, rawBody, insecureTls },
                      activeEnv?.variables ?? {}
                    ),
                    codeLang
                  );
                  void navigator.clipboard?.writeText(snippet);
                  showToast(`Kode ${codeLang} disalin ke clipboard.`);
                }}
              >
                <Copy size={10} /> Salin
              </button>
            </div>
            <pre
              style={{
                margin: 0,
                padding: 7,
                borderRadius: 5,
                background: 'var(--bg-app)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10.5,
                maxHeight: 150,
                overflow: 'auto',
                whiteSpace: 'pre-wrap'
              }}
            >
              {generateHttpClientSnippet(
                resolveHttpPayloadWithEnv(
                  { method, url, headers, cookieSession, bodyMode, formFields, rawBody, insecureTls },
                  activeEnv?.variables ?? {}
                ),
                codeLang
              )}
            </pre>
          </div>
        )}

        {/* Method + URL + Send */}
        <div
          style={{
            padding: 9,
            borderRadius: 6,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 7
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            <select
              className="form-input"
              style={{ width: 92, fontWeight: 700, fontSize: 11.5, padding: '5px 6px' }}
              value={method}
              onChange={(e) => setMethod(e.target.value as HttpMethod)}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              className="form-input"
              style={{ flex: 1, fontSize: 12, fontFamily: 'var(--font-mono)' }}
              placeholder="https://intranet/modul_save.php"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSend();
                }
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn btn-primary"
              style={{ flex: 1, justifyContent: 'center', fontSize: 12 }}
              disabled={sending}
              onClick={() => void handleSend()}
            >
              <Send size={13} /> {sending ? 'Mengirim Request...' : 'Kirim Request'}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 5 }}>
            <button
              type="button"
              className="btn"
              style={{ minWidth: 0, justifyContent: 'center', fontSize: 10.5, padding: '3px 5px', gap: 4 }}
              title="Deteksi otomatis $_POST, $_GET, & $request->input() dari tab PHP yang sedang aktif"
              onClick={() => sendTabToHttpTester()}
            >
              <FileCode2 size={11.5} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Field PHP
              </span>
            </button>
            <button
              type="button"
              className="btn"
              style={{ minWidth: 0, justifyContent: 'center', fontSize: 10.5, padding: '3px 5px', gap: 4 }}
              title="Tempel 'Copy as cURL' dari Chrome DevTools Network (otomatis mengisi URL, Header, Cookie PHPSESSID, & Body)"
              onClick={() => setCurlModalOpen((v) => !v)}
            >
              <ClipboardPaste size={11.5} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Paste cURL
              </span>
            </button>
          </div>

          {curlModalOpen && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: 8,
                borderRadius: 6,
                background: 'var(--bg-surface)',
                border: '1px solid var(--accent)'
              }}
            >
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>
                Tempel hasil klik kanan Network → <code>Copy as cURL (bash / cmd)</code>:
              </div>
              <textarea
                className="form-input"
                rows={4}
                placeholder={`curl 'http://localhost/modul_save.php' -H 'Cookie: PHPSESSID=...' --data-raw 'nip=1985...&act=save'`}
                value={curlInput}
                onChange={(e) => setCurlInput(e.target.value)}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 11, resize: 'vertical' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <button
                  type="button"
                  className="btn"
                  style={{ fontSize: 11, padding: '3px 8px' }}
                  onClick={() => setCurlModalOpen(false)}
                >
                  Batal
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ fontSize: 11, padding: '3px 10px' }}
                  onClick={handleImportCurl}
                >
                  Impor cURL
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sub-tabs: Body | Headers & Session | Koleksi | Env & Impor */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 4 }}>
          {(
            [
              { id: 'body', label: 'Body' },
              { id: 'headers', label: 'Header' },
              { id: 'saved', label: `Koleksi (${Math.max(savedRequests.length, httpWorkspace.requests.length)})` },
              { id: 'env', label: 'Env/Impor' }
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              className={`btn ${activeSubTab === t.id ? 'btn-primary' : ''}`}
              style={{ minWidth: 0, justifyContent: 'center', fontSize: 10.5, padding: '4px 4px', overflow: 'hidden', textOverflow: 'ellipsis' }}
              onClick={() => setActiveSubTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Sub-tab 1: Body / Form */}
        {activeSubTab === 'body' && (
          <div
            style={{
              padding: 9,
              borderRadius: 6,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Tipe Payload:</span>
              <select
                className="form-input"
                style={{ width: 170, fontSize: 11.5, padding: '3px 6px' }}
                value={bodyMode}
                onChange={(e) => setBodyMode(e.target.value as HttpBodyMode)}
              >
                <option value="none">Tanpa Body</option>
                <option value="urlencoded">Form POST (_save.php)</option>
                <option value="json">JSON (application/json)</option>
                <option value="raw">Raw Teks</option>
              </select>
            </div>

            {bodyMode === 'urlencoded' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {formFields.map((row, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(e) =>
                        updateKeyValueRow(formFields, setFormFields, idx, {
                          enabled: e.target.checked
                        })
                      }
                    />
                    <input
                      className="form-input"
                      style={{ flex: 1, fontSize: 11.5, padding: '4px 6px', fontFamily: 'var(--font-mono)' }}
                      placeholder="nama_field"
                      value={row.key}
                      onChange={(e) =>
                        updateKeyValueRow(formFields, setFormFields, idx, { key: e.target.value })
                      }
                    />
                    <input
                      className="form-input"
                      style={{ flex: 1, fontSize: 11.5, padding: '4px 6px', fontFamily: 'var(--font-mono)' }}
                      placeholder="nilai"
                      value={row.value}
                      onChange={(e) =>
                        updateKeyValueRow(formFields, setFormFields, idx, { value: e.target.value })
                      }
                    />
                    <button
                      className="icon-btn"
                      onClick={() => setFormFields(formFields.filter((_, i) => i !== idx))}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                <button
                  className="btn"
                  style={{ fontSize: 11, justifyContent: 'center' }}
                  onClick={() =>
                    setFormFields([...formFields, { key: '', value: '', enabled: true }])
                  }
                >
                  <Plus size={12} /> Tambah Field $_POST
                </button>
              </div>
            )}

            {(bodyMode === 'json' || bodyMode === 'raw') && (
              <textarea
                className="form-input"
                rows={5}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, resize: 'vertical' }}
                value={rawBody}
                onChange={(e) => setRawBody(e.target.value)}
              />
            )}
          </div>
        )}

        {/* Sub-tab 2: Session Cookie & Headers */}
        {activeSubTab === 'headers' && (
          <div
            style={{
              padding: 9,
              borderRadius: 6,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8
            }}
          >
            <div>
              <label className="form-label" style={{ fontSize: 11 }}>
                PHPSESSID / Cookie Login Intranet
              </label>
              <input
                className="form-input"
                style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)' }}
                placeholder="Tempel nilai PHPSESSID atau laravel_session=..."
                value={cookieSession}
                onChange={(e) => setCookieSession(e.target.value)}
              />
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 3 }}>
                Jika diisi kode sesi saja (mis. <code>a8f92c...</code>), otomatis dikirim sebagai{' '}
                <code>Cookie: PHPSESSID=...</code>
              </div>
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11.5,
                cursor: 'pointer'
              }}
            >
              <input
                type="checkbox"
                checked={insecureTls}
                onChange={(e) => setInsecureTls(e.target.checked)}
              />
              <ShieldAlert size={13} style={{ color: '#fcd34d' }} />
              Izinkan HTTPS Self-Signed (Server Intranet Lokal)
            </label>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 5 }}>Custom Headers</div>
              {headers.map((h, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  <input
                    type="checkbox"
                    checked={h.enabled}
                    onChange={(e) =>
                      updateKeyValueRow(headers, setHeaders, idx, { enabled: e.target.checked })
                    }
                  />
                  <input
                    className="form-input"
                    style={{ flex: 1, fontSize: 11, padding: '3px 6px' }}
                    placeholder="Header"
                    value={h.key}
                    onChange={(e) =>
                      updateKeyValueRow(headers, setHeaders, idx, { key: e.target.value })
                    }
                  />
                  <input
                    className="form-input"
                    style={{ flex: 1, fontSize: 11, padding: '3px 6px' }}
                    placeholder="Value"
                    value={h.value}
                    onChange={(e) =>
                      updateKeyValueRow(headers, setHeaders, idx, { value: e.target.value })
                    }
                  />
                  <button
                    className="icon-btn"
                    onClick={() => setHeaders(headers.filter((_, i) => i !== idx))}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <button
                className="btn"
                style={{ width: '100%', justifyContent: 'center', fontSize: 11 }}
                onClick={() => setHeaders([...headers, { key: '', value: '', enabled: true }])}
              >
                <Plus size={12} /> Tambah Header
              </button>
            </div>
          </div>
        )}

        {/* Sub-tab 4: Environment Variables, Auto-Capture & OpenAPI / Postman Importer */}
        {activeSubTab === 'env' && activeEnv && (
          <div
            style={{
              padding: 9,
              borderRadius: 6,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 9
            }}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
                Variabel Lingkungan: {activeEnv.name} (Gunakan <code>{'{{nama_var}}'}</code>)
              </div>
              {Object.entries(activeEnv.variables).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
                  <code style={{ fontSize: 10.5, color: '#7dd3fc', minWidth: 68 }}>{k}</code>
                  <input
                    className="form-input"
                    style={{ flex: 1, fontSize: 11, padding: '3px 6px', fontFamily: 'var(--font-mono)' }}
                    value={v}
                    onChange={(e) => {
                      const nextEnvs = httpWorkspace.environments.map((env) =>
                        env.id === activeEnv.id
                          ? { ...env, variables: { ...env.variables, [k]: e.target.value } }
                          : env
                      );
                      void persistHttpWorkspace({ ...httpWorkspace, environments: nextEnvs });
                    }}
                  />
                </div>
              ))}
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <input
                  className="form-input"
                  style={{ width: 78, fontSize: 10.5, padding: '3px 5px' }}
                  placeholder="key baru"
                  value={newEnvKey}
                  onChange={(e) => setNewEnvKey(e.target.value)}
                />
                <input
                  className="form-input"
                  style={{ flex: 1, fontSize: 10.5, padding: '3px 5px' }}
                  placeholder="nilai..."
                  value={newEnvVal}
                  onChange={(e) => setNewEnvVal(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() => {
                    if (!newEnvKey.trim()) return;
                    const nextEnvs = httpWorkspace.environments.map((env) =>
                      env.id === activeEnv.id
                        ? { ...env, variables: { ...env.variables, [newEnvKey.trim()]: newEnvVal } }
                        : env
                    );
                    void persistHttpWorkspace({ ...httpWorkspace, environments: nextEnvs });
                    setNewEnvKey('');
                    setNewEnvVal('');
                  }}
                >
                  <Plus size={11} />
                </button>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 7 }}>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
                🔑 Auto-Capture Token / Cookie Login
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, marginBottom: 5 }}>
                <input
                  type="checkbox"
                  checked={autoCaptureCookie}
                  onChange={(e) => setAutoCaptureCookie(e.target.checked)}
                />
                Tangkap otomatis <code>Set-Cookie</code> (PHPSESSID) dari respons
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 0.8fr', gap: 4 }}>
                <input
                  className="form-input"
                  style={{ fontSize: 10.5, padding: '3px 6px', fontFamily: 'var(--font-mono)' }}
                  placeholder="JSON Path (mis. data.token)"
                  value={autoCaptureJsonPath}
                  onChange={(e) => setAutoCaptureJsonPath(e.target.value)}
                />
                <input
                  className="form-input"
                  style={{ fontSize: 10.5, padding: '3px 6px', fontFamily: 'var(--font-mono)' }}
                  placeholder="Ke var (token)"
                  value={autoCaptureTargetVar}
                  onChange={(e) => setAutoCaptureTargetVar(e.target.value)}
                />
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 7 }}>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Upload size={11} color="#34d399" /> Impor OpenAPI / Swagger / Postman JSON
              </div>
              <textarea
                className="form-input"
                rows={4}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, resize: 'vertical' }}
                placeholder="Tempel isi file swagger.json, openapi.json, atau Postman Collection v2.1 JSON..."
                value={specImportText}
                onChange={(e) => setSpecImportText(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', fontSize: 11, marginTop: 5 }}
                disabled={!specImportText.trim()}
                onClick={async () => {
                  try {
                    const imported = importOpenApiOrPostmanJson(specImportText);
                    const nextReqs = [...httpWorkspace.requests];
                    const nextFolders = [...httpWorkspace.folders];
                    for (const req of imported.requests) {
                      if (!nextFolders.includes(req.folder)) nextFolders.push(req.folder);
                      const saved = await window.aptana.http.saveRequest(req);
                      nextReqs.unshift({ ...saved, folder: req.folder });
                    }
                    const nextEnvs =
                      imported.baseUrl && imported.baseUrl !== '{{base_url}}'
                        ? httpWorkspace.environments.map((env) =>
                            env.id === activeEnv.id
                              ? { ...env, variables: { ...env.variables, base_url: imported.baseUrl! } }
                              : env
                          )
                        : httpWorkspace.environments;
                    await persistHttpWorkspace({
                      ...httpWorkspace,
                      environments: nextEnvs,
                      folders: nextFolders,
                      requests: nextReqs
                    });
                    await refreshSaved();
                    setSpecImportText('');
                    setActiveSubTab('saved');
                    showToast(
                      `📦 Berhasil impor ${imported.requests.length} endpoint dari ${imported.sourceFormat.toUpperCase()} ("${imported.collectionName}")!`
                    );
                  } catch (err) {
                    showToast(`Gagal impor API spec: ${err instanceof Error ? err.message : String(err)}`);
                  }
                }}
              >
                <FolderOpen size={12} /> Impor ke Koleksi
              </button>
            </div>
          </div>
        )}

        {/* Sub-tab 3: Saved Requests */}
        {activeSubTab === 'saved' && (
          <div
            style={{
              padding: 9,
              borderRadius: 6,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 7
            }}
          >
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                className="form-input"
                style={{ width: 82, fontSize: 11 }}
                placeholder="Folder"
                value={saveFolder}
                onChange={(e) => setSaveFolder(e.target.value)}
                title="Nama folder koleksi"
              />
              <input
                className="form-input"
                style={{ flex: 1, fontSize: 11.5 }}
                placeholder="Nama endpoint..."
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
              />
              <button className="btn btn-primary" style={{ fontSize: 11 }} onClick={() => void handleSaveRequest()}>
                Simpan
              </button>
            </div>

            {savedRequests.length === 0 ? (
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', padding: '8px 0' }}>
                Belum ada request tersimpan.
              </div>
            ) : (
              savedRequests.map((req) => (
                <div
                  key={req.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                    padding: '6px 8px',
                    borderRadius: 5,
                    border: '1px solid var(--border-subtle)',
                    cursor: 'pointer'
                  }}
                  onClick={() => loadSavedRequest(req)}
                >
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600 }}>
                      <span className="badge" style={{ marginRight: 5 }}>
                        {req.method}
                      </span>
                      {req.name}
                    </div>
                    <div
                      style={{
                        fontSize: 10.5,
                        color: 'var(--text-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {req.url}
                    </div>
                  </div>
                  <button
                    className="icon-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      void window.aptana.http.deleteSaved(req.id).then(refreshSaved);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* Error Output */}
        {sendError && (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              background: 'rgba(239,68,68,0.14)',
              border: '1px solid rgba(239,68,68,0.4)',
              color: '#fca5a5',
              fontSize: 11.5
            }}
          >
            <strong>Gagal Menghubungi Endpoint:</strong> {sendError}
          </div>
        )}

        {/* Response Viewer */}
        {response && (
          <div
            style={{
              padding: 9,
              borderRadius: 6,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 7
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 5 }}>
              <span
                style={{
                  padding: '2px 7px',
                  borderRadius: 4,
                  fontWeight: 700,
                  fontSize: 11,
                  background: response.ok ? 'rgba(16,185,129,0.18)' : 'rgba(239,68,68,0.2)',
                  color: response.ok ? '#6ee7b7' : '#fca5a5'
                }}
              >
                {response.status} {response.statusText}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {response.durationMs} ms • {(response.sizeBytes / 1024).toFixed(1)} KB
              </span>
            </div>

            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className={`btn ${responseView === 'body' ? 'btn-primary' : ''}`}
                style={{ fontSize: 10.5, padding: '2px 8px' }}
                onClick={() => setResponseView('body')}
              >
                Response Body
              </button>
              <button
                className={`btn ${responseView === 'headers' ? 'btn-primary' : ''}`}
                style={{ fontSize: 10.5, padding: '2px 8px' }}
                onClick={() => setResponseView('headers')}
              >
                Headers ({Object.keys(response.headers).length})
              </button>
              <button
                className="btn"
                style={{ fontSize: 10.5, padding: '2px 7px', marginLeft: 'auto' }}
                onClick={() => {
                  void navigator.clipboard.writeText(response.body);
                  showToast('Response body disalin.');
                }}
                title="Salin Response"
              >
                <Copy size={11} />
              </button>
              <button
                className="btn"
                style={{ fontSize: 10.5, padding: '2px 7px' }}
                disabled={aiBusy}
                onClick={() => void handleDiagnoseWithAi()}
                title="Analisis Response / Error PHP dengan Gemini AI"
              >
                <Sparkles size={11} /> AI
              </button>
            </div>

            {responseView === 'body' ? (
              <pre
                style={{
                  margin: 0,
                  padding: 8,
                  borderRadius: 5,
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-subtle)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  maxHeight: 290,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}
              >
                {response.body || '(Response kosong)'}
              </pre>
            ) : (
              <div
                style={{
                  padding: 8,
                  borderRadius: 5,
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  maxHeight: 240,
                  overflow: 'auto'
                }}
              >
                {Object.entries(response.headers).map(([k, v]) => (
                  <div key={k} style={{ marginBottom: 3 }}>
                    <strong style={{ color: 'var(--accent)' }}>{k}:</strong> {v}
                  </div>
                ))}
              </div>
            )}

            {aiAnalysis && (
              <div
                style={{
                  padding: 8,
                  borderRadius: 5,
                  background: 'rgba(139, 92, 246, 0.1)',
                  border: '1px solid rgba(139, 92, 246, 0.35)',
                  fontSize: 11.5,
                  whiteSpace: 'pre-wrap',
                  maxHeight: 220,
                  overflowY: 'auto'
                }}
              >
                <strong style={{ color: '#c4b5fd', display: 'block', marginBottom: 4 }}>
                  ✨ Diagnosis Gemini AI:
                </strong>
                {aiAnalysis}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
