import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ProtocolMessage, TCP_DEFAULT_PORT } from '../../shared/types';
import { computeHash } from '../storage/chunker';

const CHUNK_DIR = path.join(
  require('os').homedir(),
  '.title-tbd',
  'title-tbd-storage',
  'chunks'
);

let server: net.Server | null = null;

// Registry of connected worker sockets for sending inference requests
const workerSockets: Map<string, net.Socket> = new Map();

export function getWorkerSocket(nodeId: string): net.Socket | null {
  return workerSockets.get(nodeId) || null;
}

export function getAllWorkerSockets(): Map<string, net.Socket> {
  return workerSockets;
}

/**
 * Start the TCP server to accept chunk storage and fetch requests.
 */
export function startTcpServer(
  port: number = TCP_DEFAULT_PORT,
  onNodeConnected?: (address: string, port: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    server = net.createServer(handleConnection);

    server.on('error', (err) => {
      console.error('[TCP Server] Error:', err.message);
      reject(err);
    });

    server.listen(port, '0.0.0.0', () => {
      console.log(`[TCP Server] Listening on port ${port}`);
      resolve();
    });
  });
}

function handleConnection(socket: net.Socket): void {
  const clientAddress = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`[TCP Server] Connection from ${clientAddress}`);

  let buffer = Buffer.alloc(0);
  let messageLength = 0;

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    // Protocol: [4 bytes message length][JSON message][optional binary data]
    while (buffer.length >= 4) {
      if (messageLength === 0) {
        messageLength = buffer.readUInt32BE(0);
        buffer = buffer.subarray(4);
      }

      if (buffer.length < messageLength) {
        break; // Wait for more data
      }

      const messageData = buffer.subarray(0, messageLength);
      buffer = buffer.subarray(messageLength);
      messageLength = 0;

      try {
        const message: ProtocolMessage = JSON.parse(messageData.toString());
        handleMessage(socket, message);
      } catch (err) {
        console.error('[TCP Server] Failed to parse message:', err);
      }
    }
  });

  socket.on('close', () => {
    console.log(`[TCP Server] Connection closed: ${clientAddress}`);
  });

  socket.on('error', (err) => {
    console.error(`[TCP Server] Socket error from ${clientAddress}:`, err.message);
  });
}

