import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '../src/services/bridge';
const api: DesktopBridge = {
  saveProject: (p) => ipcRenderer.invoke('project:save', p),
  openProject: () => ipcRenderer.invoke('project:open'),
  connections: () => ipcRenderer.invoke('connections:list'),
  setConnection: (p) => ipcRenderer.invoke('connections:set', p),
  testConnection: (p) => ipcRenderer.invoke('connections:test', p),
  providerTurn: (p) => ipcRenderer.invoke('provider:turn', p),
  build: (p) => ipcRenderer.invoke('toolchain:build', p),
  cancel: (id) => ipcRenderer.invoke('task:cancel', id),
  capabilities: () => ipcRenderer.invoke('capabilities'),
  onProviderText: (callback) => {
    const listener = (_e: unknown, data: { requestId: string; text: string }) => callback(data);
    ipcRenderer.on('provider:text', listener);
    return () => ipcRenderer.removeListener('provider:text', listener);
  },
};
contextBridge.exposeInMainWorld('trace', api);
