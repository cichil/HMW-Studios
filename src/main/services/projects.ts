import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { ProjectSavePayload, SavedProject, SavedProjectTab } from '@shared/types';

interface HmwProjectFileEnvelope {
  schema: 'hmw-studio-project/v1';
  savedAt: string;
  project: SavedProject;
}

export function normalizeSavedProjectTab(tab: SavedProjectTab): SavedProjectTab {
  if (tab.kind === 'remote') {
    const cleanRel = (tab.relativePath ?? '')
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '');
    return {
      kind: 'remote',
      filePath: tab.filePath,
      relativePath: cleanRel,
      remoteConnectionId: tab.remoteConnectionId?.trim()
    };
  }
  return {
    kind: 'local',
    filePath: tab.filePath,
    relativePath: (tab.relativePath ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
  };
}

export function getSavedProjectTabKey(tab: SavedProjectTab): string {
  const norm = normalizeSavedProjectTab(tab);
  if (norm.kind === 'remote') {
    return `remote:${norm.remoteConnectionId ?? ''}:${norm.relativePath}`;
  }
  return `local:${norm.filePath.replace(/\\/g, '/').toLowerCase()}`;
}

export function dedupeSavedProjectTabs(tabs: SavedProjectTab[]): SavedProjectTab[] {
  if (!Array.isArray(tabs)) return [];
  const seen = new Set<string>();
  const out: SavedProjectTab[] = [];
  for (const rawTab of tabs) {
    if (!rawTab || (rawTab.kind !== 'local' && rawTab.kind !== 'remote')) continue;
    const norm = normalizeSavedProjectTab(rawTab);
    if (norm.kind === 'remote' && (!norm.remoteConnectionId || !norm.relativePath)) continue;
    if (norm.kind === 'local' && !norm.filePath) continue;
    const key = getSavedProjectTabKey(norm);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(norm);
  }
  return out;
}

export class ProjectManager {
  private readonly storageDir: string;
  private readonly projectsFile: string;

  constructor(storageDir: string) {
    this.storageDir = resolve(storageDir);
    this.projectsFile = join(this.storageDir, 'projects.json');
  }

  private async readAllRaw(): Promise<SavedProject[]> {
    if (!existsSync(this.projectsFile)) return [];
    try {
      const content = await readFile(this.projectsFile, 'utf-8');
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) return [];
      return (parsed as SavedProject[]).map((proj) => ({
        ...proj,
        openTabs: dedupeSavedProjectTabs(proj.openTabs)
      }));
    } catch {
      return [];
    }
  }

  private async writeAllRaw(projects: SavedProject[]): Promise<void> {
    await mkdir(this.storageDir, { recursive: true });
    await writeFile(this.projectsFile, JSON.stringify(projects, null, 2), 'utf-8');
  }

  async list(): Promise<SavedProject[]> {
    const all = await this.readAllRaw();
    return all.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
  }

  async getById(id: string): Promise<SavedProject | null> {
    const all = await this.readAllRaw();
    return all.find((p) => p.id === id) ?? null;
  }

  async save(payload: ProjectSavePayload): Promise<SavedProject> {
    const all = await this.readAllRaw();
    const now = new Date().toISOString();
    const id =
      payload.id?.trim() ||
      `proj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const existingIdx = all.findIndex((p) => p.id === id);
    const existing = existingIdx >= 0 ? all[existingIdx] : undefined;

    const record: SavedProject = {
      id,
      name: payload.name.trim() || 'Proyek Tanpa Nama',
      notes: payload.notes?.trim() || undefined,
      workspacePath: payload.workspacePath?.trim() || null,
      connectionId: payload.connectionId?.trim() || null,
      remoteSubPath: (payload.remoteSubPath ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''),
      openTabs: dedupeSavedProjectTabs(Array.isArray(payload.openTabs) ? payload.openTabs : []),
      activeTabKey: payload.activeTabKey ?? null,
      projectFilePath: payload.projectFilePath?.trim() || existing?.projectFilePath,
      lastOpenedAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    if (existingIdx >= 0) {
      all[existingIdx] = record;
    } else {
      all.push(record);
    }

    await this.writeAllRaw(all);

    // Jika proyek ini terhubung dengan file .hmwproj di disk, perbarui file .hmwproj tersebut otomatis
    if (record.projectFilePath) {
      try {
        await this.writeProjectFileOnly(record.projectFilePath, record);
      } catch {
        // Jangan gagalkan simpan katalog internal bila drive eksternal sedang tidak terpasang
      }
    }

    return record;
  }

  async touchOpened(id: string): Promise<SavedProject | null> {
    const all = await this.readAllRaw();
    const idx = all.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    const now = new Date().toISOString();
    all[idx] = {
      ...all[idx],
      lastOpenedAt: now
    };
    await this.writeAllRaw(all);
    return all[idx];
  }

  async remove(id: string): Promise<void> {
    const all = await this.readAllRaw();
    const filtered = all.filter((p) => p.id !== id);
    await this.writeAllRaw(filtered);
  }

  private async writeProjectFileOnly(filePath: string, project: SavedProject): Promise<void> {
    const resolved = resolve(filePath);
    await mkdir(dirname(resolved), { recursive: true });
    const envelope: HmwProjectFileEnvelope = {
      schema: 'hmw-studio-project/v1',
      savedAt: new Date().toISOString(),
      project: {
        ...project,
        projectFilePath: resolved
      }
    };
    await writeFile(resolved, JSON.stringify(envelope, null, 2), 'utf-8');
  }

  async exportToFile(filePath: string, payload: ProjectSavePayload): Promise<SavedProject> {
    const resolved = resolve(filePath);
    const saved = await this.save({
      ...payload,
      projectFilePath: resolved
    });
    await this.writeProjectFileOnly(resolved, saved);
    return saved;
  }

  async openFromFile(filePath: string): Promise<SavedProject> {
    const resolved = resolve(filePath);
    const raw = await readFile(resolved, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<HmwProjectFileEnvelope> & Partial<SavedProject>;
    const srcProject: Partial<SavedProject> =
      parsed.schema === 'hmw-studio-project/v1' && parsed.project ? parsed.project : parsed;

    if (!srcProject || typeof srcProject.name !== 'string') {
      throw new Error('Format file proyek .hmwproj tidak valid.');
    }

    // Daftarkan atau perbarui ke daftar Proyek Tersimpan HMW Studio
    return this.save({
      id: srcProject.id,
      name: srcProject.name,
      notes: srcProject.notes,
      workspacePath: srcProject.workspacePath ?? null,
      connectionId: srcProject.connectionId ?? null,
      remoteSubPath: srcProject.remoteSubPath ?? '',
      openTabs: Array.isArray(srcProject.openTabs) ? srcProject.openTabs : [],
      activeTabKey: srcProject.activeTabKey ?? null,
      projectFilePath: resolved
    });
  }
}
