import React, { useState } from 'react';
import { Code2, Play, Plus, Trash2 } from 'lucide-react';
import type { RubleScope } from '@shared/types';
import { useIdeStore } from '../store/useIdeStore';

export const RublesSidebar: React.FC = () => {
  const {
    rubleBundles,
    refreshRubles,
    insertTextIntoActiveTab,
    executeRubleCommand,
    showToast
  } = useIdeStore();

  const [addingMode, setAddingMode] = useState<'none' | 'snippet' | 'command'>('none');
  const [snipTrigger, setSnipTrigger] = useState('');
  const [snipName, setSnipName] = useState('');
  const [snipScope, setSnipScope] = useState<RubleScope>('html');
  const [snipBody, setSnipBody] = useState('');

  const [cmdName, setCmdName] = useState('');
  const [cmdLine, setCmdLine] = useState('');

  const handleCreateSnippet = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!snipTrigger.trim() || !snipName.trim() || !snipBody.trim()) return;
    await window.aptana.rubles.saveSnippet({
      trigger: snipTrigger.trim(),
      name: snipName.trim(),
      scope: snipScope,
      description: `Custom snippet (${snipScope})`,
      body: snipBody
    });
    await refreshRubles();
    setAddingMode('none');
    setSnipTrigger('');
    setSnipName('');
    setSnipBody('');
    showToast('Snippet Ruble kustom berhasil ditambahkan ke Monaco Intellisense!');
  };

  const handleCreateCommand = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!cmdName.trim() || !cmdLine.trim()) return;
    await window.aptana.rubles.saveCommand({
      name: cmdName.trim(),
      description: 'Perintah otomatisasi pengguna',
      commandLine: cmdLine.trim()
    });
    await refreshRubles();
    setAddingMode('none');
    setCmdName('');
    setCmdLine('');
    showToast('Command Ruble kustom berhasil disimpan.');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="sidebar-header">
        <span>Rubles 2.0 &amp; Snippets</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className="btn-ghost"
            style={{ border: 'none', padding: '2px 5px', fontSize: 11 }}
            onClick={() => setAddingMode(addingMode === 'snippet' ? 'none' : 'snippet')}
            title="Tambah Custom Snippet"
          >
            <Plus size={12} /> Snippet
          </button>
          <button
            className="btn-ghost"
            style={{ border: 'none', padding: '2px 5px', fontSize: 11 }}
            onClick={() => setAddingMode(addingMode === 'command' ? 'none' : 'command')}
            title="Tambah Custom Command"
          >
            <Plus size={12} /> Cmd
          </button>
        </div>
      </div>

      {addingMode === 'snippet' && (
        <form
          onSubmit={(e) => void handleCreateSnippet(e)}
          style={{
            padding: 10,
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          <input
            placeholder="Trigger tab (contoh: card-ui)"
            value={snipTrigger}
            onChange={(e) => setSnipTrigger(e.target.value)}
          />
          <input
            placeholder="Nama snippet"
            value={snipName}
            onChange={(e) => setSnipName(e.target.value)}
          />
          <select
            value={snipScope}
            onChange={(e) => setSnipScope(e.target.value as RubleScope)}
          >
            <option value="global">Semua Bahasa (Global)</option>
            <option value="html">HTML</option>
            <option value="css">CSS</option>
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="php">PHP</option>
            <option value="python">Python</option>
          </select>
          <textarea
            rows={4}
            placeholder="Isi kode snippet..."
            value={snipBody}
            onChange={(e) => setSnipBody(e.target.value)}
          />
          <button type="submit" className="btn btn-accent" style={{ justifyContent: 'center' }}>
            Simpan Snippet
          </button>
        </form>
      )}

      {addingMode === 'command' && (
        <form
          onSubmit={(e) => void handleCreateCommand(e)}
          style={{
            padding: 10,
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          <input
            placeholder="Nama Perintah (contoh: Build Assets)"
            value={cmdName}
            onChange={(e) => setCmdName(e.target.value)}
          />
          <input
            placeholder="Perintah CLI (contoh: npm run build)"
            value={cmdLine}
            onChange={(e) => setCmdLine(e.target.value)}
          />
          <button type="submit" className="btn btn-accent" style={{ justifyContent: 'center' }}>
            Simpan Command
          </button>
        </form>
      )}

      <div className="sidebar-scroll">
        {rubleBundles.map((bundle) => (
          <div
            key={bundle.id}
            style={{
              marginBottom: 12,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              padding: 8
            }}
          >
            <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>
              {bundle.name}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 8 }}>
              {bundle.description}
            </div>

            {bundle.snippets.map((s) => (
              <div
                key={s.id}
                className="tree-row"
                onClick={() => insertTextIntoActiveTab(s.body)}
                title="Klik untuk menyisipkan ke editor aktif (atau ketik trigger di editor)"
              >
                <Code2 size={13} color="var(--accent)" />
                <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{s.trigger}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  — {s.name}
                </span>
                {!bundle.builtIn && (
                  <button
                    className="btn-ghost"
                    style={{ border: 'none', padding: 2 }}
                    onClick={async (e) => {
                      e.stopPropagation();
                      await window.aptana.rubles.deleteSnippet(s.id);
                      await refreshRubles();
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}

            {bundle.commands.map((cmd) => (
              <div
                key={cmd.id}
                className="tree-row"
                onClick={() => void executeRubleCommand(cmd.name, cmd.commandLine)}
                title={`Jalankan: ${cmd.commandLine}`}
              >
                <Play size={13} color="#4ade80" />
                <span style={{ flex: 1 }}>{cmd.name}</span>
                {!bundle.builtIn && (
                  <button
                    className="btn-ghost"
                    style={{ border: 'none', padding: 2 }}
                    onClick={async (e) => {
                      e.stopPropagation();
                      await window.aptana.rubles.deleteCommand(cmd.id);
                      await refreshRubles();
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
