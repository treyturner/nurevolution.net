import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { artworkThumbnailPath } from '../../../shared/content/artwork.ts'
import {
  checkThumbnails,
  generateThumbnails,
  thumbnailCli,
} from '../../../tools/content/thumbnails.ts'
import { catalog } from './fixtures.ts'

let root: string
const asOf = Date.parse('2026-09-12')
beforeEach(async () => {
  root = await fs.mkdtemp(resolve(tmpdir(), 'nurevolution-thumbnails-'))
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
    create: { width: 320, height: 180, channels: 3, background: '#478fa8' },
  })
    .png()
    .toBuffer()
  asset.relativePath = 'cover.png'
  asset.byteLength = bytes.length
  asset.sha256 = createHash('sha256').update(bytes).digest('hex')
  const uploads = resolve(root, 'uploads')
  const output = resolve(root, 'thumbnails')
  await fs.mkdir(uploads)
  await fs.writeFile(resolve(uploads, asset.relativePath), bytes)
  return {
    content,
    asset,
    uploads,
    output,
    bytes,
    file: resolve(output, basename(artworkThumbnailPath(asset))),
  }
}

it('generates small square WebP files from verified sources, deduplicates artwork, and omits draft/future artwork', async () => {
  const f = await fixture()
  const first = f.content.episodes[0]!
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
    relativePath: 'unavailable-private.png',
  })
  const result = await generateThumbnails(f.content, f.uploads, f.output, asOf)
  expect(result.images).toBe(1)
  expect(result.bytes).toBeLessThan(12 * 1024)
  expect(await sharp(f.file).metadata()).toMatchObject({
    format: 'webp',
    width: 96,
    height: 96,
  })
  const before = await fs.readFile(f.file)
  await generateThumbnails(f.content, f.uploads, f.output, asOf)
  expect(await fs.readFile(f.file)).toEqual(before)
  const modified = (await fs.stat(f.file)).mtimeMs
  expect(await checkThumbnails(f.content, f.output, asOf)).toEqual(result)
  expect((await fs.stat(f.file)).mtimeMs).toBe(modified)
})

it('fails before writing thumbnails when source length or hash differs from the catalog', async () => {
  const f = await fixture()
  for (const bytes of [
    Buffer.concat([f.bytes, Buffer.from('extra')]),
    Buffer.alloc(f.bytes.length),
  ]) {
    await fs.writeFile(resolve(f.uploads, f.asset.relativePath), bytes)
    await expect(
      generateThumbnails(f.content, f.uploads, f.output, asOf),
    ).rejects.toThrow('does not match the catalog')
    await expect(fs.stat(f.output)).rejects.toMatchObject({ code: 'ENOENT' })
  }
})

it('detects missing, obsolete, or unexpected thumbnails after authoring changes', async () => {
  const f = await fixture()
  await expect(checkThumbnails(f.content, f.output, asOf)).rejects.toThrow(
    'do not match',
  )
  await generateThumbnails(f.content, f.uploads, f.output, asOf)
  const changed = structuredClone(f.content)
  changed.assets.find((a) => a.id === f.asset.id)!.sha256 = 'b'.repeat(64)
  await expect(checkThumbnails(changed, f.output, asOf)).rejects.toThrow(
    'do not match',
  )
  await fs.writeFile(resolve(f.output, 'unexpected.webp'), 'extra')
  await expect(checkThumbnails(f.content, f.output, asOf)).rejects.toThrow(
    'do not match',
  )
})

it('rejects full-size images, incorrect formats, corrupt bodies, and excessive payloads', async () => {
  const f = await fixture()
  await generateThumbnails(f.content, f.uploads, f.output, asOf)
  const png = await sharp(f.bytes).resize(96, 96).png().toBuffer()
  const wrongSize = await sharp(f.bytes).resize(48, 48).webp().toBuffer()
  for (const bytes of [
    f.bytes,
    png,
    wrongSize,
    Buffer.from('corrupt'),
    Buffer.alloc(12 * 1024 + 1),
  ]) {
    await fs.writeFile(f.file, bytes)
    await expect(checkThumbnails(f.content, f.output, asOf)).rejects.toThrow()
  }
})

it('rejects symlink destinations and sources', async () => {
  const f = await fixture()
  await fs.symlink(f.uploads, f.output)
  await expect(
    generateThumbnails(f.content, f.uploads, f.output, asOf),
  ).rejects.toThrow('Symlink')
  await fs.unlink(f.output)
  await fs.rename(
    resolve(f.uploads, 'cover.png'),
    resolve(f.uploads, 'real.png'),
  )
  await fs.symlink('real.png', resolve(f.uploads, 'cover.png'))
  await expect(
    generateThumbnails(f.content, f.uploads, f.output, asOf),
  ).rejects.toThrow('Symlink')
})

it('checks the committed archive offline and requires explicit valid CLI modes', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  expect(await thumbnailCli(['--check'])).toBe(0)
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
    await expect(thumbnailCli(args)).rejects.toThrow()
  await expect(
    thumbnailCli(['--write', '--uploads', root]),
  ).rejects.toMatchObject({ code: 'ENOENT' })
})
