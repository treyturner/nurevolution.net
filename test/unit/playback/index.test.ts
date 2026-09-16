import { expect, it, vi } from 'vitest'
import { gzipSync } from 'node:zlib'
import {
  createHeaderCache,
  decodeHeader,
  matchPlayback,
  validatePlayback,
} from '../../../server/playback/index'
import {
  playbackManifestSchema,
  playbackPath,
} from '../../../shared/playback/schema'
import { atom, fixture, hash } from './fixtures'

it('binds complete, unique classification/index coverage to canonical sources', () => {
  const f = fixture()
  const manifest = validatePlayback(f.manifest, [f.asset])
  const path = playbackPath(f.entry)!
  expect(matchPlayback(manifest, path)).toEqual(f.entry)
  expect(matchPlayback(manifest, path.replace('.m4a', '.mp3'))).toBeNull()
  expect(
    matchPlayback(manifest, path.replace(f.entry.sourceSha256, '0'.repeat(64))),
  ).toBeUndefined()
  expect(() => validatePlayback(f.manifest, [])).toThrow('coverage')
  for (const change of [
    { id: 'missing' },
    { sha256: '0'.repeat(64) },
    { byteLength: 1 },
  ])
    expect(() =>
      validatePlayback(f.manifest, [{ ...f.asset, ...change }]),
    ).toThrow('Stale')
  expect(() =>
    validatePlayback({ ...f.manifest, entries: [f.entry, f.entry] }, [f.asset]),
  ).toThrow('Duplicate')
  for (const change of [
    { mode: 'CBR' },
    { bitrates: [128] },
    { virtual: undefined },
    { virtual: { ...f.entry.virtual, byteLength: 99 } },
    { virtual: { ...f.entry.virtual, audioOffset: 99 } },
  ])
    expect(() =>
      playbackManifestSchema.parse({
        ...f.manifest,
        entries: [{ ...f.entry, ...change }],
      }),
    ).toThrow()
  const cbr = {
    ...f.entry,
    mode: 'CBR' as const,
    bitrates: [320],
    virtual: undefined,
  }
  expect(playbackPath(cbr)).toBeNull()
  expect(
    validatePlayback({ ...f.manifest, entries: [cbr] }, [f.asset]).entries,
  ).toHaveLength(1)
})
it('verifies compressed header identity and requires a complete front index and exact mdat span', async () => {
  const f = fixture()
  expect(await decodeHeader(f.compressed, f.entry)).toEqual(f.header)
  await expect(
    decodeHeader(f.compressed, { ...f.entry, virtual: undefined }),
  ).rejects.toThrow('No virtual')
  await expect(
    decodeHeader(f.compressed, {
      ...f.entry,
      virtual: { ...f.entry.virtual!, headerSha256: '0'.repeat(64) },
    }),
  ).rejects.toThrow('identity')
  await expect(
    decodeHeader(f.compressed, {
      ...f.entry,
      virtual: { ...f.entry.virtual!, headerByteLength: f.header.length + 1 },
    }),
  ).rejects.toThrow('identity')
  await expect(decodeHeader(Buffer.from('bad'), f.entry)).rejects.toThrow()
  for (const header of [
    Buffer.alloc(1),
    atom('bad!'),
    atom('ftyp', Buffer.alloc(0), 0),
    atom('ftyp', Buffer.alloc(0), 1),
    atom('ftyp'),
    Buffer.concat([atom('ftyp'), atom('mdat')]),
    Buffer.concat([atom('ftyp'), atom('moov'), atom('mdat')]),
  ]) {
    const entry = {
      ...f.entry,
      virtual: {
        ...f.entry.virtual!,
        headerByteLength: header.length,
        headerSha256: hash(header),
      },
    }
    await expect(decodeHeader(gzipSync(header), entry)).rejects.toThrow()
  }
  const large = Buffer.alloc(16)
  large.writeUInt32BE(1)
  large.write('mdat', 4)
  large.writeBigUInt64BE(BigInt(16 + f.entry.virtual!.audioByteLength), 8)
  const header = Buffer.concat([atom('ftyp'), atom('moov'), large])
  const entry = {
    ...f.entry,
    virtual: {
      ...f.entry.virtual!,
      headerByteLength: header.length,
      headerSha256: hash(header),
    },
  }
  expect(await decodeHeader(gzipSync(header), entry)).toEqual(header)
})
it('coalesces concurrent reads, retries failures and evicts least recently used headers', async () => {
  const f = fixture(),
    read = vi.fn(async () => f.compressed)
  const cache = createHeaderCache(read, f.header.length)
  expect(await Promise.all([cache(f.entry), cache(f.entry)])).toEqual([
    f.header,
    f.header,
  ])
  expect(read).toHaveBeenCalledOnce()
  await cache(f.entry)
  expect(read).toHaveBeenCalledOnce()
  const second = {
    ...f.entry,
    virtual: { ...f.entry.virtual!, sha256: '0'.repeat(64) },
  }
  await cache(second)
  await cache(f.entry)
  expect(read).toHaveBeenCalledTimes(3)
  const uncached = createHeaderCache(read, 1)
  await uncached(f.entry)
  await uncached(f.entry)
  expect(read).toHaveBeenCalledTimes(5)
  const failing = vi
    .fn()
    .mockRejectedValueOnce(Error('missing'))
    .mockResolvedValue(f.compressed)
  const retry = createHeaderCache(failing)
  await expect(retry(f.entry)).rejects.toThrow('missing')
  expect(await retry(f.entry)).toEqual(f.header)
})
