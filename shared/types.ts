// ============================================================
// FreeGrid — Shared Types
// Used by both desktop (Electron) and mobile (PWA) clients
// ============================================================

// --- Node Info ---

export interface NodeInfo {
  nodeId: string;
  hostname: string;
  ip: string;
  port: number;
  storageOffered: number; // bytes offered to the network
  storageUsed: number; // bytes currently used for storing others' chunks
  status: 'online' | 'offline';
  nodeType: 'desktop' | 'mobile';
  isRelay: boolean;
  lastSeen: number; // timestamp
}

// --- File & Chunk Metadata ---

export interface ChunkMetadata {
  chunkId: string; // UUID
  fileId: string; // parent file ID
  chunkIndex: number; // position in original file (0, 1, 2...)
  totalChunks: number; // total chunks for this file
  originalSize: number; // size of this chunk before encryption
  encryptedSize: number; // size after encryption
  sha256: string; // SHA-256 hash of the encrypted chunk (for integrity)
  iv: string; // Base64-encoded AES initialization vector
  nodeId: string; // which node stores this chunk
}

export interface FileManifest {
  fileId: string;
  originalFilename: string;
  mimeType: string;
  totalSize: number; // original file size in bytes
  chunkSize: number; // chunk size used (default 1MB)
  totalChunks: number;
  chunks: ChunkMetadata[];
  createdAt: string; // ISO date string
  encryptionSalt: string; // PBKDF2 salt (Base64-encoded)
}

// --- Network Protocol Messages ---

export type ProtocolMessage =
  | { type: 'STORE_REQUEST'; chunkId: string; size: number; metadata: ChunkMetadata }
  | { type: 'STORE_ACK'; chunkId: string; sha256: string }
  | { type: 'STORE_NACK'; chunkId: string; reason: string }
  | { type: 'FETCH_REQUEST'; chunkId: string }
  | { type: 'FETCH_RESPONSE'; chunkId: string; data: string }
  | { type: 'FETCH_NACK'; chunkId: string; reason: string }
  | { type: 'NODE_ANNOUNCE'; info: NodeInfo }
  | { type: 'NODE_LEAVE'; nodeId: string }
  | { type: 'HEARTBEAT'; nodeId: string; timestamp: number }
  | { type: 'NODE_LIST'; nodes: NodeInfo[] }
  | { type: 'WORKER_HELLO'; nodeId: string; hostname: string; ip: string; port: number; totalRam: number; freeRam: number; cpuCount: number; cpuModel: string }
  | { type: 'WORKER_WELCOME'; message: string }
  | { type: 'WORKER_STATUS'; nodeId: string; freeRam: number; loadedLayers: string | null }
  | { type: 'ASSIGN_LAYERS'; model: string; layerRange: string; totalLayers: number }
  | { type: 'HEARTBEAT_ACK'; nodeId: string; timestamp: number; freeRam: number }
  | { type: 'INFER_REQUEST'; requestId: string; layerRange: string; data: string }
  | { type: 'INFER_RESPONSE'; requestId: string; nodeId: string; status: string; data: string; tokens?: string[]; fullText?: string; done?: boolean; error?: string; layerRange?: string };

// --- Worker Node Info (extended) ---

export interface WorkerNodeInfo extends NodeInfo {
  totalRam: number;
  freeRam: number;
  cpuCount: number;
  cpuModel: string;
  loadedLayers: string | null;
  assignedModel: string | null;
}

// --- Relay Server Messages (WebSocket) ---

export type RelayMessage =
  | { type: 'REGISTER'; info: NodeInfo }
  | { type: 'REGISTER_ACK'; nodeId: string }
  | { type: 'DEREGISTER'; nodeId: string }
  | { type: 'NODE_LIST'; nodes: NodeInfo[] }
  | { type: 'NODE_JOINED'; info: NodeInfo }
  | { type: 'NODE_LEFT'; nodeId: string }
  | { type: 'HEARTBEAT'; nodeId: string; timestamp: number }
  | { type: 'STORE_CHUNK'; chunkId: string; data: string; metadata: ChunkMetadata }
  | { type: 'STORE_CHUNK_ACK'; chunkId: string; sha256: string }
  | { type: 'FETCH_CHUNK'; chunkId: string }
  | { type: 'FETCH_CHUNK_RESPONSE'; chunkId: string; data: string }
  | { type: 'ERROR'; message: string };

// --- App State ---

export interface StorageStats {
  totalOffered: number; // total storage offered by this node
  totalUsed: number; // total storage used by this node
  filesStored: number; // number of files stored
  chunksStored: number; // number of chunks stored
}

export interface NetworkStats {
  connectedNodes: number;
  totalNetworkStorage: number; // sum of all nodes' offered storage
  totalNetworkUsed: number; // sum of all nodes' used storage
}

// --- Constants ---

export const DEFAULT_CHUNK_SIZE = 1024 * 1024; // 1MB
export const HEARTBEAT_INTERVAL = 30000; // 30 seconds
export const NODE_TIMEOUT = 90000; // 3x heartbeat = 90 seconds
export const RELAY_DEFAULT_PORT = 9500;
export const TCP_DEFAULT_PORT = 9501;
export const MDNS_SERVICE_TYPE = '_freegrid._tcp';
