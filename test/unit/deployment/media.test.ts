import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  bodyDigest,
  checkMediaHttp,
  scanSources,
} from '../../../tools/deploy/check-media.ts'
import { createManifest, sha256 } from '../../../tools/deploy/manifest.ts'
import { runnableCatalog } from '../content/fixtures.ts'

function tiny() {
  const c = runnableCatalog()
  c.episodes = c.episodes.slice(0, 1)
  c.assets = c.assets
    .filter((a) =>
      [
        c.episodes[0]!.audioAssetId,
        c.episodes[0]!.artworkAssetId,
        c.show.standardArtworkAssetId,
        c.show.itunesArtworkAssetId,
      ].includes(a.id),
    )
    .map((a) => ({ ...a, byteLength: 5, sha256: sha256('bytes') }))
  return createManifest(c, 'a'.repeat(40), '2026-09-09T00:00:00.000Z')
}
const directories: string[] = []
afterEach(async () => {
  for (const dir of directories.splice(0))
    await fs.rm(dir, { recursive: true, force: true })
})

it('bounds streamed responses and detects missing/truncated/oversized bodies', async () => {
  expect(await bodyDigest(new Response('bytes'), 5)).toEqual({
    bytes: 5,
    sha256: sha256('bytes'),
  })
  await expect(bodyDigest(new Response(null), 5)).rejects.toThrow('Missing')
  await expect(bodyDigest(new Response('by'), 5)).rejects.toThrow('Truncated')
  await expect(bodyDigest(new Response('too long'), 5)).rejects.toThrow(
    'exceeds',
  )
})

it('scans all original bytes and decodes audio only when explicitly requested', async () => {
  const dir = await fs.mkdtemp(resolve(tmpdir(), 'nurevolution-scan-'))
  directories.push(dir)
  const manifest = tiny(),
    roots = { audio: resolve(dir, 'audio'), uploads: resolve(dir, 'uploads') }
  for (const { asset } of manifest.assets) {
    const file = resolve(roots[asset.sourceRoot], asset.relativePath)
    await fs.mkdir(dirname(file), { recursive: true })
    await fs.writeFile(file, 'bytes')
  }
  const run = vi.fn(async () => '')
  expect((await scanSources(manifest, roots, false, run)).decoded).toBe(0)
  expect((await scanSources(manifest, roots, true, run)).decoded).toBe(1)
  expect(run).toHaveBeenCalledTimes(1)
  expect(run.mock.calls[0]).toContain('ffmpeg')
})

it('audits every public URL, exact ranges, attachment redirects, and optional full checksums', async () => {
  const manifest = tiny(),
    origins = { web: 'https://web.example', media: 'https://media.example' }
  const request = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (url.startsWith(origins.web + '/downloads/'))
      return new Response(null, {
        status: 307,
        headers: { location: origins.media + new URL(url).pathname },
      })
    const entry = manifest.assets.find(
      (e) =>
        new URL(e.asset.url).pathname === new URL(url).pathname ||
        e.downloads.some(
          (d) => '/downloads/' + d.slug === new URL(url).pathname,
        ),
    )!
    const headers: Record<string, string> = {
      'content-length': '5',
      'content-type': entry.asset.mediaType,
    }
    if (url.includes('/downloads/')) {
      headers['content-disposition'] = entry.downloads[0]!.disposition
      headers['content-type'] = 'application/octet-stream'
    }
    if (init?.method === 'HEAD') return new Response(null, { headers })
    if (new Headers(init?.headers).has('Range'))
      return new Response('bytes', {
        status: 206,
        headers: { ...headers, 'content-range': 'bytes 0-4/5' },
      })
    return new Response('bytes', { headers })
  })
  expect(
    (await checkMediaHttp(manifest, origins, true, request)).transferredBytes,
  ).toBe(manifest.assets.length * 10)
  expect(
    (await checkMediaHttp(manifest, origins, false, request)).transferredBytes,
  ).toBe(manifest.assets.length * 5)
  await expect(
    checkMediaHttp(
      manifest,
      { ...origins, web: 'https://web.example/path' },
      false,
      request,
    ),
  ).rejects.toThrow('origin')
  const original = request.getMockImplementation()!
  for (const type of [
    'head',
    'range',
    'redirect',
    'attachment',
    'full',
    'hash',
  ]) {
    request.mockImplementation(async (input, init) => {
      const url = String(input),
        range = new Headers(init?.headers).has('Range')
      if (
        type === 'head' &&
        init?.method === 'HEAD' &&
        !url.includes('/downloads/')
      )
        return new Response(null, { status: 404 })
      if (type === 'range' && range) return new Response('bytes')
      if (type === 'redirect' && url.startsWith(origins.web + '/downloads/'))
        return new Response(null, { status: 404 })
      if (
        type === 'attachment' &&
        url.startsWith(origins.media + '/downloads/')
      )
        return new Response(null, { status: 404 })
      if (!init?.method && !range && type === 'full')
        return new Response('failed', { status: 500 })
      if (!init?.method && !range && type === 'hash')
        return new Response('wrong')
      return original(input, init)
    })
    await expect(
      checkMediaHttp(manifest, origins, true, request),
    ).rejects.toThrow()
  }
})
