import * as crypto from 'crypto';
import { DEFAULT_CHUNK_SIZE } from '../../shared/types';

export interface FileChunk {
  index: number;
  data: Buffer;
  size: number;
}

/**
 * Split a file buffer into chunks of the specified size.
 */
export function splitIntoChunks(
  fileData: Buffer,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): FileChunk[] {
  const chunks: FileChunk[] = [];
  const totalChunks = Math.ceil(fileData.length / chunkSize);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, fileData.length);
    const data = fileData.subarray(start, end);

    chunks.push({
      index: i,
      data,
      size: data.length,
    });
  }

  return chunks;
}

/**
 * Reassemble chunks back into the original file.
 * Chunks must be in order (sorted by index).
 */
export function reassembleChunks(chunks: FileChunk[]): Buffer {
  // Sort by index to ensure correct order
  const sorted = [...chunks].sort((a, b) => a.index - b.index);

  // Verify we have all chunks
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].index !== i) {
      throw new Error(
        `Missing chunk at index ${i}. Have chunks at indices: ${sorted.map(c => c.index).join(', ')}`
      );
    }
  }

  return Buffer.concat(sorted.map(c => c.data));
}

/**
 * Compute SHA-256 hash of a buffer, returned as hex string.
 */
export function computeHash(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Verify that a buffer matches an expected SHA-256 hash.
 */
export function verifyHash(data: Buffer, expectedHash: string): boolean {
  const actualHash = computeHash(data);
  return actualHash === expectedHash;
}
