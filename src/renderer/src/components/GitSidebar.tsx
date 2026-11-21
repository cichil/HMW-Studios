import React, { useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  GitBranch,
  GitCommitHorizontal,
  Minus,
  Plus,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import { useIdeStore } from '../store/useIdeStore';

export const GitSidebar: React.FC = () => {
  const {
    workspacePath,
    gitStatus,
    refreshGit,
    openDiffTab,
    geminiConfig,
    setActiveSidebar,
    setGeminiSubTab,
    showToast
  } = useIdeStore();

  const [commitMessage, setCommitMessage] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiCommitBusy, setAiCommitBusy] = useState(false);

  if (!workspacePath) {
    return (
      <div>
        <div className="sidebar-header">
          <span>Git Source Control</span>
        </div>
        <div style={{ padding: 14, color: 'var(--text-muted)' }}>
          Buka folder proyek terlebih dahulu untuk mengelola Git.
        </div>
      </div>
    );
  }

  if (!gitStatus || !gitStatus.isRepo) {
    return (
      <div>
        <div className="sidebar-header">
          <span>Git Source Control</span>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Folder proyek ini belum diinisialisasi sebagai repositori Git.
          </p>
          <button
            className="btn btn-accent"
            onClick={async () => {
              await window.aptana.git.init(workspacePath);
              await refreshGit();
              showToast('Repositori Git baru berhasil diinisialisasi.');
            }}
          >
            <GitBranch size={14} />
            <span>Inisialisasi Git Repository</span>
          </button>
        </div>
      </div>
    );
  }

  const staged = gitStatus.changes.filter((c) => c.staged);
  const unstaged = gitStatus.changes.filter((c) => !c.staged);

  const handleCommit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!commitMessage.trim()) return;
    setBusy(true);
    try {
      if (staged.length === 0 && unstaged.length > 0) {
        await window.aptana.git.stage(
          workspacePath,
          unstaged.map((u) => u.path)
        );
      }
      await window.aptana.git.commit(workspacePath, commitMessage.trim());
      setCommitMessage('');
      await refreshGit();
      showToast('Commit Git berhasil dibuat.');
    } catch (err) {
      showToast(`Gagal commit: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenGitDiff = async (relPath: string): Promise<void> => {
    const diff = await window.aptana.git.fileDiff(workspacePath, relPath);
    const sep = workspacePath.includes('\\') ? '\\' : '/';
    openDiffTab({
      id: `git-diff:${relPath}`,
      title: `Git Diff: ${relPath.split('/').pop()}`,
      filePath: `${workspacePath}${sep}${relPath.replace(/\//g, sep)}`,
      relativePath: relPath,
      originalContent: diff.original,
      modifiedContent: diff.modified,
      diffLabel: `HEAD ↔ Working Tree (${relPath})`
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="sidebar-header">
        <span>Git Source Control</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className="btn-ghost"
            style={{ border: 'none', padding: 3 }}
            title="Git Pull"
            onClick={async () => {
              const res = await window.aptana.git.pull(workspacePath);
              await refreshGit();
              showToast(res.summary);
            }}
          >
            <ArrowDownToLine size={13} />
          </button>
          <button
            className="btn-ghost"
            style={{ border: 'none', padding: 3 }}
            title="Git Push"
            onClick={async () => {
              const res = await window.aptana.git.push(workspacePath);
              await refreshGit();
              showToast(res.summary);
            }}
          >
            <ArrowUpFromLine size={13} />
          </button>
          <button
            className="btn-ghost"
            style={{ border: 'none', padding: 3 }}
            title="Segarkan Status Git"
            onClick={() => void refreshGit()}
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      <div style={{ padding: 10, borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <GitBranch size={14} color="var(--accent)" />
          <select
            value={gitStatus.branch}
            onChange={async (e) => {
              await window.aptana.git.checkout(workspacePath, e.target.value, false);
              await refreshGit();
            }}
            style={{ flex: 1 }}
          >
            {gitStatus.branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            onClick={() => setCreatingBranch(!creatingBranch)}
            title="Buat Branch Baru"
          >
            +
          </button>
        </div>

        {creatingBranch && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newBranchName.trim()) return;
              await window.aptana.git.checkout(workspacePath, newBranchName.trim(), true);
              setNewBranchName('');
              setCreatingBranch(false);
              await refreshGit();
            }}
            style={{ display: 'flex', gap: 6 }}
          >
            <input
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              placeholder="nama-branch-baru"
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-accent">
              Checkout
            </button>
          </form>
        )}

        <form onSubmit={(e) => void handleCommit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            rows={2}
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Pesan commit..."
          />
          <button
            type="button"
            className="btn"
            disabled={aiCommitBusy || gitStatus.changes.length === 0}
            style={{ justifyContent: 'center', fontSize: 11.5 }}
            onClick={async () => {
              if (!geminiConfig?.hasApiKey) {
                setActiveSidebar('ai');
                setGeminiSubTab('settings');
                showToast('Atur GEMINI_API_KEY Anda terlebih dahulu pada panel Gemini AI.');
                return;
              }
              setAiCommitBusy(true);
              try {
                const targetChanges = staged.length > 0 ? staged : unstaged;
                const diffSnippets: string[] = [
                  `Branch: ${gitStatus.branch}`,
                  `Daftar file berubah (${targetChanges.length}):`,
                  ...targetChanges.map((c) => `- [${c.status}] ${c.path}`)
                ];
                for (const item of targetChanges.slice(0, 4)) {
                  try {
                    const d = await window.aptana.git.fileDiff(workspacePath, item.path);
                    diffSnippets.push(
                      `\n--- File: ${item.path} ---\nSebelum (ringkas):\n${d.original.slice(0, 900)}\nSesudah (ringkas):\n${d.modified.slice(0, 1200)}`
                    );
                  } catch {
                    // Lewati jika gagal diff file biner/baru
                  }
                }
                const res = await window.aptana.ai.summarizeChanges({
                  mode: 'commit-message',
                  changesText: diffSnippets.join('\n')
                });
                setCommitMessage(res.commitMessage);
                showToast('✨ Pesan commit AI berhasil dibuat.');
              } catch (err) {
                showToast(
                  `Gagal membuat pesan commit AI: ${err instanceof Error ? err.message : String(err)}`
                );
              } finally {
                setAiCommitBusy(false);
              }
            }}
          >
            <Sparkles size={13} color="#a855f7" />
            <span>
              {aiCommitBusy ? 'Menyusun Pesan Commit...' : '✨ Buat Pesan Commit AI'}
            </span>
          </button>
          <button
            type="submit"
            className="btn btn-accent"
            disabled={busy || !commitMessage.trim() || gitStatus.changes.length === 0}
            style={{ justifyContent: 'center' }}
          >
            <Check size={14} />
            <span>Commit Perubahan ({staged.length || unstaged.length})</span>
          </button>
        </form>
      </div>

      <div className="sidebar-scroll">
        {staged.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', padding: '4px 6px' }}>
              STAGED ({staged.length})
            </div>
            {staged.map((item) => (
              <div
                key={`staged:${item.path}`}
                className="tree-row"
                onClick={() => void handleOpenGitDiff(item.path)}
              >
                <span style={{ color: 'var(--success)', fontWeight: 700, width: 14 }}>
                  {item.status}
                </span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.path}
                </span>
                <button
                  className="btn-ghost"
                  style={{ border: 'none', padding: 2 }}
                  title="Unstage"
                  onClick={async (e) => {
                    e.stopPropagation();
                    await window.aptana.git.unstage(workspacePath, [item.path]);
                    await refreshGit();
                  }}
                >
                  <Minus size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', padding: '4px 6px' }}>
            PERUBAHAN ({unstaged.length})
          </div>
          {unstaged.length === 0 ? (
            <div style={{ padding: '4px 8px', color: 'var(--text-muted)', fontSize: 12 }}>
              Working tree bersih.
            </div>
          ) : (
            unstaged.map((item) => (
              <div
                key={`unstaged:${item.path}`}
                className="tree-row"
                onClick={() => void handleOpenGitDiff(item.path)}
              >
                <span style={{ color: 'var(--warning)', fontWeight: 700, width: 14 }}>
                  {item.status}
                </span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.path}
                </span>
                <button
                  className="btn-ghost"
                  style={{ border: 'none', padding: 2 }}
                  title="Stage File"
                  onClick={async (e) => {
                    e.stopPropagation();
                    await window.aptana.git.stage(workspacePath, [item.path]);
                    await refreshGit();
                  }}
                >
                  <Plus size={13} />
                </button>
              </div>
            ))
          )}
        </div>

        {gitStatus.recentCommits.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', padding: '4px 6px' }}>
              RIWAYAT COMMIT TERBARU
            </div>
            {gitStatus.recentCommits.map((c) => (
              <div
                key={c.hash}
                style={{
                  padding: '6px 8px',
                  borderBottom: '1px solid var(--border-subtle)',
                  fontSize: 11.5
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--accent)', fontWeight: 600 }}>
                  <GitCommitHorizontal size={12} />
                  <span>{c.shortHash}</span>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>• {c.author}</span>
                </div>
                <div style={{ color: 'var(--text-primary)', marginTop: 2 }}>{c.message}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
