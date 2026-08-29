import { NodeInfo, HEARTBEAT_INTERVAL, NODE_TIMEOUT, TCP_DEFAULT_PORT } from '../../shared/types';
import { v4 as uuidv4 } from 'uuid';
import * as os from 'os';
import { publishNode, startDiscovery, stopDiscovery } from './discovery';
import { startTcpServer, stopTcpServer } from './tcp-server';

interface NetworkManagerOptions {
  nodeId: string;
  port: number;
}

class NetworkManager {
  private nodes: Map<string, NodeInfo> = new Map();
  private nodeId: string;
  private port: number;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(options: NetworkManagerOptions) {
    this.nodeId = options.nodeId;
    this.port = options.port;

    // Register self
    this.registerSelf();
  }

  private registerSelf(): void {
    const hostname = os.hostname();
    const interfaces = os.networkInterfaces();

    // Find the first non-internal IPv4 address
    let ip = '127.0.0.1';
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ip = iface.address;
          break;
        }
      }
    }

    const selfInfo: NodeInfo = {
      nodeId: this.nodeId,
      hostname,
      ip,
      port: this.port,
      storageOffered: 2 * 1024 * 1024 * 1024, // 2GB
      storageUsed: 0,
      status: 'online',
      nodeType: 'desktop',
      isRelay: false,
      lastSeen: Date.now(),
    };

    this.nodes.set(this.nodeId, selfInfo);
  }

  /**
   * Start the network: TCP server + mDNS discovery + heartbeat.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // Start TCP server
    try {
      await startTcpServer(this.port);
      console.log(`[Network] TCP server started on port ${this.port}`);
    } catch (err: any) {
      console.error(`[Network] Failed to start TCP server:`, err.message);
      // Try alternate port
      this.port = this.port + 1;
      try {
        await startTcpServer(this.port);
        console.log(`[Network] TCP server started on alternate port ${this.port}`);
      } catch (err2: any) {
        console.error(`[Network] Failed to start TCP server on alternate port:`, err2.message);
      }
    }

    // Publish via mDNS
    try {
      publishNode(this.nodeId, this.port);
    } catch (err: any) {
      console.error(`[Network] mDNS publish failed:`, err.message);
    }

    // Start discovering other nodes
    try {
      startDiscovery(
        (nodeInfo) => {
          this.addNode(nodeInfo);
          this.notifyRenderer();
        },
        (nodeId) => {
          this.removeNode(nodeId);
          this.notifyRenderer();
        }
      );
    } catch (err: any) {
      console.error(`[Network] mDNS discovery failed:`, err.message);
    }

    // Start heartbeat
    this.startHeartbeat();

    console.log(`[Network] Node ${this.nodeId.slice(0, 8)} started on ${this.getLocalIP()}:${this.port}`);
  }

  private getLocalIP(): string {
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

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;

      for (const [id, node] of this.nodes) {
        if (id !== this.nodeId && now - node.lastSeen > NODE_TIMEOUT) {
          if (node.status === 'online') {
            node.status = 'offline';
            changed = true;
            console.log(`[Network] Node ${node.hostname} went offline`);
          }
        }
      }

      if (changed) {
        this.notifyRenderer();
      }
    }, HEARTBEAT_INTERVAL);
  }

  private notifyRenderer(): void {
    // This will be called from main process to update renderer
    // Implemented via IPC in ipc-handlers.ts
  }

  getConnectedNodes(): NodeInfo[] {
    // Clean up stale nodes
    const now = Date.now();
    for (const [id, node] of this.nodes) {
      if (id !== this.nodeId && now - node.lastSeen > NODE_TIMEOUT) {
        node.status = 'offline';
      }
    }
    return Array.from(this.nodes.values());
  }

  addNode(info: NodeInfo): void {
    this.nodes.set(info.nodeId, { ...info, lastSeen: Date.now() });
  }

  removeNode(nodeId: string): void {
    if (nodeId !== this.nodeId) {
      this.nodes.delete(nodeId);
    }
  }

  updateNodeStorage(nodeId: string, used: number): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.storageUsed = used;
      node.lastSeen = Date.now();
    }
  }

  getNodeId(): string {
    return this.nodeId;
  }

  getPort(): number {
    return this.port;
  }

  // Pick a node to store a chunk (round-robin, excluding self for now)
  pickStorageNode(): NodeInfo | null {
    const candidates = Array.from(this.nodes.values()).filter(
      n => n.nodeId !== this.nodeId && n.status === 'online'
    );

    if (candidates.length === 0) {
      // If no other nodes, store on self
      return this.nodes.get(this.nodeId) || null;
    }

    // Simple: pick the one with the most free space
    return candidates.sort(
      (a, b) => (b.storageOffered - b.storageUsed) - (a.storageOffered - a.storageUsed)
    )[0];
  }

  destroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    stopDiscovery();
    stopTcpServer();
    console.log('[Network] Stopped');
  }
}

let manager: NetworkManager | null = null;

export function initNetworkManager(options: NetworkManagerOptions): NetworkManager {
  manager = new NetworkManager(options);
  return manager;
}

export function getNetworkManager(): NetworkManager {
  if (!manager) {
    throw new Error('NetworkManager not initialized. Call initNetworkManager first.');
  }
  return manager;
}

export function getNodeInfo(): NodeInfo {
  return getNetworkManager().getConnectedNodes().find(
    n => n.nodeId === getNetworkManager().getNodeId()
  )!;
}
