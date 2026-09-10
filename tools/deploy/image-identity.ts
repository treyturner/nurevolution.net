import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { Execute } from './host.ts'
import { sha256 } from './manifest.ts'

const savedImage = z
  .array(
    z.object({
      Config: z
        .string()
        .regex(/^(?:[a-f0-9]{64}\.json|blobs\/sha256\/[a-f0-9]{64})$/),
    }),
  )
  .length(1)

// Both Docker archive formats contain the original configuration bytes. Hash
// those bytes, not image inspect's Id (a config OR manifest digest by backend).
export async function archiveConfigDigest(archive: string, run: Execute) {
  const [image] = savedImage.parse(
    JSON.parse(await run('tar', ['-xOf', archive, '--', 'manifest.json'])),
  )
  const bytes = await run(
    'tar',
    ['-xOf', archive, '--', image!.Config],
    undefined,
    300_000,
    false,
  )
  const config = JSON.parse(bytes) as { os?: string; architecture?: string }
  if (config.os !== 'linux' || config.architecture !== 'amd64')
    throw new Error('Expected a linux/amd64 image configuration')
  const digest = sha256(bytes)
  if (!image!.Config.includes(digest))
    throw new Error('Image configuration filename/checksum mismatch')
  return 'sha256:' + digest
}

export async function imageConfigDigest(image: string, run: Execute) {
  const directory = await fs.mkdtemp(resolve(tmpdir(), 'nurevolution-image-'))
  try {
    const archive = resolve(directory, 'image.tar')
    // The CLI streams the archive to disk, including with a remote daemon.
    // Only the small manifest/configuration enters Node's bounded output buffer.
    await run('docker', [
      'image',
      'save',
      '--platform',
      'linux/amd64',
      '--output',
      archive,
      image,
    ])
    return await archiveConfigDigest(archive, run)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}
