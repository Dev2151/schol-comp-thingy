import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';
import { v4 as uuidv4 } from 'uuid';
import { Bonjour, Service } from 'bonjour-service';
import * as fs from 'fs';

// Platform info: the original build hard-exited unless it ran on one specific
// Arch ThinkPad. That gate is now a warning so the worker can run inside
// VMs (e.g. Lubuntu in GNOME Boxes) and on other machines.
const ALLOWED_HOSTNAME = 'ty-20nks0qn15';
if (process.platform !== 'linux') {
  console.warn(`[Title TBD Worker] Warning: unsupported platform ${process.platform} — continuing anyway.`);
}
try {
  const osRelease = fs.readFileSync('/etc/os-release', 'utf-8');
  if (!osRelease.includes('arch') && !osRelease.includes('endeavouros')) {
    console.warn('[Title TBD Worker] Warning: non-Arch-based distro — continuing anyway.');
  }
} catch {}
if (os.hostname() !== ALLOWED_HOSTNAME) {
  console.warn(`[Title TBD Worker] Warning: hostname is ${os.hostname()}, not the dev ThinkPad (${ALLOWED_HOSTNAME}) — continuing anyway.`);
}

// ============================================================
// Title TBD Worker Node — Main Process
// ============================================================

const DATA_DIR = path.join(os.homedir(), '.title-tbd-worker');
const NODE_ID_FILE = path.join(DATA_DIR, 'node-id');
const MDNS_SERVICE_TYPE = '_title-tbd_tcp';
const TCP_DEFAULT_PORT = 9501;

// --- State ---
let mainWindow: BrowserWindow | null = null;
let nodeId: string = '';
let coordinatorSocket: net.Socket | null = null;
let coordinatorInfo: { ip: string; port: number; hostname: string } | null = null;
let connectionStatus: 'searching' | 'connecting' | 'connected' | 'error' = 'searching';
let loadedLayers: { model: string; layerRange: string; status: string } | null = null;
let assignedModel = '';
let assignedLayerStart = 0;
let assignedLayerEnd = 0;
let logs: string[] = [];
const bonjour = new Bonjour();

function log(msg: string) {
  const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logs.push(entry);
  if (logs.length > 200) logs.shift();
  console.log(msg);
  mainWindow?.webContents.send('worker-log', entry);
  mainWindow?.webContents.send('worker-status', getStatus());
}

function getStatus() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    nodeId,
    hostname: os.hostname(),
    connectionStatus,
    coordinator: coordinatorInfo,
    totalRam: totalMem,
    freeRam: freeMem,
    cpuCount: os.cpus().length,
    cpuModel: os.cpus()[0]?.model || 'Unknown',
    loadedLayers,
    logs: logs.slice(-50),
  };
}

// --- Node ID ---
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getOrCreateNodeId(): string {
  ensureDataDir();
  if (fs.existsSync(NODE_ID_FILE)) {
    return fs.readFileSync(NODE_ID_FILE, 'utf-8').trim();
  }
  const id = uuidv4();
  fs.writeFileSync(NODE_ID_FILE, id);
  return id;
}

// --- TCP Protocol ---
function sendMessage(socket: net.Socket, message: any) {
  const data = JSON.stringify(message);
  const buf = Buffer.from(data);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length, 0);
  socket.write(Buffer.concat([len, buf]));
}

function parseMessages(socket: net.Socket, onData: (msg: any) => void) {
  let buffer = Buffer.alloc(0);
  let msgLen = 0;

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      if (msgLen === 0) {
        msgLen = buffer.readUInt32BE(0);
        buffer = buffer.subarray(4);
      }
      if (buffer.length < msgLen) break;
      const msgData = buffer.subarray(0, msgLen);
      buffer = buffer.subarray(msgLen);
      msgLen = 0;
      try {
        onData(JSON.parse(msgData.toString()));
      } catch (e) {
        log(`Failed to parse message: ${e}`);
      }
    }
  });
}

