import type { EpisodeDetail } from '../../shared/content/public'
type Tracks = EpisodeDetail['tracks']

export function trackNavigation(
  tracks: Tracks,
  time: number,
  duration: number | null,
) {
  const known = tracks.filter(
    (track) =>
      track.startTime !== null &&
      Number.isFinite(track.startTime) &&
      track.startTime >= 0 &&
      (duration === null || track.startTime < duration),
  )
  const anchor = known.findLastIndex((track) => track.startTime! <= time)
  const previous =
    anchor < 0
      ? null
      : time - known[anchor]!.startTime! > 3
        ? known[anchor]!.startTime!
        : known[Math.max(0, anchor - 1)]!.startTime!
  const next = known[anchor + 1]?.startTime ?? null
  // A timed row followed by an untimed row has no supported ending boundary.
  const current =
    tracks.find((track, index) => {
      if (!known.includes(track) || time < track.startTime!) return false
      if (index === tracks.length - 1) return true
      const end = tracks[index + 1]!.startTime
      return end !== null && Number.isFinite(end) && time < end
    })?.position ?? null
  return {
    previous,
    next,
    current,
    positions: known.map((track) => track.position),
  }
}
