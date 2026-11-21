import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DesktopIslandCommand, DesktopIslandSnapshot } from '@shared/types';
import { registerIpcHandlers, type RegisteredBackendServices } from './ipc/handlers';

let mainWindow: BrowserWindow | null = null;
let islandWindow: BrowserWindow | null = null;
let islandReady = false;
let latestIslandSnapshot: DesktopIslandSnapshot | null = null;
let isMainFocused = true;
let blurTimer: ReturnType<typeof setTimeout> | null = null;
let backendServices: RegisteredBackendServices | null = null;

const ISLAND_WIN_WIDTH = 468;
const ISLAND_COLLAPSED_HEIGHT = 50;
const ISLAND_EXPANDED_HEIGHT = 312;

function resolveAppIcon(): string | undefined {
  const candidates = [
    join(__dirname, '../../resources/icon.ico'),
    join(process.resourcesPath, 'icon.ico'),
    join(__dirname, '../../resources/icon.png')
  ];
  return candidates.find((p) => existsSync(p));
}

function destroyDesktopIslandWindow(): void {
  if (blurTimer) {
    clearTimeout(blurTimer);
    blurTimer = null;
  }
  islandReady = false;
  if (islandWindow && !islandWindow.isDestroyed()) {
    islandWindow.destroy();
  }
  islandWindow = null;
}