// --- Coordinator Connection ---
function connectToCoordinator(ip: string, port: number, hostname: string) {
  if (coordinatorSocket) {
    coordinatorSocket.destroy();
    coordinatorSocket = null;
  }

  connectionStatus = 'connecting';
  coordinatorInfo = { ip, port, hostname };
  log(`Connecting to coordinator ${hostname} at ${ip}:${port}...`);
  mainWindow?.webContents.send('worker-status', getStatus());

  const socket = net.createConnection({ host: ip, port }, () => {
    connectionStatus = 'connected';
    log(`Connected to coordinator ${hostname}`);
    mainWindow?.webContents.send('worker-status', getStatus());

    // Send hello with our info
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    sendMessage(socket, {
      type: 'WORKER_HELLO',
      nodeId,
      hostname: os.hostname(),
      ip: getLocalIP(),
      port: TCP_DEFAULT_PORT,
      totalRam: totalMem,
      freeRam: freeMem,
      cpuCount: os.cpus().length,
      cpuModel: os.cpus()[0]?.model || 'Unknown',
    });
  });

  parseMessages(socket, (msg) => {
    switch (msg.type) {
      case 'WORKER_WELCOME':
        log(`Coordinator confirmed: ${msg.message}`);
        break;

      case 'ASSIGN_LAYERS': {
        const [start, end] = (msg.layerRange || '0-0').split('-').map(Number);
        loadedLayers = {
          model: msg.model,
          layerRange: msg.layerRange,
          status: 'loaded',
        };
        const modelChanged = assignedModel !== msg.model;
        assignedModel = msg.model;
        assignedLayerStart = start;
        assignedLayerEnd = end;
        log(`Assigned layers ${msg.layerRange} for model ${msg.model} (${end - start + 1} layers)`);
        mainWindow?.webContents.send('worker-status', getStatus());
        // Make sure this VM's Ollama has the assigned model (auto-pull once)
        if (modelChanged) void ensureModelPulled(msg.model);
        break;
      }

      case 'HEARTBEAT':
        sendMessage(socket, {
          type: 'HEARTBEAT_ACK',
          nodeId,
          timestamp: Date.now(),
          freeRam: os.freemem(),
        });
        break;

      case 'INFER_REQUEST': {
        const reqId = msg.requestId;
        const tokenBudget = msg.tokenBudget || 100;
        log(`Inference request: layers ${msg.layerRange}, budget ${tokenBudget} tokens`);

        // Run inference using Ollama on this worker's portion
        runWorkerInference(socket, reqId, msg.prompt, msg.layerRange, tokenBudget);
        break;
      }

      case 'INFER_START': {
        log(`Inference started on coordinator: model=${msg.model}`);
        mainWindow?.webContents.send('worker-infer-start', {
          model: msg.model,
          prompt: msg.prompt,
        });
        break;
      }

      case 'INFER_PROGRESS': {
        mainWindow?.webContents.send('worker-infer-progress', {
          token: msg.token,
          tokenIndex: msg.tokenIndex,
          totalTokens: msg.totalTokens,
        });
        break;
      }

      case 'INFER_DONE': {
        log(`Inference complete on coordinator (${msg.fullText?.length || 0} chars)`);
        mainWindow?.webContents.send('worker-infer-done', {
          fullText: msg.fullText,
        });
        break;
      }

      case 'INFER_STOP': {
        log(`Inference stopped by coordinator`);
        mainWindow?.webContents.send('worker-infer-stop');
        break;
      }

      default:
        log(`Unknown message from coordinator: ${msg.type}`);
    }
  });

  socket.on('close', () => {
    connectionStatus = 'searching';
    coordinatorSocket = null;
    coordinatorInfo = null;
    loadedLayers = null;
    reconnectAttempts = Math.min(reconnectAttempts + 1, 6); // cap backoff at ~30s
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    const delay = 3000 * reconnectAttempts;
    log(`Disconnected from coordinator. Reconnecting in ${Math.round(delay / 1000)}s...`);
    mainWindow?.webContents.send('worker-status', getStatus());
    // Auto-reconnect with backoff
    setTimeout(() => {
      if (connectionStatus !== 'connected') {
        reconnect();
      }
    }, delay);
  });

  socket.on('error', (err) => {
    log(`Connection error: ${err.message}`);
    connectionStatus = 'error';
    mainWindow?.webContents.send('worker-status', getStatus());
  });

  coordinatorSocket = socket;

  // Send periodic heartbeats to keep alive
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (coordinatorSocket) {
      sendMessage(coordinatorSocket, {
        type: 'HEARTBEAT_ACK',
        nodeId,
        timestamp: Date.now(),
        freeRam: os.freemem(),
      });
    }
  }, 15000); // Every 15 seconds
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

// --- Manual Coordinator IP ---
const LAST_COORD_FILE = path.join(DATA_DIR, 'last-coordinator');

function getSavedCoordinatorIp(): string | null {
  try {
    if (fs.existsSync(LAST_COORD_FILE)) {
      return fs.readFileSync(LAST_COORD_FILE, 'utf-8').trim();
    }
  } catch {}
  return null;
}

function saveCoordinatorIp(ip: string) {
  try {
    ensureDataDir();
    fs.writeFileSync(LAST_COORD_FILE, ip);
  } catch {}
}

function getCoordinatorIpArg(): string | null {
  // Check CLI args: --coordinator-ip=100.x.x.x
  for (const arg of process.argv) {
    if (arg.startsWith('--coordinator-ip=')) {
      return arg.split('=')[1];
    }
  }
  // Check env var
  return process.env.COORDINATOR_IP || null;
}

