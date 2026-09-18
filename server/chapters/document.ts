import { createHash } from 'node:crypto'
import { serializeChapters } from '../../shared/content/chapters.ts'
import type { EpisodeDetail } from '../../shared/content/public.ts'

export function chapterDocument(episode: Pick<EpisodeDetail, 'tracks'>) {
  const body = serializeChapters(episode.tracks)
  if (body === null) return null
  const sha256 = createHash('sha256').update(body, 'utf8').digest('hex')
  return { body, sha256, etag: `W/"${sha256}"` }
}
