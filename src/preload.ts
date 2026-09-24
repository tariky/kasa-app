import { contextBridge, ipcRenderer } from 'electron';
import { napraviApi } from './ipc/api';

contextBridge.exposeInMainWorld('api', napraviApi(
  (kanal, ...args) => ipcRenderer.invoke(kanal, ...args),
  (cb) => {
    const l = () => cb();
    ipcRenderer.on('licenca:blokirano', l);
    return () => { ipcRenderer.removeListener('licenca:blokirano', l); };
  },
));
