import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DiskFileAssembler,
  decodeChunkFrame,
  encodeChunkFrame,
} from './file-transfer'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('binary chunk frames', () => {
  it('round-trips a file id, index, and payload', () => {
    const payload = Buffer.from('chunk payload')
    const decoded = decodeChunkFrame(encodeChunkFrame('file-123', 42, payload))
    expect(decoded?.fileId).toBe('file-123')
    expect(decoded?.index).toBe(42)
    expect(decoded?.data.equals(payload)).toBe(true)
  })

  it('rejects non-OnCloudShare frames', () => {
    expect(decodeChunkFrame(Buffer.from('not a frame'))).toBeNull()
  })
})

describe('DiskFileAssembler', () => {
  it('writes sequentially, resumes, and finalizes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocs-transfer-test-'))
    tempDirs.push(dir)
    const assembler = new DiskFileAssembler(dir)
    const input = {
      fileId: 'resume-file',
      name: 'example.bin',
      size: 6,
      mimeType: 'application/octet-stream',
      totalChunks: 2,
      chunkSize: 3,
      from: 'peer',
      fromName: 'Peer',
    }

    assembler.start(input)
    assembler.addChunk(input.fileId, 0, Buffer.from('abc'))
    const resumed = assembler.start({ ...input, resume: true })
    expect(resumed.nextIndex).toBe(1)
    assembler.addChunk(input.fileId, 1, Buffer.from('def'))

    const finalized = assembler.finalizeInPlace(input.fileId)
    expect(finalized).not.toBeNull()
    expect(fs.readFileSync(finalized!.path, 'utf8')).toBe('abcdef')
  })
})
