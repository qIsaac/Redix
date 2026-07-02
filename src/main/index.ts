import { app, BrowserWindow, shell, nativeImage } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { ConnectionManager } from './services/connection-manager';
import { SecureStorage } from './services/secure-storage';
import { registerIPCHandlers } from './ipc/handlers';

// 模块级变量，供 activate 和 before-quit 事件访问
let connectionManager: ConnectionManager;
let storage: SecureStorage;
let handlersRegistered = false;

// 图标路径：使用 app.getAppPath() 确保开发和打包都能正确定位到项目根目录
function getIconPath(): string {
  const iconExt = process.platform === 'darwin' ? 'icns' : 'png';
  return join(app.getAppPath(), 'resources', `icon.${iconExt}`);
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Redix',
    icon: getIconPath(),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 18 },
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    transparent: false,
    backgroundColor: '#f5f5f7',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return mainWindow;
}

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.redix.app');

  const iconPath = getIconPath();

  // 设置 About 面板（macOS 点击菜单 About 时显示）
  app.setAboutPanelOptions({
    applicationName: 'Redix',
    applicationVersion: app.getVersion(),
    copyright: '© 2026 Redix',
    iconPath,
  });

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // 设置 macOS Dock 图标
  if (process.platform === 'darwin' && app.dock && existsSync(iconPath)) {
    app.dock.setIcon(nativeImage.createFromPath(iconPath));
  }

  const mainWindow = createWindow();

  // 初始化服务并注册 IPC handler（仅注册一次）
  storage = new SecureStorage();
  connectionManager = new ConnectionManager();

  if (!handlersRegistered) {
    registerIPCHandlers(connectionManager, storage, mainWindow);
    handlersRegistered = true;
  }

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      // handler 只注册一次，不再重复调用 registerIPCHandlers
    }
  });
});

// 退出前清理所有连接
app.on('before-quit', () => {
  if (connectionManager) {
    connectionManager.destroyAll();
  }
});

// Quit when all windows are closed (including macOS)
app.on('window-all-closed', () => {
  app.quit();
});
