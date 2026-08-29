import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 96 bits for GCM
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;

export interface EncryptedChunk {
  encryptedData: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

/**
 * Derive an AES-256 key from a password using PBKDF2.
 */
export function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512');
}

/**
 * Generate a random salt for PBKDF2 key derivation.
 */
export function generateSalt(): Buffer {
  return crypto.randomBytes(SALT_LENGTH);
}

/**
 * Generate a random initialization vector.
 */
export function generateIV(): Buffer {
  return crypto.randomBytes(IV_LENGTH);
}

/**
 * Encrypt a buffer using AES-256-GCM.
 * Returns the encrypted data, IV, and auth tag.
 */
export function encrypt(data: Buffer, key: Buffer): EncryptedChunk {
  const iv = generateIV();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedData: encrypted,
    iv,
    authTag,
  };
}

/**
 * Decrypt a buffer using AES-256-GCM.
 * Requires the same IV and auth tag used during encryption.
 */
export function decrypt(
  encryptedData: Buffer,
  key: Buffer,
  iv: Buffer,
  authTag: Buffer
): Buffer {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  return decrypted;
}

/**
 * Convenience: encrypt and return everything needed to decrypt later.
 * Returns a single buffer containing: [iv (16 bytes)][authTag (16 bytes)][encrypted data]
 */
export function encryptToBuffer(data: Buffer, key: Buffer): Buffer {
  const { encryptedData, iv, authTag } = encrypt(data, key);

  // Pack: iv + authTag + encryptedData
  const result = Buffer.alloc(iv.length + authTag.length + encryptedData.length);
  iv.copy(result, 0);
  authTag.copy(result, iv.length);
  encryptedData.copy(result, iv.length + authTag.length);

  return result;
}

/**
 * Convenience: decrypt from a packed buffer created by encryptToBuffer.
 */
export function decryptFromBuffer(packedData: Buffer, key: Buffer): Buffer {
  const iv = packedData.subarray(0, IV_LENGTH);
  const authTag = packedData.subarray(IV_LENGTH, IV_LENGTH + 16);
  const encryptedData = packedData.subarray(IV_LENGTH + 16);

  return decrypt(encryptedData, key, iv, authTag);
}

/**
 * Get the IV from a packed encrypted buffer (first 16 bytes).
 */
export function getIVFromBuffer(packedData: Buffer): Buffer {
  return packedData.subarray(0, IV_LENGTH);
}
