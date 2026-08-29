import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { FileManifest, ChunkMetadata, DEFAULT_CHUNK_SIZE } from '../../shared/types';
import { computeHash } from './chunker';
import { encryptToBuffer, decryptFromBuffer, deriveKey, generateSalt } from './encryptor';

/**
 * Get the storage directory path.
 * Creates it if it doesn't exist.
 */
function getStorageDir(dataDir: string): string {
  const storageDir = path.join(dataDir, 'title-tbd-storage');
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }
  return storageDir;
}

/**
 * Get the chunks directory for a specific file.
 */
function getFileChunksDir(dataDir: string, fileId: string): string {
  const dir = path.join(getStorageDir(dataDir), 'chunks', fileId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get the manifests directory.
 */
function getManifestsDir(dataDir: string): string {
  const dir = path.join(getStorageDir(dataDir), 'manifests');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Create a new FileManifest for a file being uploaded.
 */
export function createManifest(
  originalFilename: string,
  mimeType: string,
  totalSize: number,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): { manifest: FileManifest; fileId: string; salt: Buffer } {
  const fileId = uuidv4();
  const salt = generateSalt();
  const totalChunks = Math.ceil(totalSize / chunkSize);

  const manifest: FileManifest = {
    fileId,
    originalFilename,
    mimeType,
    totalSize,
    chunkSize,
    totalChunks,
    chunks: [],
    createdAt: new Date().toISOString(),
    encryptionSalt: salt.toString('base64'),
  };

  return { manifest, fileId, salt };
}

/**
 * Add chunk metadata to a manifest after storing the chunk.
 */
export function addChunkToManifest(
  manifest: FileManifest,
  chunkMetadata: ChunkMetadata
): void {
  manifest.chunks.push(chunkMetadata);
  // Sort by chunk index
  manifest.chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
}

/**
 * Save a manifest to disk.
 */
export function saveManifest(dataDir: string, manifest: FileManifest): void {
  const manifestsDir = getManifestsDir(dataDir);
  const filePath = path.join(manifestsDir, `${manifest.fileId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2));
}

/**
 * Load a manifest from disk by file ID.
 */
export function loadManifest(dataDir: string, fileId: string): FileManifest | null {
  const manifestsDir = getManifestsDir(dataDir);
  const filePath = path.join(manifestsDir, `${fileId}.json`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const data = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(data) as FileManifest;
}

/**
 * List all manifests (all files stored on this node or known to this node).
 */
export function listManifests(dataDir: string): FileManifest[] {
  const manifestsDir = getManifestsDir(dataDir);

  if (!fs.existsSync(manifestsDir)) {
    return [];
  }

  const files = fs.readdirSync(manifestsDir).filter(f => f.endsWith('.json'));

  return files.map(f => {
    const data = fs.readFileSync(path.join(manifestsDir, f), 'utf-8');
    return JSON.parse(data) as FileManifest;
  });
}

/**
 * Delete a manifest and its chunks from disk.
 */
export function deleteManifest(dataDir: string, fileId: string): boolean {
  const manifestsDir = getManifestsDir(dataDir);
  const manifestPath = path.join(manifestsDir, `${fileId}.json`);

  if (!fs.existsSync(manifestPath)) {
    return false;
  }

  // Delete manifest
  fs.unlinkSync(manifestPath);

  // Delete chunks
  const chunksDir = path.join(getStorageDir(dataDir), 'chunks', fileId);
  if (fs.existsSync(chunksDir)) {
    fs.rmSync(chunksDir, { recursive: true });
  }

  return true;
}

/**
 * Store a chunk to local disk (encrypted).
 * Returns the SHA-256 hash of the encrypted chunk.
 */
export function storeChunkLocally(
  dataDir: string,
  fileId: string,
  chunkIndex: number,
  encryptedData: Buffer,
  password: string
): { hash: string; filePath: string } {
  const chunksDir = getFileChunksDir(dataDir, fileId);
  const fileName = `chunk_${String(chunkIndex).padStart(4, '0')}.enc`;
  const filePath = path.join(chunksDir, fileName);

  fs.writeFileSync(filePath, encryptedData);
  const hash = computeHash(encryptedData);

  return { hash, filePath };
}

/**
 * Load a chunk from local disk and decrypt it.
 */
export function loadChunkLocally(
  dataDir: string,
  fileId: string,
  chunkIndex: number,
  password: string
): Buffer | null {
  const chunksDir = getFileChunksDir(dataDir, fileId);
  const fileName = `chunk_${String(chunkIndex).padStart(4, '0')}.enc`;
  const filePath = path.join(chunksDir, fileName);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const encryptedData = fs.readFileSync(filePath);
  const salt = Buffer.from(
    loadManifest(dataDir, fileId)?.encryptionSalt || '',
    'base64'
  );

  if (salt.length === 0) {
    throw new Error('No encryption salt found in manifest');
  }

  const key = deriveKey(password, salt);
  return decryptFromBuffer(encryptedData, key);
}

/**
 * Check how much storage is being used by chunks on this node.
 */
export function getStorageUsed(dataDir: string): number {
  const chunksBase = path.join(getStorageDir(dataDir), 'chunks');

  if (!fs.existsSync(chunksBase)) {
    return 0;
  }

  let totalBytes = 0;

  function walkDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else {
        const stat = fs.statSync(fullPath);
        totalBytes += stat.size;
      }
    }
  }

  walkDir(chunksBase);
  return totalBytes;
}
