// Explicit local acceptance check. Requires the verified original archive;
// never runs on the production host or contacts production services.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { execute, waitReady } from '../deploy/host.ts'
import {
  playbackManifestSchema,
  playbackPath,
} from '../../shared/playback/schema.ts'

const audioRoot = process.argv[2]
if (!audioRoot)
  throw Error(
    'Usage: node tools/playback/capacity.ts /absolute/audio/directory',
  )
const name = 'nurevolution-playback-' + randomUUID().slice(0, 8)
const address = process.env.NUREVOLUTION_DOCKER_ADDRESS ?? '127.0.0.1'
if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address))
  throw Error('Expected an IPv4 Docker address')
const docker = (args: string[]) => execute('docker', args)
const manifest = playbackManifestSchema.parse(
  JSON.parse(await readFile('playback/manifest.json', 'utf8')),
)
const paths = manifest.entries.flatMap((entry) => playbackPath(entry) ?? [])
let requests = 0,
  pageChecks = 0,
  peakRssKiB = 0
try {
  await docker([
    'build',
    '--provenance=false',
    '--build-arg',
    'RELEASE_COMMIT=' + (await execute('git', ['rev-parse', 'HEAD'])),
    '-t',
    name,
    '.',
  ])
  await docker([
    'run',
    '-d',
    '--name',
    name,
    '--read-only',
    '--memory',
    '256m',
    '--memory-swap',
    '256m',
    '--pids-limit',
    '64',
    '--cap-drop',
    'ALL',
    '-v',
    resolve(audioRoot) + ':/media/audio:ro',
    '-e',
    'NUXT_AUDIO_ROOT=/media/audio',
    '-e',
    'NUXT_VIRTUAL_PLAYBACK=true',
    '-p',
    address + '::3000',
    name,
  ])
  const port = (await docker(['port', name, '3000/tcp'])).split(':').at(-1)!
  const origin = 'http://' + address + ':' + port
  const get = (path: string, init?: RequestInit) =>
    fetch(origin + path, { signal: AbortSignal.timeout(10000), ...init })
  await waitReady(
    async () => assert.equal((await get('/api/health')).status, 200),
    30,
  )
  const episode = await (await get('/api/episodes/trey-turner-praxis')).json()
  assert.match(
    episode.audio.playback.url,
    /\/playback\/[a-f0-9]{64}\/[a-f0-9]{64}\.m4a$/,
  )
  // Warm every index, exceeding the LRU budget and exercising eviction.
  for (const path of paths)
    assert.equal((await get(path, { method: 'HEAD' })).status, 200)
  const stop = Date.now() + 120000
  const stopStreams = new AbortController()
  const timer = setTimeout(() => stopStreams.abort(), 120000)
  try {
    await Promise.all([
      ...Array.from({ length: 16 }, async (_, client) => {
        let iteration = 0
        try {
          while (Date.now() < stop) {
            const path = paths[(client + iteration++) % paths.length]!
            const response = await get(path, {
              headers: { Range: 'bytes=0-' },
              signal: stopStreams.signal,
            })
            assert.equal(response.status, 206)
            requests++
            const reader = response.body!.getReader()
            let count = 0
            try {
              while (!stopStreams.signal.aborted) {
                const { done, value } = await reader.read()
                if (done) break
                // Approximately 32 KiB/s per listener, with occasional disconnects.
                await delay((value.length / 32768) * 1000, undefined, {
                  signal: stopStreams.signal,
                })
                if (client % 4 === 0 && ++count === 3) break
              }
            } finally {
              await reader.cancel().catch(() => {})
            }
          }
        } catch (error) {
          if (!stopStreams.signal.aborted) throw error
        }
      }),
      (async () => {
        while (Date.now() < stop) {
          for (const path of [
            '/api/health',
            '/episodes/trey-turner-praxis',
            '/feed/podcast',
          ]) {
            const response = await get(path)
            assert.equal(response.status, 200)
            await response.arrayBuffer()
            pageChecks++
          }
          const status = await docker(['exec', name, 'cat', '/proc/1/status'])
          peakRssKiB = Math.max(
            peakRssKiB,
            Number(/VmRSS:\s+(\d+)/.exec(status)![1]),
          )
          await delay(1000)
        }
      })(),
    ])
  } finally {
    clearTimeout(timer)
    stopStreams.abort()
  }
  const state = JSON.parse(
    await docker(['inspect', '--format', '{{json .State}}', name]),
  )
  assert.equal(state.Running, true)
  assert.equal(state.OOMKilled, false)
  assert.ok(peakRssKiB < 256 * 1024)
  assert.ok(requests >= 16 && pageChecks >= 30)
  const evidence = {
    listeners: 16,
    seconds: 120,
    memoryLimitMiB: 256,
    peakRssMiB: peakRssKiB / 1024,
    requests,
    pageChecks,
    virtualEpisodes: paths.length,
    oomKilled: state.OOMKilled,
  }
  await mkdir('.local/playback', { recursive: true })
  await writeFile(
    '.local/playback/capacity.json',
    JSON.stringify(evidence, null, 2) + '\n',
  )
  console.log(JSON.stringify(evidence))
} finally {
  await docker(['rm', '-f', name]).catch(() => {})
  await docker(['image', 'rm', name]).catch(() => {})
}
