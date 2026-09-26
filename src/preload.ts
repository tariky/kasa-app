import { contextBridge, ipcRenderer } from 'electron';
import { napraviApi, ocistiGreske } from './ipc/api';

contextBridge.exposeInMainWorld('api', napraviApi(
  ocistiGreske((kanal, ...args) => ipcRenderer.invoke(kanal, ...args)),
  (ime, cb) => {
    const l = (_e: unknown, podaci: unknown) => cb(podaci);
    ipcRenderer.on(ime, l);
    return () => { ipcRenderer.removeListener(ime, l); };
  },
));
