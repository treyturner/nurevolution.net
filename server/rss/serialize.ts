import type { PodcastArchive } from '../content/feed.ts'
import { xmlAttribute, xmlCdata, xmlText } from './xml.ts'

export function serializePodcastRss(archive: PodcastArchive): string {
  const { show, episodes } = archive
  const { rss } = show
  const text = (tag: string, value: string, field = `show.${tag}`) =>
    `<${tag}>${xmlText(value, field)}</${tag}>`
  const attribute = xmlAttribute
  const channel = [
    text('title', show.title),
    `<atom:link href="${attribute(show.feedUrl, 'show.feedUrl')}" rel="self" type="application/rss+xml"/>`,
    text('link', show.siteUrl),
    text('description', show.descriptionText),
    text('language', rss.language),
    text('category', rss.category),
    `<itunes:category text="${attribute(rss.category, 'show.rss.category')}"/>`,
    text('itunes:author', rss.author),
    text('itunes:explicit', String(rss.explicit)),
    text('itunes:summary', show.descriptionText),
  ]
  if (rss.subtitle !== undefined)
    channel.push(text('itunes:subtitle', rss.subtitle))
  if (rss.copyright !== undefined)
    channel.push(text('copyright', rss.copyright))
  if (rss.owner) {
    channel.push(
      `<itunes:owner>${text('itunes:name', rss.owner.name)}${text('itunes:email', rss.owner.email)}</itunes:owner>`,
    )
    const contact = `${rss.owner.email} (${rss.owner.name})`
    channel.push(text('managingEditor', contact), text('webMaster', contact))
  }
  channel.push(
    `<image>${text('url', show.standardArtworkUrl)}${text('title', show.title)}${text('link', show.siteUrl)}<width>144</width><height>144</height></image>`,
    `<itunes:image href="${attribute(show.itunesArtworkUrl, 'show.itunesArtworkUrl')}"/>`,
    '<ttl>1</ttl>',
  )
  const items = episodes.map((episode) => {
    const field = (name: string) => `${episode.id}.${name}`
    const itemText = (tag: string, value: string) =>
      text(tag, value, field(tag))
    const date = new Date(episode.publishedAt ?? '')
    if (!Number.isFinite(date.getTime()))
      throw new Error(`${field('publishedAt')}: invalid publication instant`)
    const body = [
      itemText('title', `${episode.artist} – ${episode.title}`),
      itemText('link', episode.rss.link),
      itemText('pubDate', date.toUTCString()),
      `<guid isPermaLink="${episode.guidIsPermalink}">${xmlText(episode.guid, field('guid'))}</guid>`,
      `<description>${xmlCdata(episode.descriptionHtml, field('descriptionHtml'))}</description>`,
      `<content:encoded>${xmlCdata(episode.descriptionHtml, field('descriptionHtml'))}</content:encoded>`,
      `<enclosure url="${attribute(episode.audio.url, field('audio.url'))}" length="${episode.audio.byteLength}" type="${attribute(episode.audio.mediaType, field('audio.mediaType'))}"/>`,
      itemText('itunes:author', episode.artist),
      itemText('itunes:explicit', String(episode.rss.explicit)),
    ]
    if (episode.durationSeconds !== null)
      body.push(
        itemText(
          'itunes:duration',
          String(Math.max(1, Math.round(episode.durationSeconds))),
        ),
      )
    return `<item>\n${body.join('\n')}\n</item>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n${[...channel, ...items].join('\n')}\n</channel>\n</rss>\n`
}
