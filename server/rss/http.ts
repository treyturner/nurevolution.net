import { createHash } from 'node:crypto'
import type { PodcastArchive } from '../content/feed.ts'
import { serializePodcastRss } from './serialize.ts'

export interface FeedResponse {
  status: number
  headers: Record<string, string>
  body: string
}

const freshness = 'public, max-age=60, must-revalidate'
const plain = 'text/plain; charset=utf-8'

function methodNotAllowed(): FeedResponse {
  return {
    status: 405,
    headers: {
      allow: 'GET, HEAD',
      'content-type': plain,
      'cache-control': 'no-store',
    },
    body: 'Method not allowed.\n',
  }
}

export function matchesEtag(header: string | undefined, etag: string) {
  if (header === undefined) return false
  const input = header.trim()
  if (input === '*') return true
  // Commas are valid inside opaque tags. Parse the list before deciding a match.
  const token = /[ \t]*(?:W\/)?"([\x21\x23-\x7e\x80-\xff]*)"[ \t]*/y
  const expected = etag.replace(/^W\//, '').slice(1, -1)
  let index = 0,
    matched = false
  while (index < input.length) {
    if (/[ ,\t]/.test(input[index]!)) {
      index++
      continue
    }
    token.lastIndex = index
    const match = token.exec(input)
    if (!match) return false
    matched ||= match[1] === expected
    index = token.lastIndex
    if (index < input.length && input[index] !== ',') return false
  }
  return matched
}

export function isFeedAlias(url: URL) {
  return (
    url.pathname === '/feed/podcast/' ||
    (url.pathname === '/' &&
      url.searchParams.getAll('feed').length === 1 &&
      url.searchParams.get('feed') === 'podcast')
  )
}

export function feedAliasResponse(method: string): FeedResponse {
  if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed()
  return {
    status: 301,
    headers: {
      location: '/feed/podcast',
      'cache-control': freshness,
      'content-type': plain,
    },
    body: method === 'HEAD' ? '' : 'Moved permanently.\n',
  }
}

export function createFeedResponder(
  readArchive: (asOf: number) => Promise<PodcastArchive>,
  now: () => number = Date.now,
  logError: (error: unknown) => void = console.error,
) {
  return async (
    method: string,
    ifNoneMatch?: string,
  ): Promise<FeedResponse> => {
    if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed()
    try {
      const xml = serializePodcastRss(await readArchive(now()))
      const etag = `W/"${createHash('sha256').update(xml, 'utf8').digest('hex')}"`
      const headers = {
        'content-type': 'application/rss+xml; charset=utf-8',
        'cache-control': freshness,
        'x-content-type-options': 'nosniff',
        etag,
      }
      if (matchesEtag(ifNoneMatch, etag))
        return { status: 304, headers, body: '' }
      return { status: 200, headers, body: method === 'HEAD' ? '' : xml }
    } catch (error) {
      logError(error)
      return {
        status: 503,
        headers: { 'content-type': plain, 'cache-control': 'no-store' },
        body: method === 'HEAD' ? '' : 'Feed temporarily unavailable.\n',
      }
    }
  }
}
