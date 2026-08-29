import * as http from 'http';
import * as crypto from 'crypto';
import { NodeInfo, RelayMessage } from '../shared/types';

const PORT = parseInt(process.env.RELAY_PORT || '9500', 10);
const HEARTBEAT_TIMEOUT = 90000; // 90 seconds

// --- State ---

interface StoredChunk {
  chunkId: string;
  data: string; // Base64-encoded
  metadata: any;
  storedAt: number;
}

const nodes: Map<string, NodeInfo & { ws?: any }> = new Map();
const chunks: Map<string, StoredChunk> = new Map();

// --- HTTP Server ---

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  // --- API Routes ---

  // GET /status — relay health check
  if (url.pathname === '/status' && req.method === 'GET') {
    const nodeList = Array.from(nodes.values()).map(({ ws, ...rest }) => rest);
    respondJSON(res, 200, {
      status: 'ok',
      nodes: nodeList.length,
      chunks: chunks.size,
      uptime: process.uptime(),
    });
    return;
  }

  // GET /nodes — list all registered nodes
  if (url.pathname === '/nodes' && req.method === 'GET') {
    const nodeList = Array.from(nodes.values()).map(({ ws, ...rest }) => rest);
    respondJSON(res, 200, { nodes: nodeList });
    return;
  }

  // POST /register — register a node
  if (url.pathname === '/register' && req.method === 'POST') {
    parseBody(req, (body) => {
      try {
        const info: NodeInfo = JSON.parse(body);
        info.lastSeen = Date.now();
        info.isRelay = false;
        nodes.set(info.nodeId, { ...info });
        console.log(`[Relay] Node registered: ${info.hostname} (${info.nodeId.slice(0, 8)})`);
        respondJSON(res, 200, { success: true, nodeId: info.nodeId });

        // Notify other nodes
        broadcast({ type: 'NODE_JOINED', info } as RelayMessage, info.nodeId);
      } catch (err: any) {
        respondJSON(res, 400, { error: err.message });
      }
    });
    return;
  }

  // POST /deregister — remove a node
  if (url.pathname === '/deregister' && req.method === 'POST') {
    parseBody(req, (body) => {
      try {
        const { nodeId } = JSON.parse(body);
        nodes.delete(nodeId);
        console.log(`[Relay] Node deregistered: ${nodeId.slice(0, 8)}`);
        respondJSON(res, 200, { success: true });

        broadcast({ type: 'NODE_LEFT', nodeId } as RelayMessage);
      } catch (err: any) {
        respondJSON(res, 400, { error: err.message });
      }
    });
    return;
  }

  // POST /heartbeat — node heartbeat
  if (url.pathname === '/heartbeat' && req.method === 'POST') {
    parseBody(req, (body) => {
      try {
        const { nodeId } = JSON.parse(body);
        const node = nodes.get(nodeId);
        if (node) {
          node.lastSeen = Date.now();
          node.status = 'online';
        }
        respondJSON(res, 200, { success: true });
      } catch (err: any) {
        respondJSON(res, 400, { error: err.message });
      }
    });
    return;
  }

  // POST /chunk/:chunkId — store a chunk (for mobile nodes)
  if (url.pathname.startsWith('/chunk/') && req.method === 'POST') {
    const chunkId = url.pathname.split('/')[2];
    parseBody(req, (body) => {
      try {
        const { data, metadata, nodeId } = JSON.parse(body);
        chunks.set(chunkId, {
          chunkId,
          data,
          metadata,
          storedAt: Date.now(),
        });
        console.log(`[Relay] Chunk stored: ${chunkId.slice(0, 8)} (${data.length} bytes base64)`);
        respondJSON(res, 200, { success: true, chunkId });
      } catch (err: any) {
        respondJSON(res, 400, { error: err.message });
      }
    });
    return;
  }

  // GET /chunk/:chunkId — fetch a chunk
  if (url.pathname.startsWith('/chunk/') && req.method === 'GET') {
    const chunkId = url.pathname.split('/')[2];
    const chunk = chunks.get(chunkId);
    if (chunk) {
      respondJSON(res, 200, { chunkId, data: chunk.data, metadata: chunk.metadata });
    } else {
      respondJSON(res, 404, { error: 'Chunk not found' });
    }
    return;
  }

  // 404
  respondJSON(res, 404, { error: 'Not found' });
});

// --- WebSocket Upgrade (for real-time updates) ---

// We'll use a simple polling approach for the mobile PWA instead of WebSocket
// to keep the relay simple. Mobile clients poll /nodes every few seconds.

// --- Helpers ---

function respondJSON(res: http.ServerResponse, status: number, data: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req: http.IncomingMessage, callback: (body: string) => void): void {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    callback(body);
  });
}

function broadcast(message: RelayMessage, excludeNodeId?: string): void {
  // For now, broadcasting is done via polling.
  // Nodes will see new/removed nodes on their next /nodes poll.
  const nodeList = Array.from(nodes.values())
    .filter(n => n.nodeId !== excludeNodeId)
    .map(({ ws, ...rest }) => rest);

  console.log(`[Relay] Broadcast: ${message.type} to ${nodeList.length} nodes`);
}

// --- Cleanup stale nodes ---

setInterval(() => {
  const now = Date.now();
  for (const [nodeId, node] of nodes) {
    if (now - node.lastSeen > HEARTBEAT_TIMEOUT) {
      console.log(`[Relay] Node timed out: ${node.hostname} (${nodeId.slice(0, 8)})`);
      nodes.delete(nodeId);
      broadcast({ type: 'NODE_LEFT', nodeId } as RelayMessage);
    }
  }

  // Clean up old chunks (older than 1 hour)
  for (const [chunkId, chunk] of chunks) {
    if (now - chunk.storedAt > 3600000) {
      chunks.delete(chunkId);
    }
  }
}, 30000);

// --- Start ---

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ⬡ FreeGrid Relay Server`);
  console.log(`  ──────────────────────`);
  console.log(`  Port:     ${PORT}`);
  console.log(`  Status:   http://localhost:${PORT}/status`);
  console.log(`  Nodes:    http://localhost:${PORT}/nodes`);
  console.log(`\n  Waiting for nodes to connect...\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Relay] Shutting down...');
  server.close();
  process.exit(0);
});
