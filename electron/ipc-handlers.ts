import { ipcMain, BrowserWindow, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { splitIntoChunks, reassembleChunks, computeHash, verifyHash } from './storage/chunker';
import {
  encryptToBuffer,
  decryptFromBuffer,
  deriveKey,
  generateSalt,
} from './storage/encryptor';
import {
  createManifest,
  addChunkToManifest,
  saveManifest,
  loadManifest,
  listManifests,
  deleteManifest,
  storeChunkLocally,
  getStorageUsed,
} from './storage/manifest';
import { getNetworkManager, getNodeInfo } from './network/manager';
import { getOllamaClient } from './ai/ollama-client';
import { RELAY_DEFAULT_PORT } from '../shared/types';
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

  // --- Open File Dialog ---
  ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, filePath: null };
    }
    return { canceled: false, filePath: result.filePaths[0] };
  });

  // --- File Upload ---
  ipcMain.handle('upload-file', async (_event, filePath: string, password: string) => {
    try {
      const fileData = fs.readFileSync(filePath);
      const fileName = path.basename(filePath);
      const mimeType = getMimeType(fileName);
      const fileSize = fileData.length;

      // Create manifest
      const { manifest, fileId, salt } = createManifest(fileName, mimeType, fileSize);

      // Split into chunks
      const chunks = splitIntoChunks(fileData, manifest.chunkSize);

      // Encrypt each chunk and store locally (for now, all chunks on this node)
      // In Phase 2+, we'll distribute to other nodes
      for (const chunk of chunks) {
        const key = deriveKey(password, salt);
        const encryptedData = encryptToBuffer(chunk.data, key);
        const { hash } = storeChunkLocally(DATA_DIR, fileId, chunk.index, encryptedData, password);

        const chunkMetadata = {
          chunkId: uuidv4(),
          fileId,
          chunkIndex: chunk.index,
          totalChunks: chunks.length,
          originalSize: chunk.size,
          encryptedSize: encryptedData.length,
          sha256: hash,
          iv: '', // IV is packed in the encrypted buffer
          nodeId,
        };

        addChunkToManifest(manifest, chunkMetadata);
      }

      // Save manifest
      saveManifest(DATA_DIR, manifest);

      // Notify renderer
      mainWindow?.webContents.send('files-updated', listManifests(DATA_DIR));

      return { success: true, fileId, chunks: chunks.length };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // --- File Download ---
  ipcMain.handle(
    'download-file',
    async (_event, fileId: string, outputPath: string, password: string) => {
      try {
        const manifest = loadManifest(DATA_DIR, fileId);
        if (!manifest) {
          return { success: false, error: 'File manifest not found' };
        }

        const loadedChunks: { index: number; data: Buffer; size: number }[] = [];

        for (const chunkMeta of manifest.chunks) {
          // Try loading from local storage first
          const chunksDir = path.join(DATA_DIR, 'title-tbd-storage', 'chunks', fileId);
          const fileName = `chunk_${String(chunkMeta.chunkIndex).padStart(4, '0')}.enc`;
          const filePath = path.join(chunksDir, fileName);

          if (!fs.existsSync(filePath)) {
            // TODO: In Phase 2, fetch from remote node
            return {
              success: false,
              error: `Chunk ${chunkMeta.chunkIndex} not found locally or on remote nodes`,
            };
          }

          const encryptedData = fs.readFileSync(filePath);
          const salt = Buffer.from(manifest.encryptionSalt, 'base64');
          const key = deriveKey(password, salt);
          const decryptedData = decryptFromBuffer(encryptedData, key);

          loadedChunks.push({
            index: chunkMeta.chunkIndex,
            data: decryptedData,
            size: decryptedData.length,
          });
        }

        // Reassemble
        const fileData = reassembleChunks(loadedChunks);

        // Verify total size
        if (fileData.length !== manifest.totalSize) {
          return {
            success: false,
            error: `Size mismatch: expected ${manifest.totalSize}, got ${fileData.length}`,
          };
        }

        // Write to output path
        const finalPath = outputPath || path.join(os.homedir(), 'Downloads', manifest.originalFilename);
        fs.writeFileSync(finalPath, fileData);

        return { success: true, path: finalPath, size: fileData.length };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    }
  );

  // --- List Files ---
  ipcMain.handle('list-files', async () => {
    return listManifests(DATA_DIR);
  });

  // --- Delete File ---
  ipcMain.handle('delete-file', async (_event, fileId: string) => {
    const success = deleteManifest(DATA_DIR, fileId);
    if (success) {
      mainWindow?.webContents.send('files-updated', listManifests(DATA_DIR));
    }
    return success;
  });

  // --- Network ---
  ipcMain.handle('get-connected-nodes', async () => {
    try {
      const manager = getNetworkManager();
      return manager.getConnectedNodes();
    } catch {
      return [];
    }
  });

  ipcMain.handle('get-storage-stats', async () => {
    const used = getStorageUsed(DATA_DIR);
    return {
      totalOffered: 2 * 1024 * 1024 * 1024, // 2GB default
      totalUsed: used,
      filesStored: listManifests(DATA_DIR).length,
      chunksStored: 0, // TODO: count chunks
    };
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
      const manager = getNetworkManager();
      const nodes = manager.getConnectedNodes().filter((n: any) => n.nodeId !== manager.getNodeId());
      const freeRam = os.freemem();

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

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.zip': 'application/zip',
    '.json': 'application/json',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}
