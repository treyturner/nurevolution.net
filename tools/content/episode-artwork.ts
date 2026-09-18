import { createHash, randomUUID } from 'node:crypto'
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
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

async function discardTransaction(pending: string) {
  // Move the journal out of the recovery path before non-atomic recursive
  // cleanup, so interruption during cleanup cannot leave a broken journal.
  const discarded = pending + '.cleanup-' + randomUUID()
  await rename(pending, discarded)
  await rm(discarded, { recursive: true })
}

// A prepared transaction lives beside the manifest, outside public artwork.
// Hard links publish complete images without replacing existing immutable files;
// the manifest rename commits the batch. The journal survives process exits.
async function recoverArtwork(output: string, manifestPath: string) {
  const pending = manifestPath + '.pending'
  await assertNoSymlinks(pending)
  let journal: string
  try {
    journal = await readFile(resolve(pending, 'journal.json'), 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      // A missing journal inside an existing transaction is not ours to erase.
      try {
        await lstat(pending)
      } catch (missing) {
        if (
          missing instanceof Error &&
          'code' in missing &&
          missing.code === 'ENOENT'
        )
          return
        throw missing
      }
    }
    throw error
  }
  await listFiles(pending) // Reject symlinks anywhere in the transaction.
  const { previous, next } = z
    .object({ previous: manifestSchema, next: manifestSchema })
    .strict()
    .parse(JSON.parse(journal))
  const current = await readManifest(manifestPath, true)
  if (JSON.stringify(current) === JSON.stringify(next)) {
    await checkFiles(output, next)
  } else {
    if (JSON.stringify(current) !== JSON.stringify(previous))
      throw Error(
        'Episode artwork manifest changed during publication; retain the pending transaction for inspection',
      )
    const oldPaths = new Set(previous.images.map((image) => image.path))
    for (const entry of next.images.filter(
      (image) => !oldPaths.has(image.path),
    )) {
      const target = resolve(output, basename(entry.path))
      await assertNoSymlinks(target)
      const staged = await lstat(resolve(pending, basename(entry.path)))
      try {
        const published = await lstat(target)
        if (published.ino !== staged.ino || published.dev !== staged.dev)
          throw Error(
            'Episode artwork file changed during publication; refusing to remove it',
          )
        await unlink(target)
      } catch (error) {
        if (!(
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ))
          throw error
      }
    }
    await checkFiles(output, previous)
  }
  await discardTransaction(pending)
}

export async function generateEpisodeArtwork(
  catalog: Catalog,
  uploads: string,
  output: string,
  manifestPath: string,
  asOf = Date.now(),
) {
  await assertNoSymlinks(output)
  await recoverArtwork(output, manifestPath)
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
  const manifest: EpisodeArtworkManifest = {
    version: 1,
    images: [...entries.values()].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
  }
  // Validate and encode every original before preparing a recoverable batch.
  await mkdir(dirname(manifestPath), { recursive: true })
  const staging = await mkdtemp(manifestPath + '.preparing-')
  const pending = manifestPath + '.pending'
  let prepared = false
  try {
    for (const [path, bytes] of generated)
      await writeFile(resolve(staging, basename(path)), bytes, { flag: 'wx' })
    await writeFile(
      resolve(staging, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      { flag: 'wx' },
    )
    await writeFile(
      resolve(staging, 'journal.json'),
      JSON.stringify({ previous, next: manifest }),
      { flag: 'wx' },
    )
    // Only a completely prepared directory may become a recoverable journal.
    await rename(staging, pending)
    prepared = true
    await mkdir(output, { recursive: true })
    for (const path of generated.keys()) {
      const destination = resolve(output, basename(path))
      await assertNoSymlinks(destination)
      await link(resolve(pending, basename(path)), destination)
    }
    const result = await checkEpisodeArtwork(
      catalog,
      output,
      resolve(pending, 'manifest.json'),
      asOf,
    )
    await rename(resolve(pending, 'manifest.json'), manifestPath)
    await discardTransaction(pending)
    return result
  } catch (error) {
    if (prepared) await recoverArtwork(output, manifestPath)
    throw error
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
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
