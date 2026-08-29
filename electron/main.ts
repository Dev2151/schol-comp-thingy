import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';

// Platform gate: Linux only, Arch-based only, this ThinkPad only
const ALLOWED_HOSTNAME = 'ty-20nks0qn15';
if (process.platform !== 'linux') {
  console.error(`[FreeGrid] Unsupported platform: ${process.platform}. This app only runs on Linux.`);
  app.quit();
  process.exit(1);
}
try {
  const osRelease = fs.readFileSync('/etc/os-release', 'utf-8');
  if (!osRelease.includes('arch') && !osRelease.includes('endeavouros')) {
    console.error('[FreeGrid] Unsupported distro. This app only runs on Arch-based Linux.');
    app.quit();
    process.exit(1);
  }
} catch {}
if (os.hostname() !== ALLOWED_HOSTNAME) {
  console.error(`[FreeGrid] Unauthorized host: ${os.hostname()}. This app only runs on ${ALLOWED_HOSTNAME}.`);
  app.quit();
  process.exit(1);
}
import { v4 as uuidv4 } from 'uuid';
import { registerIpcHandlers } from './ipc-handlers';
import { initNetworkManager } from './network/manager';

const DATA_DIR = path.join(os.homedir(), '.freegrid');
const NODE_ID_FILE = path.join(DATA_DIR, 'node-id');

function getOrCreateNodeId(): string {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(NODE_ID_FILE)) return fs.readFileSync(NODE_ID_FILE, 'utf-8').trim();
  const id = uuidv4();
  fs.writeFileSync(NODE_ID_FILE, id);
  return id;
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'FreeGrid',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In development, load from Vite dev server
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built HTML
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Initialize network manager (synchronous init, async start)
  const nodeId = getOrCreateNodeId();
  const networkManager = initNetworkManager({ nodeId, port: 9501 });
  networkManager.start().catch((err) => {
    console.error('[App] Network start failed:', err.message);
  });

  createWindow();
  registerIpcHandlers(mainWindow!);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
