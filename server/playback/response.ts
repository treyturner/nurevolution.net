import { open, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import type { Asset } from '../../shared/content/schema.ts'
import type { PlaybackEntry } from '../../shared/playback/schema.ts'
import { byteRange } from '../http/byte-range'

export interface VirtualResponse {
  status: number
  headers: Record<string, string>
  body?: Readable
}
export interface PlaybackResource {
  entry: PlaybackEntry
  asset: Asset
}
export interface PlaybackOptions {
  root: string
  find: (path: string) => Promise<PlaybackResource | undefined>
  header: (entry: PlaybackEntry) => Promise<Buffer>
  log?: (error: unknown) => void
}

export function createPlaybackResponder(options: PlaybackOptions) {
  return async (
    pathname: string,
    request: Request,
  ): Promise<VirtualResponse> => {
    const fail = (status: number, headers: Record<string, string> = {}) => ({
      status,
      headers: {
        'cache-control': 'no-store',
        'content-length': '0',
        ...headers,
      },
    })
    if (!['GET', 'HEAD'].includes(request.method))
      return fail(405, { allow: 'GET, HEAD' })
    let file: Awaited<ReturnType<typeof open>> | undefined
    try {
      const resource = await options.find(pathname)
      if (!resource || !options.root) return fail(404)
      const { entry, asset } = resource
      const v = entry.virtual!
      if (
        asset.kind !== 'audio' ||
        entry.assetId !== asset.id ||
        entry.sourceSha256 !== asset.sha256 ||
        entry.sourceByteLength !== asset.byteLength
      )
        throw new Error('Playback source identity mismatch')
      const root = await realpath(options.root)
      const path = resolve(root, asset.relativePath)
      if (!path.startsWith(root + '/') || (await realpath(path)) !== path)
        throw new Error('Invalid playback source path')
      file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      const stat = await file.stat()
      if (!stat.isFile() || stat.size !== entry.sourceByteLength)
        throw new Error('Playback source size mismatch')
      const header = await options.header(entry)
      const etag = `"${v.sha256}"`
      const headers: Record<string, string> = {
        'content-type': 'audio/mp4',
        'accept-ranges': 'bytes',
        etag,
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'Content-Length, Content-Range, ETag',
      }
      const noneMatch = request.headers.get('if-none-match')
      if (
        noneMatch
          ?.split(',')
          .some(
            (value) =>
              value.trim().replace(/^W\//, '') === etag || value.trim() === '*',
          )
      ) {
        return { status: 304, headers }
      }
      const ifRange = request.headers.get('if-range')
      const range =
        request.method === 'GET' && (!ifRange || ifRange === etag)
          ? byteRange(request.headers.get('range'), v.byteLength)
          : undefined
      if (range === null)
        return fail(416, { 'content-range': `bytes */${v.byteLength}` })
      const { start, end } = range ?? { start: 0, end: v.byteLength - 1 }
      headers['content-length'] = String(end - start + 1)
      if (range)
        headers['content-range'] = `bytes ${start}-${end}/${v.byteLength}`
      if (request.method === 'HEAD') return { status: 200, headers }
      // FileHandle.createReadStream owns this descriptor, including early cancellation.
      const input =
        end >= header.length
          ? file.createReadStream({
              start: v.audioOffset + Math.max(0, start - header.length),
              end: v.audioOffset + end - header.length,
              highWaterMark: 64 * 1024,
              signal: request.signal,
            })
          : undefined
      if (input) file = undefined
      const body = Readable.from(
        (async function* () {
          try {
            if (start < header.length)
              yield header.subarray(start, Math.min(end + 1, header.length))
            if (input) yield* input
          } finally {
            input?.destroy()
          }
        })(),
        { highWaterMark: 64 * 1024, objectMode: false, signal: request.signal },
      )
      // A cancellation before the generator's first pull must also close the file.
      body.on('close', () => input?.destroy())
      input?.on('error', (error) => body.destroy(error))
      return { status: range ? 206 : 200, headers, body }
    } catch (error) {
      options.log?.(error)
      return fail(503)
    } finally {
      await file?.close()
    }
  }
}
