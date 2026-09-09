import * as fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, relative, resolve, sep } from 'node:path'
import { assertNoSymlinks } from '../content/files.ts'
import { validateManifest, type MediaManifest } from './manifest.ts'
import type { Asset } from '../../shared/content/schema.ts'

export async function checkAsset(path: string, asset: Asset) {
  await assertNoSymlinks(path)
  const stat = await fs.stat(path)
  if (!stat.isFile() || stat.size !== asset.byteLength)
    throw new Error(`Asset size mismatch: ${asset.id}`)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  if (hash.digest('hex') !== asset.sha256)
    throw new Error(`Asset checksum mismatch: ${asset.id}`)
}

export function assetPath(root: string, asset: Asset) {
  return resolve(root, asset.sourceRoot, asset.relativePath)
}

export async function checkAssets(manifest: MediaManifest, root: string) {
  validateManifest(manifest)
  for (const { asset } of manifest.assets)
    await checkAsset(assetPath(root, asset), asset)
  return {
    files: manifest.assets.length,
    bytes: manifest.assets.reduce((n, e) => n + e.asset.byteLength, 0),
  }
}

export async function stageAssets(
  manifest: MediaManifest,
  roots: Record<'audio' | 'uploads', string>,
  destination: string,
) {
  validateManifest(manifest)
  destination = resolve(destination)
  for (const root of Object.values(roots)) {
    for (const [a, b] of [
      [root, destination],
      [destination, root],
    ]) {
      const path = relative(resolve(a!), resolve(b!))
      if (!path || (path !== '..' && !path.startsWith('..' + sep)))
        throw new Error('Source and destination overlap')
    }
  }
  await assertNoSymlinks(destination)
  // Finish the source audit before making any destination files.
  for (const { asset } of manifest.assets)
    await checkAsset(
      resolve(roots[asset.sourceRoot], asset.relativePath),
      asset,
    )
  await fs.mkdir(destination, { recursive: true })
  const staging = await fs.mkdtemp(resolve(destination, '.stage-'))
  let copied = 0
  try {
    for (const { asset } of manifest.assets) {
      const target = assetPath(destination, asset)
      await assertNoSymlinks(target)
      try {
        await fs.lstat(target)
        await checkAsset(target, asset)
        continue
      } catch (error) {
        if (!(
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ))
          throw error
      }
      const staged = resolve(staging, asset.id)
      await fs.copyFile(
        resolve(roots[asset.sourceRoot], asset.relativePath),
        staged,
        fs.constants.COPYFILE_EXCL,
      )
      await checkAsset(staged, asset)
      await fs.chmod(staged, 0o444)
      await fs.mkdir(dirname(target), { recursive: true })
      await assertNoSymlinks(target)
      // A hard link creates exclusively; concurrent uploads never overwrite bytes.
      await fs.link(staged, target)
      copied++
    }
    return { ...(await checkAssets(manifest, destination)), copied }
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
}
