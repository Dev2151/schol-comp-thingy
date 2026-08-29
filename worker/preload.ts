import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('worker', {
  getStatus: () => ipcRenderer.invoke('get-worker-status'),
  getLogs: () => ipcRenderer.invoke('get-worker-logs'),
  reconnect: () => ipcRenderer.invoke('reconnect'),
  connectToIp: (ip: string, port?: number) => ipcRenderer.invoke('connect-to-ip', ip, port),
  getSavedCoordinatorIp: () => ipcRenderer.invoke('get-saved-coordinator-ip'),

  onStatus: (callback: (status: any) => void) => {
    ipcRenderer.on('worker-status', (_event, status) => callback(status));
  },
  onLog: (callback: (log: string) => void) => {
    ipcRenderer.on('worker-log', (_event, log) => callback(log));
  },
  onInferStart: (callback: (data: any) => void) => {
    ipcRenderer.on('worker-infer-start', (_event, data) => callback(data));
  },
  onInferProgress: (callback: (data: any) => void) => {
    ipcRenderer.on('worker-infer-progress', (_event, data) => callback(data));
  },
  onInferDone: (callback: (data: any) => void) => {
    ipcRenderer.on('worker-infer-done', (_event, data) => callback(data));
  },
  onInferStop: (callback: () => void) => {
    ipcRenderer.on('worker-infer-stop', () => callback());
  },
  removeListeners: () => {
    ipcRenderer.removeAllListeners('worker-status');
    ipcRenderer.removeAllListeners('worker-log');
    ipcRenderer.removeAllListeners('worker-infer-start');
    ipcRenderer.removeAllListeners('worker-infer-progress');
    ipcRenderer.removeAllListeners('worker-infer-done');
    ipcRenderer.removeAllListeners('worker-infer-stop');
  },
});
