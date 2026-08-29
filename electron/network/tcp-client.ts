import * as net from 'net';
import { ProtocolMessage, NodeInfo } from '../../shared/types';
import { sendMessage } from './tcp-server';

interface PendingRequest {
  resolve: (data: any) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Connect to a remote node's TCP server.
 */
export function connectToNode(
  host: string,
  port: number
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      console.log(`[TCP Client] Connected to ${host}:${port}`);
      resolve(socket);
    });

    socket.on('error', (err) => {
      console.error(`[TCP Client] Connection error to ${host}:${port}:`, err.message);
      reject(err);
    });

    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error(`Connection timeout to ${host}:${port}`));
    });
  });
}

/**
 * Send a chunk to a remote node for storage.
 * Returns the SHA-256 hash of the stored chunk.
 */
export async function sendChunkToNode(
  node: NodeInfo,
  chunkId: string,
  chunkData: Buffer,
  metadata: any
): Promise<string> {
  const socket = await connectToNode(node.ip, node.port);

  return new Promise((resolve, reject) => {
    try {
      // Send store request
      const request: ProtocolMessage = {
        type: 'STORE_REQUEST',
        chunkId,
        size: chunkData.length,
        metadata,
      };
      sendMessage(socket, request);

      // Wait for ACK, then send the binary data
      let ackReceived = false;

      const dataHandler = (data: Buffer) => {
        // Parse the response
        let buffer = Buffer.alloc(0);

        const processBuffer = () => {
          while (buffer.length >= 4) {
            const msgLen = buffer.readUInt32BE(0);
            if (buffer.length < 4 + msgLen) break;

            const msgData = buffer.subarray(4, 4 + msgLen);
            buffer = buffer.subarray(4 + msgLen);

            const msg: ProtocolMessage = JSON.parse(msgData.toString());

            if (msg.type === 'STORE_ACK' && !ackReceived) {
              ackReceived = true;
              console.log(`[TCP Client] ACK received for chunk ${chunkId}, sending data...`);

              // Send the binary chunk data
              socket.write(chunkData);

              // Wait for final ACK with hash
              return;
            }

            if (msg.type === 'STORE_ACK' && ackReceived) {
              // Final ACK with hash
              socket.removeListener('data', dataHandler);
              socket.end();
              resolve(msg.sha256);
              return;
            }
          }
        };

        buffer = Buffer.concat([buffer, data]);
        processBuffer();
      };

      socket.on('data', dataHandler);

      // Timeout
      setTimeout(() => {
        socket.removeListener('data', dataHandler);
        socket.destroy();
        reject(new Error(`Store timeout for chunk ${chunkId}`));
      }, 30000);

    } catch (err) {
      socket.destroy();
      reject(err);
    }
  });
}

/**
 * Fetch a chunk from a remote node.
 * Returns the chunk data as a Buffer.
 */
export async function fetchChunkFromNode(
  node: NodeInfo,
  chunkId: string
): Promise<Buffer> {
  const socket = await connectToNode(node.ip, node.port);

  return new Promise((resolve, reject) => {
    try {
      // Send fetch request
      const request: ProtocolMessage = { type: 'FETCH_REQUEST', chunkId };
      sendMessage(socket, request);

      let buffer = Buffer.alloc(0);

      const dataHandler = (data: Buffer) => {
        buffer = Buffer.concat([buffer, data]);

        while (buffer.length >= 4) {
          const msgLen = buffer.readUInt32BE(0);
          if (buffer.length < 4 + msgLen) break;

          const msgData = buffer.subarray(4, 4 + msgLen);
          buffer = buffer.subarray(4 + msgLen);

          const msg: ProtocolMessage = JSON.parse(msgData.toString());

          if (msg.type === 'FETCH_RESPONSE') {
            socket.removeListener('data', dataHandler);
            socket.end();
            resolve(Buffer.from(msg.data, 'base64'));
            return;
          }

          if (msg.type === 'FETCH_NACK') {
            socket.removeListener('data', dataHandler);
            socket.end();
            reject(new Error(msg.reason));
            return;
          }
        }
      };

      socket.on('data', dataHandler);

      setTimeout(() => {
        socket.removeListener('data', dataHandler);
        socket.destroy();
        reject(new Error(`Fetch timeout for chunk ${chunkId}`));
      }, 30000);

    } catch (err) {
      socket.destroy();
      reject(err);
    }
  });
}

/**
 * Send a heartbeat to a remote node.
 */
export async function sendHeartbeat(
  node: NodeInfo,
  ourNodeId: string
): Promise<boolean> {
  try {
    const socket = await connectToNode(node.ip, node.port);
    const request: ProtocolMessage = {
      type: 'HEARTBEAT',
      nodeId: ourNodeId,
      timestamp: Date.now(),
    };
    sendMessage(socket, request);
    socket.end();
    return true;
  } catch {
    return false;
  }
}
