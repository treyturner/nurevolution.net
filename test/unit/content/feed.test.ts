import { describe, expect, it } from 'vitest'
import {
  episodeSchema,
  rssSettingsSchema,
  showSchema,
} from '../../../shared/content/schema.ts'
import { publicFeedArchive } from '../../../server/content/feed.ts'
import { readCatalog } from '../../../server/content/repository.ts'
import { validateCatalog } from '../../../server/content/validate.ts'
import {
  candidate,
  catalog,
  documents,
  reader,
  rssSettings,
  runnableCatalog,
} from './fixtures.ts'

const at = Date.parse('2026-09-08')

describe('RSS metadata and shared projection', () => {
  it('keeps the historical candidate unchanged but requires settings in runnable catalogs', async () => {
    expect(showSchema.parse(candidate.catalog.show)).not.toHaveProperty('rss')
    expect(validateCatalog(documents(catalog()))).toEqual(candidate.catalog)
    expect(() => publicFeedArchive(catalog(), at)).toThrow('show.json: rss')
    const port = reader()
    await expect(
      readCatalog({
        ...port,
        read: async (path) =>
          path === 'show.json' ? candidate.catalog.show : port.read(path),
      }),
    ).rejects.toThrow('show.json: rss')
  })

  it.each([
    { language: 'en-us' },
    { category: 'music' },
    { explicit: 'false' },
    { author: '' },
    { author: '\ud800' },
    { owner: { name: 'Only name' } },
    { owner: { name: 'Owner', email: 'invalid' } },
    { unknown: true },
  ])('rejects unsupported or malformed RSS settings: %j', (change) => {
    expect(
      rssSettingsSchema.safeParse({ ...rssSettings(), ...change }).success,
    ).toBe(false)
  })

  it('projects all historical links and explicit inheritance without sharing mutable settings', () => {
    const source = runnableCatalog()
    source.show.rss!.explicit = true
    source.episodes[0]!.explicit = false
    const feed = publicFeedArchive(source, at)
    for (const episode of feed.episodes) {
      expect(episode.rss.link).toBe(
        source.legacyUrls.find((e) => e.episodeId === episode.id)!.url,
      )
      expect(episode.rss.explicit).toBe(episode.id !== source.episodes[0]!.id)
    }
    feed.show.rss.owner!.name = 'Changed response'
    feed.episodes[0]!.tracks.splice(0)
    expect(source.show.rss!.owner!.name).toBe('nurevolution studios')
    expect(
      source.episodes.find((e) => e.id === feed.episodes[0]!.id)!.tracks.length,
    ).toBeGreaterThan(0)
    source.show.rss!.explicit = false
    source.episodes[0]!.explicit = true
    expect(
      publicFeedArchive(source, at).episodes.find(
        (e) => e.id === source.episodes[0]!.id,
      )!.rss.explicit,
    ).toBe(true)
  })

  it('uses stable slug links for new episodes and deterministic mapping precedence', () => {
    const source = runnableCatalog(),
      episode = source.episodes[0]!
    source.legacyUrls = source.legacyUrls.filter(
      (e) => e.episodeId !== episode.id,
    )
    episode.title = 'Edited title'
    expect(
      publicFeedArchive(source, at).episodes.find((e) => e.id === episode.id)!
        .rss.link,
    ).toBe(`https://nurevolution.net/episodes/${episode.slug}`)
    source.legacyUrls.push(
      { episodeId: episode.id, url: 'https://nurevolution.net/z' },
      { episodeId: episode.id, url: 'https://nurevolution.net/a' },
    )
    expect(
      publicFeedArchive(source, at).episodes.find((e) => e.id === episode.id)!
        .rss.link,
    ).toBe('https://nurevolution.net/a')
    expect(source.legacyUrls.at(-1)!.url).toBe('https://nurevolution.net/a')
  })

  it('rejects forbidden XML characters before any normalization can hide them', () => {
    for (const value of [
      '\0',
      '\u0001',
      '\ud800',
      '\udc00',
      '\ufffe',
      '\uffff',
    ]) {
      expect(
        episodeSchema.safeParse({
          ...candidate.catalog.episodes[0],
          descriptionHtml: `<p>${value}</p>`,
        }).success,
      ).toBe(false)
      expect(
        showSchema.safeParse({ ...candidate.catalog.show, title: value })
          .success,
      ).toBe(false)
    }
    expect(
      episodeSchema.parse({
        ...candidate.catalog.episodes[0],
        descriptionHtml: '<p>😀 &amp; <3\t\r\n</p>',
      }).descriptionHtml,
    ).toContain('😀')
  })
})
