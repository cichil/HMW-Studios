import { app, BrowserWindow, shell } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { autoUpdater } from 'electron-updater';
import {
  GITHUB_LATEST_RELEASE_API_URL,
  GITHUB_RELEASES_PAGE_URL,
  isNewerVersion,
  normalizeVersionTag,
  pickWindowsReleaseDownloadUrl,
  type AppUpdateStateDto,
  type GithubReleaseLike
} from '@shared/appUpdaterHelpers';

function extractReleaseNotesText(notes: unknown): string | undefined {
  if (!notes) return undefined;
  if (typeof notes === 'string') return notes.trim().slice(0, 2000) || undefined;
  if (Array.isArray(notes)) {
    const joined = notes
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'note' in item) {
          return String((item as { note?: unknown }).note ?? '');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
    return joined.trim().slice(0, 2000) || undefined;
  }
  return undefined;
}

export class AutoUpdaterService {
  private state: AppUpdateStateDto;
  private initialized = false;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const canAutoInstall = this.detectCanAutoInstall();
    this.state = {
      phase: 'idle',
      currentVersion: this.getCurrentVersion(),
      releaseUrl: GITHUB_RELEASES_PAGE_URL,
      canAutoInstall
    };
  }

  private getCurrentVersion(): string {
    try {
      return app.getVersion() || '4.0.1';
    } catch {
      return '4.0.1';
    }
  }

  /**
   * Auto-install penuh lewat `electron-updater` hanya aktif pada aplikasi Windows
   * yang terpasang melalui NSIS Installer (`Uninstall HMW Studio.exe` & `app-update.yml` tersedia).
   * Pada versi Portable `.ZIP` atau mode `dev`, layanan tetap mengecek rilis terbaru via GitHub API.
   */
  private detectCanAutoInstall(): boolean {
    try {
      if (!app.isPackaged || process.platform !== 'win32') return false;
      const updateConfigPath = join(process.resourcesPath, 'app-update.yml');
      if (!existsSync(updateConfigPath)) return false;
      const exeDir = dirname(app.getPath('exe'));
      const hasUninstaller =
        existsSync(join(exeDir, 'Uninstall HMW Studio.exe')) ||
        existsSync(join(exeDir, 'Uninstall.exe'));
      return hasUninstaller;
    } catch {
      return false;
    }
  }

  private updateState(patch: Partial<AppUpdateStateDto>): AppUpdateStateDto {
    this.state = {
      ...this.state,
      ...patch,
      currentVersion: this.getCurrentVersion(),
      canAutoInstall: this.detectCanAutoInstall()
    };
    this.broadcastState();
    return this.state;
  }

  private broadcastState(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        try {
          win.webContents.send('updater:stateChanged', this.state);
        } catch {
          // ignore closed window
        }
      }
    }
  }

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    if (this.state.canAutoInstall) {
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.allowPrerelease = false;
      autoUpdater.disableWebInstaller = true;

      autoUpdater.on('checking-for-update', () => {
        this.updateState({
          phase: 'checking',
          errorMessage: undefined
        });
      });

      autoUpdater.on('update-available', (info) => {
        const latestVer = normalizeVersionTag(info.version);
        this.updateState({
          phase: 'available',
          latestVersion: latestVer,
          releaseName: info.releaseName || `HMW Studio v${latestVer}`,
          releaseNotes: extractReleaseNotesText(info.releaseNotes),
          releaseUrl: `https://github.com/cichil/HMW-Studios/releases/tag/v${latestVer}`,
          errorMessage: undefined,
          checkedAt: new Date().toISOString()
        });
      });

      autoUpdater.on('update-not-available', (info) => {
        this.updateState({
          phase: 'up-to-date',
          latestVersion: normalizeVersionTag(info?.version || this.getCurrentVersion()),
          errorMessage: undefined,
          checkedAt: new Date().toISOString()
        });
      });

      autoUpdater.on('download-progress', (prog) => {
        this.updateState({
          phase: 'downloading',
          downloadPercent: Math.min(100, Math.max(0, Math.round(prog.percent || 0))),
          bytesPerSecond: prog.bytesPerSecond,
          transferredBytes: prog.transferred,
          totalBytes: prog.total,
          errorMessage: undefined
        });
      });

      autoUpdater.on('update-downloaded', (info) => {
        const latestVer = normalizeVersionTag(info.version);
        this.updateState({
          phase: 'downloaded',
          latestVersion: latestVer,
          releaseName: info.releaseName || `HMW Studio v${latestVer}`,
          releaseNotes: extractReleaseNotesText(info.releaseNotes),
          downloadPercent: 100,
          errorMessage: undefined
        });
      });

      autoUpdater.on('error', (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.updateState({
          phase: 'error',
          errorMessage: msg
        });
      });
    }

    // Cek pembaruan secara hening di latar belakang 12 detik setelah aplikasi terbuka
    if (app.isPackaged) {
      this.startupTimer = setTimeout(() => {
        void this.checkForUpdates(true);
      }, 12000);
    }
  }

  dispose(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
  }

  getState(): AppUpdateStateDto {
    return this.state;
  }

  private async checkViaGithubReleasesApi(silent: boolean): Promise<AppUpdateStateDto> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(GITHUB_LATEST_RELEASE_API_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `HMW-Studio/${this.getCurrentVersion()}`
        },
        signal: controller.signal
      });

      if (res.status === 404) {
        // Belum ada release yang dipublikasikan di GitHub
        return this.updateState({
          phase: silent ? 'idle' : 'up-to-date',
          latestVersion: this.getCurrentVersion(),
          releaseUrl: GITHUB_RELEASES_PAGE_URL,
          errorMessage: undefined,
          checkedAt: new Date().toISOString()
        });
      }

      if (!res.ok) {
        throw new Error(`GitHub API HTTP ${res.status}`);
      }

      const data = (await res.json()) as GithubReleaseLike;
      const latestVer = normalizeVersionTag(data.tag_name || data.name || '');
      const currentVer = this.getCurrentVersion();
      const downloadUrl = pickWindowsReleaseDownloadUrl(data);

      if (latestVer && isNewerVersion(currentVer, latestVer)) {
        return this.updateState({
          phase: 'available',
          latestVersion: latestVer,
          releaseName: data.name || `HMW Studio v${latestVer}`,
          releaseNotes: (data.body || '').trim().slice(0, 2000) || undefined,
          releaseUrl: downloadUrl,
          errorMessage: undefined,
          checkedAt: new Date().toISOString()
        });
      }

      return this.updateState({
        phase: silent ? 'idle' : 'up-to-date',
        latestVersion: latestVer || currentVer,
        releaseUrl: data.html_url || GITHUB_RELEASES_PAGE_URL,
        errorMessage: undefined,
        checkedAt: new Date().toISOString()
      });
    } catch (err) {
      if (silent) {
        return this.updateState({ phase: 'idle', errorMessage: undefined });
      }
      const msg = err instanceof Error ? err.message : String(err);
      return this.updateState({
        phase: 'error',
        errorMessage: `Gagal mengecek pembaruan di GitHub: ${msg}`,
        checkedAt: new Date().toISOString()
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async checkForUpdates(silent = false): Promise<AppUpdateStateDto> {
    if (this.state.phase === 'downloading') {
      return this.state;
    }

    if (!silent) {
      this.updateState({ phase: 'checking', errorMessage: undefined });
    }

    if (this.state.canAutoInstall) {
      try {
        const result = await autoUpdater.checkForUpdates();
        const remoteVer = normalizeVersionTag(result?.updateInfo?.version || '');
        if (remoteVer && isNewerVersion(this.getCurrentVersion(), remoteVer)) {
          return this.updateState({
            phase: 'available',
            latestVersion: remoteVer,
            releaseName: result?.updateInfo?.releaseName || `HMW Studio v${remoteVer}`,
            releaseNotes: extractReleaseNotesText(result?.updateInfo?.releaseNotes),
            releaseUrl: `https://github.com/cichil/HMW-Studios/releases/tag/v${remoteVer}`,
            errorMessage: undefined,
            checkedAt: new Date().toISOString()
          });
        }
        return this.updateState({
          phase: silent ? 'idle' : 'up-to-date',
          latestVersion: remoteVer || this.getCurrentVersion(),
          errorMessage: undefined,
          checkedAt: new Date().toISOString()
        });
      } catch {
        // Fallback otomatis ke GitHub Releases API bila latest.yml belum tersedia atau jaringan terbatas
        return this.checkViaGithubReleasesApi(silent);
      }
    }

    return this.checkViaGithubReleasesApi(silent);
  }

  async downloadUpdate(): Promise<AppUpdateStateDto> {
    if (!this.state.canAutoInstall) {
      const targetUrl = this.state.releaseUrl || GITHUB_RELEASES_PAGE_URL;
      await shell.openExternal(targetUrl);
      return this.state;
    }

    if (this.state.phase === 'downloaded') {
      return this.state;
    }

    this.updateState({
      phase: 'downloading',
      downloadPercent: 0,
      errorMessage: undefined
    });

    try {
      await autoUpdater.downloadUpdate();
      return this.state;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.updateState({
        phase: 'error',
        errorMessage: `Gagal mengunduh pembaruan: ${msg}`
      });
    }
  }

  quitAndInstall(): void {
    if (this.state.canAutoInstall && this.state.phase === 'downloaded') {
      autoUpdater.quitAndInstall(false, true);
    }
  }

  async openReleasePage(): Promise<void> {
    await shell.openExternal(this.state.releaseUrl || GITHUB_RELEASES_PAGE_URL);
  }
}
