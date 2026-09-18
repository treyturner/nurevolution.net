import type { EpisodeDetail } from './public.ts'

/** Known chapter starts only; missing cuts are never estimated or interpolated. */
export function serializeChapters(
  tracks: EpisodeDetail['tracks'],
): string | null {
  let previous = -1
  const chapters = tracks.flatMap((track) => {
    if (track.startTime === null) return []
    if (
      !Number.isFinite(track.startTime) ||
      track.startTime < 0 ||
      track.startTime <= previous
    )
      throw new Error(
        'Chapter starts must be finite, nonnegative, and strictly increasing',
      )
    previous = track.startTime
    return [
      {
        startTime: track.startTime,
        title: `${String(track.position).padStart(2, '0')}. ${track.artist} - ${track.title}`,
      },
    ]
  })
  return chapters.length
    ? JSON.stringify({ version: '1.2.0', chapters }) + '\n'
    : null
}