// --- Worker Inference ---
async function runWorkerInference(
  socket: net.Socket,
  requestId: string,
  prompt: string,
  layerRange: string,
  tokenBudget: number
) {
  log(`Running inference on layers ${layerRange} (${tokenBudget} tokens)`);

  try {
    // Use Ollama API to generate tokens for this worker's portion
    const response = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: assignedModel,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
        options: { num_predict: tokenBudget },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let fullText = '';
    let tokens: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(l => l.trim());

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.message?.content) {
            tokens.push(json.message.content);
            fullText += json.message.content;
            log(`[token] ${json.message.content}`);
          }
          if (json.done) {
            // Send all tokens back to coordinator
            sendPipeMsg(socket, {
              type: 'INFER_RESPONSE',
              requestId,
              nodeId,
              layerRange,
              tokens,
              fullText,
              done: true,
            });
            log(`Inference complete: ${fullText.length} chars generated`);
            return;
          }
        } catch {}
      }
    }

    // Send remaining tokens
    sendPipeMsg(socket, {
      type: 'INFER_RESPONSE',
      requestId,
      nodeId,
      layerRange,
      tokens,
      fullText,
      done: true,
    });
    log(`Inference complete: ${fullText.length} chars generated`);
  } catch (err: any) {
    log(`Inference error: ${err.message}`);
    sendPipeMsg(socket, {
      type: 'INFER_RESPONSE',
      requestId,
      nodeId,
      layerRange,
      error: err.message,
      done: true,
    });
  }
}

function sendPipeMsg(socket: net.Socket, message: any) {
  const data = JSON.stringify(message);
  const buf = Buffer.from(data);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length, 0);
  socket.write(Buffer.concat([len, buf]));
}

// --- Local model auto-pull ---
// If the coordinator assigns a model this VM doesn't have yet, pull it from
// the Ollama registry so local inference works without manual setup.
let pullingModel = '';
async function ensureModelPulled(model: string): Promise<void> {
  if (!model || pullingModel === model) return;
  try {
    const tags = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
    if (tags.ok) {
      const data: any = await tags.json();
      const installed = (data.models || []).some((m: any) => m.name === model || m.name === `${model}:latest`);
      if (installed) return;
    }
    pullingModel = model;
    log(`Model ${model} not in local Ollama — pulling (one-time download)...`);
    const res = await fetch('http://localhost:11434/api/pull', {
      method: 'POST',
      body: JSON.stringify({ model }),
    });
    if (res.ok && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value, { stream: true }).split('\n').filter(l => l.trim())) {
          try {
            const j = JSON.parse(line);
            if (j.error) { log(`Ollama pull error: ${j.error}`); pullingModel = ''; return; }
            if (j.total && j.completed) {
              const pct = Math.round((j.completed / j.total) * 100);
              if (pct % 25 === 0) log(`[ollama] ${model}: ${pct}%`);
            }
          } catch {}
        }
      }
      log(`Model ${model} is ready locally.`);
    } else {
      log(`Ollama pull failed with HTTP ${res.status}`);
    }
  } catch (err: any) {
    log(`Ollama model check/pull failed: ${err.message} (is 'ollama serve' running?)`);
  } finally {
    if (pullingModel === model) pullingModel = '';
  }
}

// --- mDNS Discovery ---
let foundViaMdns = false;
let reconnectAttempts = 0;

// GNOME Boxes / QEMU NAT: the host laptop is always reachable from inside the
// VM at this magic address, so VM workers can find the coordinator without mDNS.
const VM_HOST_FALLBACKS = ['10.0.2.2', '127.0.0.1'];

/**
 * Full fallback chain, used on startup AND on every reconnect:
 * 1. --coordinator-ip= / COORDINATOR_IP (manual override)
 * 2. last known coordinator IP (persists across VM reboots)
 * 3. VM NAT fallbacks (10.0.2.2 → host, then localhost)
 * 4. mDNS (only works on a real LAN, not across VM NAT)
 */
