import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, randomBytes } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { episodeArtworkPath } from '../../../shared/content/artwork.ts'
import {
  checkEpisodeArtwork,
  generateEpisodeArtwork,
  episodeArtworkCli,
  type EpisodeArtworkManifest,
} from '../../../tools/content/episode-artwork.ts'
import { catalog } from './fixtures.ts'

vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
}))

let root: string
const asOf = Date.parse('2026-09-18')
const digest = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex')
beforeEach(async () => {
  root = await fs.mkdtemp(resolve(tmpdir(), 'nurevolution-episode-artwork-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true })
})
async function fixture() {
  const content = catalog()
  content.episodes = content.episodes.slice(0, 1)
  const asset = content.assets.find(
    (a) => a.id === content.episodes[0]!.artworkAssetId,
  )!
  const bytes = await sharp({
    create: {
      width: 320,
      height: 180,
      channels: 4,
      background: { r: 80, g: 130, b: 190, alpha: 0.5 },
    },
  })
    .png()
    .withMetadata({ orientation: 6 })
    .toBuffer()
  Object.assign(asset, {
    relativePath: 'cover.png',
    byteLength: bytes.length,
    sha256: digest(bytes),
  })
  const uploads = resolve(root, 'uploads'),
    output = resolve(root, 'artwork'),
    manifest = resolve(root, 'manifest.json')
  await fs.mkdir(uploads)
  await fs.writeFile(resolve(uploads, asset.relativePath), bytes)
  const generate = () =>
    generateEpisodeArtwork(content, uploads, output, manifest, asOf)
  const check = () => checkEpisodeArtwork(content, output, manifest, asOf)
  const read = async () =>
    JSON.parse(await fs.readFile(manifest, 'utf8')) as EpisodeArtworkManifest
  const write = async (value: EpisodeArtworkManifest) => {
    await fs.writeFile(manifest, JSON.stringify(value))
  }
  return {
    content,
    asset,
    bytes,
    uploads,
    output,
    manifest,
    generate,
    check,
    read,
    write,
    file: () => resolve(output, basename(episodeArtworkPath(asset))),
  }
}

it('generates deterministic padded JPEGs from verified originals, stripping metadata/alpha and excluding unpublished artwork', async () => {
  const f = await fixture(),
    first = f.content.episodes[0]!
  f.content.episodes.push(
    { ...first, id: 'duplicate' },
    {
      ...first,
      id: 'draft',
      status: 'draft',
      publishedAt: null,
      artworkAssetId: 'private',
    },
    {
      ...first,
      id: 'future',
      publishedAt: '2099-01-01T00:00:00.000Z',
      artworkAssetId: 'private',
    },
  )
  f.content.assets.push({
    ...f.asset,
    id: 'private',
    sha256: 'a'.repeat(64),
    relativePath: 'unavailable.png',
  })
  const result = await f.generate()
  expect(result.images).toBe(1)
  expect(result.bytes).toBeLessThan(512 * 1024)
  const original = await fs.readFile(f.file()),
    manifest = await fs.readFile(f.manifest, 'utf8'),
    modified = (await fs.stat(f.file())).mtimeMs
  const info = await sharp(original).metadata()
  expect(info).toMatchObject({
    format: 'jpeg',
    width: 1400,
    height: 1400,
    space: 'srgb',
    hasAlpha: false,
  })
  expect(info.exif).toBeUndefined()
  const { data, info: raw } = await sharp(original)
    .raw()
    .toBuffer({ resolveWithObject: true })
  expect(raw.channels).toBe(3)
  // Orientation makes the original portrait; contain adds dark side padding.
  for (let c = 0; c < 3; c++)
    expect(
      Math.abs(data[(700 * 1400 + 10) * 3 + c]! - [16, 18, 22][c]!),
    ).toBeLessThanOrEqual(3)
  expect(await f.generate()).toEqual(result)
  expect(await fs.readFile(f.file())).toEqual(original)
  expect((await fs.stat(f.file())).mtimeMs).toBe(modified)
  expect(await fs.readFile(f.manifest, 'utf8')).toBe(manifest)
  expect(await f.check()).toEqual(result)
})

it('retains previously public URLs when artwork changes and rejects unadvertised extras', async () => {
  const f = await fixture()
  await f.generate()
  const oldPath = f.file(),
    oldBytes = await fs.readFile(oldPath)
  const replacement = await sharp(f.bytes).rotate().negate().png().toBuffer()
  Object.assign(f.asset, {
    sha256: digest(replacement),
    byteLength: replacement.length,
  })
  await fs.writeFile(resolve(f.uploads, 'cover.png'), replacement)
  await expect(f.check()).rejects.toThrow('cover published images')
  expect((await f.generate()).images).toBe(2)
  expect(await fs.readFile(oldPath)).toEqual(oldBytes)
  const manifest = await f.read()
  expect(manifest.images.filter((i) => i.retained)).toHaveLength(1)
  expect((await f.check()).images).toBe(2)
  const retained = manifest.images.find((i) => i.retained)!
  retained.retained = false
  await f.write(manifest)
  await expect(f.check()).rejects.toThrow('cover published images')
  retained.retained = true
  await f.write(manifest)
  await fs.writeFile(resolve(f.output, 'extra.jpg'), 'extra')
  await expect(f.check()).rejects.toThrow('do not match the manifest')
})

async function publicationFixture() {
  const f = await fixture()
  await f.generate()
  const original = await fs.readFile(f.file())
  const manifest = await fs.readFile(f.manifest)
  const modified = (await fs.stat(f.file())).mtimeMs
  for (const color of ['red', 'green']) {
    const bytes = await sharp({
      create: { width: 20, height: 20, channels: 3, background: color },
    })
      .png()
      .toBuffer()
    const asset = {
      ...f.asset,
      id: color,
      relativePath: color + '.png',
      sha256: digest(bytes),
      byteLength: bytes.length,
    }
    f.content.assets.push(asset)
    f.content.episodes.push({
      ...f.content.episodes[0]!,
      id: color,
      artworkAssetId: color,
    })
    await fs.writeFile(resolve(f.uploads, asset.relativePath), bytes)
  }
  return { ...f, original, originalManifest: manifest, modified }
}

it.each(['staging', 'second image', 'manifest', 'validation'])(
  'rolls back a %s failure without changing existing artwork and allows retry',
  async (failure) => {
    const f = await publicationFixture()
    if (failure === 'staging')
      vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(Error('Injected failure'))
    if (failure === 'second image') {
      const link = fs.link
      vi.spyOn(fs, 'link')
        .mockImplementationOnce(link)
        .mockRejectedValueOnce(Error('Injected failure'))
    }
    if (failure === 'manifest') {
      const rename = fs.rename
      vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
        if (target === f.manifest) throw Error('Injected failure')
        return rename(source, target)
      })
    }
    if (failure === 'validation') {
      const read = fs.readFile
      let failed = false
      vi.spyOn(fs, 'readFile').mockImplementation(
        (...args: Parameters<typeof fs.readFile>) => {
          if (
            !failed &&
            String(args[0]).startsWith(f.output + '/') &&
            args[0] !== f.file()
          ) {
            failed = true
            return Promise.reject(Error('Injected failure'))
          }
          return read(...args)
        },
      )
    }
    await expect(f.generate()).rejects.toThrow('Injected failure')
    vi.restoreAllMocks()
    expect(await fs.readdir(f.output)).toEqual([basename(f.file())])
    expect(await fs.readFile(f.manifest)).toEqual(f.originalManifest)
    expect(await fs.readFile(f.file())).toEqual(f.original)
    expect((await fs.stat(f.file())).mtimeMs).toBe(f.modified)
    expect((await f.generate()).images).toBe(3)
    expect((await f.check()).images).toBe(3)
    expect(await fs.readdir(root)).not.toContain('manifest.json.pending')
  },
)

