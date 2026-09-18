import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import sharp from 'sharp'
import { z } from 'zod'
import type { Catalog } from '../../shared/content/schema.ts'
import {
  episodeArtworkPath,
  episodeArtworkSize,
  episodeArtworkMaxBytes,
} from '../../shared/content/artwork.ts'
import { selectPublic } from '../../shared/content/public.ts'
import { readCatalog } from '../../server/content/repository.ts'
import { assertNoSymlinks, fileReader, listFiles } from './files.ts'
import { isMain, runCli } from './cli.ts'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const manifestSchema = z
  .object({
    version: z.literal(1),
    images: z.array(
      z
        .object({
          path: z
            .string()
            .regex(/^\/episode-artwork\/v[1-9][0-9]*-[a-f0-9]{64}\.jpg$/),
          sourceSha256: hash,
          sha256: hash,
          width: z.literal(episodeArtworkSize),
          height: z.literal(episodeArtworkSize),
          byteLength: z.number().int().positive().max(episodeArtworkMaxBytes),
          retained: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict()
export type EpisodeArtworkManifest = z.infer<typeof manifestSchema>

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
const digest = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex')

async function readManifest(
  path: string,
  optional = false,
): Promise<EpisodeArtworkManifest> {
  await assertNoSymlinks(path)
  try {
    return manifestSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    if (
      optional &&
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return { version: 1, images: [] }
    throw error
  }
}

async function checkFiles(output: string, manifest: EpisodeArtworkManifest) {
  const paths = manifest.images.map((image) => image.path)
  if (
    new Set(paths).size !== paths.length ||
    JSON.stringify(paths) !== JSON.stringify([...paths].sort())
  )
    throw Error('Episode artwork manifest must be sorted and unique')
  if (
    JSON.stringify(await listFiles(output)) !==
    JSON.stringify(paths.map((path) => basename(path)))
  )
    throw Error('Episode artwork files do not match the manifest')
  let totalBytes = 0
  for (const entry of manifest.images) {
    if (!entry.path.endsWith(`-${entry.sourceSha256}.jpg`))
      throw Error('Episode artwork path does not match its source hash')
    const bytes = await readFile(resolve(output, basename(entry.path)))
    if (bytes.length !== entry.byteLength || digest(bytes) !== entry.sha256)
      throw Error(
        `${entry.path}: episode artwork bytes do not match the manifest`,
      )
    const image = sharp(bytes, { limitInputPixels: episodeArtworkSize ** 2 })
    const info = await image.metadata()
    if (
      info.format !== 'jpeg' ||
      info.width !== episodeArtworkSize ||
      info.height !== episodeArtworkSize ||
      info.space !== 'srgb' ||
      info.hasAlpha ||
      (info.pages ?? 1) !== 1 ||
      info.exif ||
      info.icc ||
      info.iptc ||
      info.xmp
    )
      throw Error(
        `${entry.path}: expected a static metadata-free sRGB ${episodeArtworkSize}px square JPEG`,
      )
    await image.raw().toBuffer()
    totalBytes += bytes.length
  }
  return { images: paths.length, bytes: totalBytes }
}

export async function checkEpisodeArtwork(
  catalog: Catalog,
  output: string,
  manifestPath: string,
  asOf = Date.now(),
) {
  const manifest = await readManifest(manifestPath)
  const current = new Set(publicArtwork(catalog, asOf).map(episodeArtworkPath))
  const active = manifest.images
    .filter((entry) => !entry.retained)
    .map((entry) => entry.path)
  if (
    JSON.stringify([...current].sort()) !== JSON.stringify(active) ||
    manifest.images.some((entry) => entry.retained && current.has(entry.path))
  )
    throw Error(
      'Episode artwork must cover published images exactly; mark only previously published obsolete images as retained',
    )
  return checkFiles(output, manifest)
}

export async function generateEpisodeArtwork(
  catalog: Catalog,
  uploads: string,
  output: string,
  manifestPath: string,
  asOf = Date.now(),
) {
  await assertNoSymlinks(output)
  const previous = await readManifest(manifestPath, true)
  await checkFiles(output, previous)
  const entries = new Map(
    previous.images.map((entry) => [entry.path, { ...entry, retained: true }]),
  )
  const generated = new Map<string, Buffer>()
  const background = '#101216'
  for (const asset of publicArtwork(catalog, asOf)) {
    const source = resolve(uploads, asset.relativePath)
    await assertNoSymlinks(source)
    const bytes = await readFile(source)
    if (bytes.length !== asset.byteLength || digest(bytes) !== asset.sha256)
      throw Error(`${asset.id}: source artwork does not match the catalog`)
    const image = await sharp(bytes)
      .rotate()
      .toColourspace('srgb')
      .flatten({ background })
      .resize(episodeArtworkSize, episodeArtworkSize, {
        fit: 'contain',
        background,
      })
      .jpeg({ quality: 82 })
      .toBuffer()
    if (image.length > episodeArtworkMaxBytes)
      throw Error(
        `${asset.id}: episode artwork exceeds ${episodeArtworkMaxBytes} bytes`,
      )
    const path = episodeArtworkPath(asset)
    const sha256 = digest(image)
    const old = entries.get(path)
    if (old && old.sha256 !== sha256)
      throw Error(
        `${path}: changing immutable artwork requires a new recipe version`,
      )
    entries.set(path, {
      path,
      sourceSha256: asset.sha256,
      sha256,
      width: episodeArtworkSize,
      height: episodeArtworkSize,
      byteLength: image.length,
      retained: false,
    })
    if (!old) generated.set(path, image)
  }
  // Validate and encode every original before writing any new public artifacts.
  await mkdir(output, { recursive: true })
  await mkdir(dirname(manifestPath), { recursive: true })
  for (const [path, bytes] of generated) {
    const destination = resolve(output, basename(path))
    await assertNoSymlinks(destination)
    await writeFile(destination, bytes, { flag: 'wx' })
  }
  const manifest: EpisodeArtworkManifest = {
    version: 1,
    images: [...entries.values()].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  return checkEpisodeArtwork(catalog, output, manifestPath, asOf)
}

export async function episodeArtworkCli(args: string[]) {
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
    throw Error(
      'Use --check, or --write --uploads <verified uploads directory>',
    )
  const { catalog } = await readCatalog(
    fileReader(resolve('content')),
    Date.now(),
  )
  const output = resolve('public/episode-artwork')
  const manifest = resolve('tools/content/episode-artwork-manifest.json')
  const result = values.write
    ? await generateEpisodeArtwork(
        catalog,
        resolve(values.uploads!),
        output,
        manifest,
      )
    : await checkEpisodeArtwork(catalog, output, manifest)
  console.log(JSON.stringify({ valid: true, ...result }))
  return 0
}
if (isMain(import.meta.url))
  process.exitCode = await runCli(
    () => episodeArtworkCli(process.argv.slice(2)),
    console.error,
  )
