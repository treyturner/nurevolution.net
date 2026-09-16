import { bodyDigest } from './check-media.ts'

export async function checkVirtualPlayback(
  origins: { web: string; media: string },
  request: typeof fetch = fetch,
) {
  const get = (url: string, init?: RequestInit) =>
    request(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      ...init,
    })
  const detail = await get(origins.web + '/api/episodes/trey-turner-praxis')
  if (detail.status !== 200) throw Error('Virtual playback episode unavailable')
  const body = await detail.json()
  const playback = body?.audio?.playback
  if (
    !playback ||
    playback.mediaType !== 'audio/mp4' ||
    playback.codecs !== 'mp4a.6B'
  )
    throw Error('Virtual playback is not enabled')
  const url = new URL(playback.url)
  const path = /^\/playback\/[a-f0-9]{64}\/([a-f0-9]{64})\.m4a$/.exec(
    url.pathname,
  )
  if (
    url.origin !== origins.media ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !path
  )
    throw Error('Unexpected virtual playback URL')
  const head = await get(url.href, { method: 'HEAD' })
  const length = Number(head.headers.get('content-length'))
  if (
    head.status !== 200 ||
    !Number.isSafeInteger(length) ||
    length <= 8 ||
    head.headers.get('content-type') !== 'audio/mp4' ||
    head.headers.get('etag') !== `"${path[1]}"`
  )
    throw Error('Virtual playback HEAD mismatch')
  const range = await get(url.href, { headers: { Range: 'bytes=0-7' } })
  if (
    range.status !== 206 ||
    range.headers.get('content-range') !== `bytes 0-7/${length}`
  ) {
    await range.body?.cancel()
    throw Error('Virtual playback range mismatch')
  }
  await bodyDigest(range, 8)
}