it.each(['before', 'after', 'cleanup'])(
  'recovers after process exit %s the manifest commit',
  async (when) => {
    const f = await publicationFixture()
    const catalogPath = resolve(root, 'catalog.json')
    await fs.writeFile(catalogPath, JSON.stringify(f.content))
    const script = `
    import fs from 'node:fs/promises'
    import { syncBuiltinESMExports } from 'node:module'
    const [catalogPath, uploads, output, manifest, when, asOf] = process.argv.slice(1)
    const link = fs.link, rename = fs.rename, rm = fs.rm
    fs.link = async (...args) => {
      await link(...args)
      if (when === 'before') process.exit(73)
    }
    fs.rename = async (...args) => {
      await rename(...args)
      if (when === 'after' && args[1] === manifest) process.exit(73)
    }
    fs.rm = async (...args) => {
      if (when === 'cleanup' && String(args[0]).includes('.cleanup-')) process.exit(73)
      return rm(...args)
    }
    syncBuiltinESMExports()
    const { generateEpisodeArtwork } = await import(${JSON.stringify(new URL('../../../tools/content/episode-artwork.ts', import.meta.url).href)})
    await generateEpisodeArtwork(JSON.parse(await fs.readFile(catalogPath, 'utf8')), uploads, output, manifest, Number(asOf))
  `
    await expect(
      promisify(execFile)(process.execPath, [
        '--input-type=module',
        '-e',
        script,
        catalogPath,
        f.uploads,
        f.output,
        f.manifest,
        when,
        String(asOf),
      ]),
    ).rejects.toMatchObject({ code: 73 })
    expect((await fs.readdir(root)).includes('manifest.json.pending')).toBe(
      when !== 'cleanup',
    )
    expect((await f.generate()).images).toBe(3)
    expect((await f.check()).images).toBe(3)
    expect(await fs.readFile(f.file())).toEqual(f.original)
    expect((await fs.stat(f.file())).mtimeMs).toBe(f.modified)
    expect(await fs.readdir(root)).not.toContain('manifest.json.pending')
  },
)

