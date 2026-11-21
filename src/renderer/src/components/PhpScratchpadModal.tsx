import React, { useEffect, useRef, useState } from 'react';
import { Copy, Play, TerminalSquare, Trash2, X, Zap } from 'lucide-react';
import type { PhpSnippetRunResult } from '@shared/types';
import { ensureMonacoInitialized, monaco } from '../themes/monacoSetup';
import { useIdeStore } from '../store/useIdeStore';

const SCRATCHPAD_PRESETS: Array<{ label: string; code: string }> = [
  {
    label: 'Substr & Kode Unit',
    code: `<?php\n$kd_unitkerja = '05020100';\necho "4 digit awal: " . substr($kd_unitkerja, 0, 4) . "\\n";\necho "4 digit akhir: " . substr($kd_unitkerja, -4) . "\\n";\n`
  },
  {
    label: 'Tanggal & Waktu',
    code: `<?php\ndate_default_timezone_set('Asia/Jakarta');\n$now = new DateTimeImmutable();\necho "Sekarang : " . $now->format('Y-m-d H:i:s') . "\\n";\necho "+7 Hari  : " . $now->modify('+7 days')->format('Y-m-d') . "\\n";\n`
  },
  {
    label: 'JSON & Array Filter',
    code: `<?php\n$pegawai = [\n  ['nip' => '198501', 'nama' => 'Budi', 'aktif' => 1],\n  ['nip' => '199002', 'nama' => 'Siti', 'aktif' => 0],\n  ['nip' => '199205', 'nama' => 'Andi', 'aktif' => 1],\n];\n$aktif = array_values(array_filter($pegawai, fn($p) => $p['aktif'] === 1));\necho json_encode($aktif, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\\n";\n`
  },
  {
    label: 'Password & Hash',
    code: `<?php\n$plain = 'RahasiaIntranet123';\n$bcrypt = password_hash($plain, PASSWORD_BCRYPT);\necho "MD5    : " . md5($plain) . "\\n";\necho "SHA256 : " . hash('sha256', $plain) . "\\n";\necho "Bcrypt : " . $bcrypt . "\\n";\n`
  }
];

