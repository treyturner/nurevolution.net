import type { EpisodeDetail } from '../../shared/content/public'
import { deliveryAssetUrl } from './delivery-assets'

export function playerSource(
  episode: EpisodeDetail,
  mediaOrigin: string,
  userAgent: string,
  canPlayType: (type: string) => string,
  pageUrl?: string,
) {
  const url = deliveryAssetUrl(episode.audio.url, 'audio', mediaOrigin)
  const virtual = episode.audio.playback
  // iOS Chrome/Edge use WebKit. Other engines retain MP3 until audible seek
  // validation qualifies them, even when they advertise container support.
  const chromium =
    /(?:Chrome|Chromium)\/[\d.]+/.test(userAgent) &&
    !/(?:iPhone|iPad|iPod|CriOS|EdgiOS|OPiOS)/.test(userAgent)
  return virtual &&
    chromium &&
    canPlayType(`${virtual.mediaType}; codecs="${virtual.codecs}"`)
    ? {
        id: episode.id,
        url: new URL(virtual.url, pageUrl).href,
        fallbackUrl: url,
      }
    : { id: episode.id, url }
}
