import { expect, it } from 'vitest'
import { runnableCatalog } from '../content/fixtures.ts'
import {
  assertRollbackCompatible,
  createManifest,
  safeAsset,
  serialize,
  sha256,
  validateManifest,
  verifyHash,
} from '../../../tools/deploy/manifest.ts'

const date = '2026-09-09T00:00:00.000Z'
const commit = 'a'.repeat(40)
const full = () => {
  const c = runnableCatalog()
  return createManifest(c, commit, date, c.assets)
}

it('deterministically maps the complete public archive and historical artwork', () => {
  const c = runnableCatalog(),
    m = full()
  expect(m.assets).toHaveLength(156)
  expect(m.assets.every((e) => e.public)).toBe(true)
  expect(m.episodes).toHaveLength(55)
  expect(m.assets.flatMap((e) => e.downloads)).toHaveLength(55)
  c.assets.reverse()
  c.episodes.reverse()
  expect(createManifest(c, commit, date, c.assets)).toEqual(m)
  expect(validateManifest(JSON.parse(serialize(m)))).toEqual(m)
  expect(() => verifyHash(serialize(m), sha256(serialize(m)))).not.toThrow()
  expect(() => verifyHash('changed', sha256(serialize(m)))).toThrow('checksum')
  expect(() => verifyHash('', 'bad')).toThrow()
})

it('does not publish draft-only or unreferenced new assets and rejects scheduled releases', () => {
  const c = runnableCatalog()
  c.episodes[0]!.status = 'draft'
  let m = createManifest(c, commit, date)
  expect(m.episodes).toHaveLength(54)
  expect(
    m.assets.find((e) => e.asset.id === c.episodes[0]!.audioAssetId)!.public,
  ).toBe(false)
  const unreferenced = m.assets.find(
    (e) => !e.public && e.asset.kind === 'artwork',
  )!
  expect(unreferenced.downloads).toEqual([])
  m = createManifest(c, commit, date, c.assets)
  expect(
    m.assets.find((e) => e.asset.id === c.episodes[0]!.audioAssetId)!.public,
  ).toBe(false)
  c.episodes[1]!.publishedAt = '2030-01-01T00:00:00.000Z'
  expect(() => createManifest(c, commit, date)).toThrow('requires M8')
  expect(() => createManifest(c, 'invalid', date)).toThrow()
  expect(() => createManifest(c, commit, 'yesterday')).toThrow()
})

it('rejects unsafe or inconsistent URL, file, and download mappings', () => {
  const a = full().assets.find((e) => e.asset.kind === 'audio')!.asset
  for (const suffix of ['?secret=1', '/{env.SECRET}', '/*', '/%0a', '/%ZZ']) {
    expect(() => safeAsset({ ...a, url: a.url + suffix })).toThrow()
  }
  for (const url of [
    'http://podcast.nurevolution.net/' + a.relativePath,
    'https://elsewhere.example/' + a.relativePath,
    'https://podcast.nurevolution.net/other.mp3',
  ])
    expect(() => safeAsset({ ...a, url })).toThrow('Unmapped')
  expect(() => safeAsset({ ...a, relativePath: '../escape' })).toThrow()
  const mutations = [
    (m: ReturnType<typeof full>) => m.assets.push(m.assets[0]!),
    (m: ReturnType<typeof full>) => {
      m.assets.find((e) => e.downloads.length)!.public = false
    },
    (m: ReturnType<typeof full>) => {
      m.assets.find((e) => e.downloads.length)!.downloads[0]!.disposition =
        'injected'
    },
    (m: ReturnType<typeof full>) => {
      m.assets.find((e) => e.downloads.length)!.episodeSlugs = []
    },
    (m: ReturnType<typeof full>) => {
      m.episodes[0]!.byteLength++
    },
    (m: ReturnType<typeof full>) => {
      m.episodes.shift()
    },
    (m: ReturnType<typeof full>) => {
      m.assets.find((e) => e.downloads.length)!.downloads = []
    },
  ]
  for (const mutate of mutations) {
    const m = full()
    mutate(m)
    expect(() => validateManifest(m)).toThrow()
  }
})

it('prevents rollback from withdrawing episodes or changing subscriber identity', () => {
  expect(() => assertRollbackCompatible(full(), full())).not.toThrow()
  const c = runnableCatalog()
  c.episodes.pop()
  expect(() =>
    assertRollbackCompatible(full(), createManifest(c, commit, date, c.assets)),
  ).toThrow('withdraw')
  const changed = full()
  changed.episodes[0]!.guid += '-changed'
  expect(() => assertRollbackCompatible(full(), changed)).toThrow('identity')
})
