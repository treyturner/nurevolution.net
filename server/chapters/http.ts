import type { EpisodeDetail } from '../../shared/content/public.ts'
import { matchesEtag, type FeedResponse } from '../rss/http.ts'
import { chapterDocument } from './document.ts'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'ETag',
}

export function createChapterResponder(
  find: (slug: string, asOf: number) => Promise<EpisodeDetail | undefined>,
  now: () => number = Date.now,
  logError: (error: unknown) => void = console.error,
) {
  return async (
    slug: string,
    method: string,
    ifNoneMatch?: string,
  ): Promise<FeedResponse> => {
    const fail = (
      status: number,
      message: string,
      extra: Record<string, string> = {},
    ): FeedResponse => ({
      status,
      headers: {
        ...cors,
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        ...extra,
      },
      body: method === 'HEAD' ? '' : message + '\n',
    })
    if (method !== 'GET' && method !== 'HEAD')
      return fail(405, 'Method not allowed.', { allow: 'GET, HEAD' })
    try {
      // Lookup rechecks public visibility even when a conditional tag matches.
      const episode = await find(slug, now())
      const document = episode && chapterDocument(episode)
      if (!document) return fail(404, 'Chapters not found.')
      const headers = {
        ...cors,
        'content-type': 'application/json+chapters; charset=utf-8',
        'cache-control': 'public, max-age=60, must-revalidate',
        'x-content-type-options': 'nosniff',
        etag: document.etag,
      }
      if (matchesEtag(ifNoneMatch, document.etag))
        return { status: 304, headers, body: '' }
      return {
        status: 200,
        headers,
        body: method === 'HEAD' ? '' : document.body,
      }
    } catch (error) {
      logError(error)
      return fail(503, 'Chapters temporarily unavailable.')
    }
  }
}
