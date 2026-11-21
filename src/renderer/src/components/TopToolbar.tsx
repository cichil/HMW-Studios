import React from 'react';
import {
  Bookmark,
  BookOpen,
  Command,
  FolderKanban,
  FolderOpen,
  Globe,
  SaveAll,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TerminalSquare
} from 'lucide-react';
import type { ThemeId } from '@shared/types';
import { useIdeStore } from '../store/useIdeStore';
import { DynamicIsland } from './DynamicIsland';
import { HmwLogo } from './HmwLogo';

export const TopToolbar: React.FC = () => {
  const {
    theme,
    setTheme,
    projects,
    activeProjectId,
    setProjectModalOpen,
    quickSaveActiveProject,
    openWorkspaceFolder,
    saveAllTabs,
    tabs,
    previewOpen,
    togglePreviewPane,
    bottomPanelOpen,
    setBottomPanel,
    activeSidebar,
    setActiveSidebar,
    setPaletteMode,
    setAuditModalOpen,
    setSecurityScannerModalOpen,
    docsModalOpen,
    setDocsModalOpen
  } = useIdeStore();

  const hasDirtyTabs = tabs.some((t) => t.content !== t.savedContent);
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  return (
    <header className="top-toolbar">
      {/* LEFT GROUP: Brand Lockup & Project Actions */}
      <div className="toolbar-group">
        <div className="brand-cluster" title="HMW Studio">
          <HmwLogo size={28} />
          <div className="brand-wordmark">
            <span>HMW</span>
            <span className="brand-wordmark-accent">Studio</span>
          </div>
        </div>

        <button
          className={`btn ${activeProject ? 'btn-accent' : ''}`}
          style={{ padding: '4px 9px' }}
          onClick={() => setProjectModalOpen(true)}
          title="Buka Daftar Proyek Tersimpan atau Simpan Proyek Baru"
        >
          <FolderKanban size={14} />
          <span
            style={{
              maxWidth: 125,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {activeProject ? activeProject.name : `Proyek (${projects.length})`}
          </span>
        </button>

        <button
          className="btn"
          style={{ padding: '4px 9px' }}
          onClick={() => void quickSaveActiveProject()}
          title="Simpan Proyek Saat Ini agar Dapat Dibuka Kembali (Ctrl+Alt+S)"
        >
          <Bookmark size={14} color="var(--accent)" />
          <span>
            Simpan<span className="toolbar-label-wide"> Proyek</span>
          </span>
        </button>

        <button
          className="btn"
          style={{ padding: '4px 9px' }}
          onClick={() => void openWorkspaceFolder()}
          title="Buka Folder Proyek Lokal"
        >
          <FolderOpen size={14} />
          <span>
            <span className="toolbar-label-wide">Buka </span>Folder
          </span>
        </button>

        <button
          className="btn"
          style={{ padding: '4px 8px' }}
          disabled={!hasDirtyTabs}
          onClick={() => void saveAllTabs()}
          title="Simpan Semua Perubahan File (Ctrl+Shift+S)"
        >
          <SaveAll size={14} />
          <span className="toolbar-label-wide">Simpan Semua</span>
        </button>
      </div>

      {/* CENTER GROUP: HMW Dynamic Island */}
      <DynamicIsland />

      {/* RIGHT GROUP: Commands, Gemini AI, Preview, Terminal & Theme */}
      <div className="toolbar-group" style={{ flexShrink: 0 }}>
        <button
          className="btn btn-ghost"
          style={{ padding: '4px 7px' }}
          onClick={() => setSecurityScannerModalOpen(true)}
          title="Enterprise Security, PHP 8 Compatibility & Broken-Include Scanner"
        >
          <ShieldAlert size={14} color="#f87171" />
        </button>

        <button
          className="btn btn-ghost"
          style={{ padding: '4px 7px' }}
          onClick={() => setAuditModalOpen(true)}
          title="Enterprise Audit Trail & 1-Click SQL Undo"
        >
          <ShieldCheck size={14} color="#34d399" />
        </button>

        <button
          className="btn btn-ghost"
          style={{ padding: '4px 7px' }}
          onClick={() => setPaletteMode('commands')}
          title="Command Palette & Rubles (Ctrl+Shift+P)"
        >
          <Command size={14} />
        </button>

        <button
          className={`btn ${docsModalOpen ? 'btn-accent' : 'btn-ghost'}`}
          style={{ padding: '4px 8px' }}
          onClick={() => setDocsModalOpen(!docsModalOpen)}
          title="Dokumentasi & Panduan Lengkap Fitur HMW Studio (F1)"
        >
          <BookOpen size={14} color={docsModalOpen ? '#ffffff' : '#38bdf8'} />
          <span className="toolbar-label-wide">Dokumentasi</span>
        </button>

        <button
          className={`btn ${activeSidebar === 'ai' ? 'btn-accent' : 'btn-ai'}`}
          style={{ padding: '4px 9px' }}
          onClick={() => setActiveSidebar('ai')}
          title="Buka Google Gemini AI Studio: Chat, CRUD Wisanggeni, Audit Keamanan & Docs (Ctrl+Shift+A)"
        >
          <Sparkles size={14} color={activeSidebar === 'ai' ? '#fff' : '#c084fc'} />
          <span>Gemini AI</span>
        </button>

        <button
          className={`btn ${previewOpen ? 'btn-accent' : ''}`}
          style={{ padding: '4px 9px' }}
          onClick={() => void togglePreviewPane()}
          title="Toggle Live Web Preview Server"
        >
          <Globe size={14} />
          <span>Preview</span>
        </button>

        <button
          className={`btn ${bottomPanelOpen ? 'btn-accent' : ''}`}
          style={{ padding: '4px 7px' }}
          onClick={() => setBottomPanel(!bottomPanelOpen, 'terminal')}
          title="Buka / Tutup Panel Terminal & SSH (Ctrl+`)"
        >
          <TerminalSquare size={14} />
        </button>

        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as ThemeId)}
          title="Tema Visual HMW Studio"
          style={{
            padding: '4px 8px',
            flexShrink: 0,
            backgroundColor: 'var(--bg-app)',
            color: 'var(--text-primary)'
          }}
        >
          <option value="aptana-dark">HMW Dark</option>
          <option value="modern-dark">Midnight Blue</option>
          <option value="modern-light">Clean Light</option>
        </select>
      </div>
    </header>
  );
};
