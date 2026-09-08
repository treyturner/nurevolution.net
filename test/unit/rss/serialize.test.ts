import { describe, expect, it } from 'vitest'
import { DOMParser } from '@xmldom/xmldom'
import { publicFeedArchive } from '../../../server/content/feed.ts'
import { serializePodcastRss } from '../../../server/rss/serialize.ts'
import { xmlAttribute, xmlCdata, xmlText } from '../../../server/rss/xml.ts'
import {
  assertPodcastFeed,
  elements,
  parseRss,
} from '../../../tools/content/feed/assert.ts'
import evidence from '../../../docs/milestones/evidence/M03-feed-reference.json'
import { runnableCatalog, sources } from '../content/fixtures.ts'

const at = Date.parse('2026-09-08')
const archive = () => publicFeedArchive(runnableCatalog(), at)

describe('complete podcast RSS serialization', () => {
  it('independently reconciles all canonical fields and the full frozen subscriber archive', () => {
    const value = archive(),
      before = structuredClone(value),
      xml = serializePodcastRss(value)
    expect(assertPodcastFeed(xml, value)).toEqual({
      items: 55,
      newestId: 'wp-484',
      oldestId: 'wp-337',
    })
    expect(value).toEqual(before)
    expect(xml.endsWith('</rss>\n')).toBe(true)
    const { items } = parseRss(xml)
    for (const raw of sources().inventory.episodes) {
      const item = items.find(
        (e) =>
          e.getElementsByTagName('guid')[0]!.textContent ===
          raw.originalIdentity.feedGuid,
      )!
      expect(item).toBeDefined()
      expect(
        item.getElementsByTagName('guid')[0]!.getAttribute('isPermaLink'),
      ).toBe('false')
      const enclosure = item.getElementsByTagName('enclosure')[0]!
      expect(enclosure.getAttribute('url')).toBe(raw.enclosure.url)
      expect(enclosure.getAttribute('length')).toBe(
        `${raw.enclosure.byteLength}`,
      )
      expect(enclosure.getAttribute('type')).toBe(raw.enclosure.type)
      expect(
        Date.parse(item.getElementsByTagName('pubDate')[0]!.textContent!),
      ).toBe(Date.parse(raw.publication.feedRfc822))
    }
    expect(xml).not.toMatch(
      /sourceRoot|sha256|wordpress-import|itunes:new-feed-url|itunes:block|itunes:complete|lastBuildDate|<generator|<comments|<itunes:keywords|<itunes:type|podcast:chapters/,
    )
    expect(xml.match(/<itunes:image /g)).toHaveLength(1)
  })

  it('documents exactly seven legacy title/author differences and preserves clean labels', () => {
    const value = archive(),
      differences = []
    for (const old of evidence.episodeMetadata) {
      const episode = value.episodes.find((e) => e.id === old.episodeId)!
      for (const [field, actual] of [
        ['title', `${episode.artist} – ${episode.title}`],
        ['author', episode.artist],
      ] as const) {
        if (old[field] !== actual)
          differences.push({
            episodeId: episode.id,
            field,
            legacy: old[field],
            canonicalDerived: actual,
          })
      }
      expect(old.explicit).toBe('no')
      expect(episode.rss.explicit).toBe(false)
    }
    expect(differences).toEqual(evidence.canonicalPresentationDifferences)
    expect(value.episodes.find((e) => e.id === 'wp-417')!.durationSeconds).toBe(
      3396.349388,
    )
    const { items } = parseRss(serializePodcastRss(value))
    const praxis = items[value.episodes.findIndex((e) => e.id === 'wp-417')]!
    expect(praxis.getElementsByTagName('itunes:duration')[0]!.textContent).toBe(
      '3396',
    )
    for (const id of ['wp-197', 'wp-473', 'wp-269']) {
      const index = value.episodes.findIndex((e) => e.id === id)
      expect(
        items[index]!.getElementsByTagName('description')[0]!.textContent,
      ).toBe(value.episodes[index]!.descriptionHtml)
    }
  })

  it('omits optional values, keeps false overrides and rounds positive durations', () => {
    const value = archive()
    delete value.show.rss.owner
    delete value.show.rss.subtitle
    delete value.show.rss.copyright
    value.show.rss.explicit = true
    value.episodes[0]!.durationSeconds = null
    value.episodes[1]!.durationSeconds = 0.1
    value.episodes[2]!.durationSeconds = 60.5
    value.episodes[1]!.rss.explicit = true
    const xml = serializePodcastRss(value)
    assertPodcastFeed(xml, value)
    expect(xml).not.toMatch(
      /<itunes:owner|<itunes:subtitle|<copyright|<webMaster|<managingEditor/,
    )
    const { items } = parseRss(xml)
    expect(items[0]!.getElementsByTagName('itunes:duration').length).toBe(0)
    expect(
      items[1]!.getElementsByTagName('itunes:duration')[0]!.textContent,
    ).toBe('1')
    expect(
      items[2]!.getElementsByTagName('itunes:duration')[0]!.textContent,
    ).toBe('61')
  })

  it('uses the same publication boundary and deterministic order as the shared archive', () => {
    const source = runnableCatalog(),
      a = source.episodes[0]!,
      b = source.episodes[1]!
    source.episodes = [b, a]
    a.publishedAt = b.publishedAt = '2026-09-08T12:00:00.000Z'
    a.status = 'draft'
    expect(
      publicFeedArchive(source, Date.parse(b.publishedAt) - 1).episodes,
    ).toHaveLength(0)
    expect(
      publicFeedArchive(source, Date.parse(b.publishedAt)).episodes.map(
        (e) => e.id,
      ),
    ).toEqual([b.id])
    a.status = 'published'
    const value = publicFeedArchive(source, Date.parse(b.publishedAt))
    expect(value.episodes.map((e) => e.id)).toEqual([a.id, b.id].sort())
    assertPodcastFeed(serializePodcastRss(value), value)
    a.status = b.status = 'draft'
    a.publishedAt = null
    const empty = publicFeedArchive(source, at)
    expect(assertPodcastFeed(serializePodcastRss(empty), empty)).toEqual({
      items: 0,
      oldestId: null,
      newestId: null,
    })
    expect(() => publicFeedArchive(source, NaN)).toThrow('finite')
  })

  it('round-trips metacharacters, entities, URLs and legal whitespace without mutation', () => {
    const value = archive(),
      episode = value.episodes[0]!
    value.show.title = 'A & B <3 "quotes" \'apostrophe\' 😀'
    episode.guid = 'urn:opaque:A&B<3%26%27😀'
    episode.guidIsPermalink = true
    episode.audio.url = 'https://example.com/A%26B%27C/😀?a=1&b=2'
    episode.descriptionHtml =
      '<p>A &amp; B ]]> 😀\r\n\t<a href="https://example.com?a=1&amp;b=2">link</a></p>'
    const xml = serializePodcastRss(value)
    assertPodcastFeed(xml, value)
    expect(xml).toContain(']]]]><![CDATA[>')
    expect(xml).toContain(']]>&#13;<![CDATA[')
    expect(xml).not.toContain('A&amp;amp;B')
  })

  it.each([null, 'invalid'])(
    'rejects an invalid publication date at the serialization boundary: %s',
    (date) => {
      const value = archive()
      value.episodes[0]!.publishedAt = date
      expect(() => serializePodcastRss(value)).toThrow('publishedAt')
    },
  )
})

