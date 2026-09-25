import { ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { getNetworkManager, getNodeInfo } from './network/manager';
import { getOllamaClient } from './ai/ollama-client';
import { RELAY_DEFAULT_PORT } from '../shared/types';
import { ensureOllamaModel, getEffectiveFreeRam } from '../shared/model-selection';
import { assignLayers, sendLayerAssignment, runDistributedInference, getPipelineState } from './ai/distributed';

// Persistent data directory
const DATA_DIR = path.join(os.homedir(), '.title-tbd');
const NODE_ID_FILE = path.join(DATA_DIR, 'node-id');

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getOrCreateNodeId(): string {
  ensureDataDir();
  if (fs.existsSync(NODE_ID_FILE)) {
    return fs.readFileSync(NODE_ID_FILE, 'utf-8').trim();
  }
  const nodeId = uuidv4();
  fs.writeFileSync(NODE_ID_FILE, nodeId);
  return nodeId;
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  const nodeId = getOrCreateNodeId();

  // --- Network ---
  ipcMain.handle('get-connected-nodes', async () => {
    try {
      const manager = getNetworkManager();
      return manager.getConnectedNodes();
    } catch {
      return [];
    }
  });

  ipcMain.handle('get-network-stats', async () => {
    try {
      const manager = getNetworkManager();
      const nodes = manager.getConnectedNodes();
      const totalStorage = nodes.reduce((sum, n) => sum + n.storageOffered, 0);
      const totalUsed = nodes.reduce((sum, n) => sum + n.storageUsed, 0);
      return {
        connectedNodes: nodes.length,
        totalNetworkStorage: totalStorage,
        totalNetworkUsed: totalUsed,
      };
    } catch {
      return { connectedNodes: 0, totalNetworkStorage: 0, totalNetworkUsed: 0 };
    }
  });

  // --- AI ---
  ipcMain.handle('ollama-status', async () => {
    const client = getOllamaClient();
    return client.checkStatus();
  });

  ipcMain.handle('ollama-chat', async (_event, model: string, prompt: string) => {
    const client = getOllamaClient();
    return client.chat(model, prompt);
  });

  // Streaming chat — sends tokens via webContents.send
  let streamAbort: AbortController | null = null;

  ipcMain.handle('ollama-chat-stream', async (event, model: string, prompt: string, history: { role: string; content: string }[]) => {
    const client = getOllamaClient();
    const webContents = event.sender;

    // Cancel any existing stream
    if (streamAbort) streamAbort.abort();

    streamAbort = client.chatStream(
      model, prompt, history,
      (token) => webContents.send('ollama-stream-token', token),
      (fullText) => {
        webContents.send('ollama-stream-done', fullText);
        streamAbort = null;
      },
      (error) => {
        webContents.send('ollama-stream-error', error);
        streamAbort = null;
      },
    );

    return { ok: true };
  });

  ipcMain.handle('ollama-stop-stream', async () => {
    if (streamAbort) {
      streamAbort.abort();
      streamAbort = null;
    }
    // Also stop distributed inference and notify workers
    try {
      const { stopInference } = require('./ai/distributed');
      stopInference();
    } catch {}
    return { ok: true };
  });

  ipcMain.handle('ollama-list-models', async () => {
    const client = getOllamaClient();
    return client.listModels();
  });

  ipcMain.handle('get-distributable-models', async () => {
    const { getModelInfo } = require('./ai/pipeline');
    const client = getOllamaClient();
    let installed: { name: string; size: number }[] = [];
    try {
      installed = await client.listModels();
    } catch {}
    // All known distributable models
    const allModels = [
      'gemma2:2b', 'gemma2:9b', 'gemma2:27b',
      'llama3.2:3b', 'llama3.1:8b', 'llama3.1:70b',
      'mistral:7b', 'mistral:13b',
      'qwen2.5:7b',
      'phi3:mini',
    ];
    return allModels.map(name => {
      const info = getModelInfo(name);
      const found = installed.find((m: any) => m.name === name);
      return {
        name,
        size: found?.size || (info ? info.estimatedSizeBytes : 0),
        totalLayers: info?.totalLayers || 0,
        estimatedSizeGB: info ? (info.estimatedSizeBytes / 1024**3).toFixed(1) : '?',
        paramsBillions: info?.paramsBillions || 0,
        installed: !!found,
      };
    });
  });

  // --- QR Code / PWA ---
  ipcMain.handle('get-pwa-url', async () => {
    // Return the LAN IP so phones on the same network can connect
    const port = 5173; // Vite dev server port
    const ip = getLanIp();
    return `http://${ip}:${port}?node=${nodeId}`;
  });

  // --- System Info ---
  ipcMain.handle('get-system-info', async () => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const hostname = os.hostname();
    const cpus = os.cpus();
    return {
      hostname,
      totalRam: totalMem,
      freeRam: freeMem,
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model || 'Unknown',
      platform: os.platform(),
    };
  });

  // --- Distributed Inference ---
  ipcMain.handle('get-pipeline-state', async () => {
    try {
      return getPipelineState();
    } catch (err: any) {
      console.error('[IPC] get-pipeline-state error:', err.message);
      return { model: null, assignments: [], activeWorkers: [], coordinatorLayers: null, workerLayers: [] };
    }
  });

  ipcMain.handle('assign-model-layers', async (_event, modelName: string) => {
    try {
      // Make sure Ollama actually has this model before splitting it
      const pulled = await ensureOllamaModel(modelName, (m) => console.log(`[IPC] ${m}`));
      if (!pulled) {
        return { assignments: [], workerResults: [], error: `Model ${modelName} is not available in Ollama (pull failed)` };
      }
      const manager = getNetworkManager();
      const nodes = manager.getConnectedNodes().filter((n: any) => n.nodeId !== manager.getNodeId());
      const freeRam = getEffectiveFreeRam();

      console.log(`[IPC] Assigning layers for ${modelName}, coordinator free RAM: ${(freeRam / 1024**3).toFixed(1)} GB, found ${nodes.length} worker(s)`);

      const workers = nodes.map((n: any) => ({
        nodeId: n.nodeId,
        hostname: n.hostname,
        ip: n.ip,
        port: n.port,
        freeRam: n.storageOffered || 8 * 1024**3,
      }));

      const assignments = assignLayers(modelName, freeRam, workers);

      // Send assignment to each worker via existing TCP connection
      const results: any[] = [];
      for (const a of assignments) {
        if (a.nodeId === 'coordinator') continue;
        const ok = sendLayerAssignment(a.nodeId, a);
        results.push({ ...a, connected: ok });
        console.log(`[IPC] Sent assignment to ${a.hostname}: layers ${a.layerStart}-${a.layerEnd}, connected: ${ok}`);
      }

      return { assignments, workerResults: results };
    } catch (err: any) {
      console.error('[IPC] assign-model-layers error:', err.message, err.stack);
      return { assignments: [], workerResults: [], error: err.message };
    }
  });

  ipcMain.handle('run-distributed-inference', async (event, prompt: string, model: string) => {
    try {
      const webContents = event.sender;

      return new Promise((resolve) => {
        runDistributedInference(
          prompt, model,
          (token: string) => webContents.send('ollama-stream-token', token),
          (fullText: string) => {
            webContents.send('ollama-stream-done', fullText);
            resolve({ ok: true, response: fullText });
          },
          (error: string) => {
            webContents.send('ollama-stream-error', error);
            resolve({ ok: false, error });
          },
        );
      });
    } catch (err: any) {
      console.error('[IPC] run-distributed-inference error:', err.message);
      return { ok: false, error: err.message };
    }
  });

  // --- Settings ---
  ipcMain.handle('get-data-dir', async () => DATA_DIR);
  ipcMain.handle('get-node-id', async () => nodeId);
}

function getLanIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}