function ensureDesktopIslandWindow(): BrowserWindow {
  if (islandWindow && !islandWindow.isDestroyed()) {
    return islandWindow;
  }

  const refBounds =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : undefined;
  const workArea = refBounds
    ? screen.getDisplayMatching(refBounds).workArea
    : screen.getPrimaryDisplay().workArea;

  const x = Math.round(workArea.x + (workArea.width - ISLAND_WIN_WIDTH) / 2);
  const y = workArea.y + 6;

  islandReady = false;
  const win = new BrowserWindow({
    width: ISLAND_WIN_WIDTH,
    height: ISLAND_COLLAPSED_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    title: 'HMW Dynamic Island',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.webContents.on('did-finish-load', () => {
    islandReady = true;
    if (latestIslandSnapshot && !win.isDestroyed()) {
      win.webContents.send('island:snapshot', latestIslandSnapshot);
    }
    syncDesktopIslandVisibility();
  });

  win.on('closed', () => {
    islandReady = false;
    islandWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    const sep = process.env.ELECTRON_RENDERER_URL.includes('?') ? '&' : '?';
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${sep}windowMode=desktop-island`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { windowMode: 'desktop-island' }
    });
  }

  islandWindow = win;
  return win;
}

function syncDesktopIslandVisibility(): void {
  if (
    process.env.APTANA_SMOKE_TEST === '1' ||
    !mainWindow ||
    mainWindow.isDestroyed() ||
    !latestIslandSnapshot
  ) {
    if (islandWindow && !islandWindow.isDestroyed()) {
      islandWindow.hide();
    }
    return;
  }

  const mode = latestIslandSnapshot.mode;
  if (mode === 'off') {
    if (islandWindow && !islandWindow.isDestroyed()) {
      islandWindow.hide();
    }
    return;
  }

  const mainMinimizedOrUnfocused =
    mainWindow.isMinimized() || !mainWindow.isVisible() || !isMainFocused;
  const shouldShow = mode === 'always' || (mode === 'auto' && mainMinimizedOrUnfocused);

  if (shouldShow) {
    const win = ensureDesktopIslandWindow();
    if (islandReady && !win.isDestroyed() && !win.isVisible()) {
      win.showInactive();
      win.setAlwaysOnTop(true, 'screen-saver');
    }
  } else if (islandWindow && !islandWindow.isDestroyed() && islandWindow.isVisible()) {
    const b = islandWindow.getBounds();
    if (b.height !== ISLAND_COLLAPSED_HEIGHT) {
      islandWindow.setBounds({
        x: b.x,
        y: b.y,
        width: ISLAND_WIN_WIDTH,
        height: ISLAND_COLLAPSED_HEIGHT
      });
    }
    islandWindow.hide();
  }
}

function registerDesktopIslandIpc(): void {
  ipcMain.handle('island:pushSnapshot', (_e, snapshot: DesktopIslandSnapshot) => {
    latestIslandSnapshot = snapshot;
    if (snapshot.mode !== 'off') {
      ensureDesktopIslandWindow();
    }
    if (islandWindow && !islandWindow.isDestroyed() && islandReady) {
      islandWindow.webContents.send('island:snapshot', snapshot);
    }
    syncDesktopIslandVisibility();
  });

  ipcMain.handle('island:getSnapshot', () => latestIslandSnapshot);

  ipcMain.handle('island:setExpanded', (_e, expanded: boolean) => {
    if (!islandWindow || islandWindow.isDestroyed()) return;
    const b = islandWindow.getBounds();
    islandWindow.setBounds({
      x: b.x,
      y: b.y,
      width: ISLAND_WIN_WIDTH,
      height: expanded ? ISLAND_EXPANDED_HEIGHT : ISLAND_COLLAPSED_HEIGHT
    });
    if (expanded && islandWindow.isVisible()) {
      islandWindow.focus();
    }
  });

  ipcMain.handle('island:dispatchCommand', (_e, cmd: DesktopIslandCommand) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const needsFocus =
      cmd.type === 'focus-ide' ||
      cmd.type === 'island-search' ||
      cmd.type === 'jump-error' ||
      cmd.type === 'open-sync' ||
      cmd.type === 'edit-connection' ||
      cmd.type === 'open-ai' ||
      cmd.type === 'open-terminal' ||
      cmd.type === 'open-output' ||
      cmd.type === 'open-logs' ||
      cmd.type === 'open-db' ||
      cmd.type === 'open-http' ||
      cmd.type === 'open-transfers' ||
      cmd.type === 'open-preview';

    if (needsFocus) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
      isMainFocused = true;
      syncDesktopIslandVisibility();
    }

    mainWindow.webContents.send('island:command', cmd);
  });
}

function createMainWindow(): BrowserWindow {
  const { width: workW, height: workH } = screen.getPrimaryDisplay().workAreaSize;
  const minW = Math.min(960, workW);
  const minH = Math.min(600, workH);
  const initialWidth = Math.min(1440, Math.max(minW, workW - 32));
  const initialHeight = Math.min(900, Math.max(minH, workH - 32));

  const win = new BrowserWindow({
    width: initialWidth,
    height: initialHeight,
    minWidth: minW,
    minHeight: minH,
    center: true,
    title: 'HMW Studio',
    icon: resolveAppIcon(),
    backgroundColor: '#14171f',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.on('ready-to-show', () => {
    win.show();
    isMainFocused = win.isFocused();
    syncDesktopIslandVisibility();
    if (process.env.APTANA_SMOKE_TEST === '1') {
      setTimeout(() => {
        console.log('APTANA_SMOKE_READY_OK');
        app.quit();
      }, 2000);
    }
  });

  win.on('focus', () => {
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    isMainFocused = true;
    syncDesktopIslandVisibility();
  });

  win.on('blur', () => {
    if (blurTimer) clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      if (!win.isDestroyed()) {
        isMainFocused = win.isFocused();
        syncDesktopIslandVisibility();
      }
    }, 90);
  });

  win.on('minimize', () => {
    isMainFocused = false;
    syncDesktopIslandVisibility();
  });

  win.on('restore', () => {
    isMainFocused = win.isFocused();
    syncDesktopIslandVisibility();
  });

  win.on('closed', () => {
    mainWindow = null;
    destroyDesktopIslandWindow();
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    const ctrlOrCmd = process.platform === 'darwin' ? input.meta : input.control;
    if (!ctrlOrCmd) return;
    const key = (input.key || '').toLowerCase();
    const isKeyS = key === 's' || input.code === 'KeyS';
    if (!isKeyS) return;

    if (!input.shift && !input.alt) {
      event.preventDefault();
      win.webContents.send('ide:shortcut', 'save');
    } else if (input.shift && !input.alt) {
      event.preventDefault();
      win.webContents.send('ide:shortcut', 'save-all');
    } else if (!input.shift && input.alt) {
      event.preventDefault();
      win.webContents.send('ide:shortcut', 'save-project');
    }
  });

  win.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith('http://') || details.url.startsWith('https://')) {
      void shell.openExternal(details.url);
    }
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

void app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.hmw.studio');
  }
  backendServices = registerIpcHandlers();
  registerDesktopIslandIpc();
  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  destroyDesktopIslandWindow();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  destroyDesktopIslandWindow();
  if (backendServices) {
    void backendServices.dispose();
  }
});
