import { describe, expect, it } from 'vitest'
import {
  assetSchema,
  episodeSchema,
  instantSchema,
  relativePathSchema,
  textSchema,
  urlSchema,
} from '../../../shared/content/schema.ts'
import {
  episodeDetail,
  episodeSummary,
  selectPublic,
  showPublic,
} from '../../../shared/content/public.ts'
import {
  normalizeDescription,
  importDescription,
} from '../../../server/content/description.ts'
import { validateCatalog } from '../../../server/content/validate.ts'
import { catalog, documents, sources } from './fixtures.ts'

describe('authoring schemas and complete validation', () => {
  it('allows optional duration, empty or partially timed tracks and literal heart text', () => {
    const e = catalog().episodes[0]!
    e.durationSeconds = null
    e.tracks = [
      { position: 1, title: '<3', artist: 'A & B', startTime: 0 },
      { position: 2, title: 'B', artist: 'A', startTime: null },
      { position: 3, title: 'C', artist: 'A', startTime: 5.123456 },
    ]
    expect(episodeSchema.parse(e).tracks[0]!.startTime).toBe(0)
    e.tracks = []
    e.status = 'draft'
    e.publishedAt = null
    expect(episodeSchema.parse(e).tracks).toEqual([])
    expect(textSchema.safeParse('<strong>markup</strong>').success).toBe(false)
    expect(textSchema.safeParse('bad\u0092').success).toBe(false)
  })

  it.each([NaN, Infinity, -1, 0, 5, 5000])(
    'rejects invalid second known start %s across an untimed row',
    (startTime) => {
      const e = catalog().episodes[0]!
      e.durationSeconds = 5000
      e.tracks = [
        { position: 1, title: 'A', artist: 'A', startTime: 5 },
        { position: 2, title: 'B', artist: 'B', startTime: null },
        { position: 3, title: 'C', artist: 'C', startTime },
      ]
      expect(episodeSchema.safeParse(e).success).toBe(false)
    },
  )

  it('rejects absent published time, gaps, invalid types and unknown fields', () => {
    const e = catalog().episodes[0]!
    expect(episodeSchema.safeParse({ ...e, publishedAt: null }).success).toBe(
      false,
    )
    expect(
      episodeSchema.safeParse({
        ...e,
        tracks: [{ ...e.tracks[0], position: 2 }],
      }).success,
    ).toBe(false)
    for (const invalid of [
      { status: 'scheduled' },
      { title: '  ' },
      { guid: '' },
      { guidIsPermalink: 'false' },
      { durationSeconds: 0 },
      { tracks: null },
      { surprise: true },
    ]) {
      expect(episodeSchema.safeParse({ ...e, ...invalid }).success).toBe(false)
    }
  })

  it.each([
    '2025-02-29T00:00:00.000Z',
    '2024-02-30T00:00:00.000Z',
    '2024-01-01T00:00:00',
    '2024-01-01T00:00:00.000+00:00',
    '2024-01-01T24:00:00.000Z',
  ])('rejects noncanonical instant %s', (value) =>
    expect(instantSchema.safeParse(value).success).toBe(false),
  )
  it('accepts a leap day', () =>
    expect(instantSchema.parse('2024-02-29T00:00:00.000Z')).toBe(
      '2024-02-29T00:00:00.000Z',
    ))

  it.each([
    '//example.com/a',
    'javascript:alert(1)',
    'https://u:p@example.com/a',
    'https://example.com/a#x',
    'https://example.com/%xy',
    'https://example.com/a b',
    'http://[invalid',
    'https://example.com\\evil',
  ])('rejects unsafe media URL %s', (value) =>
    expect(urlSchema.safeParse(value).success).toBe(false),
  )
  it('validates URLs without changing encoded punctuation or Unicode', () => {
    const value = "https://example.com/é/a%26b%27c'd.mp3"
    expect(urlSchema.parse(value)).toBe(value)
    expect(relativePathSchema.parse("é/a&b'c.mp3")).toBe("é/a&b'c.mp3")
  })
  it.each(['/absolute', '../up', 'a/../b', 'a//b', 'a/./b', 'a\\b', 'a\nb'])(
    'rejects source traversal %s',
    (value) => expect(relativePathSchema.safeParse(value).success).toBe(false),
  )
  it('rejects asset type/root mismatch, fractional size and invalid hash', () => {
    const a = catalog().assets[0]!
    for (const invalid of [
      { kind: 'audio', mediaType: 'image/png' },
      { kind: 'artwork', sourceRoot: 'audio' },
      { byteLength: 1.5 },
      { byteLength: Number.MAX_SAFE_INTEGER + 1 },
      { sha256: 'abc' },
    ])
      expect(assetSchema.safeParse({ ...a, ...invalid }).success).toBe(false)
  })

  it.each(['id', 'slug', 'guid'] as const)(
    'rejects duplicate episode %s',
    (key) => {
      const c = catalog()
      c.episodes[1]![key] = c.episodes[0]![key]
      expect(() => validateCatalog(documents(c))).toThrow(`duplicate`)
    },
  )
  it('diagnoses filenames, malformed records, missing/wrong references and duplicate manifests', () => {
    const d = documents(catalog())
    d.episodes[0]!.file = 'episodes/wrong.json'
    expect(() => validateCatalog(d)).toThrow('filename')
    d.episodes[0]!.value.title = ''
    expect(() => validateCatalog(d)).toThrow('episodes/wrong.json')
    for (const mutate of [
      (c: ReturnType<typeof catalog>) => {
        c.assets.push(c.assets[0]!)
      },
      (c: ReturnType<typeof catalog>) => {
        c.legacyUrls.push(c.legacyUrls[0]!)
      },
      (c: ReturnType<typeof catalog>) => {
        c.legacyUrls[0]!.episodeId = 'missing'
      },
      (c: ReturnType<typeof catalog>) => {
        c.episodes[0]!.audioAssetId = c.episodes[0]!.artworkAssetId
      },
      (c: ReturnType<typeof catalog>) => {
        c.show.standardArtworkAssetId = 'missing'
      },
      (c: ReturnType<typeof catalog>) => {
        c.episodes[1]!.audioAssetId = c.episodes[0]!.audioAssetId
      },
    ]) {
      const c = catalog()
      mutate(c)
      expect(() => validateCatalog(documents(c))).toThrow()
    }
  })
  it('requires canonical safe descriptions and rejects future publishing while permitting drafts', () => {
    const c = catalog()
    c.episodes[0]!.descriptionHtml = '<p onclick="evil()">hi</p>'
    expect(() => validateCatalog(documents(c))).toThrow('descriptionHtml')
    c.episodes[0]!.descriptionHtml = '<p>hi</p>'
    c.episodes[0]!.publishedAt = '2099-01-01T00:00:00.000Z'
    expect(() =>
      validateCatalog(documents(c), Date.parse('2026-09-08')),
    ).toThrow('keep the episode draft')
    c.episodes[0]!.status = 'draft'
    expect(
      validateCatalog(documents(c), Date.parse('2026-09-08')).episodes,
    ).toHaveLength(55)
  })
})

