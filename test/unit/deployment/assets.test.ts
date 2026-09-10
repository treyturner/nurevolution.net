import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import {
  checkAsset,
  checkAssets,
  stageAssets,
} from '../../../tools/deploy/stage-assets.ts'
import { createManifest, sha256 } from '../../../tools/deploy/manifest.ts'
import { runnableCatalog } from '../content/fixtures.ts'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await fs.rm(dir, { recursive: true, force: true })
})
async function fixture() {
  const dir = await fs.mkdtemp(resolve(tmpdir(), 'nurevolution-assets-'))
  dirs.push(dir)
  const roots = {
    audio: resolve(dir, 'source/audio'),
    uploads: resolve(dir, 'source/uploads'),
  }
  const c = runnableCatalog()
  c.episodes = []
  c.assets = c.assets.filter((a) => a.kind === 'artwork').slice(0, 2)
  c.show.standardArtworkAssetId = c.assets[0]!.id
  c.show.itunesArtworkAssetId = c.assets[1]!.id
  for (const a of c.assets) {
    a.byteLength = 5
    a.sha256 = sha256('bytes')
    const file = resolve(roots[a.sourceRoot], a.relativePath)
    await fs.mkdir(resolve(file, '..'), { recursive: true })
    await fs.writeFile(file, 'bytes')
  }
  return {
    dir,
    roots,
    destination: resolve(dir, 'destination'),
    manifest: createManifest(c, 'a'.repeat(40), '2026-09-09T00:00:00.000Z'),
  }
}

it('stages verified bytes exclusively, resumes idempotently, and detects destination corruption', async () => {
  const f = await fixture()
  expect(await stageAssets(f.manifest, f.roots, f.destination)).toEqual({
    files: 2,
    bytes: 10,
    copied: 2,
  })
  expect((await stageAssets(f.manifest, f.roots, f.destination)).copied).toBe(0)
  expect((await fs.readdir(f.destination)).sort()).toEqual(['uploads'])
  const a = f.manifest.assets[0]!.asset,
    file = resolve(f.destination, a.sourceRoot, a.relativePath)
  await fs.chmod(file, 0o644)
  await fs.writeFile(file, 'WRONG')
  await expect(checkAssets(f.manifest, f.destination)).rejects.toThrow(
    'checksum',
  )
  await expect(stageAssets(f.manifest, f.roots, f.destination)).rejects.toThrow(
    'checksum',
  )
  expect(await fs.readFile(file, 'utf8')).toBe('WRONG')
  expect(
    (await fs.readdir(f.destination)).some((name) =>
      name.startsWith('.stage-'),
    ),
  ).toBe(false)
})

it('rejects changed/missing sources, symlinks, nonfiles, and overlapping roots without overwriting', async () => {
  const f = await fixture(),
    a = f.manifest.assets[0]!.asset
  const file = resolve(f.roots[a.sourceRoot], a.relativePath)
  await expect(
    stageAssets(f.manifest, f.roots, f.roots.uploads),
  ).rejects.toThrow('overlap')
  await expect(stageAssets(f.manifest, f.roots, f.dir)).rejects.toThrow(
    'overlap',
  )
  await fs.writeFile(file, 'truncated')
  await expect(stageAssets(f.manifest, f.roots, f.destination)).rejects.toThrow(
    'size',
  )
  await fs.unlink(file)
  await expect(
    stageAssets(f.manifest, f.roots, f.destination),
  ).rejects.toThrow()
  const outside = resolve(f.dir, 'outside')
  await fs.writeFile(outside, 'bytes')
  await fs.symlink(outside, file)
  await expect(checkAsset(file, a)).rejects.toThrow('Symlink')
  await expect(checkAsset(f.dir, a)).rejects.toThrow('size')
  await expect(fs.stat(f.destination)).rejects.toThrow()
})

it('stages and repairs readable media trees under umask 0077 without changing host parents', async () => {
  const f = await fixture()
  const stage = () =>
    promisify(execFile)(process.execPath, [
      '--input-type=module',
      '-e',
      'const {stageAssets}=await import(process.argv[1]); process.umask(0o077); await stageAssets(JSON.parse(process.argv[2]), JSON.parse(process.argv[3]), process.argv[4])',
      new URL('../../../tools/deploy/stage-assets.ts', import.meta.url).href,
      JSON.stringify(f.manifest),
      JSON.stringify(f.roots),
      f.destination,
    ])
  await fs.chmod(f.dir, 0o700)
  await stage()
  const directories = new Set([f.destination])
  for (const { asset } of f.manifest.assets) {
    const target = resolve(f.destination, asset.sourceRoot, asset.relativePath)
    for (
      let directory = dirname(target);
      directory !== f.destination;
      directory = dirname(directory)
    )
      directories.add(directory)
    expect((await fs.stat(target)).mode & 0o777).toBe(0o444)
    await fs.chmod(target, 0o600)
  }
  for (const directory of directories) {
    expect((await fs.stat(directory)).mode & 0o777).toBe(0o755)
    await fs.chmod(directory, 0o700)
  }
  await stage()
  for (const directory of directories)
    expect((await fs.stat(directory)).mode & 0o777).toBe(0o755)
  for (const { asset } of f.manifest.assets)
    expect(
      (
        await fs.stat(
          resolve(f.destination, asset.sourceRoot, asset.relativePath),
        )
      ).mode & 0o777,
    ).toBe(0o444)
  expect((await fs.stat(f.dir)).mode & 0o777).toBe(0o700)
  expect(await checkAssets(f.manifest, f.destination)).toEqual({
    files: 2,
    bytes: 10,
  })
})
