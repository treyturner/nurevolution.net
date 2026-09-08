import { describe, expect, it } from 'vitest'
import {
  createCandidate,
  deriveSlugs,
  inputPaths,
  jsonBytes,
  parseDuration,
  publicationInstant,
  sha256,
} from '../../../tools/content/source.ts'
import { normalizeDescription } from '../../../server/content/description.ts'
import { candidate, sources } from './fixtures.ts'

describe('frozen WordPress transformation', () => {
  it('reconciles every episode, track, GUID, enclosure, date and artwork with the public audit', () => {
    const input = sources()
    expect(candidate.report.actual).toEqual({
      episodes: 55,
      tracks: 832,
      starts: 338,
      timedEpisodes: 22,
      assets: 156,
      legacyUrls: 55,
    })
    expect(
      candidate.catalog.episodes.filter((e) => !e.tracks.length),
    ).toHaveLength(5)
    expect(
      candidate.report.episodes.filter((e) => e.databaseGuidDiffers),
    ).toHaveLength(13)
    for (const raw of input.inventory.episodes) {
      const episode = candidate.catalog.episodes.find((e) => e.id === raw.id)!
      expect(episode).toMatchObject({
        id: raw.id,
        title: raw.title,
        artist: raw.artist,
        guid: raw.originalIdentity.feedGuid,
        guidIsPermalink: raw.originalIdentity.feedGuidIsPermalink,
        audioAssetId: raw.audioAssetId,
        artworkAssetId: raw.artworkAssetId,
      })
      expect(Date.parse(episode.publishedAt!)).toBe(
        Date.parse(raw.publication.feedRfc822),
      )
      expect(
        candidate.catalog.assets.find((a) => a.id === episode.audioAssetId),
      ).toMatchObject({
        url: raw.enclosure.url,
        mediaType: raw.enclosure.type,
        byteLength: raw.enclosure.byteLength,
      })
      expect(episode.tracks).toHaveLength(raw.tracklist.tracks.length)
      expect(normalizeDescription(episode.descriptionHtml)).toBe(
        episode.descriptionHtml,
      )
      for (const [index, track] of episode.tracks.entries()) {
        const source = raw.tracklist.tracks[index]!
        expect(track.position).toBe(source.position)
        expect(track.artist).toBe(source.artist)
        expect(track.title).toBe(
          raw.id === 'wp-281' && track.position === 4
            ? source.title.replace('\u0092', '’')
            : source.title,
        )
        expect(track.startTime).toBe(
          raw.id === 'wp-417'
            ? input.timings.episodes.find((e) => e.episodeId === 'wp-417')!
                .tracks[index]!.startTime
            : source.startTime,
        )
      }
    }
    expect(
      candidate.catalog.episodes.find((e) => e.id === 'wp-417'),
    ).toMatchObject({
      durationSeconds: 3396.349388,
      guid: 'https://nurevolution.net/?post_type=one_page_portfolio&p=417',
    })
    expect(
      candidate.catalog.episodes.find((e) => e.id === 'wp-417')!.tracks.at(-1)!
        .startTime,
    ).toBe(3157.442948)
    expect(
      candidate.catalog.episodes.find((e) => e.id === 'wp-342')!.slug,
    ).not.toBe(candidate.catalog.episodes.find((e) => e.id === 'wp-344')!.slug)
    expect(
      candidate.catalog.episodes.find((e) => e.id === 'wp-435')!.tracks[10]!
        .title,
    ).toContain('<3')
    expect(
      candidate.catalog.episodes.find((e) => e.id === 'wp-197')!
        .descriptionHtml,
    ).toContain('http://beeple-crap.com/')
    expect(
      candidate.catalog.episodes.find((e) => e.id === 'wp-473')!
        .descriptionHtml,
    ).toContain('https://open.spotify.com')
  })
  it('keeps deterministic reports and exact initial output fingerprints', () => {
    expect(createCandidate(sources()).files).toEqual(candidate.files)
    for (const [path, hash] of Object.entries(candidate.report.outputHashes))
      expect(sha256(candidate.files.get(path)!)).toBe(hash)
    expect(candidate.report.issues).toHaveLength(3)
    expect(
      candidate.report.episodes.find((e) => e.id === 'wp-281')!.textChanges,
    ).toHaveLength(1)
    expect(jsonBytes(candidate.report)).not.toContain('/home/coder')
    expect(
      new Set([
        candidate.catalog.show.standardArtworkAssetId,
        candidate.catalog.show.itunesArtworkAssetId,
        ...candidate.catalog.episodes.flatMap((e) => [
          e.audioAssetId,
          e.artworkAssetId,
        ]),
      ]).size,
    ).toBe(112)
  })

  const cases: [string, (input: ReturnType<typeof sources>) => void][] = [
    [
      'changed inventory hash',
      (s) => {
        s.hashes[inputPaths.inventory] = '0'.repeat(64)
      },
    ],
    [
      'changed timings hash',
      (s) => {
        s.hashes[inputPaths.timings] = '0'.repeat(64)
      },
    ],
    [
      'wrong correction episode',
      (s) => {
        s.correction.episodeId = 'wp-999'
      },
    ],
    [
      'wrong correction evidence',
      (s) => {
        s.correction.timingEvidenceId = 'other'
      },
    ],
    [
      'wrong correction asset hash',
      (s) => {
        s.correction.audioAsset.sha256 = '0'.repeat(64)
      },
    ],
    [
      'wrong correction asset id',
      (s) => {
        s.correction.audioAsset.id = 'other'
      },
    ],
    [
      'wrong correction asset length',
      (s) => {
        s.correction.audioAsset.byteLength++
      },
    ],
    [
      'wrong correction path',
      (s) => {
        s.correction.audioAsset.relativePath = 'other.mp3'
      },
    ],
    [
      'wrong measured duration',
      (s) => {
        s.correction.inspection.durationSeconds += 10
      },
    ],
    [
      'wrong correction count',
      (s) => {
        s.correction.decision.trackCount = 20
      },
    ],
    [
      'duplicate source identity',
      (s) => {
        s.inventory.episodes.push(s.inventory.episodes[0]!)
      },
    ],
    [
      'duplicate asset',
      (s) => {
        s.inventory.assets.push(s.inventory.assets[0]!)
      },
    ],
    [
      'duplicate timing',
      (s) => {
        s.timings.episodes.push(s.timings.episodes[0]!)
      },
    ],
    [
      'wrong source ID',
      (s) => {
        s.inventory.episodes[0]!.sourceRecord.id++
      },
    ],
    [
      'wrong track count',
      (s) => {
        s.inventory.episodes[0]!.tracklist.count++
      },
    ],
    [
      'wrong audio reference',
      (s) => {
        s.inventory.episodes[0]!.audioAssetId = 'unknown'
      },
    ],
    [
      'wrong audio bytes',
      (s) => {
        s.inventory.episodes[0]!.enclosure.byteLength++
      },
    ],
    [
      'wrong podPress bytes',
      (s) => {
        s.inventory.episodes[0]!.databaseMedia.podPressByteLength++
      },
    ],
    [
      'wrong audio filename',
      (s) => {
        s.inventory.episodes[0]!.databaseMedia.filename = 'wrong.mp3'
      },
    ],
    [
      'wrong artwork path',
      (s) => {
        s.inventory.episodes[0]!.artworkEvidence.relativePath = 'wrong.jpg'
      },
    ],
    [
      'unreviewed ACF bytes',
      (s) => {
        s.inventory.episodes[0]!.databaseMedia.byteLength++
      },
    ],
    [
      'wrong feed duration',
      (s) => {
        s.inventory.episodes[0]!.databaseMedia.feedDuration = '0:55:25'
      },
    ],
    [
      'wrong show artwork URL',
      (s) => {
        s.inventory.show.standardArtworkUrl = 'https://example.com/wrong.jpg'
      },
    ],
    [
      'wrong legacy URL',
      (s) => {
        s.legacy.entries[0]!.url += '-changed'
      },
    ],
    [
      'incomplete archive',
      (s) => {
        const e = s.inventory.episodes[0]!
        e.tracklist.tracks.pop()
        e.tracklist.count--
      },
    ],
    [
      'unexplained timestamp',
      (s) => {
        s.inventory.episodes[0]!.tracklist.tracks[0]!.startTime = 0
      },
    ],
    [
      'applied timing drift',
      (s) => {
        s.timings.episodes[0]!.tracks[0]!.startTime = 1
      },
    ],
    [
      'applied timing count drift',
      (s) => {
        s.timings.episodes[0]!.tracks.pop()
      },
    ],
    [
      'applied timing position drift',
      (s) => {
        s.timings.episodes[0]!.tracks[0]!.position++
      },
    ],
    [
      'missing Praxis evidence',
      (s) => {
        s.timings.episodes = s.timings.episodes.filter(
          (e) => e.episodeId !== 'wp-417',
        )
      },
    ],
    [
      'Praxis position drift',
      (s) => {
        s.timings.episodes.find((e) => e.episodeId === 'wp-417')!.tracks[0]!
          .position++
      },
    ],
    [
      'Praxis duplicate start',
      (s) => {
        s.timings.episodes.find(
          (e) => e.episodeId === 'wp-417',
        )!.tracks[1]!.startTime = 0
      },
    ],
    [
      'Praxis split total drift',
      (s) => {
        s.timings.episodes.find((e) => e.episodeId === 'wp-417')!.tracks.at(-1)!
          .durationSeconds++
      },
    ],
  ]
  it.each(cases)('refuses %s', (_name, mutate) => {
    const input = sources()
    mutate(input)
    expect(() => createCandidate(input)).toThrow()
  })
})

