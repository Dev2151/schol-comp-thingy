import { contextBridge, ipcRenderer } from 'electron';

// Expose a safe API to the renderer process
contextBridge.exposeInMainWorld('freegrid', {
  // --- File Dialog ---
  openFileDialog: () =>
    ipcRenderer.invoke('open-file-dialog'),

  // --- File Operations ---
  uploadFile: (filePath: string, password: string) =>
    ipcRenderer.invoke('upload-file', filePath, password),

  downloadFile: (fileId: string, outputPath: string, password: string) =>
    ipcRenderer.invoke('download-file', fileId, outputPath, password),

  listFiles: () =>
    ipcRenderer.invoke('list-files'),

  deleteFile: (fileId: string) =>
    ipcRenderer.invoke('delete-file', fileId),

  // --- Network Operations ---
  getConnectedNodes: () =>
    ipcRenderer.invoke('get-connected-nodes'),

  getStorageStats: () =>
    ipcRenderer.invoke('get-storage-stats'),

  getNetworkStats: () =>
    ipcRenderer.invoke('get-network-stats'),

  // --- AI Operations ---
  ollamaStatus: () =>
    ipcRenderer.invoke('ollama-status'),

  ollamaChat: (model: string, prompt: string) =>
    ipcRenderer.invoke('ollama-chat', model, prompt),

  ollamaChatStream: (model: string, prompt: string, history: { role: string; content: string }[]) =>
    ipcRenderer.invoke('ollama-chat-stream', model, prompt, history),

  ollamaStopStream: () =>
    ipcRenderer.invoke('ollama-stop-stream'),

  onStreamToken: (callback: (token: string) => void) => {
    ipcRenderer.on('ollama-stream-token', (_event, token) => callback(token));
  },

  onStreamDone: (callback: (fullText: string) => void) => {
    ipcRenderer.on('ollama-stream-done', (_event, fullText) => callback(fullText));
  },

  onStreamError: (callback: (error: string) => void) => {
    ipcRenderer.on('ollama-stream-error', (_event, error) => callback(error));
  },

  removeStreamListeners: () => {
    ipcRenderer.removeAllListeners('ollama-stream-token');
    ipcRenderer.removeAllListeners('ollama-stream-done');
    ipcRenderer.removeAllListeners('ollama-stream-error');
  },

  ollamaListModels: () =>
    ipcRenderer.invoke('ollama-list-models'),

  getDistributableModels: () =>
    ipcRenderer.invoke('get-distributable-models'),

  getPipelineState: () =>
    ipcRenderer.invoke('get-pipeline-state'),

  assignModelLayers: (modelName: string) =>
    ipcRenderer.invoke('assign-model-layers', modelName),

  runDistributedInference: (prompt: string, model: string) =>
    ipcRenderer.invoke('run-distributed-inference', prompt, model),

  // --- QR Code ---
  getPwaUrl: () =>
    ipcRenderer.invoke('get-pwa-url'),

  // --- Settings ---
  getDataDir: () =>
    ipcRenderer.invoke('get-data-dir'),

  getNodeId: () =>
    ipcRenderer.invoke('get-node-id'),

  getSystemInfo: () =>
    ipcRenderer.invoke('get-system-info'),

  // --- Events ---
  onNodeUpdate: (callback: (nodes: any[]) => void) => {
    ipcRenderer.on('nodes-updated', (_event, nodes) => callback(nodes));
  },

  onFileUpdate: (callback: (files: any[]) => void) => {
    ipcRenderer.on('files-updated', (_event, files) => callback(files));
  },

  removeNodeListener: () => {
    ipcRenderer.removeAllListeners('nodes-updated');
  },

  removeFileListener: () => {
    ipcRenderer.removeAllListeners('files-updated');
  },

  onPipelineUpdate: (callback: (state: any) => void) => {
    ipcRenderer.on('pipeline-updated', (_event, state) => callback(state));
  },

  removePipelineListener: () => {
    ipcRenderer.removeAllListeners('pipeline-updated');
  },
});

export interface FreeGridAPI {
  uploadFile: (filePath: string, password: string) => Promise<any>;
  downloadFile: (fileId: string, outputPath: string, password: string) => Promise<any>;
  listFiles: () => Promise<any[]>;
  deleteFile: (fileId: string) => Promise<boolean>;
  getConnectedNodes: () => Promise<any[]>;
  getStorageStats: () => Promise<any>;
  getNetworkStats: () => Promise<any>;
  ollamaStatus: () => Promise<any>;
  ollamaChat: (model: string, prompt: string) => Promise<any>;
  ollamaChatStream: (model: string, prompt: string, history: { role: string; content: string }[]) => Promise<any>;
  ollamaStopStream: () => Promise<any>;
  onStreamToken: (callback: (token: string) => void) => void;
  onStreamDone: (callback: (fullText: string) => void) => void;
  onStreamError: (callback: (error: string) => void) => void;
  removeStreamListeners: () => void;
  ollamaListModels: () => Promise<any>;
  getPwaUrl: () => Promise<string>;
  getDataDir: () => Promise<string>;
  getNodeId: () => Promise<string>;
  getSystemInfo: () => Promise<{ hostname: string; totalRam: number; freeRam: number; cpuCount: number; cpuModel: string; platform: string }>;
  onNodeUpdate: (callback: (nodes: any[]) => void) => void;
  onFileUpdate: (callback: (files: any[]) => void) => void;
  removeNodeListener: () => void;
  removeFileListener: () => void;
}
