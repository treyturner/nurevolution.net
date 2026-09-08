import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { checkFeed } from '../../../tools/content/check-feed.ts'
import { reconcileFiles } from '../../../tools/content/files.ts'
import { runCli } from '../../../tools/content/cli.ts'
import { candidate, runnableCatalog } from '../content/fixtures.ts'

let root: string
const at = Date.parse('2026-09-08')
beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), 'nurevolution-feed-'))
  await reconcileFiles(candidate.files, root, [], true)
  await writeFile(
    resolve(root, 'show.json'),
    JSON.stringify(runnableCatalog().show),
  )
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

it('checks the real maintained content and produces an offline, stable full-archive report', async () => {
  const print = vi.spyOn(console, 'log').mockImplementation(() => {})
  expect(await checkFeed([])).toBe(0)
  const first = JSON.parse(print.mock.calls[0]![0])
  expect(first).toMatchObject({
    valid: true,
    items: 55,
    newestId: 'wp-484',
    oldestId: 'wp-337',
    historicalItemsCompared: 55,
  })
  expect(first.xmlByteLength).toBeGreaterThan(30_000)
  expect(first.xmlSha256).toMatch(/^[a-f0-9]{64}$/)
  expect(await checkFeed(['--output', root], print, at)).toBe(0)
  expect(JSON.parse(print.mock.calls[1]![0])).toEqual(first)
  expect(await readFile(resolve(root, 'wordpress-import.json'), 'utf8')).toBe(
    candidate.files.get('wordpress-import.json'),
  )
})

it('accepts editorial changes and a 56th episode while preserving every original identity', async () => {
  const source = runnableCatalog(),
    old = source.episodes[0]!
  old.title = 'Reviewed editorial title'
  await writeFile(resolve(root, `episodes/${old.id}.json`), JSON.stringify(old))
  const originalAudio = source.assets.find((a) => a.id === old.audioAssetId)!
  source.assets.push({
    ...originalAudio,
    id: 'asset-new-audio',
    url: 'https://podcast.nurevolution.net/new.mp3',
    relativePath: 'new.mp3',
  })
  await writeFile(
    resolve(root, 'assets.json'),
    JSON.stringify({ schemaVersion: 1, assets: source.assets }),
  )
  await writeFile(
    resolve(root, 'episodes/new-episode.json'),
    JSON.stringify({
      ...old,
      id: 'new-episode',
      slug: 'saved-new-slug',
      guid: 'urn:episode:new',
      audioAssetId: 'asset-new-audio',
      publishedAt: '2026-09-01T12:00:00.000Z',
    }),
  )
  const print = vi.fn()
  expect(await checkFeed(['--output', root], print, at)).toBe(0)
  expect(JSON.parse(print.mock.calls[0]![0])).toMatchObject({
    items: 56,
    newestId: 'new-episode',
    historicalItemsCompared: 55,
  })
  const addedFile = resolve(root, 'episodes/new-episode.json')
  const added = JSON.parse(await readFile(addedFile, 'utf8'))
  added.publishedAt = '2026-09-01T12:00:00.123Z'
  await writeFile(addedFile, JSON.stringify(added))
  await expect(checkFeed(['--output', root], print, at)).rejects.toThrow(
    'new-episode.publishedAt: RSS publication instants require whole seconds',
  )
})

it('rejects missing settings, changed history, malformed XML text, and fractional RSS publication seconds', async () => {
  const print = vi.fn(),
    output = ['--output', root]
  await writeFile(
    resolve(root, 'show.json'),
    JSON.stringify(candidate.catalog.show),
  )
  expect(await runCli(() => checkFeed(output, print, at), print)).toBe(1)
  expect(print.mock.calls.at(-1)![0]).toContain('rss settings are required')
  await writeFile(
    resolve(root, 'show.json'),
    JSON.stringify(runnableCatalog().show),
  )
  const episode = { ...candidate.catalog.episodes[0]! }
  await writeFile(
    resolve(root, `episodes/${episode.id}.json`),
    JSON.stringify({ ...episode, guid: 'changed-guid' }),
  )
  await expect(checkFeed(output, print, at)).rejects.toThrow('protected guid')
  await writeFile(
    resolve(root, `episodes/${episode.id}.json`),
    JSON.stringify({ ...episode, descriptionHtml: '<p>\ud800</p>' }),
  )
  await expect(checkFeed(output, print, at)).rejects.toThrow('XML 1.0')
  await writeFile(
    resolve(root, `episodes/${episode.id}.json`),
    JSON.stringify(episode),
  )
  await writeFile(
    resolve(root, 'episodes/new-draft.json'),
    JSON.stringify({
      ...episode,
      id: 'new-draft',
      slug: 'new-draft',
      guid: 'new-draft',
      status: 'draft',
      publishedAt: null,
    }),
  )
  expect(await checkFeed(output, print, at)).toBe(0)
  // A fractional *historical* date is also protected before serialization.
  await writeFile(
    resolve(root, `episodes/${episode.id}.json`),
    JSON.stringify({
      ...episode,
      publishedAt: episode.publishedAt!.replace('.000Z', '.123Z'),
    }),
  )
  await expect(checkFeed(output, print, at)).rejects.toThrow(
    'protected publishedAt',
  )
  expect(await runCli(() => checkFeed(['--write'], print, at), print)).toBe(1)
})
