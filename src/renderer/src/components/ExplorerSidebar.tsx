import React, { useEffect, useState } from 'react';
import {
  Activity,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  CloudDownload,
  CloudUpload,
  Columns2,
  Copy,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  GitCompare,
  Pencil,
  RefreshCw,
  Scissors,
  Server,
  Shield,
  Trash2,
  X
} from 'lucide-react';
import type { FileNode, RemoteEntry } from '@shared/types';
import { normalizeRemoteRelPath, useIdeStore } from '../store/useIdeStore';

interface RemoteContextMenuState {
  x: number;
  y: number;
  entry: RemoteEntry | null;
}

interface LocalContextMenuState {
  x: number;
  y: number;
  node: FileNode | null;
}

type ExplorerClipboardItem =
  | {
      mode: 'copy' | 'cut';
      sourceKind: 'local';
      path: string;
      relativePath: string;
      name: string;
      isDirectory: boolean;
    }
  | {
      mode: 'copy' | 'cut';
      sourceKind: 'remote';
      connectionId: string;
      connectionName: string;
      relativePath: string;
      name: string;
      isDirectory: boolean;
    };

export const ExplorerSidebar: React.FC = () => {
  const {
    workspacePath,
    fileTree,
    expandedDirs,
    toggleDirExpanded,
    refreshTree,
    openFileInTab,
    openRemoteFileInTab,
    openDiffTab,
    syncRenamedRemoteTabs,
    closeDeletedRemoteTabs,
    tabs,
    activeTabId,
    connections,
    selectedConnectionId,
    remoteSubPath,
    remoteEntries,
    remoteLoading,
    remoteConnectionStatus,
    remoteConnectionError,
    browseRemoteDir,
    openConnectionModal,
    setServerMonitorOpen,
    setSecondaryTab,
    showToast
  } = useIdeStore();

  // Local Explorer states
  const [creatingLocal, setCreatingLocal] = useState<{
    kind: 'file' | 'folder';
    parentDir: string;
  } | null>(null);
  const [newLocalName, setNewLocalName] = useState('');
  const [renamingLocalPath, setRenamingLocalPath] = useState<string | null>(null);
  const [renameLocalValue, setRenameLocalValue] = useState('');
  const [selectedLocalNode, setSelectedLocalNode] = useState<FileNode | null>(null);
  const [localContextMenu, setLocalContextMenu] = useState<LocalContextMenuState | null>(null);

  // Remote Browser states
  const [remoteExpanded, setRemoteExpanded] = useState(true);
  const [creatingRemote, setCreatingRemote] = useState<{
    kind: 'file' | 'folder';
    baseSubPath: string;
  } | null>(null);
  const [newRemoteName, setNewRemoteName] = useState('');
  const [renamingRemoteRelPath, setRenamingRemoteRelPath] = useState<string | null>(null);
  const [renameRemoteValue, setRenameRemoteValue] = useState('');
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [selectedRemoteEntry, setSelectedRemoteEntry] = useState<RemoteEntry | null>(null);
  const [contextMenu, setContextMenu] = useState<RemoteContextMenuState | null>(null);
  const [chmodTarget, setChmodTarget] = useState<RemoteEntry | null>(null);
  const [chmodValue, setChmodValue] = useState('644');
  const [dragOverSubPath, setDragOverSubPath] = useState<string | null>(null);

  // Cross Local <-> Remote Clipboard (Ctrl+X / Ctrl+C / Ctrl+V)
  const [fileClipboard, setFileClipboard] = useState<ExplorerClipboardItem | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeConn = connections.find((c) => c.id === selectedConnectionId) ?? null;

  useEffect(() => {
    if (!contextMenu && !localContextMenu) return;
    const closeMenu = (): void => {
      setContextMenu(null);
      setLocalContextMenu(null);
    };
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [contextMenu, localContextMenu]);

  const getLocalParentDir = (filePath: string): string => {
    const sep = filePath.includes('\\') ? '\\' : '/';
    const idx = filePath.lastIndexOf(sep);
    return idx > 0 ? filePath.slice(0, idx) : workspacePath || filePath;
  };

  const setClipboardFromLocal = (node: FileNode, mode: 'copy' | 'cut'): void => {
    setFileClipboard({
      mode,
      sourceKind: 'local',
      path: node.path,
      relativePath: node.relativePath,
      name: node.name,
      isDirectory: node.isDirectory
    });
    showToast(
      `${mode === 'cut' ? '✂ Dipotong (Cut)' : '📋 Disalin (Copy)'} [Lokal]: ${node.name} — Tekan Ctrl+V di folder Lokal atau Remote`
    );
  };

  const setClipboardFromRemote = (entry: RemoteEntry, mode: 'copy' | 'cut'): void => {
    if (!selectedConnectionId) return;
    setFileClipboard({
      mode,
      sourceKind: 'remote',
      connectionId: selectedConnectionId,
      connectionName: activeConn?.name || 'Remote',
      relativePath: entry.relativePath,
      name: entry.name,
      isDirectory: entry.isDirectory
    });
    showToast(
      `${mode === 'cut' ? '✂ Dipotong (Cut)' : '📋 Disalin (Copy)'} [${
        activeConn?.name || 'Remote'
      }]: ${entry.name} — Tekan Ctrl+V di folder Lokal atau Remote`
    );
  };

  const handlePasteToLocalDir = async (explicitTargetDir?: string): Promise<void> => {
    if (!workspacePath) {
      showToast('Buka folder proyek lokal terlebih dahulu sebelum menempel (Paste).');
      return;
    }
    if (!fileClipboard) {
      showToast('Clipboard file masih kosong. Pilih file/folder lalu tekan Ctrl+C atau Ctrl+X.');
      return;
    }

    const targetDir =
      explicitTargetDir ??
      (selectedLocalNode
        ? selectedLocalNode.isDirectory
          ? selectedLocalNode.path
          : getLocalParentDir(selectedLocalNode.path)
        : workspacePath);

    try {
      if (fileClipboard.sourceKind === 'local') {
        await window.aptana.workspace.copyOrMoveEntry(
          fileClipboard.path,
          targetDir,
          fileClipboard.mode
        );
        await refreshTree();
        showToast(
          `${fileClipboard.mode === 'cut' ? 'Dipindahkan' : 'Disalin'} di Lokal: ${fileClipboard.name}`
        );
        if (fileClipboard.mode === 'cut') {
          setFileClipboard(null);
          setSelectedLocalNode(null);
        }
      } else {
        setRemoteBusy(true);
        showToast(
          `${
            fileClipboard.mode === 'cut' ? 'Memindahkan' : 'Mengunduh'
          } dari ${fileClipboard.connectionName}: ${fileClipboard.name}...`
        );
        await window.aptana.connections.downloadEntryToLocalDir(
          fileClipboard.connectionId,
          fileClipboard.relativePath,
          fileClipboard.isDirectory,
          targetDir,
          fileClipboard.mode === 'cut'
        );
        await refreshTree();
        if (fileClipboard.mode === 'cut') {
          closeDeletedRemoteTabs(fileClipboard.connectionId, fileClipboard.relativePath);
          if (selectedConnectionId === fileClipboard.connectionId) {
            await browseRemoteDir(remoteSubPath);
          }
          setFileClipboard(null);
          setSelectedRemoteEntry(null);
        }
        showToast(
          `${
            fileClipboard.mode === 'cut' ? 'Dipindahkan' : 'Ditempel'
          } dari [${fileClipboard.connectionName}] ke Lokal: ${fileClipboard.name}`
        );
      }
    } catch (err) {
      showToast(
        `Gagal menempel ke Lokal: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setRemoteBusy(false);
    }
  };

  const handlePasteToRemoteDir = async (explicitRemoteSubDir?: string): Promise<void> => {
    if (!selectedConnectionId || !activeConn) {
      showToast('Pilih koneksi server terlebih dahulu sebelum menempel (Paste) ke Remote.');
      return;
    }
    if (!fileClipboard) {
      showToast('Clipboard file masih kosong. Pilih file/folder lalu tekan Ctrl+C atau Ctrl+X.');
      return;
    }

    const targetSub =
      explicitRemoteSubDir !== undefined
        ? explicitRemoteSubDir
        : selectedRemoteEntry?.isDirectory
          ? selectedRemoteEntry.relativePath
          : remoteSubPath;

    setRemoteBusy(true);
    try {
      if (fileClipboard.sourceKind === 'local') {
        showToast(
          `${
            fileClipboard.mode === 'cut' ? 'Memindahkan' : 'Mengunggah'
          } ${fileClipboard.name} ke ${activeConn.name}: /${targetSub}...`
        );
        const res = await window.aptana.connections.uploadMultiplePaths(
          selectedConnectionId,
          [fileClipboard.path],
          targetSub
        );
        if (res.errors.length > 0) {
          throw new Error(res.errors[0]);
        }
        if (fileClipboard.mode === 'cut') {
          await window.aptana.workspace.deleteEntry(fileClipboard.path);
          await refreshTree();
          setFileClipboard(null);
          setSelectedLocalNode(null);
        }
        await browseRemoteDir(remoteSubPath);
        showToast(
          `${
            fileClipboard.mode === 'cut' ? 'Dipindahkan' : 'Ditempel'
          } dari Lokal ke [${activeConn.name}]: /${targetSub ? `${targetSub}/` : ''}${fileClipboard.name}`
        );
      } else {
        showToast(
          `${
            fileClipboard.mode === 'cut' ? 'Memindahkan' : 'Menyalin'
          } di server: ${fileClipboard.name} → /${targetSub}...`
        );
        const res = await window.aptana.connections.copyOrMoveRemoteEntry(
          fileClipboard.connectionId,
          fileClipboard.relativePath,
          fileClipboard.isDirectory,
          selectedConnectionId,
          targetSub,
          fileClipboard.mode
        );
        if (fileClipboard.mode === 'cut') {
          if (fileClipboard.connectionId === selectedConnectionId) {
            syncRenamedRemoteTabs(
              selectedConnectionId,
              fileClipboard.relativePath,
              res.destRelativePath
            );
          } else {
            closeDeletedRemoteTabs(fileClipboard.connectionId, fileClipboard.relativePath);
          }
          setFileClipboard(null);
          setSelectedRemoteEntry(null);
        }
        await browseRemoteDir(remoteSubPath);
        showToast(
          `${
            fileClipboard.mode === 'cut' ? 'Dipindahkan' : 'Disalin'
          } di [${activeConn.name}]: /${res.destRelativePath}`
        );
      }
    } catch (err) {
      showToast(
        `Gagal menempel ke Server: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setRemoteBusy(false);
    }
  };

  const handleLocalPaneKeyDown = (e: React.KeyboardEvent): void => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;

    const k = e.key.toLowerCase();
    if ((k === 'x' || e.code === 'KeyX') && selectedLocalNode) {
      e.preventDefault();
      e.stopPropagation();
      setClipboardFromLocal(selectedLocalNode, 'cut');
    } else if ((k === 'c' || e.code === 'KeyC') && selectedLocalNode) {
      e.preventDefault();
      e.stopPropagation();
      setClipboardFromLocal(selectedLocalNode, 'copy');
    } else if (k === 'v' || e.code === 'KeyV') {
      e.preventDefault();
      e.stopPropagation();
      void handlePasteToLocalDir();
    }
  };

  const handleRemotePaneKeyDown = (e: React.KeyboardEvent): void => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;

    const k = e.key.toLowerCase();
    if ((k === 'x' || e.code === 'KeyX') && selectedRemoteEntry) {
      e.preventDefault();
      e.stopPropagation();
      setClipboardFromRemote(selectedRemoteEntry, 'cut');
    } else if ((k === 'c' || e.code === 'KeyC') && selectedRemoteEntry) {
      e.preventDefault();
      e.stopPropagation();
      setClipboardFromRemote(selectedRemoteEntry, 'copy');
    } else if (k === 'v' || e.code === 'KeyV') {
      e.preventDefault();
      e.stopPropagation();
      void handlePasteToRemoteDir();
    }
  };

  // ---------------- LOCAL EXPLORER HANDLERS ----------------
  const handleCreateLocalSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!workspacePath || !creatingLocal || !newLocalName.trim()) return;
    const sep = workspacePath.includes('\\') ? '\\' : '/';
    const fullTarget = `${creatingLocal.parentDir}${sep}${newLocalName.trim()}`;
    await window.aptana.workspace.createEntry(
      fullTarget,
      creatingLocal.kind === 'folder',
      ''
    );
    await refreshTree();
    if (creatingLocal.kind === 'file') {
      const rel = fullTarget
        .slice(workspacePath.length)
        .replace(/^[/\\]+/, '')
        .replace(/\\/g, '/');
      await openFileInTab(fullTarget, rel);
    }
    setNewLocalName('');
    setCreatingLocal(null);
  };

  const handleRenameLocalSubmit = async (
    node: FileNode,
    e: React.FormEvent
  ): Promise<void> => {
    e.preventDefault();
    const trimmed = renameLocalValue.trim();
    if (!trimmed || trimmed === node.name) {
      setRenamingLocalPath(null);
      return;
    }
    const sep = node.path.includes('\\') ? '\\' : '/';
    const parentDir = node.path.slice(0, node.path.lastIndexOf(sep));
    const nextPath = `${parentDir}${sep}${trimmed}`;
    try {
      await window.aptana.workspace.renameEntry(node.path, nextPath);
      await refreshTree();
      showToast(`Diubah namanya: ${node.name} → ${trimmed}`);
    } catch (err) {
      showToast(`Gagal mengubah nama: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRenamingLocalPath(null);
    }
  };

  const handleDeleteNode = async (node: FileNode, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    const confirmed = window.confirm(
      `Hapus ${node.isDirectory ? 'folder' : 'file'} lokal "${node.relativePath}"?`
    );
    if (!confirmed) return;
    await window.aptana.workspace.deleteEntry(node.path);
    await refreshTree();
    showToast(`Dihapus: ${node.relativePath}`);
  };

  const handleUploadSingle = async (node: FileNode, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    if (!workspacePath || !selectedConnectionId) {
      showToast('Pilih koneksi server terlebih dahulu untuk mengunggah file.');
      return;
    }
    try {
      await window.aptana.connections.uploadSingleFile(
        selectedConnectionId,
        workspacePath,
        node.relativePath
      );
      showToast(`Diunggah ke server: ${node.relativePath}`);
    } catch (err) {
      showToast(`Gagal unggah: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // ---------------- REMOTE BROWSER HANDLERS ----------------
  const startCreateRemote = (kind: 'file' | 'folder', baseSubPath = remoteSubPath): void => {
    if (!selectedConnectionId) {
      showToast('Pilih atau tambahkan koneksi server terlebih dahulu.');
      return;
    }
    setRemoteExpanded(true);
    setRenamingRemoteRelPath(null);
    setCreatingRemote({ kind, baseSubPath });
    setNewRemoteName('');
  };

  const handleCreateRemoteSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!selectedConnectionId || !creatingRemote || !newRemoteName.trim()) return;
    const cleanInput = newRemoteName.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!cleanInput) return;

    const targetRelPath = creatingRemote.baseSubPath
      ? `${creatingRemote.baseSubPath.replace(/^\/+|\/+$/g, '')}/${cleanInput}`
      : cleanInput;

    setRemoteBusy(true);
    try {
      const isDir = creatingRemote.kind === 'folder';
      await window.aptana.connections.createRemoteEntry(
        selectedConnectionId,
        targetRelPath,
        isDir,
        ''
      );

      // Navigate into parent dir or refresh current dir so user sees the newly created entry immediately
      await browseRemoteDir(creatingRemote.baseSubPath);
      setCreatingRemote(null);
      setNewRemoteName('');

      if (isDir) {
        showToast(`Folder remote berhasil dibuat: /${targetRelPath}`);
      } else {
        showToast(`File remote dibuat: /${targetRelPath}`);
        await openRemoteFileInTab(selectedConnectionId, targetRelPath);
      }
    } catch (err) {
      showToast(
        `Gagal membuat ${creatingRemote.kind === 'folder' ? 'folder' : 'file'} di remote: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    } finally {
      setRemoteBusy(false);
    }
  };

  const startRenameRemote = (entry: RemoteEntry, e?: React.MouseEvent): void => {
    e?.stopPropagation();
    setCreatingRemote(null);
    setRenamingRemoteRelPath(entry.relativePath);
    setRenameRemoteValue(entry.name);
  };

  const handleRenameRemoteSubmit = async (
    entry: RemoteEntry,
    e: React.FormEvent
  ): Promise<void> => {
    e.preventDefault();
    if (!selectedConnectionId) return;
    const cleanNewName = renameRemoteValue
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '');

    if (!cleanNewName || cleanNewName === entry.name) {
      setRenamingRemoteRelPath(null);
      return;
    }

    const parts = entry.relativePath.split('/').filter(Boolean);
    parts.pop();
    const newRelPath = parts.length > 0 ? `${parts.join('/')}/${cleanNewName}` : cleanNewName;

    setRemoteBusy(true);
    try {
      await window.aptana.connections.renameRemoteEntry(
        selectedConnectionId,
        entry.relativePath,
        newRelPath
      );
      syncRenamedRemoteTabs(selectedConnectionId, entry.relativePath, newRelPath);
      await browseRemoteDir(remoteSubPath);
      showToast(`Nama di server diubah: ${entry.name} → ${cleanNewName}`);
    } catch (err) {
      showToast(
        `Gagal mengubah nama di server: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setRemoteBusy(false);
      setRenamingRemoteRelPath(null);
    }
  };

  const handleDeleteRemoteEntry = async (
    entry: RemoteEntry,
    e?: React.MouseEvent
  ): Promise<void> => {
    e?.stopPropagation();
    if (!selectedConnectionId) return;
    const confirmed = window.confirm(
      `Yakin ingin menghapus ${entry.isDirectory ? 'FOLDER beserta seluruh isinya' : 'file'} di server "${activeConn?.name}":\n/${entry.relativePath}?`
    );
    if (!confirmed) return;

    setRemoteBusy(true);
    try {
      await window.aptana.connections.deleteRemoteEntry(
        selectedConnectionId,
        entry.relativePath,
        entry.isDirectory
      );
      closeDeletedRemoteTabs(selectedConnectionId, entry.relativePath);
      await browseRemoteDir(remoteSubPath);
      showToast(`Dihapus dari server: /${entry.relativePath}`);
    } catch (err) {
      showToast(
        `Gagal menghapus di server: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setRemoteBusy(false);
    }
  };

  const startChmodRemote = (entry: RemoteEntry, e?: React.MouseEvent): void => {
    e?.stopPropagation();
    setCreatingRemote(null);
    setRenamingRemoteRelPath(null);
    setChmodTarget(entry);
    setChmodValue(entry.permissions || (entry.isDirectory ? '755' : '644'));
  };

  const handleChmodSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!selectedConnectionId || !chmodTarget) return;
    const cleanMode = chmodValue.replace(/[^0-7]/g, '');
    if (cleanMode.length < 3) {
      showToast('Masukkan 3 atau 4 digit octal valid (contoh: 644 atau 755).');
      return;
    }
    setRemoteBusy(true);
    try {
      await window.aptana.connections.chmodRemoteEntry(
        selectedConnectionId,
        chmodTarget.relativePath,
        cleanMode
      );
      await browseRemoteDir(remoteSubPath);
      showToast(
        `Permission diubah ke ${cleanMode}: /${chmodTarget.relativePath}`
      );
      setChmodTarget(null);
    } catch (err) {
      showToast(
        `Gagal mengubah permission (chmod): ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setRemoteBusy(false);
    }
  };

  const handleDropOnRemote = async (
    e: React.DragEvent,
    targetSubDir: string
  ): Promise<void> => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverSubPath(null);
    if (!selectedConnectionId) {
      showToast('Pilih koneksi server terlebih dahulu sebelum mengunggah file.');
      return;
    }

    const droppedPaths: string[] = [];
    const internalLocalPath = e.dataTransfer.getData('application/x-hmw-local-path');
    if (internalLocalPath) {
      droppedPaths.push(internalLocalPath);
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i += 1) {
        const f = e.dataTransfer.files[i];
        try {
          const nativePath = window.aptana.system.getPathForFile(f);
          if (nativePath && !droppedPaths.includes(nativePath)) {
            droppedPaths.push(nativePath);
          }
        } catch {
          // Abaikan item non-disk
        }
      }
    }

    if (droppedPaths.length === 0) return;

    setRemoteBusy(true);
    showToast(
      `Mengunggah ${droppedPaths.length} item ke ${activeConn?.name}: /${targetSubDir}...`
    );
    try {
      const res = await window.aptana.connections.uploadMultiplePaths(
        selectedConnectionId,
        droppedPaths,
        targetSubDir
      );
      await browseRemoteDir(remoteSubPath);
      if (res.errors.length > 0) {
        showToast(
          `Terunggah ${res.uploaded} file (${res.errors.length} gagal: ${res.errors[0]})`
        );
      } else {
        showToast(
          `Berhasil mengunggah ${res.uploaded} file ke /${targetSubDir || ''}`
        );
      }
    } catch (err) {
      showToast(
        `Gagal mengunggah ke server: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setRemoteBusy(false);
    }
  };

  const handleRemoteEntryClick = async (entry: RemoteEntry): Promise<void> => {
    if (renamingRemoteRelPath === entry.relativePath) return;
    if (entry.isDirectory) {
      await browseRemoteDir(entry.relativePath);
      return;
    }
    if (!selectedConnectionId) return;
    try {
      await openRemoteFileInTab(selectedConnectionId, entry.relativePath);
    } catch (err) {
      showToast(
        `Tidak dapat membuka file remote: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleCompareRemoteWithLocal = async (
    entry: RemoteEntry,
    e?: React.MouseEvent
  ): Promise<void> => {
    e?.stopPropagation();
    if (!selectedConnectionId) return;
    try {
      const remoteContent = await window.aptana.connections.readRemoteFile(
        selectedConnectionId,
        entry.relativePath
      );
      let localContent = remoteContent;
      let localFullPath = entry.relativePath;
      let useRemoteSaveTarget = true;

      if (workspacePath) {
        const sep = workspacePath.includes('\\') ? '\\' : '/';
        localFullPath = `${workspacePath}${sep}${entry.relativePath.replace(/\//g, sep)}`;
        try {
          const localRes = await window.aptana.workspace.readFile(localFullPath);
          localContent = localRes.content;
          useRemoteSaveTarget = false;
        } catch {
          localContent = remoteContent;
          useRemoteSaveTarget = true;
        }
      }

      openDiffTab({
        id: `remote-diff:${selectedConnectionId}:${entry.relativePath}`,
        title: `Remote ↔ Local: ${entry.name}`,
        filePath: localFullPath,
        relativePath: entry.relativePath,
        originalContent: remoteContent,
        modifiedContent: localContent,
        diffLabel: `Server (${activeConn?.name}) ↔ Lokal (${entry.relativePath})`,
        remoteConnectionId: useRemoteSaveTarget ? selectedConnectionId : undefined,
        remoteConnectionName: useRemoteSaveTarget ? activeConn?.name : undefined
      });
    } catch (err) {
      showToast(
        `Tidak dapat membandingkan file remote: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleDownloadRemoteFile = async (
    entry: RemoteEntry,
    e?: React.MouseEvent
  ): Promise<void> => {
    e?.stopPropagation();
    if (!workspacePath || !selectedConnectionId) {
      showToast('Buka folder proyek lokal terlebih dahulu untuk mengunduh file.');
      return;
    }
    try {
      await window.aptana.connections.downloadSingleFile(
        selectedConnectionId,
        workspacePath,
        entry.relativePath
      );
      await refreshTree();
      showToast(`Diunduh ke workspace: ${entry.relativePath}`);
    } catch (err) {
      showToast(`Gagal mengunduh: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const renderNode = (node: FileNode, depth = 0): React.ReactNode => {
    const isExpanded = Boolean(expandedDirs[node.path]);
    const isSelected =
      selectedLocalNode?.path === node.path ||
      (!selectedLocalNode && !activeTab?.remoteConnectionId && activeTab?.filePath === node.path);
    const isCutItem =
      fileClipboard?.mode === 'cut' &&
      fileClipboard.sourceKind === 'local' &&
      fileClipboard.path === node.path;
    const isRenaming = renamingLocalPath === node.path;

    return (
      <React.Fragment key={node.path}>
        {isRenaming ? (
          <form
            onSubmit={(e) => void handleRenameLocalSubmit(node, e)}
            style={{
              padding: `3px 6px 3px ${8 + depth * 14}px`,
              display: 'flex',
              gap: 4
            }}
          >
            <input
              autoFocus
              value={renameLocalValue}
              onChange={(e) => setRenameLocalValue(e.target.value)}
              style={{ flex: 1, padding: '3px 6px', fontSize: 12 }}
            />
            <button type="submit" className="btn btn-accent" style={{ padding: '2px 7px' }}>
              OK
            </button>
            <button
              type="button"
              className="btn"
              style={{ padding: '2px 6px' }}
              onClick={() => setRenamingLocalPath(null)}
            >
              ✕
            </button>
          </form>
        ) : (
          <div
            className={`tree-row ${isSelected ? 'selected' : ''}`}
            style={{
              paddingLeft: 8 + depth * 14,
              opacity: isCutItem ? 0.55 : 1
            }}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-hmw-local-path', node.path);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={(e) => {
              setSelectedLocalNode(node);
              (e.currentTarget.closest('.sidebar-scroll') as HTMLElement | null)?.focus({
                preventScroll: true
              });
              if (e.ctrlKey || e.metaKey) return;
              if (node.isDirectory) {
                toggleDirExpanded(node.path);
              } else {
                void openFileInTab(node.path, node.relativePath);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSelectedLocalNode(node);
              setContextMenu(null);
              setLocalContextMenu({ x: e.clientX, y: e.clientY, node });
            }}
          >
            {node.isDirectory ? (
              <>
                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {isExpanded ? (
                  <FolderOpen size={14} color="#f97316" />
                ) : (
                  <Folder size={14} color="#f97316" />
                )}
              </>
            ) : (
              <>
                <span style={{ width: 13 }} />
                <FileCode2 size={14} color="#38bdf8" />
              </>
            )}
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {node.name}
            </span>

            <span className="row-actions">
              {node.isDirectory && (
                <>
                  <button
                    className="btn-ghost"
                    style={{ border: 'none', padding: 2 }}
                    title="Buat File di Dalam Folder Ini"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isExpanded) toggleDirExpanded(node.path);
                      setCreatingLocal({ kind: 'file', parentDir: node.path });
                      setNewLocalName('');
                    }}
                  >
                    <FilePlus2 size={12} />
                  </button>
                  <button
                    className="btn-ghost"
                    style={{ border: 'none', padding: 2 }}
                    title="Buat Subfolder Baru"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isExpanded) toggleDirExpanded(node.path);
                      setCreatingLocal({ kind: 'folder', parentDir: node.path });
                      setNewLocalName('');
                    }}
                  >
                    <FolderPlus size={12} />
                  </button>
                </>
              )}
              {!node.isDirectory && selectedConnectionId && (
                <button
                  className="btn-ghost"
                  style={{ border: 'none', padding: 2 }}
                  title="Unggah ke Server Aktif"
                  onClick={(e) => void handleUploadSingle(node, e)}
                >
                  <CloudUpload size={13} />
                </button>
              )}
              <button
                className="btn-ghost"
                style={{ border: 'none', padding: 2 }}
                title="Ubah Nama (Rename)"
                onClick={(e) => {
                  e.stopPropagation();
                  setRenamingLocalPath(node.path);
                  setRenameLocalValue(node.name);
                }}
              >
                <Pencil size={12} />
              </button>
              <button
                className="btn-ghost"
                style={{ border: 'none', padding: 2 }}
                title="Hapus"
                onClick={(e) => void handleDeleteNode(node, e)}
              >
                <Trash2 size={12} />
              </button>
            </span>
          </div>
        )}

        {node.isDirectory &&
          isExpanded &&
          node.children?.map((child) => renderNode(child, depth + 1))}
      </React.Fragment>
    );
  };

  const navigateRemoteUp = (): void => {
    if (!remoteSubPath) return;
    const parts = remoteSubPath.split('/').filter(Boolean);
    parts.pop();
    void browseRemoteDir(parts.join('/'));
  };

  const remoteBreadcrumbSegments = remoteSubPath.split('/').filter(Boolean);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* ---------------- TOP PANE: LOCAL APP EXPLORER ---------------- */}
      <div className="sidebar-header">
        <span>App Explorer (Lokal)</span>
        {workspacePath && (
          <div style={{ display: 'flex', gap: 3 }}>
            <button
              className="btn-ghost"
              style={{ border: 'none', padding: 3 }}
              title="File Lokal Baru"
              onClick={() => {
                setCreatingLocal({ kind: 'file', parentDir: workspacePath });
                setNewLocalName('');
              }}
            >
              <FilePlus2 size={14} />
            </button>
            <button
              className="btn-ghost"
              style={{ border: 'none', padding: 3 }}
              title="Folder Lokal Baru"
              onClick={() => {
                setCreatingLocal({ kind: 'folder', parentDir: workspacePath });
                setNewLocalName('');
              }}
            >
              <FolderPlus size={14} />
            </button>
            <button
              className="btn-ghost"
              style={{ border: 'none', padding: 3 }}
              title="Segarkan Pohon File Lokal"
              onClick={() => void refreshTree()}
            >
              <RefreshCw size={13} />
            </button>
          </div>
        )}
      </div>

      {creatingLocal && (
        <form
          onSubmit={(e) => void handleCreateLocalSubmit(e)}
          style={{
            padding: 8,
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 5
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Buat {creatingLocal.kind === 'folder' ? 'Folder' : 'File'} Lokal di:{' '}
            <code>
              {workspacePath && creatingLocal.parentDir !== workspacePath
                ? creatingLocal.parentDir.slice(workspacePath.length)
                : '/'}
            </code>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              autoFocus
              value={newLocalName}
              onChange={(e) => setNewLocalName(e.target.value)}
              placeholder={
                creatingLocal.kind === 'file' ? 'contoh: index.php' : 'contoh: assets'
              }
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-accent">
              Buat
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setCreatingLocal(null);
                setNewLocalName('');
              }}
            >
              ✕
            </button>
          </div>
        </form>
      )}

      {fileClipboard && (
        <div
          style={{
            padding: '5px 8px',
            background: 'rgba(56, 189, 248, 0.1)',
            borderBottom: '1px solid rgba(56, 189, 248, 0.35)',
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6
          }}
        >
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: '#7dd3fc',
              fontWeight: 600
            }}
            title={`${fileClipboard.mode === 'cut' ? 'Cut' : 'Copy'}: ${fileClipboard.name}`}
          >
            {fileClipboard.mode === 'cut' ? '✂' : '📋'}{' '}
            {fileClipboard.sourceKind === 'local'
              ? `[Lokal] ${fileClipboard.name}`
              : `[${fileClipboard.connectionName}] ${fileClipboard.name}`}
          </span>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {workspacePath && (
              <button
                type="button"
                className="btn"
                style={{ padding: '1px 6px', fontSize: 10.5 }}
                title="Tempel (Paste) ke folder Lokal terpilih"
                onClick={() => void handlePasteToLocalDir()}
              >
                → Lokal
              </button>
            )}
            {activeConn && (
              <button
                type="button"
                className="btn"
                style={{ padding: '1px 6px', fontSize: 10.5 }}
                title="Tempel (Paste) ke folder Remote saat ini"
                onClick={() => void handlePasteToRemoteDir()}
              >
                → Remote
              </button>
            )}
            <button
              type="button"
              className="btn-ghost"
              style={{ border: 'none', padding: 2 }}
              title="Kosongkan Clipboard"
              onClick={() => setFileClipboard(null)}
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      <div
        className="sidebar-scroll"
        tabIndex={0}
        style={{ flex: 1.15, outline: 'none' }}
        onKeyDown={handleLocalPaneKeyDown}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setSelectedLocalNode(null);
            e.currentTarget.focus({ preventScroll: true });
          }
        }}
        onContextMenu={(e) => {
          if (!workspacePath) return;
          e.preventDefault();
          setContextMenu(null);
          setLocalContextMenu({ x: e.clientX, y: e.clientY, node: null });
        }}
      >
        {!workspacePath ? (
          <div style={{ padding: 14, color: 'var(--text-muted)', lineHeight: 1.55 }}>
            Belum ada folder proyek terbuka. Klik <strong>Buka Proyek</strong> atau{' '}
            <strong>Proyek Demo</strong> di bilah atas.
          </div>
        ) : fileTree.length === 0 ? (
          <div style={{ padding: 14, color: 'var(--text-muted)' }}>Folder proyek kosong.</div>
        ) : (
          fileTree.map((node) => renderNode(node, 0))
        )}
      </div>

      {/* ---------------- BOTTOM PANE: REMOTE SERVER BROWSER ---------------- */}
      <div
        className="sidebar-header"
        style={{ borderTop: '1px solid var(--border-subtle)', cursor: 'pointer' }}
        onClick={() => setRemoteExpanded(!remoteExpanded)}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {remoteExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Server size={13} color="var(--accent)" />
          <span>Remote Browser</span>
          {activeConn?.isProduction && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 800,
                padding: '1px 5px',
                borderRadius: 4,
                background: 'rgba(239, 68, 68, 0.2)',
                border: '1px solid rgba(239, 68, 68, 0.5)',
                color: '#fca5a5'
              }}
              title="Server ini ditandai sebagai Server PRODUKSI"
            >
              PROD
            </span>
          )}
        </span>
        {activeConn && (
          <div
            style={{ display: 'flex', gap: 3 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="btn-ghost"
              style={{ border: 'none', padding: 3 }}
              title="Monitor Kesehatan Server SSH (CPU/RAM/Disk), Crontab & DB Processlist"
              onClick={() => setServerMonitorOpen(true)}
            >
              <Activity size={13} color="#34d399" />
            </button>
            <button
              className="btn-ghost"
              style={{ border: 'none', padding: 3 }}
              title={`Edit Konfigurasi Koneksi "${activeConn.name}"`}
              onClick={() => openConnectionModal(activeConn)}
            >
              <Pencil size={13} />
            </button>
            <button
              className="btn-ghost"
              style={{ border: 'none', padding: 3 }}
              title={`Buat File Baru di Server (/${remoteSubPath})`}
              onClick={() => startCreateRemote('file', remoteSubPath)}
            >
              <FilePlus2 size={14} />
            </button>
            <button
              className="btn-ghost"
              style={{ border: 'none', padding: 3 }}
              title={`Buat Folder Baru di Server (/${remoteSubPath})`}
              onClick={() => startCreateRemote('folder', remoteSubPath)}
            >
              <FolderPlus size={14} />
            </button>
            <button
              className="btn-ghost"
              style={{ border: 'none', padding: 3 }}
              title="Muat Ulang Direktori Server"
              onClick={() => void browseRemoteDir(remoteSubPath)}
            >
              <RefreshCw size={13} />
            </button>
          </div>
        )}
      </div>

      {remoteExpanded && creatingRemote && activeConn && (
        <form
          onSubmit={(e) => void handleCreateRemoteSubmit(e)}
          style={{
            padding: 8,
            background: 'var(--bg-elevated)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>
            + Buat {creatingRemote.kind === 'folder' ? 'Folder' : 'File'} di Server ({activeConn.name}: /
            {creatingRemote.baseSubPath})
          </div>
          <div style={{ display: 'flex', gap: 5 }}>
            <input
              autoFocus
              disabled={remoteBusy}
              value={newRemoteName}
              onChange={(e) => setNewRemoteName(e.target.value)}
              placeholder={
                creatingRemote.kind === 'file'
                  ? 'nama_file.php atau sub/file.php'
                  : 'nama_folder_baru'
              }
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-accent" disabled={remoteBusy}>
              Buat
            </button>
            <button
              type="button"
              className="btn"
              disabled={remoteBusy}
              onClick={() => {
                setCreatingRemote(null);
                setNewRemoteName('');
              }}
            >
              ✕
            </button>
          </div>
        </form>
      )}

      {remoteExpanded && chmodTarget && activeConn && (
        <form
          onSubmit={(e) => void handleChmodSubmit(e)}
          style={{
            padding: 8,
            background: 'var(--bg-elevated)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 700 }}>
            Ubah Permission (CHMOD): /{chmodTarget.relativePath}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {['644', '755', '600', '775', '777'].map((preset) => (
              <button
                key={preset}
                type="button"
                className="btn"
                style={{
                  padding: '2px 7px',
                  fontSize: 11,
                  borderColor: chmodValue === preset ? 'var(--accent)' : undefined
                }}
                onClick={() => setChmodValue(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 5 }}>
            <input
              autoFocus
              disabled={remoteBusy}
              value={chmodValue}
              onChange={(e) => setChmodValue(e.target.value)}
              placeholder="contoh: 644 atau 755"
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-accent" disabled={remoteBusy}>
              Simpan
            </button>
            <button
              type="button"
              className="btn"
              disabled={remoteBusy}
              onClick={() => setChmodTarget(null)}
            >
              ✕
            </button>
          </div>
        </form>
      )}

      {remoteExpanded && (
        <div
          className="sidebar-scroll"
          tabIndex={0}
          onKeyDown={handleRemotePaneKeyDown}
          style={{
            flex: 1.2,
            borderTop: 'none',
            outline:
              dragOverSubPath === '__CURRENT__' ? '2px dashed #38bdf8' : 'none',
            outlineOffset: -3,
            background:
              dragOverSubPath === '__CURRENT__'
                ? 'rgba(56, 189, 248, 0.07)'
                : undefined
          }}
          onDragOver={(e) => {
            if (!activeConn) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            if (dragOverSubPath === null) {
              setDragOverSubPath('__CURRENT__');
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setDragOverSubPath(null);
            }
          }}
          onDrop={(e) => void handleDropOnRemote(e, remoteSubPath)}
          onContextMenu={(e) => {
            if (!activeConn) return;
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, entry: null });
          }}
        >
          {!activeConn ? (
            <div style={{ padding: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Pilih atau buat koneksi SFTP / FTPS / Local Target untuk menelusuri dan mengedit server secara langsung.
              <div style={{ marginTop: 8 }}>
                <button
                  className="btn"
                  onClick={() => openConnectionModal(null)}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  + Tambah Koneksi Server
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Interactive Breadcrumbs + Up button */}
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  padding: '3px 6px 7px',
                  borderBottom: '1px solid var(--border-subtle)',
                  marginBottom: 4,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 2,
                    minWidth: 0
                  }}
                >
                  <span
                    style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 700 }}
                    onClick={() => void browseRemoteDir('')}
                    title={`Kembali ke root ${activeConn.remotePath}`}
                  >
                    {activeConn.name}:/
                  </span>
                  {remoteBreadcrumbSegments.map((seg, idx) => {
                    const targetSub = remoteBreadcrumbSegments.slice(0, idx + 1).join('/');
                    return (
                      <React.Fragment key={targetSub}>
                        <span
                          style={{ cursor: 'pointer' }}
                          onClick={() => void browseRemoteDir(targetSub)}
                        >
                          {seg}
                        </span>
                        {idx < remoteBreadcrumbSegments.length - 1 && <span>/</span>}
                      </React.Fragment>
                    );
                  })}
                </div>
                {remoteSubPath && (
                  <button
                    className="btn-ghost"
                    style={{ padding: '1px 5px', fontSize: 11, flexShrink: 0 }}
                    onClick={navigateRemoteUp}
                    title="Naik satu level folder"
                  >
                    ↑ Naik
                  </button>
                )}
              </div>

              {dragOverSubPath !== null && (
                <div
                  style={{
                    margin: '2px 6px 6px',
                    padding: '6px 8px',
                    borderRadius: 6,
                    background: 'rgba(56, 189, 248, 0.14)',
                    border: '1px dashed #38bdf8',
                    color: '#38bdf8',
                    fontSize: 11,
                    fontWeight: 600
                  }}
                >
                  Lepaskan file/folder untuk mengunggah ke:/
                  {dragOverSubPath === '__CURRENT__' ? remoteSubPath : dragOverSubPath}
                </div>
              )}

              {remoteLoading ? (
                <div style={{ padding: 10, color: 'var(--text-muted)' }}>
                  Menghubungi server {activeConn.name} ({activeConn.host}:{activeConn.port})...
                </div>
              ) : remoteConnectionStatus === 'error' ? (
                <div
                  style={{
                    margin: '6px',
                    padding: '10px 11px',
                    borderRadius: 8,
                    background: 'rgba(244, 63, 94, 0.1)',
                    border: '1px solid rgba(251, 113, 133, 0.42)',
                    color: '#fecdd3',
                    fontSize: 11.5,
                    lineHeight: 1.45,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#fda4af' }}>
                    🔴 Tidak Terhubung ke {activeConn.name} ({activeConn.protocol.toUpperCase()})
                  </div>
                  <div
                    style={{
                      fontFamily: 'Consolas, monospace',
                      fontSize: 11,
                      color: 'var(--text-secondary)',
                      wordBreak: 'break-word'
                    }}
                  >
                    {remoteConnectionError || `Gagal terhubung ke ${activeConn.host}:${activeConn.port}`}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-accent"
                      style={{ padding: '3px 8px', fontSize: 11 }}
                      onClick={() => void browseRemoteDir(remoteSubPath)}
                    >
                      <RefreshCw size={11.5} />
                      <span>Coba Lagi</span>
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '3px 8px', fontSize: 11 }}
                      onClick={() => openConnectionModal(activeConn)}
                    >
                      <Pencil size={11.5} color="var(--accent)" />
                      <span>Edit Server</span>
                    </button>
                  </div>
                </div>
              ) : remoteEntries.length === 0 ? (
                <div style={{ padding: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Direktori kosong. Gunakan ikon <strong>+ File</strong> /{' '}
                  <strong>+ Folder</strong>, klik kanan, atau <strong>seret &amp; lepas (Drag &amp; Drop)</strong> file dari Windows Explorer ke sini.
                </div>
              ) : (
                remoteEntries.map((entry) => {
                  const isRenaming = renamingRemoteRelPath === entry.relativePath;
                  const isSelectedRemote =
                    selectedRemoteEntry?.relativePath === entry.relativePath ||
                    (!selectedRemoteEntry &&
                      activeTab?.remoteConnectionId === selectedConnectionId &&
                      activeTab?.relativePath === entry.relativePath);
                  const isCutRemote =
                    fileClipboard?.mode === 'cut' &&
                    fileClipboard.sourceKind === 'remote' &&
                    fileClipboard.connectionId === selectedConnectionId &&
                    fileClipboard.relativePath === entry.relativePath;

                  if (isRenaming) {
                    return (
                      <form
                        key={`rename:${entry.relativePath}`}
                        onSubmit={(e) => void handleRenameRemoteSubmit(entry, e)}
                        style={{ padding: '3px 6px', display: 'flex', gap: 4 }}
                      >
                        <input
                          autoFocus
                          disabled={remoteBusy}
                          value={renameRemoteValue}
                          onChange={(e) => setRenameRemoteValue(e.target.value)}
                          style={{ flex: 1, padding: '3px 6px', fontSize: 12 }}
                        />
                        <button
                          type="submit"
                          className="btn btn-accent"
                          style={{ padding: '2px 7px' }}
                          disabled={remoteBusy}
                        >
                          OK
                        </button>
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: '2px 6px' }}
                          onClick={() => setRenamingRemoteRelPath(null)}
                        >
                          ✕
                        </button>
                      </form>
                    );
                  }

                  return (
                    <div
                      key={entry.relativePath}
                      className={`tree-row ${isSelectedRemote ? 'selected' : ''}`}
                      style={{
                        opacity: isCutRemote ? 0.55 : 1,
                        ...(entry.isDirectory && dragOverSubPath === entry.relativePath
                          ? {
                              outline: '1px dashed #38bdf8',
                              background: 'rgba(56, 189, 248, 0.16)'
                            }
                          : {})
                      }}
                      onClick={(e) => {
                        setSelectedRemoteEntry(entry);
                        (e.currentTarget.closest('.sidebar-scroll') as HTMLElement | null)?.focus({
                          preventScroll: true
                        });
                        if (e.ctrlKey || e.metaKey) return;
                        void handleRemoteEntryClick(entry);
                      }}
                      onDragOver={(e) => {
                        if (!entry.isDirectory) return;
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'copy';
                        setDragOverSubPath(entry.relativePath);
                      }}
                      onDrop={(e) => {
                        if (!entry.isDirectory) return;
                        void handleDropOnRemote(e, entry.relativePath);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSelectedRemoteEntry(entry);
                        setLocalContextMenu(null);
                        setContextMenu({ x: e.clientX, y: e.clientY, entry });
                      }}
                      title={
                        entry.isDirectory
                          ? 'Klik untuk masuk folder (Ctrl+Klik atau Klik Kanan untuk memilih/Cut/Copy folder)'
                          : 'Klik untuk langsung mengedit di server (Ctrl+S simpan ke server, Ctrl+X/C/V untuk pindah/salin)'
                      }
                    >
                      {entry.isDirectory ? (
                        <Folder size={14} color="#fb923c" />
                      ) : (
                        <FileCode2 size={14} color="#38bdf8" />
                      )}
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1
                        }}
                      >
                        {entry.name}
                      </span>
                      {entry.permissions && (
                        <span
                          style={{
                            fontSize: 10,
                            fontFamily: 'Consolas, monospace',
                            color: 'var(--text-muted)',
                            marginRight: 2
                          }}
                          title={`Permission: ${entry.permissions}`}
                        >
                          {entry.permissions}
                        </span>
                      )}

                      <span className="row-actions">
                        {entry.isDirectory ? (
                          <>
                            <button
                              className="btn-ghost"
                              style={{ border: 'none', padding: 2 }}
                              title="Buat File Baru di Dalam Folder Ini"
                              onClick={(e) => {
                                e.stopPropagation();
                                startCreateRemote('file', entry.relativePath);
                              }}
                            >
                              <FilePlus2 size={12} />
                            </button>
                            <button
                              className="btn-ghost"
                              style={{ border: 'none', padding: 2 }}
                              title="Buat Subfolder di Dalam Folder Ini"
                              onClick={(e) => {
                                e.stopPropagation();
                                startCreateRemote('folder', entry.relativePath);
                              }}
                            >
                              <FolderPlus size={12} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="btn-ghost"
                              style={{ border: 'none', padding: 2 }}
                              title="Bandingkan Diff Remote vs Lokal"
                              onClick={(e) => void handleCompareRemoteWithLocal(entry, e)}
                            >
                              <GitCompare size={12} />
                            </button>
                            <button
                              className="btn-ghost"
                              style={{ border: 'none', padding: 2 }}
                              title="Unduh ke Workspace Lokal"
                              onClick={(e) => void handleDownloadRemoteFile(entry, e)}
                            >
                              <CloudDownload size={12} />
                            </button>
                          </>
                        )}
                        <button
                          className="btn-ghost"
                          style={{ border: 'none', padding: 2 }}
                          title="Ubah Permission (chmod)"
                          onClick={(e) => startChmodRemote(entry, e)}
                        >
                          <Shield size={12} />
                        </button>
                        <button
                          className="btn-ghost"
                          style={{ border: 'none', padding: 2 }}
                          title="Ubah Nama di Server (Rename)"
                          onClick={(e) => startRenameRemote(entry, e)}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          className="btn-ghost"
                          style={{ border: 'none', padding: 2 }}
                          title="Hapus dari Server"
                          onClick={(e) => void handleDeleteRemoteEntry(entry, e)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </span>
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      )}

      {/* Right-Click Context Menu for Local App Explorer */}
      {localContextMenu && workspacePath && (
        <div
          style={{
            position: 'fixed',
            top: Math.min(localContextMenu.y, window.innerHeight - 310),
            left: Math.min(localContextMenu.x, window.innerWidth - 255),
            width: 248,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            padding: 5,
            boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
            zIndex: 1500
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {localContextMenu.node && !localContextMenu.node.isDirectory && (
            <>
              <div
                className="tree-row"
                onClick={() => {
                  const target = localContextMenu.node!;
                  setLocalContextMenu(null);
                  void openFileInTab(target.path, target.relativePath);
                }}
              >
                <FileCode2 size={13} color="#38bdf8" />
                <span>Buka &amp; Edit File</span>
              </div>
              <div
                className="tree-row"
                onClick={async () => {
                  const target = localContextMenu.node!;
                  setLocalContextMenu(null);
                  await openFileInTab(target.path, target.relativePath);
                  const found = useIdeStore
                    .getState()
                    .tabs.find((t) => !t.remoteConnectionId && t.filePath === target.path);
                  if (found) setSecondaryTab(found.id);
                }}
              >
                <Columns2 size={13} color="#38bdf8" />
                <span>Buka di Split Editor Kanan</span>
              </div>
            </>
          )}

          {localContextMenu.node && (
            <>
              <div
                className="tree-row"
                onClick={() => {
                  const target = localContextMenu.node!;
                  setLocalContextMenu(null);
                  setClipboardFromLocal(target, 'cut');
                }}
              >
                <Scissors size={13} color="#fb923c" />
                <span>Potong / Pindah (Ctrl+X)</span>
              </div>
              <div
                className="tree-row"
                onClick={() => {
                  const target = localContextMenu.node!;
                  setLocalContextMenu(null);
                  setClipboardFromLocal(target, 'copy');
                }}
              >
                <Copy size={13} color="#38bdf8" />
                <span>Salin (Ctrl+C)</span>
              </div>
            </>
          )}

          {fileClipboard && (
            <div
              className="tree-row"
              onClick={() => {
                const targetDir = localContextMenu.node
                  ? localContextMenu.node.isDirectory
                    ? localContextMenu.node.path
                    : getLocalParentDir(localContextMenu.node.path)
                  : workspacePath;
                setLocalContextMenu(null);
                void handlePasteToLocalDir(targetDir);
              }}
            >
              <ClipboardPaste size={13} color="#4ade80" />
              <span>
                Tempel "{fileClipboard.name}" (Ctrl+V)
              </span>
            </div>
          )}

          <div
            className="tree-row"
            onClick={() => {
              const parentDir = localContextMenu.node
                ? localContextMenu.node.isDirectory
                  ? localContextMenu.node.path
                  : getLocalParentDir(localContextMenu.node.path)
                : workspacePath;
              setLocalContextMenu(null);
              setCreatingLocal({ kind: 'file', parentDir });
              setNewLocalName('');
            }}
          >
            <FilePlus2 size={13} color="var(--accent)" />
            <span>Buat File Baru</span>
          </div>

          <div
            className="tree-row"
            onClick={() => {
              const parentDir = localContextMenu.node
                ? localContextMenu.node.isDirectory
                  ? localContextMenu.node.path
                  : getLocalParentDir(localContextMenu.node.path)
                : workspacePath;
              setLocalContextMenu(null);
              setCreatingLocal({ kind: 'folder', parentDir });
              setNewLocalName('');
            }}
          >
            <FolderPlus size={13} color="var(--accent)" />
            <span>Buat Folder Baru</span>
          </div>

          {localContextMenu.node && (
            <>
              <div
                className="tree-row"
                onClick={() => {
                  const target = localContextMenu.node!;
                  setLocalContextMenu(null);
                  setRenamingLocalPath(target.path);
                  setRenameLocalValue(target.name);
                }}
              >
                <Pencil size={13} />
                <span>Ubah Nama (Rename)</span>
              </div>
              <div
                className="tree-row"
                style={{ color: 'var(--danger)' }}
                onClick={(e) => {
                  const target = localContextMenu.node!;
                  setLocalContextMenu(null);
                  void handleDeleteNode(target, e);
                }}
              >
                <Trash2 size={13} />
                <span>Hapus</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Right-Click Context Menu for Remote Browser */}
      {contextMenu && activeConn && (
        <div
          style={{
            position: 'fixed',
            top: Math.min(contextMenu.y, window.innerHeight - 340),
            left: Math.min(contextMenu.x, window.innerWidth - 255),
            width: 248,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            padding: 5,
            boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
            zIndex: 1500
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.entry && !contextMenu.entry.isDirectory && (
            <>
              <div
                className="tree-row"
                onClick={() => {
                  const target = contextMenu.entry!;
                  setContextMenu(null);
                  void handleRemoteEntryClick(target);
                }}
              >
                <FileCode2 size={13} color="#38bdf8" />
                <span>Buka &amp; Edit File</span>
              </div>
              <div
                className="tree-row"
                onClick={async () => {
                  const target = contextMenu.entry!;
                  setContextMenu(null);
                  if (!selectedConnectionId) return;
                  const cleanRel = normalizeRemoteRelPath(target.relativePath);
                  await openRemoteFileInTab(selectedConnectionId, cleanRel);
                  setSecondaryTab(`remote:${selectedConnectionId}:${cleanRel}`);
                }}
              >
                <Columns2 size={13} color="#38bdf8" />
                <span>Buka di Split Editor Kanan</span>
              </div>
            </>
          )}

          {contextMenu.entry && (
            <>
              <div
                className="tree-row"
                onClick={() => {
                  const target = contextMenu.entry!;
                  setContextMenu(null);
                  setClipboardFromRemote(target, 'cut');
                }}
              >
                <Scissors size={13} color="#fb923c" />
                <span>Potong / Pindah (Ctrl+X)</span>
              </div>
              <div
                className="tree-row"
                onClick={() => {
                  const target = contextMenu.entry!;
                  setContextMenu(null);
                  setClipboardFromRemote(target, 'copy');
                }}
              >
                <Copy size={13} color="#38bdf8" />
                <span>Salin (Ctrl+C)</span>
              </div>
            </>
          )}

          {fileClipboard && (
            <div
              className="tree-row"
              onClick={() => {
                const targetSub =
                  contextMenu.entry && contextMenu.entry.isDirectory
                    ? contextMenu.entry.relativePath
                    : remoteSubPath;
                setContextMenu(null);
                void handlePasteToRemoteDir(targetSub);
              }}
            >
              <ClipboardPaste size={13} color="#4ade80" />
              <span>
                Tempel "{fileClipboard.name}" (Ctrl+V)
              </span>
            </div>
          )}

          <div
            className="tree-row"
            onClick={() => {
              const base =
                contextMenu.entry && contextMenu.entry.isDirectory
                  ? contextMenu.entry.relativePath
                  : remoteSubPath;
              setContextMenu(null);
              startCreateRemote('file', base);
            }}
          >
            <FilePlus2 size={13} color="var(--accent)" />
            <span>
              Buat File Baru{' '}
              {contextMenu.entry?.isDirectory ? `di ${contextMenu.entry.name}` : 'di Sini'}
            </span>
          </div>

          <div
            className="tree-row"
            onClick={() => {
              const base =
                contextMenu.entry && contextMenu.entry.isDirectory
                  ? contextMenu.entry.relativePath
                  : remoteSubPath;
              setContextMenu(null);
              startCreateRemote('folder', base);
            }}
          >
            <FolderPlus size={13} color="var(--accent)" />
            <span>
              Buat Folder Baru{' '}
              {contextMenu.entry?.isDirectory ? `di ${contextMenu.entry.name}` : 'di Sini'}
            </span>
          </div>

          {contextMenu.entry && (
            <>
              {!contextMenu.entry.isDirectory && (
                <>
                  <div
                    className="tree-row"
                    onClick={() => {
                      const target = contextMenu.entry!;
                      setContextMenu(null);
                      void handleCompareRemoteWithLocal(target);
                    }}
                  >
                    <GitCompare size={13} />
                    <span>Bandingkan Diff</span>
                  </div>
                  <div
                    className="tree-row"
                    onClick={() => {
                      const target = contextMenu.entry!;
                      setContextMenu(null);
                      void handleDownloadRemoteFile(target);
                    }}
                  >
                    <CloudDownload size={13} />
                    <span>Unduh ke Lokal</span>
                  </div>
                </>
              )}

              <div
                className="tree-row"
                onClick={() => {
                  const target = contextMenu.entry!;
                  setContextMenu(null);
                  startChmodRemote(target);
                }}
              >
                <Shield size={13} color="#38bdf8" />
                <span>
                  Ubah Permission (chmod{contextMenu.entry.permissions ? ` • ${contextMenu.entry.permissions}` : ''})
                </span>
              </div>

              <div
                className="tree-row"
                onClick={() => {
                  const target = contextMenu.entry!;
                  setContextMenu(null);
                  startRenameRemote(target);
                }}
              >
                <Pencil size={13} />
                <span>Ubah Nama (Rename)</span>
              </div>

              <div
                className="tree-row"
                style={{ color: 'var(--danger)' }}
                onClick={() => {
                  const target = contextMenu.entry!;
                  setContextMenu(null);
                  void handleDeleteRemoteEntry(target);
                }}
              >
                <Trash2 size={13} />
                <span>Hapus dari Server</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
