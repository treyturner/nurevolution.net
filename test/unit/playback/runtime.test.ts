import { afterEach, expect, it, vi } from 'vitest'
import { fixture } from './fixtures'
import { playbackPath } from '../../../shared/playback/schema'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('../../../server/utils/content.ts')
})

it('only advertises and serves the current public audio, with a separate activation switch', async () => {
  vi.resetModules()
  const f = fixture()
  const assets = vi.fn(async () => [f.asset])
  vi.doMock('../../../server/utils/content.ts', () => ({
    contentRepository: { audioAssets: assets },
  }))
  const config = {
    virtualPlayback: false,
    audioRoot: '/audio',
    public: { mediaOrigin: '' },
  }
  vi.stubGlobal('useRuntimeConfig', () => config)
  const getItem = vi.fn(async () => f.manifest)
  const getItemRaw = vi.fn(async () => f.compressed as Buffer | undefined)
  vi.stubGlobal('useStorage', (name: string) => {
    expect(name).toBe('assets:playback')
    return { getItem, getItemRaw }
  })
  const runtime = await import('../../../server/utils/playback.ts')
  expect(await runtime.playbackDescriptor(f.asset.url)).toBeUndefined()
  config.virtualPlayback = true
  config.audioRoot = ''
  expect(await runtime.playbackDescriptor(f.asset.url)).toBeUndefined()
  config.audioRoot = '/audio'
  const path = playbackPath(f.entry)!
  expect(await runtime.playbackDescriptor(f.asset.url)).toEqual({
    url: 'https://podcast.nurevolution.net' + path,
    mediaType: 'audio/mp4',
    codecs: 'mp4a.6B',
  })
  config.public.mediaOrigin = 'https://preview.example'
  expect((await runtime.playbackDescriptor(f.asset.url))!.url).toBe(
    config.public.mediaOrigin + path,
  )
  expect(await runtime.playbackDescriptor('unknown')).toBeUndefined()
  expect(await runtime.findPlayback(path)).toEqual({
    entry: f.entry,
    asset: f.asset,
  })
  expect(await runtime.findPlayback('/playback/unknown')).toBeUndefined()
  expect(await runtime.playbackHeader(f.entry)).toEqual(f.header)
  expect(getItem).toHaveBeenCalledOnce()
  assets.mockResolvedValueOnce([])
  expect(await runtime.findPlayback(path)).toBeUndefined()
  for (const change of [{ sha256: '0'.repeat(64) }, { byteLength: 99 }]) {
    assets.mockResolvedValueOnce([{ ...f.asset, ...change }])
    expect(await runtime.playbackDescriptor(f.asset.url)).toBeUndefined()
    assets.mockResolvedValueOnce([{ ...f.asset, ...change }])
    expect(await runtime.findPlayback(path)).toBeUndefined()
  }
  getItemRaw.mockResolvedValueOnce(undefined)
  await expect(
    runtime.playbackHeader({
      ...f.entry,
      virtual: { ...f.entry.virtual!, sha256: '0'.repeat(64) },
    }),
  ).rejects.toThrow('Missing playback header')
})
