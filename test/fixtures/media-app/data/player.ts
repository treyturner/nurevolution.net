import type { EpisodeDetail } from '../../../../shared/content/public'
import praxis from '../../../../content/episodes/wp-417.json'

export function playerEpisodes(origin: string): EpisodeDetail[] {
  return ['first', 'second', 'third'].map((slug, index) => ({
    id: slug,
    slug,
    path: `/episodes/${slug}`,
    title: index ? 'Second fixture' : 'Praxis fixture',
    artist: 'Test tone',
    publishedAt: praxis.publishedAt,
    durationSeconds: 2,
    artworkUrl: `${origin}/cover.svg`,
    artworkThumbnailUrl: `${origin}/cover.svg`,
    descriptionHtml: '<p>Original synthetic tone for browser verification.</p>',
    guid: slug,
    guidIsPermalink: false,
    audio: {
      url: `${origin}/media/sample.mp3?episode=${slug}`,
      mediaType: 'audio/mpeg',
      byteLength: 16509,
      downloadFilename: [
        'test-tone.mp3',
        "bouche_d'incendie.mp3",
        'musique-étoile.mp3',
      ][index]!,
    },
    tracks: praxis.tracks,
  }))
}