async function handleMessage(socket: net.Socket, message: ProtocolMessage): Promise<void> {
  switch (message.type) {
    case 'STORE_REQUEST': {
      console.log(`[TCP Server] Store request for chunk ${message.chunkId}`);

      // Create directory for the file's chunks
      const fileChunksDir = path.join(CHUNK_DIR, message.metadata.fileId);
      if (!fs.existsSync(fileChunksDir)) {
        fs.mkdirSync(fileChunksDir, { recursive: true });
      }

      // Prepare to receive the chunk data
      const chunkFileName = `chunk_${String(message.metadata.chunkIndex).padStart(4, '0')}.enc`;
      const filePath = path.join(fileChunksDir, chunkFileName);

      // Send ACK to request the data
      const ack: ProtocolMessage = { type: 'STORE_ACK', chunkId: message.chunkId, sha256: '' };
      sendMessage(socket, ack);

      // Set up data receiver for the binary chunk
      let chunkBuffer = Buffer.alloc(0);
      let expectedSize = message.size;

      const dataHandler = (data: Buffer) => {
        chunkBuffer = Buffer.concat([chunkBuffer, data]);

        if (chunkBuffer.length >= expectedSize) {
          socket.removeListener('data', dataHandler);

          // Save to disk
          fs.writeFileSync(filePath, chunkBuffer.subarray(0, expectedSize));

          const hash = computeHash(chunkBuffer.subarray(0, expectedSize));
          console.log(`[TCP Server] Stored chunk ${message.chunkId} (${expectedSize} bytes, hash: ${hash.slice(0, 8)}...)`);

          // Send final ACK with hash
          const finalAck: ProtocolMessage = {
            type: 'STORE_ACK',
            chunkId: message.chunkId,
            sha256: hash,
          };
          sendMessage(socket, finalAck);
        }
      };

      socket.on('data', dataHandler);
      break;
    }

    case 'FETCH_REQUEST': {
      console.log(`[TCP Server] Fetch request for chunk ${message.chunkId}`);

      // Find the chunk file
      const chunkPath = findChunkFile(message.chunkId);
      if (!chunkPath) {
        const nack: ProtocolMessage = {
          type: 'FETCH_NACK',
          chunkId: message.chunkId,
          reason: 'Chunk not found',
        };
        sendMessage(socket, nack);
        return;
      }

      const chunkData = fs.readFileSync(chunkPath);
      const hash = computeHash(chunkData);

      // Send response with chunk data
      const response: ProtocolMessage = {
        type: 'FETCH_RESPONSE',
        chunkId: message.chunkId,
        data: chunkData.toString('base64'),
      };
      sendMessage(socket, response);

      console.log(`[TCP Server] Sent chunk ${message.chunkId} (${chunkData.length} bytes)`);
      break;
    }

    case 'HEARTBEAT': {
      const { getNetworkManager } = require('./manager');
      const response: ProtocolMessage = {
        type: 'HEARTBEAT',
        nodeId: getNetworkManager().getNodeId(),
        timestamp: Date.now(),
      };
      sendMessage(socket, response);
      break;
    }

    case 'WORKER_HELLO': {
      const workerNodeId = message.nodeId;
      console.log(`[TCP Server] Worker hello from ${message.hostname} (${workerNodeId.slice(0, 8)})`);
      console.log(`[TCP Server] Worker RAM: ${(message.totalRam / 1024 / 1024 / 1024).toFixed(1)} GB total, ${(message.freeRam / 1024 / 1024 / 1024).toFixed(1)} GB free`);

      // Store the worker socket for inference
      workerSockets.set(workerNodeId, socket);
      socket.on('close', () => {
        workerSockets.delete(workerNodeId);
        console.log(`[TCP Server] Worker ${message.hostname} socket closed`);
      });

      // Send welcome
      sendMessage(socket, {
        type: 'WORKER_WELCOME',
        message: `Connected to coordinator. Waiting for model assignment.`,
      } as any);

      // Register the worker in the network manager
      try {
        const { getNetworkManager } = require('./manager');
        const manager = getNetworkManager();
        manager.addNode({
          nodeId: workerNodeId,
          hostname: message.hostname,
          ip: message.ip,
          port: message.port,
          storageOffered: message.freeRam,
          storageUsed: 0,
          status: 'online',
          nodeType: 'desktop',
          isRelay: false,
          lastSeen: Date.now(),
        });
      } catch (err: any) {
        console.error(`[TCP Server] Failed to register worker:`, err.message);
      }

      // Notify renderer of new node
      try {
        const { getNetworkManager } = require('./manager');
        const nodes = getNetworkManager().getConnectedNodes();
        const { BrowserWindow } = require('electron');
        const windows = BrowserWindow.getAllWindows();
        windows.forEach((w: any) => w.webContents.send('nodes-updated', nodes));
      } catch {}

      // Auto-distribute layers when a worker connects
      try {
        const os = require('os');
        const { assignLayers, sendLayerAssignment, getPipelineState } = require('../ai/distributed');
        const { getNetworkManager } = require('./manager');
        const manager = getNetworkManager();
        const allNodes = manager.getConnectedNodes().filter((n: any) => n.nodeId !== manager.getNodeId());
        const freeRam = os.freemem();
        const workers = allNodes.map((n: any) => ({
          nodeId: n.nodeId,
          hostname: n.hostname,
          ip: n.ip,
          port: n.port,
          freeRam: n.storageOffered || 8 * 1024**3,
        }));

        if (workers.length > 0) {
          const modelName = 'gemma2:9b';
          console.log(`[TCP Server] Auto-distributing ${modelName}: coordinator free=${(freeRam/1024**3).toFixed(1)}GB, ${workers.length} worker(s)`);
          const assignments = assignLayers(modelName, freeRam, workers);
          for (const a of assignments) {
            if (a.nodeId === 'coordinator') continue;
            const ok = sendLayerAssignment(a.nodeId, a);
            console.log(`[TCP Server] Auto-assigned ${a.hostname}: L${a.layerStart}-${a.layerEnd} (sent: ${ok})`);
          }
          // Notify renderer of pipeline update
          const { BrowserWindow } = require('electron');
          const windows = BrowserWindow.getAllWindows();
          windows.forEach((w: any) => w.webContents.send('pipeline-updated', getPipelineState()));
        }
      } catch (err: any) {
        console.error(`[TCP Server] Auto-distribute failed:`, err.message);
      }

      break;
    }

    case 'HEARTBEAT_ACK': {
      try {
        const { getNetworkManager } = require('./manager');
        const manager = getNetworkManager();
        const nodes = manager.getConnectedNodes();
        const node = nodes.find((n: any) => n.nodeId === message.nodeId);
        if (node) {
          node.lastSeen = message.timestamp;
          node.status = 'online';
        }
      } catch {}
      break;
    }

    case 'INFER_RESPONSE': {
      const respTokens = (message as any).tokens || [];
      const respFull = (message as any).fullText || '';
      const respNode = (message as any).nodeId || 'unknown';
      console.log(`[TCP Server] Worker inference response from ${respNode.slice(0, 8)}: ${respTokens.length} tokens, ${respFull.length} chars`);
      try {
        const { onWorkerInferResponse } = require('../ai/distributed');
        onWorkerInferResponse(respTokens, respFull, respNode);
      } catch (err: any) {
        console.error(`[TCP Server] Failed to handle worker inference response:`, err.message);
      }
      break;
    }

    default:
      console.log(`[TCP Server] Unknown message type: ${(message as any).type}`);
  }
}

/**
 * Send a protocol message over a socket.
 */
export function sendMessage(socket: net.Socket, message: ProtocolMessage): void {
  const data = JSON.stringify(message);
  const buffer = Buffer.from(data);
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(buffer.length, 0);
  socket.write(Buffer.concat([lengthBuffer, buffer]));
}

/**
 * Find a chunk file by its chunk ID.
 * Searches through all files' chunks directories.
 */
function findChunkFile(chunkId: string): string | null {
  if (!fs.existsSync(CHUNK_DIR)) return null;

  // Search through all file directories
  const fileDirs = fs.readdirSync(CHUNK_DIR);
  for (const fileDir of fileDirs) {
    const chunksPath = path.join(CHUNK_DIR, fileDir);
    if (!fs.statSync(chunksPath).isDirectory()) continue;

    const chunkFiles = fs.readdirSync(chunksPath);
    for (const chunkFile of chunkFiles) {
      // For now, match by filename pattern (chunk_XXXX.enc)
      // In a real system, we'd have a chunkId → filePath index
      if (chunkFile.endsWith('.enc')) {
        return path.join(chunksPath, chunkFile);
      }
    }
  }

  return null;
}

/**
 * Stop the TCP server.
 */
export function stopTcpServer(): void {
  if (server) {
    server.close();
    server = null;
    console.log('[TCP Server] Stopped');
  }
}