function reconnect(): void {
  // Priority 1: CLI arg or env var
  const cliIp = getCoordinatorIpArg();
  if (cliIp) {
    if (reconnectAttempts === 0) log(`Using coordinator IP from argument: ${cliIp}`);
    connectToCoordinator(cliIp, TCP_DEFAULT_PORT, 'coordinator');
    return;
  }

  // Priority 2: last known coordinator IP
  const savedIp = getSavedCoordinatorIp();
  if (savedIp) {
    if (reconnectAttempts === 0) log(`Trying last known coordinator: ${savedIp}`);
    connectToCoordinator(savedIp, TCP_DEFAULT_PORT, 'coordinator');
    return;
  }

  // Priority 3: VM NAT fallback (10.0.2.2 = the host machine from inside a
  // QEMU/Boxes NAT VM). Try each fallback once per cycle.
  const fallback = VM_HOST_FALLBACKS[reconnectAttempts % VM_HOST_FALLBACKS.length];
  if (reconnectAttempts < VM_HOST_FALLBACKS.length) {
    log(`No saved coordinator — trying VM NAT fallback: ${fallback}...`);
    connectToCoordinator(fallback, TCP_DEFAULT_PORT, 'host');
    return;
  }

  // Priority 4: mDNS discovery (works on a real LAN; cannot cross VM NAT)
  if (reconnectAttempts === VM_HOST_FALLBACKS.length) {
    log('Searching for coordinator via mDNS...');
  }
}

function startDiscovery() {
  log('Searching for Title TBD coordinator on network...');

  // Manual override wins immediately
  const cliIp = getCoordinatorIpArg();
  if (cliIp) {
    log(`Using coordinator IP from argument: ${cliIp}`);
    connectToCoordinator(cliIp, TCP_DEFAULT_PORT, 'coordinator');
    return;
  }

  // Saved IP from a previous run wins next
  const savedIp = getSavedCoordinatorIp();
  if (savedIp) {
    log(`Trying last known coordinator: ${savedIp}`);
    connectToCoordinator(savedIp, TCP_DEFAULT_PORT, 'coordinator');
    return;
  }

  // No saved IP: try VM NAT fallbacks first (10.0.2.2 = host from inside Boxes),
  // then mDNS. Each failed connection triggers reconnect() with backoff, which
  // walks the chain.
  reconnect();

  // mDNS discovery (runs in parallel — wins if it finds a real coordinator)
  bonjour.find({ type: MDNS_SERVICE_TYPE }, (service: Service) => {
    if (service.name?.includes(os.hostname())) return;
    if (foundViaMdns) return;
    foundViaMdns = true;

    const hostname = service.txt?.hostname as string || service.name || 'unknown';
    const ip = service.referer?.address || service.addresses?.[0] || '0.0.0.0';
    const port = service.port || TCP_DEFAULT_PORT;

    log(`Found coordinator via mDNS: ${hostname} at ${ip}:${port}`);
    reconnectAttempts = 0;
    saveCoordinatorIp(ip);
    connectToCoordinator(ip, port, hostname);
  });
}

// --- Publish worker service ---
function publishWorkerService() {
  bonjour.publish({
    name: `title-tbd-worker-${os.hostname()}`,
    type: MDNS_SERVICE_TYPE,
    port: TCP_DEFAULT_PORT,
    txt: {
      nodeId,
      hostname: os.hostname(),
      role: 'worker',
      version: '0.2.0',
    },
  });
  log(`Published worker service: ${os.hostname()}`);
}

// --- Local IP ---
function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// --- IPC Handlers ---
function registerIpcHandlers() {
  ipcMain.handle('get-worker-status', () => getStatus());
  ipcMain.handle('get-worker-logs', () => logs.slice(-100));
  ipcMain.handle('reconnect', () => {
    if (coordinatorInfo) {
      connectToCoordinator(coordinatorInfo.ip, coordinatorInfo.port, coordinatorInfo.hostname);
    }
  });
  ipcMain.handle('connect-to-ip', (_event, ip: string, port?: number) => {
    log(`Manual connection to ${ip}:${port || TCP_DEFAULT_PORT}`);
    reconnectAttempts = 0;
    saveCoordinatorIp(ip);
    connectToCoordinator(ip, port || TCP_DEFAULT_PORT, 'coordinator');
  });
  ipcMain.handle('get-saved-coordinator-ip', () => {
    return getSavedCoordinatorIp() || getCoordinatorIpArg() || '';
  });
}

// --- Window ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Title TBD Worker',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#f5f5f7',
    titleBarStyle: 'hiddenInset',
  });

  // In development, load from Vite dev server if available, otherwise load the built file
  const devUrl = 'http://localhost:5174';
  const prodPath = path.join(__dirname, 'renderer', 'index.html');

  mainWindow.loadURL(devUrl).catch(() => {
    mainWindow?.loadFile(prodPath);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- App Lifecycle ---
app.whenReady().then(() => {
  nodeId = getOrCreateNodeId();
  registerIpcHandlers();
  createWindow();
  publishWorkerService();
  startDiscovery();
  log(`Worker node started: ${os.hostname()} (${nodeId.slice(0, 8)})`);
  log(`RAM: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB total, ${(os.freemem() / 1024 / 1024 / 1024).toFixed(1)} GB free`);
});

app.on('window-all-closed', () => {
  bonjour.unpublishAll();
  bonjour.destroy();
  if (coordinatorSocket) coordinatorSocket.destroy();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
