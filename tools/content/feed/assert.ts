import assert from 'node:assert/strict'
import { DOMParser, type Element } from '@xmldom/xmldom'
import type { PodcastArchive } from '../../../server/content/feed.ts'

const itunes = 'http://www.itunes.com/dtds/podcast-1.0.dtd'
const content = 'http://purl.org/rss/1.0/modules/content/'
const atom = 'http://www.w3.org/2005/Atom'

export function elements(parent: Element): Element[] {
  return Array.from(parent.childNodes).filter(
    (node): node is Element => node.nodeType === 1,
  )
}

function named(parent: Element, name: string, namespace = '') {
  return elements(parent).filter(
    (node) =>
      node.localName === name && (node.namespaceURI ?? '') === namespace,
  )
}

function one(parent: Element, name: string, namespace = '') {
  const nodes = named(parent, name, namespace)
  assert.equal(
    nodes.length,
    1,
    `${parent.tagName}: expected one ${name} in namespace ${namespace}`,
  )
  return nodes[0]!
}

function attributes(node: Element, expected: Record<string, string>) {
  assert.deepEqual(
    Object.fromEntries(
      Array.from(node.attributes).map((a) => [a.name, a.value]),
    ),
    expected,
    `${node.tagName}: attributes`,
  )
}

function text(
  parent: Element,
  name: string,
  expected: string | undefined,
  namespace = '',
) {
  if (expected === undefined) {
    assert.equal(
      named(parent, name, namespace).length,
      0,
      `${parent.tagName}: unexpected ${name}`,
    )
    return
  }
  const node = one(parent, name, namespace)
  assert.equal(elements(node).length, 0, `${name}: unexpected nested markup`)
  attributes(node, {})
  assert.equal(node.textContent, expected, `${name}: text`)
}

function shape(parent: Element, allowed: string[]) {
  assert.deepEqual(
    elements(parent)
      .map((n) => n.tagName)
      .sort(),
    [...allowed].sort(),
    `${parent.tagName}: child elements`,
  )
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType !== 1)
      assert.match(
        node.textContent ?? '',
        /^\s*$/,
        `${parent.tagName}: unexpected text`,
      )
  }
}

export function parseRss(xml: string) {
  assert.match(
    xml,
    /^<\?xml version="1\.0" encoding="UTF-8"\?>/,
    'UTF-8 XML declaration',
  )
  assert.doesNotMatch(xml, /<!DOCTYPE/i, 'RSS must not contain a DOCTYPE')
  const document = new DOMParser({
    onError: (level, message) => {
      throw new Error(`XML ${level}: ${message}`)
    },
  }).parseFromString(xml, 'application/xml')
  const root = document.documentElement!
  assert.equal(root.tagName, 'rss', 'RSS root')
  assert.equal(root.namespaceURI ?? '', '', 'RSS core namespace')
  attributes(root, {
    version: '2.0',
    'xmlns:itunes': itunes,
    'xmlns:content': content,
    'xmlns:atom': atom,
  })
  shape(root, ['channel'])
  const channel = one(root, 'channel')
  attributes(channel, {})
  return { channel, items: named(channel, 'item') }
}