describe('safe descriptions and import review', () => {
  it.each([
    '<p style="color:red" onclick="go()">A &amp; B<script>alert(1)</script></p>',
    '<a href="jav&#x61;script:evil()">bad</a><iframe src="https://evil.test"></iframe>',
    '<a href="//evil.test">bad</a><a href="java\nscript:evil()">bad</a>',
    '<svg><script>evil()</script></svg><img src=x onerror=go()><audio src=x></audio>',
    '<p><strong>malformed</p><a href="data:text/html,evil">bad',
  ])('removes unsafe content idempotently', (input) => {
    const result = normalizeDescription(input)
    expect(result).not.toMatch(
      /<script|<iframe|<svg|<img|<audio|javascript:|data:|onclick|onerror|style=/,
    )
    expect(normalizeDescription(result)).toBe(result)
  })
  it('preserves allowed blocks, links, text and the known emoji', () => {
    const value =
      '<blockquote><p>A &amp; B <a href="http://example.com/?a=1&amp;b=2" title="X">link</a><br /><em>E</em><strong>S</strong></p><ul><li>U</li></ul><ol><li>O</li></ol></blockquote>'
    expect(normalizeDescription(value)).toBe(value)
    const raw = sources().inventory.episodes.find((e) => e.id === 'wp-269')!
    const result = importDescription(
      raw.feedContentHtml,
      raw.descriptionHtml,
      raw.id,
    )
    expect(result.html).toContain('😀')
    expect(result.html).not.toContain('<img')
    expect(result.changes).toContain(
      'WordPress smiley image replaced with 😀 text',
    )
  })
  it('fails on unreviewed import transformations and semantic differences', () => {
    expect(() =>
      importDescription('<a href="javascript:evil()">text</a>', 'text', 'wp-x'),
    ).toThrow('unreviewed description link')
    for (const [html, db, id] of [
      ['', 'text', 'wp-x'],
      ['<iframe>text</iframe>', 'text', 'wp-x'],
      ['<p class=x>text</p>', 'text', 'wp-x'],
      ['<img alt="😀">', '😀', 'wp-269'],
      ['<img class="wp-smiley" alt="😀">', '😀', 'wp-x'],
      ['<p>changed</p>', 'original', 'wp-x'],
    ])
      expect(() => importDescription(html!, db!, id!)).toThrow()
    expect(importDescription('<p>plain</p>', 'plain', 'wp-x')).toEqual({
      html: '<p>plain</p>',
      changes: [],
    })
  })
})

describe('shared public selection and projections', () => {
  it('uses one inclusive publication boundary with stable ID tie ordering without mutation', () => {
    const c = catalog(),
      e = c.episodes[0]!
    c.episodes = ['c', 'a', 'b'].map((id) => ({
      ...e,
      id,
      slug: id,
      publishedAt: '2026-01-01T00:00:00.000Z',
    }))
    c.episodes.push({ ...e, id: 'draft', status: 'draft', publishedAt: null })
    const at = Date.parse('2026-01-01T00:00:00.000Z')
    expect(selectPublic(c, at - 1)).toEqual([])
    expect(selectPublic(c, at).map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(selectPublic(c, at + 1).map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(c.episodes[0]!.id).toBe('c')
    expect(() => selectPublic(c, NaN)).toThrow('finite')
  })
  it('orders the full archive and exposes explicit safe DTOs and fresh tracks', () => {
    const c = catalog(),
      selected = selectPublic(c, Date.parse('2026-09-08'))
    expect(selected[0]!.id).toBe('wp-484')
    expect(selected.at(-1)!.id).toBe('wp-337')
    const e = selected.find((e) => e.id === 'wp-208')!
    expect(episodeSummary(c, e)).not.toHaveProperty('audio')
    const detail = episodeDetail(c, e)
    expect(detail.audio.url).toContain("Don't")
    expect(detail.audio.downloadFilename).toContain("Don't")
    detail.tracks[0]!.title = 'changed'
    expect(e.tracks[0]!.title).not.toBe('changed')
    expect(JSON.stringify([detail, showPublic(c)])).not.toMatch(
      /sha256|sourceRoot|relativePath|databaseGuid|sourceSnapshot/,
    )
    c.assets = []
    expect(() => episodeSummary(c, e)).toThrow('Missing asset')
  })
})
