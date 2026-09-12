import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import sharp from 'sharp'
import type { Catalog } from '../../shared/content/schema.ts'
import {
  artworkThumbnailPath,
  thumbnailSize,
} from '../../shared/content/artwork.ts'
import { selectPublic } from '../../shared/content/public.ts'
import { readCatalog } from '../../server/content/repository.ts'
import { assertNoSymlinks, fileReader, listFiles } from './files.ts'
import { isMain, runCli } from './cli.ts'

const maxThumbnailBytes = 12 * 1024
function publicArtwork(catalog: Catalog, asOf: number) {
  const ids = new Set(
    selectPublic(catalog, asOf).map((episode) => episode.artworkAssetId),
  )
  return [
    ...new Map(
      catalog.assets
        .filter((asset) => ids.has(asset.id))
        .map((asset) => [asset.sha256, asset]),
    ).values(),
  ]
}

export async function checkThumbnails(
  catalog: Catalog,
  output: string,
  asOf = Date.now(),
) {
  const expected = publicArtwork(catalog, asOf)
    .map((asset) => basename(artworkThumbnailPath(asset)))
    .sort()
  const actual = await listFiles(output)
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      'Thumbnail files do not match published artwork; regenerate missing images and remove obsolete thumbnails',
    )
  let totalBytes = 0
  for (const name of expected) {
    const bytes = await readFile(resolve(output, name))
    if (bytes.length > maxThumbnailBytes)
      throw new Error(`${name}: thumbnail exceeds ${maxThumbnailBytes} bytes`)
    const image = sharp(bytes, { limitInputPixels: thumbnailSize ** 2 })
    const metadata = await image.metadata()
    if (
      metadata.format !== 'webp' ||
      metadata.width !== thumbnailSize ||
      metadata.height !== thumbnailSize ||
      (metadata.pages ?? 1) !== 1
    )
      throw new Error(
        `${name}: expected a static ${thumbnailSize}px square WebP thumbnail`,
      )
    await image.raw().toBuffer()
    totalBytes += bytes.length
  }
  return { images: expected.length, bytes: totalBytes }
}

export async function generateThumbnails(
  catalog: Catalog,
  uploads: string,
  output: string,
  asOf = Date.now(),
) {
  await assertNoSymlinks(output)
  const images = new Map<string, Buffer>()
  for (const asset of publicArtwork(catalog, asOf)) {
    const source = resolve(uploads, asset.relativePath)
    await assertNoSymlinks(source)
    const bytes = await readFile(source)
    if (
      bytes.length !== asset.byteLength ||
      createHash('sha256').update(bytes).digest('hex') !== asset.sha256
    )
      throw new Error(`${asset.id}: source artwork does not match the catalog`)
    const thumbnail = await sharp(bytes)
      .rotate()
      .resize(thumbnailSize, thumbnailSize, { fit: 'cover' })
      .webp({ quality: 72, effort: 6 })
      .toBuffer()
    if (thumbnail.length > maxThumbnailBytes)
      throw new Error(
        `${asset.id}: generated thumbnail exceeds the byte budget`,
      )
    images.set(basename(artworkThumbnailPath(asset)), thumbnail)
  }
  await mkdir(output, { recursive: true })
  for (const [name, bytes] of images) {
    const destination = resolve(output, name)
    await assertNoSymlinks(destination)
    await writeFile(destination, bytes)
  }
  return checkThumbnails(catalog, output, asOf)
}

export async function thumbnailCli(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      write: { type: 'boolean' },
      check: { type: 'boolean' },
      uploads: { type: 'string' },
    },
  })
  if (
    Boolean(values.write) === Boolean(values.check) ||
    (values.write && !values.uploads) ||
    (values.check && values.uploads)
  )
    throw new Error(
      'Use --check, or --write --uploads <verified uploads directory>',
    )
  const { catalog } = await readCatalog(
    fileReader(resolve('content')),
    Date.now(),
  )
  const output = resolve('public/artwork-thumbnails')
  const result = values.write
    ? await generateThumbnails(catalog, resolve(values.uploads!), output)
    : await checkThumbnails(catalog, output)
  console.log(JSON.stringify({ valid: true, ...result }))
  return 0
}

if (isMain(import.meta.url))
  process.exitCode = await runCli(
    () => thumbnailCli(process.argv.slice(2)),
    console.error,
  )
