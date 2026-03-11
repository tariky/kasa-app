import { app, BrowserWindow, nativeImage } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { registerIpcHandlers } from './ipc/handlers';
import { closeDb } from './database/db';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Resolve icon path – works in both dev and packaged builds
const iconPath = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.png')
  : path.join(__dirname, '../../src/assets/icon.png');

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#0f172a',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Allow opening blob: URLs in new windows (PDF preview)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('blob:')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 900,
          height: 700,
          title: 'PDF',
          icon: iconPath,
          autoHideMenuBar: true,
        },
      };
    }
    return { action: 'deny' };
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

app.on('ready', () => {
  // Set About panel info and dock icon before creating window
  const appIcon = nativeImage.createFromPath(iconPath);

  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(appIcon);
  }

  app.setAboutPanelOptions({
    applicationName: 'Pazar',
    applicationVersion: '1.0.0',
    version: '1.0.0',
    copyright: '© 2026 Tarik Caplja / Lunatik',
    credits: 'Razvio: Tarik Caplja\ntarik@lunatik.ba',
    iconPath,        // Linux
    icon: appIcon,   // macOS (NativeImage)
  } as Electron.AboutPanelOptionsOptions);

  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  closeDb();
});