describe('one-time normalization', () => {
  it('parses bounded durations, including more than 59 minutes', () => {
    expect(parseDuration('60:01')).toBe(3601)
    expect(parseDuration('1:00:01')).toBe(3601)
    for (const value of [
      '',
      '1',
      '-1:23',
      '1:2',
      '1:60',
      '1:60:00',
      '1:01:60',
      '0:00',
      '999999999999999999:00',
    ])
      expect(() => parseDuration(value)).toThrow('duration')
  })
  it('compares UTC instants rather than filename/local dates', () => {
    expect(
      publicationInstant(
        '2024-02-29 23:30:00',
        'Fri, 01 Mar 2024 01:30:00 +0200',
      ),
    ).toBe('2024-02-29T23:30:00.000Z')
    expect(() =>
      publicationInstant('2024-02-30 00:00:00', '2024-03-01'),
    ).toThrow()
    expect(() => publicationInstant('2024-01-01', '2024-01-01')).toThrow(
      'database UTC',
    )
    expect(() =>
      publicationInstant('2024-01-01 00:00:00', 'Mon, 01 Jan 2024 00:00:00'),
    ).toThrow('publication mismatch')
    expect(() =>
      publicationInstant(
        '2024-01-01 00:00:00',
        'Mon, 01 Jan 2024 01:00:00 +0000',
      ),
    ).toThrow('publication mismatch')
  })
  it('normalizes slugs once and handles collisions explicitly', () => {
    const result = deriveSlugs([
      { id: 'a', url: 'https://example.com/Trey_Caf%C3%A9' },
      { id: 'b', url: 'https://example.com/trey-cafe' },
    ])
    expect([...result]).toEqual([
      ['a', 'trey-cafe-a'],
      ['b', 'trey-cafe-b'],
    ])
    expect(() =>
      deriveSlugs([{ id: 'a', url: 'https://example.com/---' }]),
    ).toThrow('empty slug')
    expect(() =>
      deriveSlugs([{ id: 'a', url: 'https://example.com/%invalid' }]),
    ).toThrow()
    expect(() =>
      deriveSlugs([
        { id: 'a', url: 'https://example.com/x' },
        { id: 'b', url: 'https://example.com/x' },
        { id: 'c', url: 'https://example.com/x-a' },
      ]),
    ).toThrow('duplicate')
  })
})