export function assertPodcastFeed(xml: string, archive: PodcastArchive) {
  const { channel, items } = parseRss(xml)
  const { show, episodes } = archive,
    { rss } = show
  shape(channel, [
    'title',
    'atom:link',
    'link',
    'description',
    'language',
    'category',
    'itunes:category',
    'itunes:author',
    'itunes:explicit',
    'itunes:summary',
    'image',
    'itunes:image',
    'ttl',
    ...(rss.subtitle === undefined ? [] : ['itunes:subtitle']),
    ...(rss.copyright === undefined ? [] : ['copyright']),
    ...(rss.owner ? ['itunes:owner', 'managingEditor', 'webMaster'] : []),
    ...episodes.map(() => 'item'),
  ])
  text(channel, 'title', show.title)
  text(channel, 'link', show.siteUrl)
  text(channel, 'description', show.descriptionText)
  text(channel, 'language', rss.language)
  text(channel, 'category', rss.category)
  text(channel, 'author', rss.author, itunes)
  text(channel, 'explicit', rss.explicit ? 'true' : 'false', itunes)
  text(channel, 'summary', show.descriptionText, itunes)
  text(channel, 'subtitle', rss.subtitle, itunes)
  text(channel, 'copyright', rss.copyright)
  text(channel, 'ttl', '1')
  attributes(one(channel, 'link', atom), {
    href: show.feedUrl,
    rel: 'self',
    type: 'application/rss+xml',
  })
  shape(one(channel, 'link', atom), [])
  attributes(one(channel, 'category', itunes), { text: rss.category })
  shape(one(channel, 'category', itunes), [])
  attributes(one(channel, 'image', itunes), { href: show.itunesArtworkUrl })
  shape(one(channel, 'image', itunes), [])
  const image = one(channel, 'image')
  attributes(image, {})
  shape(image, ['url', 'title', 'link', 'width', 'height'])
  for (const [tag, value] of Object.entries({
    url: show.standardArtworkUrl,
    title: show.title,
    link: show.siteUrl,
    width: '144',
    height: '144',
  }))
    text(image, tag, value)
  if (rss.owner) {
    const owner = one(channel, 'owner', itunes)
    attributes(owner, {})
    shape(owner, ['itunes:name', 'itunes:email'])
    text(owner, 'name', rss.owner.name, itunes)
    text(owner, 'email', rss.owner.email, itunes)
    const contact = `${rss.owner.email} (${rss.owner.name})`
    text(channel, 'managingEditor', contact)
    text(channel, 'webMaster', contact)
  }
  assert.equal(items.length, episodes.length, 'Complete item count')
  const guids = new Set<string>(),
    enclosures = new Set<string>()
  items.forEach((item, index) => {
    const expected = episodes[index]!
    try {
      attributes(item, {})
      shape(item, [
        'title',
        'link',
        'pubDate',
        'guid',
        'description',
        'content:encoded',
        'enclosure',
        'itunes:author',
        'itunes:explicit',
        ...(expected.durationSeconds === null ? [] : ['itunes:duration']),
      ])
      text(item, 'title', `${expected.artist} – ${expected.title}`)
      text(item, 'link', expected.rss.link)
      text(item, 'description', expected.descriptionHtml)
      text(item, 'encoded', expected.descriptionHtml, content)
      text(item, 'author', expected.artist, itunes)
      text(item, 'explicit', expected.rss.explicit ? 'true' : 'false', itunes)
      const pubDate = one(item, 'pubDate')
      attributes(pubDate, {})
      assert.equal(elements(pubDate).length, 0, 'pubDate: nested markup')
      assert.match(
        pubDate.textContent!,
        /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/,
        'pubDate: RFC date',
      )
      assert.equal(
        Date.parse(pubDate.textContent!),
        Date.parse(expected.publishedAt!),
        'Publication instant',
      )
      const guid = one(item, 'guid')
      attributes(guid, {
        isPermaLink: expected.guidIsPermalink ? 'true' : 'false',
      })
      assert.equal(elements(guid).length, 0, 'guid: nested markup')
      assert.equal(guid.textContent, expected.guid, 'Opaque GUID')
      assert.equal(guids.has(expected.guid), false, 'Duplicate GUID')
      guids.add(expected.guid)
      const enclosure = one(item, 'enclosure')
      attributes(enclosure, {
        url: expected.audio.url,
        length: `${expected.audio.byteLength}`,
        type: expected.audio.mediaType,
      })
      shape(enclosure, [])
      assert.equal(
        enclosures.has(expected.audio.url),
        false,
        'Duplicate enclosure',
      )
      enclosures.add(expected.audio.url)
      if (expected.durationSeconds !== null) {
        const duration = one(item, 'duration', itunes)
        attributes(duration, {})
        assert.equal(elements(duration).length, 0, 'duration: nested markup')
        assert.match(
          duration.textContent!,
          /^[1-9]\d*$/,
          'duration: positive integer seconds',
        )
        const seconds = Number(duration.textContent)
        assert.ok(
          (seconds - expected.durationSeconds > -0.5 &&
            seconds - expected.durationSeconds <= 0.5) ||
            (expected.durationSeconds < 0.5 && seconds === 1),
          'duration: nearest positive second',
        )
      }
    } catch (error) {
      throw new Error(`${expected.id}: feed item mismatch`, { cause: error })
    }
  })
  return {
    items: items.length,
    oldestId: episodes.at(-1)?.id ?? null,
    newestId: episodes[0]?.id ?? null,
  }
}
