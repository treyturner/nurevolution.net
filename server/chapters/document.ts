import { createHash } from 'node:crypto'
import {
  serializeChapters,
  type ChapterTrack,
} from '../../shared/content/chapters.ts'

export function chapterDocument(episode: { tracks: readonly ChapterTrack[] }) {
  const body = serializeChapters(episode.tracks)
  if (body === null) return null
  const sha256 = createHash('sha256').update(body, 'utf8').digest('hex')
  return { body, sha256, etag: `W/"${sha256}"` }
}
