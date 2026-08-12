import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const SALT = 'oncloudshare-e2e-v1'

export function deriveKey(pin: string): Buffer {
  if (!pin) throw new Error('A room PIN is required for encryption')
  return scryptSync(pin, SALT, 32)
}

export function encryptChunk(key: Buffer, payload: Buffer): Buffer {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted])
}

export function decryptChunk(key: Buffer, payload: Buffer): Buffer {
  if (payload.length < 28) throw new Error('Encrypted chunk is truncated')
  const nonce = payload.subarray(0, 12)
  const tag = payload.subarray(12, 28)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()])
}
