import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  DbScheduleJob,
  DbScheduleJobSavePayload,
  IslandActivity
} from '@shared/types';
import type { DatabaseService } from './databaseService';
import { buildXlsxBuffer } from './xlsxBuilder';

function makeTimestampSlug(d = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${min}`;
}

function sanitizeFileSlug(raw: string): string {
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'export'
  );
}

export class DbSchedulerService {
  private readonly storageDir: string;
  private readonly schedulesFile: string;
  private readonly dbService: DatabaseService;
  private readonly onActivity?: (act: IslandActivity) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private runningIds = new Set<string>();

  constructor(
    storageDir: string,
    dbService: DatabaseService,
    onActivity?: (act: IslandActivity) => void
  ) {
    this.storageDir = resolve(storageDir);
    this.schedulesFile = join(this.storageDir, 'db-schedules.json');
    this.dbService = dbService;
    this.onActivity = onActivity;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 30_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async readRaw(): Promise<DbScheduleJob[]> {
    if (!existsSync(this.schedulesFile)) return [];
    try {
      const raw = await readFile(this.schedulesFile, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as DbScheduleJob[]) : [];
    } catch {
      return [];
    }
  }

  private async writeRaw(jobs: DbScheduleJob[]): Promise<void> {
    await mkdir(this.storageDir, { recursive: true });
    await writeFile(this.schedulesFile, JSON.stringify(jobs, null, 2), 'utf-8');
  }

  async list(): Promise<DbScheduleJob[]> {
    return this.readRaw();
  }

  async save(payload: DbScheduleJobSavePayload): Promise<DbScheduleJob> {
    const name = payload.name.trim();
    const outDir = payload.outputDir.trim();
    if (!name) throw new Error('Nama jadwal tidak boleh kosong.');
    if (!outDir) throw new Error('Folder tujuan penyimpanan wajib dipilih.');

    const list = await this.readRaw();
    const now = new Date().toISOString();
    const idx = payload.id ? list.findIndex((j) => j.id === payload.id) : -1;

    let saved: DbScheduleJob;
    if (idx >= 0) {
      const prev = list[idx];
      saved = {
        ...prev,
        name,
        kind: payload.kind,
        profileId: payload.profileId,
        database: payload.database?.trim() || undefined,
        savedQueryId: payload.savedQueryId,
        scheduleType: payload.scheduleType,
        intervalMinutes: payload.intervalMinutes ?? 60,
        dailyTimeHHMM: payload.dailyTimeHHMM ?? '17:00',
        outputDir: outDir,
        enabled: payload.enabled,
        updatedAt: now
      };
      list[idx] = saved;
    } else {
      saved = {
        id: `sched-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        kind: payload.kind,
        profileId: payload.profileId,
        database: payload.database?.trim() || undefined,
        savedQueryId: payload.savedQueryId,
        scheduleType: payload.scheduleType,
        intervalMinutes: payload.intervalMinutes ?? 60,
        dailyTimeHHMM: payload.dailyTimeHHMM ?? '17:00',
        outputDir: outDir,
        enabled: payload.enabled,
        lastRunAt: null,
        lastStatus: null,
        lastMessage: null,
        lastOutputPath: null,
        createdAt: now,
        updatedAt: now
      };
      list.unshift(saved);
    }

    await this.writeRaw(list);
    return saved;
  }

  async remove(id: string): Promise<void> {
    const list = await this.readRaw();
    await this.writeRaw(list.filter((j) => j.id !== id));
  }

  static isJobDue(job: DbScheduleJob, nowDate = new Date()): boolean {
    if (!job.enabled) return false;
    const lastMs = job.lastRunAt ? new Date(job.lastRunAt).getTime() : 0;

    if (job.scheduleType === 'interval') {
      const mins = Math.max(5, job.intervalMinutes ?? 60);
      return Date.now() - lastMs >= mins * 60_000;
    }

    // Daily HH:MM
    const hhmm = (job.dailyTimeHHMM ?? '17:00').trim();
    const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return false;
    const targetH = parseInt(m[1], 10);
    const targetM = parseInt(m[2], 10);

    const nowH = nowDate.getHours();
    const nowM = nowDate.getMinutes();
    if (nowH < targetH || (nowH === targetH && nowM < targetM)) {
      return false;
    }

    // Check if already ran today
    if (lastMs > 0) {
      const lastD = new Date(lastMs);
      if (
        lastD.getFullYear() === nowDate.getFullYear() &&
        lastD.getMonth() === nowDate.getMonth() &&
        lastD.getDate() === nowDate.getDate()
      ) {
        return false;
      }
    }
    return true;
  }

  private async tick(): Promise<void> {
    const jobs = await this.readRaw();
    const now = new Date();
    for (const job of jobs) {
      if (this.runningIds.has(job.id)) continue;
      if (DbSchedulerService.isJobDue(job, now)) {
        void this.executeJob(job.id).catch(() => {});
      }
    }
  }

  async executeJob(id: string): Promise<DbScheduleJob> {
    const list = await this.readRaw();
    const job = list.find((j) => j.id === id);
    if (!job) throw new Error('Jadwal tidak ditemukan.');
    if (this.runningIds.has(id)) return job;

    this.runningIds.add(id);
    try {
      await mkdir(job.outputDir, { recursive: true });
      const ts = makeTimestampSlug();
      let outPath = '';
      let summaryMsg = '';

      if (job.kind === 'sql-backup') {
        const dump = await this.dbService.buildSqlDump(job.profileId, {
          database: job.database,
          includeSchema: true,
          includeData: true,
          maxRowsPerTable: 20000
        });
        const slug = sanitizeFileSlug(job.database || job.name);
        outPath = join(job.outputDir, `${slug}_backup_${ts}.sql`);
        await writeFile(outPath, dump.sql, 'utf-8');
        summaryMsg = `Backup ${dump.tablesExported} tabel (${dump.rowsExported} baris) tersimpan`;
      } else {
        // Saved Query -> Excel (.xlsx)
        const savedQueries = await this.dbService.listSavedQueries();
        const sq = savedQueries.find((q) => q.id === job.savedQueryId);
        if (!sq) {
          throw new Error('Query Tersimpan yang dipilih sudah dihapus.');
        }
        const qRes = await this.dbService.executeQuery(
          job.profileId,
          sq.sql,
          job.database || sq.database,
          20000
        );
        const xlsxBuf = buildXlsxBuffer({
          sheetName: sq.name.slice(0, 31),
          columns: qRes.columns,
          rows: qRes.rows
        });
        const slug = sanitizeFileSlug(sq.name);
        outPath = join(job.outputDir, `${slug}_${ts}.xlsx`);
        await writeFile(outPath, xlsxBuf);
        summaryMsg = `Export Excel (${qRes.rowCount} baris) tersimpan`;
      }

      const freshList = await this.readRaw();
      const targetIdx = freshList.findIndex((j) => j.id === id);
      const updated: DbScheduleJob = {
        ...(targetIdx >= 0 ? freshList[targetIdx] : job),
        lastRunAt: new Date().toISOString(),
        lastStatus: 'ok',
        lastMessage: summaryMsg,
        lastOutputPath: outPath,
        updatedAt: new Date().toISOString()
      };
      if (targetIdx >= 0) {
        freshList[targetIdx] = updated;
        await this.writeRaw(freshList);
      }

      this.onActivity?.({
        id: `sched-ok-${Date.now()}`,
        tone: 'success',
        badge: 'AUTO BACKUP',
        title: `${job.name} selesai`,
        subtitle: summaryMsg,
        busy: false,
        timestamp: Date.now()
      });

      return updated;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const freshList = await this.readRaw();
      const targetIdx = freshList.findIndex((j) => j.id === id);
      const failed: DbScheduleJob = {
        ...(targetIdx >= 0 ? freshList[targetIdx] : job),
        lastRunAt: new Date().toISOString(),
        lastStatus: 'error',
        lastMessage: errMsg,
        updatedAt: new Date().toISOString()
      };
      if (targetIdx >= 0) {
        freshList[targetIdx] = failed;
        await this.writeRaw(freshList);
      }
      throw err;
    } finally {
      this.runningIds.delete(id);
    }
  }
}
