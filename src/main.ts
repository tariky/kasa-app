import { app, BrowserWindow, Menu, nativeImage, net, protocol } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import { registerIpcHandlers } from './ipc/handlers';
import { closeDb } from './database/db';
import { APP_SEMA, APP_URL, CSP_ELECTRON, imaDebugPrekidac, jeDozvoljenaNavigacija, jeDozvoljenaNavigacijaPopupa, jeDozvoljenPopup, meniSablon, putanjaZaZahtjev } from './ljuska/sigurnost';

// Upakovana aplikacija se ne pokreće s udaljenim debagovanjem: preko CDP-a bi
// se (npr. izmijenjenom prečicom na Windowsu) moglo ući u renderer i zvati
// window.api, iako su DevTools isključeni.
if (app.isPackaged && (app.commandLine.hasSwitch('remote-debugging-port') || app.commandLine.hasSwitch('remote-debugging-pipe') || imaDebugPrekidac(process.argv))) {
  app.exit(1);
  process.exit(1);
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Resolve icon path – works in both dev and packaged builds
const iconPath = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.png')
  : path.join(__dirname, '../../src/assets/icon.png');

// Ugrađeni renderer se servira kao app://pazar/… a ne file:// (file:// nema
// dodatne privilegije — fuse GrantFileProtocolExtraPrivileges je isključen).
// Mora biti registrovano prije `ready`.
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SEMA, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const urlAplikacije = MAIN_WINDOW_VITE_DEV_SERVER_URL || APP_URL;

// webContents glavnih prozora: samo oni smiju navigirati (na urlAplikacije) i otvarati PDF prozore.
const glavniProzori = new Set<number>();

function posluziRenderer() {
  const korijen = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);
  protocol.handle(APP_SEMA, async (zahtjev) => {
    const fajl = putanjaZaZahtjev(zahtjev.url, korijen);
    if (!fajl) return new Response('Not found', { status: 404 });
    let odgovor: Response;
    try {
      odgovor = await net.fetch(pathToFileURL(fajl).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
    const zaglavlja = new Headers(odgovor.headers);
    zaglavlja.set('Content-Security-Policy', CSP_ELECTRON);
    zaglavlja.set('X-Content-Type-Options', 'nosniff');
    return new Response(odgovor.body, { status: odgovor.status, headers: zaglavlja });
  });
}

// Svaki webContents (glavni prozor, PDF prozori): nema navigacije van
// aplikacije ni novih prozora osim PDF pregleda iz glavnog prozora.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e, url) => {
    const dozvoljeno = glavniProzori.has(contents.id)
      ? jeDozvoljenaNavigacija(url, urlAplikacije)
      : jeDozvoljenaNavigacijaPopupa(url, contents.getURL());
    if (!dozvoljeno) e.preventDefault();
  });
  contents.on('will-attach-webview', (e) => e.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (!glavniProzori.has(contents.id) || !jeDozvoljenPopup(url)) return { action: 'deny' };
    // PDF pregled: bez preloada (nema window.api), sandbox, bez Node-a.
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 900,
        height: 700,
        title: 'PDF',
        icon: iconPath,
        autoHideMenuBar: true,
        webPreferences: {
          preload: undefined,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          devTools: !app.isPackaged,
        },
      },
    };
  });
});

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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });
  const id = mainWindow.webContents.id;
  glavniProzori.add(id);
  mainWindow.on('closed', () => glavniProzori.delete(id));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.loadURL(urlAplikacije);
};

app.on('ready', () => {
  // Set About panel info and dock icon before creating window
  const appIcon = nativeImage.createFromPath(iconPath);

  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(appIcon);
  }

  app.setAboutPanelOptions({
    applicationName: 'Atlas',
    applicationVersion: '1.0.0',
    version: '1.0.0',
    copyright: '© 2026 Lunatik d.o.o.',
    credits: 'ERP za biznise\nIzradio: Lunatik d.o.o.\n+387 60 320 4600 (Viber, WhatsApp)\ntarik@lunatik.ba',
    iconPath,        // Linux
    icon: appIcon,   // macOS (NativeImage)
  } as Electron.AboutPanelOptionsOptions);

  // Upakovana aplikacija: bez Reload/DevTools u meniju; Uredi ostaje (copy/paste).
  Menu.setApplicationMenu(Menu.buildFromTemplate(meniSablon({ mac: process.platform === 'darwin', razvoj: !app.isPackaged })));

  if (!MAIN_WINDOW_VITE_DEV_SERVER_URL) posluziRenderer();
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
