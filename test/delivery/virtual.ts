import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import fixture from '../fixtures/playback/fixture.json' with { type: 'json' }

export async function verifyVirtualProxy(origin: string) {
  const v = fixture.entry.virtual
  const header = gunzipSync(
    await readFile(`test/fixtures/playback/headers/${v.sha256}.gz`),
  )
  const source = await readFile('test/fixtures/playback/seek.mp3')
  const expected = Buffer.concat([
    header,
    source.subarray(v.audioOffset, v.audioOffset + v.audioByteLength),
  ])
  const url = `${origin}/playback/${fixture.entry.sourceSha256}/${v.sha256}.m4a`
  const head = await fetch(url, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(head.headers.get('content-length'), String(v.byteLength))
  assert.equal(head.headers.get('content-type'), 'audio/mp4')
  for (const [start, end] of [
    [0, 7],
    [header.length - 4, header.length + 4],
    [v.byteLength - 8, v.byteLength - 1],
  ]) {
    const response = await fetch(url, {
      headers: { Range: `bytes=${start}-${end}` },
    })
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('access-control-allow-origin'), '*')
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      expected.subarray(start, end! + 1),
    )
  }
  assert.equal(
    (
      await fetch(url, {
        headers: { 'If-None-Match': head.headers.get('etag')! },
      })
    ).status,
    304,
  )
  assert.equal(
    (await fetch(url, { headers: { Range: `bytes=${v.byteLength}-` } })).status,
    416,
  )
  assert.deepEqual(
    Buffer.from(await (await fetch(url)).arrayBuffer()),
    expected,
  )
  console.log(
    'Virtual audio: exact bytes, cross-boundary ranges, validators and CORS passed through Caddy',
  )
}
