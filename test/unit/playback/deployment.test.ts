import { expect, it, vi } from 'vitest'
import { checkVirtualPlayback } from '../../../tools/deploy/check-playback'

it('requires the configured origin, enabled descriptor, identity and working range before accepting deployment', async () => {
  const origins = { web: 'https://web.example', media: 'https://media.example' }
  const url =
    origins.media +
    '/playback/' +
    'a'.repeat(64) +
    '/' +
    'b'.repeat(64) +
    '.m4a'
  const descriptor = { url, mediaType: 'audio/mp4', codecs: 'mp4a.6B' }
  const head = () =>
    new Response(null, {
      headers: {
        'content-type': 'audio/mp4',
        'content-length': '100',
        etag: '"' + 'b'.repeat(64) + '"',
      },
    })
  const range = () =>
    new Response('12345678', {
      status: 206,
      headers: { 'content-range': 'bytes 0-7/100' },
    })
  const detail = (playback: unknown = descriptor) =>
    Response.json({ audio: { playback } })
  const run = async (responses: Response[]) =>
    checkVirtualPlayback(
      origins,
      vi.fn(async () => responses.shift()!),
    )
  await run([detail(), head(), range()])
  for (const responses of [
    [new Response(null, { status: 404 })],
    [detail(null)],
    [detail({ ...descriptor, url: 'https://evil.example/playback/file.m4a' })],
    [detail(), new Response(null, { status: 503 })],
    [detail(), head(), new Response('wrong')],
    [
      detail(),
      head(),
      new Response('short', {
        status: 206,
        headers: { 'content-range': 'bytes 0-7/100' },
      }),
    ],
  ])
    await expect(run(responses)).rejects.toThrow()
})
