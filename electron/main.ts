import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { StartedServer } from '../server/index.js';
import { startServer } from '../server/index.js';

let mainWindow: BrowserWindow | null = null;
let startedServer: StartedServer | null = null;
let resolvedDataDir = '';

function getAppRoot(): string {
  // Compiled file lives at <appRoot>/dist-server/electron/main.js
  return path.resolve(__dirname, '..', '..');
}

async function bootBackend(): Promise<StartedServer> {
  const appRoot = getAppRoot();
  const distDir = path.join(appRoot, 'dist');
  resolvedDataDir = app.isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.join(appRoot, 'data');

  fs.mkdirSync(resolvedDataDir, { recursive: true });

  // Try 4310 first; if occupied by another local process, bind an ephemeral free port on 127.0.0.1
  try {
    return await startServer({
      port: 4310,
      host: '127.0.0.1',
      distDir,
      dataDir: resolvedDataDir,
    });
  } catch {
    return await startServer({
      port: 0,
      host: '127.0.0.1',
      distDir,
      dataDir: resolvedDataDir,
    });
  }
}

function createWindow(port: number): BrowserWindow {
  const iconPath = path.join(getAppRoot(), 'build', 'icon.png');
  const win = new BrowserWindow({
    width: 1460,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    title: 'Multi-Agent 本地订阅工作流编排器',
    backgroundColor: '#f5f7fb',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setMenuBarVisibility(false);

  // Open external links in default OS browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
      return { action: 'allow' };
    }
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Allow F12 / Ctrl+Shift+I for troubleshooting
  win.webContents.on('before-input-event', (_event, input) => {
    if (
      input.key === 'F12' ||
      (input.control && input.shift && input.key.toLowerCase() === 'i')
    ) {
      win.webContents.toggleDevTools();
    }
  });

  const devUrl = process.env.ELECTRON_DEV_URL;
  void win.loadURL(devUrl || `http://127.0.0.1:${port}`);

  win.on('closed', () => {
    mainWindow = null;
  });

  return win;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  ipcMain.handle('desktop:pick-folder', async (_evt, defaultPath?: string) => {
    const res = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: '选择目标本地代码仓库目录',
      defaultPath: defaultPath && fs.existsSync(defaultPath) ? defaultPath : undefined,
      properties: ['openDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('desktop:open-data-dir', async () => {
    if (resolvedDataDir) {
      await shell.openPath(resolvedDataDir);
      return true;
    }
    return false;
  });

  ipcMain.handle('desktop:get-info', () => ({
    isDesktop: true,
    version: app.getVersion(),
    dataDir: resolvedDataDir,
  }));

  app.whenReady().then(async () => {
    try {
      startedServer = await bootBackend();
      mainWindow = createWindow(startedServer.port);
    } catch (err) {
      dialog.showErrorBox(
        '启动失败',
        `本地编排引擎未能启动：${err instanceof Error ? err.message : String(err)}`,
      );
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    if (startedServer) {
      void startedServer.close();
      startedServer = null;
    }
  });
}
