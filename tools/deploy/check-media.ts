import { createHash } from 'node:crypto'
import { checkAsset } from './stage-assets.ts'
import { resolve } from 'node:path'
import { validateManifest, type MediaManifest } from './manifest.ts'
import { execute, type Execute } from './host.ts'

export async function scanSources(
  manifest: MediaManifest,
  roots: Record<'audio' | 'uploads', string>,
  decode: boolean,
  run: Execute = execute,
) {
  validateManifest(manifest)
  const records: { assetId: string; decoded: boolean }[] = []
  for (const { asset } of manifest.assets) {
    const path = resolve(roots[asset.sourceRoot], asset.relativePath)
    await checkAsset(path, asset)
    if (decode && asset.kind === 'audio')
      await run('ffmpeg', [
        '-hide_banner',
        '-nostdin',
        '-v',
        'error',
        '-xerror',
        '-i',
        path,
        '-f',
        'null',
        '-',
      ])
    records.push({
      assetId: asset.id,
      decoded: decode && asset.kind === 'audio',
    })
  }
  return {
    at: new Date().toISOString(),
    files: records.length,
    decoded: records.filter((r) => r.decoded).length,
    records,
  }
}

export async function bodyDigest(response: Response, expectedLength: number) {
  const hash = createHash('sha256')
  let bytes = 0
  if (!response.body) throw new Error('Missing response body')
  const reader = response.body.getReader()
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > expectedLength)
        throw new Error('Response exceeds expected length')
      hash.update(part.value)
    }
  } finally {
    await reader.cancel()
  }
  if (bytes !== expectedLength) throw new Error('Truncated response')
  return { bytes, sha256: hash.digest('hex') }
}

export async function checkMediaHttp(
  manifest: MediaManifest,
  origins: { web: string; media: string },
  full: boolean,
  request: typeof fetch = fetch,
) {
  validateManifest(manifest)
  for (const origin of Object.values(origins)) {
    const url = new URL(origin)
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol))
      throw new Error('Invalid audit origin')
  }
  const results: { url: string; full: boolean; bytes: number }[] = []
  for (const entry of manifest.assets.filter((e) => e.public)) {
    const a = entry.asset,
      url =
        (a.kind === 'audio' ? origins.media : origins.web) +
        new URL(a.url).pathname
    const head = await request(url, {
      method: 'HEAD',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (
      head.status !== 200 ||
      Number(head.headers.get('content-length')) !== a.byteLength ||
      head.headers.get('content-type') !== a.mediaType
    )
      throw new Error(`HEAD mismatch: ${url}`)
    const length = Math.min(1024, a.byteLength)
    const range = await request(url, {
      headers: { Range: `bytes=0-${length - 1}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    if (
      range.status !== 206 ||
      range.headers.get('content-range') !==
        `bytes 0-${length - 1}/${a.byteLength}`
    ) {
      await range.body?.cancel()
      throw new Error(`Range mismatch: ${url}`)
    }
    await bodyDigest(range, length)
    for (const download of entry.downloads) {
      const path = '/downloads/' + download.slug
      const redirect = await request(origins.web + path, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      })
      if (
        redirect.status !== 307 ||
        redirect.headers.get('location') !== origins.media + path
      )
        throw new Error('Download redirect mismatch')
      const attachment = await request(origins.media + path, {
        method: 'HEAD',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      })
      if (
        attachment.status !== 200 ||
        attachment.headers.get('content-type') !== 'application/octet-stream' ||
        attachment.headers.get('content-disposition') !==
          download.disposition ||
        Number(attachment.headers.get('content-length')) !== a.byteLength
      )
        throw new Error('Attachment mismatch')
    }
    let bytes = length
    if (full) {
      const response = await request(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(300_000),
      })
      if (response.status !== 200) {
        await response.body?.cancel()
        throw new Error('Full transfer failed')
      }
      const result = await bodyDigest(response, a.byteLength)
      if (result.sha256 !== a.sha256)
        throw new Error(`Full transfer checksum mismatch: ${url}`)
      bytes += result.bytes
    }
    results.push({ url, full, bytes })
  }
  return {
    at: new Date().toISOString(),
    origins,
    full,
    transferredBytes: results.reduce((n, r) => n + r.bytes, 0),
    results,
  }
}