it('fails before writing derivatives for missing, mismatched, corrupt, or oversized originals', async () => {
  const f = await fixture()
  for (const bytes of [
    Buffer.concat([f.bytes, Buffer.from('extra')]),
    Buffer.alloc(f.bytes.length),
  ]) {
    await fs.writeFile(resolve(f.uploads, 'cover.png'), bytes)
    await expect(f.generate()).rejects.toThrow('does not match the catalog')
    await expect(fs.stat(f.output)).rejects.toMatchObject({ code: 'ENOENT' })
  }
  const corrupt = Buffer.from('not an image')
  Object.assign(f.asset, {
    sha256: digest(corrupt),
    byteLength: corrupt.length,
  })
  await fs.writeFile(resolve(f.uploads, 'cover.png'), corrupt)
  await expect(f.generate()).rejects.toThrow()
  const noisy = await sharp(randomBytes(1400 * 1400 * 3), {
    raw: { width: 1400, height: 1400, channels: 3 },
  })
    .png()
    .toBuffer()
  Object.assign(f.asset, { sha256: digest(noisy), byteLength: noisy.length })
  await fs.writeFile(resolve(f.uploads, 'cover.png'), noisy)
  await expect(f.generate()).rejects.toThrow('exceeds')
  await expect(fs.stat(f.output)).rejects.toMatchObject({ code: 'ENOENT' })
  await fs.unlink(resolve(f.uploads, 'cover.png'))
  await expect(f.generate()).rejects.toMatchObject({ code: 'ENOENT' })
})

it('rejects corrupt artifacts, invalid manifest entries, and changed immutable output recipes', async () => {
  const f = await fixture()
  await f.generate()
  const original = await f.read(),
    bytes = await fs.readFile(f.file())
  for (const modified of [
    Buffer.concat([bytes, Buffer.from('extra')]),
    Buffer.alloc(bytes.length),
  ]) {
    await fs.writeFile(f.file(), modified)
    await expect(f.check()).rejects.toThrow('bytes do not match')
  }
  await fs.writeFile(f.file(), bytes)
  const wrongHash = structuredClone(original)
  wrongHash.images[0]!.sourceSha256 = 'f'.repeat(64)
  await f.write(wrongHash)
  await expect(f.check()).rejects.toThrow('path does not match')
  const duplicate = structuredClone(original)
  duplicate.images.push(duplicate.images[0]!)
  await f.write(duplicate)
  await expect(f.generate()).rejects.toThrow('sorted and unique')
  await f.write(original)
  for (const body of [
    await sharp(f.bytes).resize(1400, 1400).png().toBuffer(),
    await sharp(f.bytes).resize(96, 96).jpeg().toBuffer(),
    await sharp(f.bytes).resize(1400, 1400).jpeg().withMetadata().toBuffer(),
    Buffer.from('corrupt'),
  ]) {
    const altered = structuredClone(original)
    Object.assign(altered.images[0]!, {
      sha256: digest(body),
      byteLength: body.length,
    })
    await fs.writeFile(f.file(), body)
    await f.write(altered)
    await expect(f.check()).rejects.toThrow()
  }
  const altered = structuredClone(original)
  const otherRecipe = await sharp(bytes).jpeg({ quality: 50 }).toBuffer()
  Object.assign(altered.images[0]!, {
    sha256: digest(otherRecipe),
    byteLength: otherRecipe.length,
  })
  await fs.writeFile(f.file(), otherRecipe)
  await f.write(altered)
  await expect(f.generate()).rejects.toThrow('new recipe version')
  altered.images[0]!.path = '/episode-artwork/../escape.jpg'
  await f.write(altered)
  await expect(f.generate()).rejects.toThrow()
})

it('rejects symlink inputs, outputs, and manifests', async () => {
  const f = await fixture()
  await fs.symlink(f.uploads, f.output)
  await expect(f.generate()).rejects.toThrow('Symlink')
  await fs.unlink(f.output)
  await fs.rename(
    resolve(f.uploads, 'cover.png'),
    resolve(f.uploads, 'real.png'),
  )
  await fs.symlink('real.png', resolve(f.uploads, 'cover.png'))
  await expect(f.generate()).rejects.toThrow('Symlink')
  await fs.unlink(resolve(f.uploads, 'cover.png'))
  await fs.rename(
    resolve(f.uploads, 'real.png'),
    resolve(f.uploads, 'cover.png'),
  )
  await f.generate()
  await fs.rename(f.manifest, resolve(root, 'actual.json'))
  await fs.symlink('actual.json', f.manifest)
  await expect(f.check()).rejects.toThrow('Symlink')
})

it('checks committed artwork offline and requires an explicit valid CLI mode', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  expect(await episodeArtworkCli(['--check'])).toBe(0)
  expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
    valid: true,
    images: 55,
  })
  for (const args of [
    [],
    ['--write'],
    ['--check', '--write'],
    ['--check', '--uploads', root],
    ['--unknown'],
  ])
    await expect(episodeArtworkCli(args)).rejects.toThrow()
  await expect(
    episodeArtworkCli(['--write', '--uploads', root]),
  ).rejects.toMatchObject({ code: 'ENOENT' })
})
