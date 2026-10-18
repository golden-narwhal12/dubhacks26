import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '../src/services/bridge';
const api: DesktopBridge = {
  setProjectTitle: (name) => ipcRenderer.invoke('project:title', name),
  exportFirmware: (project) => ipcRenderer.invoke('project:export', project),
  onMenuAction: (callback) => {
    const listener = (_e: unknown, action: string) => callback(action);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
  hardware: {
    syncProject: (project) => ipcRenderer.invoke('hardware:sync', project),
    discover: () => ipcRenderer.invoke('hardware:discover'),
    snapshot: () => ipcRenderer.invoke('hardware:snapshot'),
    verify: (project, requestId) => ipcRenderer.invoke('hardware:verify', { project, requestId }),
    request: (input) => ipcRenderer.invoke('hardware:request', input),
    approve: (id, overrideVerification) =>
      ipcRenderer.invoke('hardware:approve', { id, overrideVerification }),
    cancel: (id) => ipcRenderer.invoke('hardware:cancel', id),
    observe: (input, requestId) => ipcRenderer.invoke('hardware:observe', { input, requestId }),
    onSnapshot: (callback) => {
      const listener = (_e: unknown, snapshot: any) => callback(snapshot);
      ipcRenderer.on('hardware:snapshot', listener);
      return () => ipcRenderer.removeListener('hardware:snapshot', listener);
    },
  },

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