export const PhpScratchpadModal: React.FC = () => {
  const {
    phpScratchpadOpen,
    setPhpScratchpadOpen,
    phpScratchpadCode,
    setPhpScratchpadCode,
    workspacePath,
    theme,
    showToast
  } = useIdeStore();

  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const runRef = useRef<() => void>(() => {});

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PhpSnippetRunResult | null>(null);

  const handleRun = async (overrideCode?: string): Promise<void> => {
    const codeToRun = overrideCode ?? editorRef.current?.getValue() ?? phpScratchpadCode;
    if (!codeToRun.trim() || running) return;
    setRunning(true);
    try {
      const res = await window.aptana.php.runSnippet(codeToRun, workspacePath ?? undefined);
      setResult(res);
    } catch (err) {
      setResult({
        available: false,
        phpVersion: 'Error',
        exitCode: -1,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        durationMs: 0
      });
    } finally {
      setRunning(false);
    }
  };

  runRef.current = () => {
    void handleRun();
  };

  useEffect(() => {
    if (!phpScratchpadOpen) return;
    ensureMonacoInitialized();
    if (!hostRef.current) return;

    const model = monaco.editor.createModel(phpScratchpadCode, 'php');
    const editor = monaco.editor.create(hostRef.current, {
      model,
      theme,
      automaticLayout: true,
      fixedOverflowWidgets: true,
      minimap: { enabled: false },
      codeLens: false,
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
      scrollBeyondLastLine: false,
      padding: { top: 8, bottom: 8 }
    });

    const actRun = editor.addAction({
      id: 'hmw.runPhpScratchpad',
      label: 'Jalankan Kode PHP (Ctrl+Enter / F5)',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, monaco.KeyCode.F5],
      run: () => {
        runRef.current();
      }
    });

    const subChange = editor.onDidChangeModelContent(() => {
      setPhpScratchpadCode(editor.getValue());
    });

    editorRef.current = editor;
    editor.focus();

    return () => {
      actRun.dispose();
      subChange.dispose();
      editor.dispose();
      model.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phpScratchpadOpen]);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const mdl = ed.getModel();
    if (mdl && !mdl.isDisposed() && mdl.getValue() !== phpScratchpadCode) {
      mdl.setValue(phpScratchpadCode);
    }
  }, [phpScratchpadCode]);

  if (!phpScratchpadOpen) return null;

  return (
    <div
      className="modal-backdrop"
      style={{ zIndex: 1300 }}
    >
      <div
        className="modal-card"
        style={{
          width: 'min(980px, 95vw)',
          height: 'min(680px, 90vh)',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'visible'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0, minHeight: 30 }}>
            <Zap size={16} color="#fbbf24" style={{ flexShrink: 0 }} />
            <strong style={{ fontSize: 13.5 }}>PHP Scratchpad / Tinker Runner</strong>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              • Uji potongan fungsi, array, tanggal, atau regex instan tanpa buka browser (Ctrl+Enter)
            </span>
          </div>

          <button
            type="button"
            className="btn-modal-exit"
            onClick={() => setPhpScratchpadOpen(false)}
          >
            <X size={14} />
            <span>Keluar</span>
          </button>
        </div>

        {/* Presets & Action Toolbar */}
        <div
          style={{
            padding: '7px 14px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Contoh Cepat:</span>
            {SCRATCHPAD_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="btn"
                style={{ padding: '2px 8px', fontSize: 11 }}
                onClick={() => {
                  setPhpScratchpadCode(p.code);
                  void handleRun(p.code);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="btn"
              style={{ padding: '4px 8px', fontSize: 11.5 }}
              onClick={() => setResult(null)}
              title="Bersihkan Output"
            >
              <Trash2 size={12} />
              <span>Bersihkan</span>
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: '4px 12px', fontSize: 12 }}
              disabled={running}
              onClick={() => void handleRun()}
            >
              <Play size={13} />
              <span>{running ? 'Menjalankan...' : 'Jalankan (Ctrl+Enter)'}</span>
            </button>
          </div>
        </div>

        {/* Split Editor + Output */}
        <div
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: '1.15fr 0.85fr',
            minHeight: 0
          }}
        >
          <div
            style={{
              borderRight: '1px solid var(--border-subtle)',
              minHeight: 0,
              position: 'relative'
            }}
          >
            <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              background: 'var(--bg-surface)'
            }}
          >
            <div
              style={{
                padding: '6px 10px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 11.5
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <TerminalSquare size={13} color="var(--accent)" />
                <strong>Output Eksekusi PHP</strong>
                {result && (
                  <span
                    style={{
                      fontSize: 10.5,
                      color: result.exitCode === 0 ? '#34d399' : '#fca5a5'
                    }}
                  >
                    • PHP {result.phpVersion} • {result.durationMs} ms
                  </span>
                )}
              </div>
              {result && (result.stdout || result.stderr) && (
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ padding: '2px 6px', fontSize: 10.5 }}
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      `${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`.trim()
                    );
                    showToast('Output PHP disalin ke clipboard.');
                  }}
                >
                  <Copy size={11} /> Salin
                </button>
              )}
            </div>

            <pre
              style={{
                flex: 1,
                margin: 0,
                padding: 12,
                overflow: 'auto',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: 'var(--text-primary)'
              }}
            >
              {!result ? (
                <span style={{ color: 'var(--text-muted)' }}>
                  Tekan Ctrl+Enter atau klik &quot;Jalankan&quot; untuk mengeksekusi kode PHP di sebelah kiri...
                </span>
              ) : (
                <>
                  {result.stdout || (result.exitCode === 0 ? '(Selesai tanpa output teks)' : '')}
                  {result.stderr && (
                    <div style={{ color: '#fca5a5', marginTop: result.stdout ? 8 : 0 }}>
                      {result.stderr}
                    </div>
                  )}
                </>
              )}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
