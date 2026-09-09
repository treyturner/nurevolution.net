import type { EpisodeDetail } from '../../shared/content/public'
import { attachment } from './filename'

interface DownloadOptions {
  fetch?: typeof globalThis.fetch
  origin?: string
  now?: () => number
  timeoutMs?: number
  log?: (error: unknown) => void
}

export function createDownloadResponder(
  find: (slug: string, asOf: number) => Promise<EpisodeDetail | undefined>,
  options: DownloadOptions = {},
) {
  const fetchMedia = options.fetch ?? globalThis.fetch
  const origin = options.origin ?? 'https://podcast.nurevolution.net'
  const log = options.log ?? console.error
  return async (slug: string, request: Request): Promise<Response> => {
    const fail = (
      status: number,
      message: string,
      extra: Record<string, string> = {},
    ) =>
      new Response(request.method === 'HEAD' ? null : `${message}\n`, {
        status,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
          ...extra,
        },
      })
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return fail(405, 'Method not allowed.', { allow: 'GET, HEAD' })
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    let upstream: Response | undefined
    try {
      const episode = await find(slug, (options.now ?? Date.now)())
      if (!episode) return fail(404, 'Episode not found.')
      const { audio } = episode
      const disposition = attachment(audio.downloadFilename)
      const url = new URL(audio.url)
      if (url.origin !== origin || url.username || url.password)
        throw new Error('Disallowed download origin')
      timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, options.timeoutMs ?? 10_000)
      upstream = await fetchMedia(audio.url, {
        method: request.method,
        headers: { 'Accept-Encoding': 'identity' },
        redirect: 'error',
        signal: AbortSignal.any([controller.signal, request.signal]),
      })
      clearTimeout(timer)
      if (
        upstream.status !== 200 ||
        upstream.headers.get('content-type')?.toLowerCase() !==
          audio.mediaType ||
        upstream.headers.get('content-length') !== String(audio.byteLength) ||
        ![null, 'identity'].includes(upstream.headers.get('content-encoding'))
      )
        throw new Error(
          'Upstream download metadata disagrees with the canonical asset',
        )
      const headers = {
        'content-type': audio.mediaType,
        'content-length': String(audio.byteLength),
        'content-disposition': disposition,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      }
      if (request.method === 'HEAD') {
        await upstream.body?.cancel()
        return new Response(null, { headers })
      }
      if (!upstream.body) throw new Error('Upstream download has no body')
      const reader = upstream.body.getReader()
      let length = 0
      let canceled = false
      const body = new ReadableStream<Uint8Array>({
        async pull(output) {
          try {
            const chunk = await reader.read()
            if (canceled) return
            if (chunk.done) {
              if (length !== audio.byteLength)
                throw new Error('Truncated download')
              output.close()
              reader.releaseLock()
              return
            }
            length += chunk.value.byteLength
            if (length > audio.byteLength)
              throw new Error('Download exceeds canonical byte length')
            output.enqueue(chunk.value)
          } catch (error) {
            if (canceled) return
            log(error)
            controller.abort()
            await reader.cancel(error).catch(() => {})
            output.error(error)
          }
        },
        async cancel(reason) {
          canceled = true
          controller.abort()
          await reader.cancel(reason)
        },
      })
      return new Response(body, { headers })
    } catch (error) {
      clearTimeout(timer)
      controller.abort()
      await upstream?.body?.cancel().catch(() => {})
      log(error)
      return fail(
        timedOut ? 504 : 502,
        'Download temporarily unavailable. Please try again.',
      )
    }
  }
}
