import { createHash } from 'node:crypto'
import { constants, type BigIntStats } from 'node:fs'
import { open, readdir, realpath, readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import type { Asset, Catalog } from '../../shared/content/schema.ts'
import { selectPublic } from '../../shared/content/public.ts'
import { episodeArtworkPath } from '../../shared/content/artwork.ts'
import { byteRange } from '../http/byte-range.ts'
import type { VirtualResponse } from '../playback/response.ts'
import { attachment } from '../downloads/filename.ts'

const excluded = new Set([
  '.git',
  '.agents',
  '.aws',
  '.codex',
  'node_modules',
  '.nuxt',
  '.output',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  'coverage',
  'test-results',
  'playwright-report',
])
const signature = (stat: BigIntStats) =>
  [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')

/** Dev-only lookup: Git's tracked/ignored state does not affect local media. */
export function createWorktreeMedia(
  root: string,
  catalog: () => Promise<Catalog>,
  now = Date.now,
) {
  root = resolve(root)
  let indexedAt = -Infinity
  let indexed: Map<string, string[]> | undefined
  const verified = new Map<string, { key: string; at: number }>()
  async function sources(name: string) {
    if (!indexed || now() - indexedAt >= 1000) {
      const next = new Map<string, string[]>()
      async function walk(directory: string) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const path = resolve(directory, entry.name)
          if (entry.isDirectory() && !excluded.has(entry.name)) await walk(path)
          else if (entry.isFile())
            next.set(entry.name, [...(next.get(entry.name) ?? []), path])
        }
      }
      await walk(root)
      indexed = next
      indexedAt = now()
    }
    return indexed.get(name) ?? []
  }
  async function checked(path: string, size: number, hash: string) {
    // Ignore links, including linked parent directories, even for known filenames.
    if (!path.startsWith(root + '/') || (await realpath(path)) !== path) return
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    let retained = false
    try {
      const stat = await file.stat({ bigint: true })
      if (!stat.isFile() || stat.size !== BigInt(size)) return
      const key = signature(stat) + ':' + hash
      const cached = verified.get(path)
      // Worktrees on coarse-timestamp filesystems still notice same-size edits.
      if (cached?.key !== key || now() - cached.at >= 1000) {
        const digest = createHash('sha256')
        for await (const chunk of file.createReadStream({
          autoClose: false,
          start: 0,
        }))
          digest.update(chunk)
        if (
          digest.digest('hex') !== hash ||
          signature(await file.stat({ bigint: true })) !== signature(stat)
        )
          return
        verified.set(path, { key, at: now() })
      }
      retained = true
      return file
    } finally {
      if (!retained) await file.close()
    }
  }
  async function original(asset: Asset) {
    for (const path of await sources(basename(asset.relativePath))) {
      const file = await checked(path, asset.byteLength, asset.sha256)
      if (file)
        return { file, mediaType: asset.mediaType, sha256: asset.sha256 }
    }
    if (asset.kind === 'artwork') {
      // Committed feed artwork also makes older covers available without originals.
      const manifest = JSON.parse(
        await readFile(
          resolve(root, 'tools/content/episode-artwork-manifest.json'),
          'utf8',
        ),
      ) as {
        images: {
          sourceSha256: string
          path: string
          byteLength: number
          sha256: string
        }[]
      }
      const image = manifest.images.find(
        (image) =>
          image.sourceSha256 === asset.sha256 &&
          image.path === episodeArtworkPath(asset),
      )
      if (image) {
        const path = resolve(root, 'public' + image.path)
        const file = await checked(path, image.byteLength, image.sha256)
        if (file) return { file, mediaType: 'image/jpeg', sha256: image.sha256 }
      }
    }
  }
  return async (
    pathname: string,
    request: Request,
  ): Promise<VirtualResponse> => {
    const empty = (
      status: number,
      extra: Record<string, string> = {},
    ): VirtualResponse => ({
      status,
      headers: { 'cache-control': 'no-store', 'content-length': '0', ...extra },
    })
    if (!['GET', 'HEAD'].includes(request.method))
      return empty(405, { allow: 'GET, HEAD' })
    let file: Awaited<ReturnType<typeof open>> | undefined
    try {
      const current = await catalog()
      const episodes = selectPublic(current, now())
      const downloadSlug = /^\/downloads\/([a-z0-9-]+)$/.exec(pathname)?.[1]
      const downloadAudio = downloadSlug
        ? episodes.find((episode) => episode.slug === downloadSlug)
            ?.audioAssetId
        : undefined
      const ids = new Set([
        current.show.standardArtworkAssetId,
        current.show.itunesArtworkAssetId,
        ...episodes.flatMap((episode) => [
          episode.audioAssetId,
          episode.artworkAssetId,
        ]),
      ])
      const asset = current.assets.find(
        (asset) =>
          ids.has(asset.id) &&
          (downloadSlug
            ? asset.kind === 'audio' && asset.id === downloadAudio
            : pathname ===
              `/__dev/assets/${asset.kind}${new URL(asset.url).pathname}`),
      )
      if (!asset) return empty(404)
      const local = await original(asset)
      if (!local) return empty(307, { location: asset.url })
      file = local.file
      const size = (await file.stat()).size
      const etag = `"${local.sha256}"`
      const headers: Record<string, string> = {
        'content-type': downloadSlug
          ? 'application/octet-stream'
          : local.mediaType,
        'cache-control': 'no-store',
        'accept-ranges': 'bytes',
        'x-content-type-options': 'nosniff',
        etag,
      }
      if (downloadSlug)
        headers['content-disposition'] = attachment(
          basename(asset.relativePath),
        )
      const ifRange = request.headers.get('if-range')
      const range =
        request.method === 'GET' && (!ifRange || ifRange === etag)
          ? byteRange(request.headers.get('range'), size)
          : undefined
      if (range === null)
        return empty(416, { 'content-range': `bytes */${size}` })
      const { start, end } = range ?? { start: 0, end: size - 1 }
      headers['content-length'] = String(end - start + 1)
      if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`
      if (request.method === 'HEAD') return { status: 200, headers }
      const body = file.createReadStream({ start, end, signal: request.signal })
      file = undefined // The stream owns and closes its descriptor.
      return { status: range ? 206 : 200, headers, body }
    } catch {
      return empty(503)
    } finally {
      await file?.close()
    }
  }
}