describe('XML primitives and independent checks', () => {
  it('preserves whitespace and quotes in every XML context', () => {
    const input = '&<>"\'\t\n\r😀]]>'
    const xml = `<r a="${xmlAttribute(input, 'attr')}"><t>${xmlText(input, 'text')}</t><c>${xmlCdata(input, 'html')}</c></r>`
    const document = new DOMParser().parseFromString(xml, 'application/xml')
    expect(document.documentElement!.getAttribute('a')).toBe(input)
    expect(document.getElementsByTagName('t')[0]!.textContent).toBe(input)
    expect(document.getElementsByTagName('c')[0]!.textContent).toBe(input)
    for (const encode of [xmlText, xmlAttribute, xmlCdata])
      expect(() => encode('\ud800', 'episode.field')).toThrow('episode.field')
  })

  it.each([
    ['malformed', (x: string) => x.replace('</rss>', '')],
    ['doctype', (x: string) => x.replace('<rss ', '<!DOCTYPE rss><rss ')],
    [
      'wrong namespace',
      (x: string) =>
        x.replace(
          'http://www.itunes.com/dtds/podcast-1.0.dtd',
          'https://wrong.example',
        ),
    ],
    [
      'duplicate channel',
      (x: string) => x.replace('</rss>', '<channel/></rss>'),
    ],
    ['nested title', (x: string) => x.replace('<title>', '<title><b/>')],
    [
      'wrong enclosure',
      (x: string) => x.replace('length="145672454"', 'length="1"'),
    ],
    ['missing item', (x: string) => x.replace(/<item>[\s\S]*?<\/item>/, '')],
    [
      'extra attribute',
      (x: string) => x.replace('<channel>', '<channel extra="true">'),
    ],
    [
      'unexpected text',
      (x: string) => x.replace('<channel>', '<channel>unexpected'),
    ],
    [
      'unescaped entity',
      (x: string) => x.replace('r u m i n a t e', '&missing;'),
    ],
  ])('fails independently for %s', (_label, mutate) => {
    const value = archive()
    expect(() =>
      assertPodcastFeed(mutate(serializePodcastRss(value)), value),
    ).toThrow()
  })

  it('checks namespaces, duplicate identities and optional omissions independently of the template', () => {
    const value = archive(),
      xml = serializePodcastRss(value)
    expect(() =>
      assertPodcastFeed(
        xml.replace(
          '<itunes:author>',
          '<itunes:author xmlns:itunes="urn:wrong">',
        ),
        value,
      ),
    ).toThrow('expected one author')
    delete value.show.rss.subtitle
    expect(() => assertPodcastFeed(xml, value)).toThrow()
    const duplicate = archive()
    duplicate.episodes[1]!.guid = duplicate.episodes[0]!.guid
    expect(() =>
      assertPodcastFeed(serializePodcastRss(duplicate), duplicate),
    ).toThrow('feed item mismatch')
    duplicate.episodes[1]!.guid = 'another-guid'
    duplicate.episodes[1]!.audio.url = duplicate.episodes[0]!.audio.url
    expect(() =>
      assertPodcastFeed(serializePodcastRss(duplicate), duplicate),
    ).toThrow('feed item mismatch')
    expect(elements(parseRss(xml).channel).length).toBeGreaterThan(55)
  })
})
