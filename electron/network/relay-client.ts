import { NodeInfo, RelayMessage, RELAY_DEFAULT_PORT } from '../../shared/types';
import * as os from 'os';

const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const POLL_INTERVAL = 5000; // 5 seconds

class RelayClient {
  private relayUrl: string;
  private nodeId: string;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private onNodesUpdate: ((nodes: NodeInfo[]) => void) | null = null;

  constructor(nodeId: string, relayHost: string = 'localhost', relayPort: number = RELAY_DEFAULT_PORT) {
    this.nodeId = nodeId;
    this.relayUrl = `http://${relayHost}:${relayPort}`;
  }

  /**
   * Connect to the relay server.
   */
  async connect(): Promise<boolean> {
    try {
      const hostname = os.hostname();
      const interfaces = os.networkInterfaces();
      let ip = '127.0.0.1';
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] || []) {
          if (iface.family === 'IPv4' && !iface.internal) {
            ip = iface.address;
            break;
          }
        }
      }

      const info: NodeInfo = {
        nodeId: this.nodeId,
        hostname,
        ip,
        port: 9501,
        storageOffered: 2 * 1024 * 1024 * 1024,
        storageUsed: 0,
        status: 'online',
        nodeType: 'desktop',
        isRelay: false,
        lastSeen: Date.now(),
      };

      const response = await fetch(`${this.relayUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(info),
      });

      if (response.ok) {
        this.connected = true;
        this.startHeartbeat();
        this.startPolling();
        console.log(`[Relay Client] Connected to relay at ${this.relayUrl}`);
        return true;
      }

      return false;
    } catch (err: any) {
      console.error(`[Relay Client] Failed to connect:`, err.message);
      return false;
    }
  }

  /**
   * Disconnect from the relay server.
   */
  async disconnect(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);

    if (this.connected) {
      try {
        await fetch(`${this.relayUrl}/deregister`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeId: this.nodeId }),
        });
      } catch {}
      this.connected = false;
    }
  }

  /**
   * Register a callback for node list updates.
   */
  onNodesChanged(callback: (nodes: NodeInfo[]) => void): void {
    this.onNodesUpdate = callback;
  }

  /**
   * Store a chunk on the relay server (for mobile nodes or when direct connection fails).
   */
  async storeChunk(chunkId: string, data: Buffer, metadata: any): Promise<string> {
    const response = await fetch(`${this.relayUrl}/chunk/${chunkId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: data.toString('base64'),
        metadata,
        nodeId: this.nodeId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to store chunk on relay: ${response.status}`);
    }

    return chunkId;
  }

  /**
   * Fetch a chunk from the relay server.
   */
  async fetchChunk(chunkId: string): Promise<Buffer> {
    const response = await fetch(`${this.relayUrl}/chunk/${chunkId}`);

    if (!response.ok) {
      throw new Error(`Chunk not found on relay: ${response.status}`);
    }

    const result = await response.json() as any;
    return Buffer.from(result.data, 'base64');
  }

  /**
   * Get all nodes from the relay.
   */
  async getNodes(): Promise<NodeInfo[]> {
    try {
      const response = await fetch(`${this.relayUrl}/nodes`);
      if (!response.ok) return [];

      const result = await response.json() as any;
      return result.nodes || [];
    } catch {
      return [];
    }
  }

  /**
   * Check if relay is reachable.
   */
  async checkStatus(): Promise<boolean> {
    try {
      const response = await fetch(`${this.relayUrl}/status`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  // --- Private ---

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      try {
        await fetch(`${this.relayUrl}/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeId: this.nodeId }),
        });
      } catch {
        // Relay might be down, will retry next interval
      }
    }, HEARTBEAT_INTERVAL);
  }

  private startPolling(): void {
    this.pollTimer = setInterval(async () => {
      try {
        const nodes = await this.getNodes();
        if (this.onNodesUpdate) {
          this.onNodesUpdate(nodes);
        }
      } catch {}
    }, POLL_INTERVAL);
  }
}

let client: RelayClient | null = null;

export function initRelayClient(
  nodeId: string,
  relayHost?: string,
  relayPort?: number
): RelayClient {
  client = new RelayClient(nodeId, relayHost, relayPort);
  return client;
}

export function getRelayClient(): RelayClient | null {
  return client;
}
