import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { execute, waitReady } from '../../tools/deploy/host.ts'
import { atomicWrite } from '../../tools/deploy/deploy.ts'
import { stageAssets } from '../../tools/deploy/stage-assets.ts'
import { prepareBundle } from '../../tools/deploy/build.ts'
import { serialize } from '../../tools/deploy/manifest.ts'
import { renderSite, profileSchema } from '../../tools/deploy/render-config.ts'
import { deliveryFixture } from './fixture.ts'
import { archiveConfigDigest } from '../../tools/deploy/image-identity.ts'

const root = resolve('.local/delivery'),
  artifacts = resolve(root, 'artifacts')
const commit = await execute('git', ['rev-parse', 'HEAD'])
const suffix = randomBytes(5).toString('hex'),
  prefix = 'nurevolution-delivery-' + suffix
const appImage = prefix + '-app',
  caddyImage = prefix + '-caddy',
  fixtureImage = prefix + '-fixture'
const network = prefix + '-network',
  volume = prefix + '-files'
const address = process.env.NUREVOLUTION_DOCKER_ADDRESS ?? '127.0.0.1'
if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address))
  throw new Error('Expected an IPv4 Docker address')
const containers: string[] = []
const docker = (args: string[]) => execute('docker', args)
const local = resolve(root, suffix)
const fixtureDirectory = resolve(local, 'files')
let madeNetwork = false,
  madeVolume = false
async function create(name: string, args: string[]) {
  await docker(['create', '--name', name, ...args])
  containers.push(name)
  return name
}
async function start(name: string) {
  await docker(['start', name])
}
async function port(name: string, containerPort: string) {
  return (await docker(['port', name, containerPort]))
    .split('\n')[0]!
    .split(':')
    .at(-1)!
}
async function get(url: string, init?: RequestInit) {
  return fetch(url, { signal: AbortSignal.timeout(10_000), ...init })
}
try {
  console.log(
    'Preparing the canonical delivery bundle and exact runtime images',
  )
  await execute('pnpm', ['build:deploy'])
  const { manifest, configuration } = await prepareBundle(
    artifacts,
    commit,
    new Date().toISOString(),
  )
  await docker([
    'build',
    '--provenance=false',
    '--build-arg',
    'RELEASE_COMMIT=' + commit,
    '-t',
    appImage,
    '.',
  ])
  await docker([
    'build',
    '--provenance=false',
    '-f',
    'deploy/Caddy.Dockerfile',
    '--build-arg',
    'CADDY_POLICY_SHA256=' + configuration.caddyDockerfileSha256,
    '-t',
    caddyImage,
    'deploy',
  ])
  const compose = JSON.parse(
    await execute(
      'docker',
      ['compose', '-f', 'deploy/compose.yaml', 'config', '--format', 'json'],
      {
        APP_IMAGE: appImage,
        APP_MEMORY_MIB: '384',
        DEPLOY_ENVIRONMENT: 'preview',
        WEB_ORIGIN: 'https://preview.nurevolution.net',
        MEDIA_ORIGIN: 'https://podcast-preview.nurevolution.net',
      },
    ),
  ) as {
    services: {
      app: {
        tmpfs: string[]
        read_only: boolean
        environment: Record<string, string>
      }
    }
  }
  assert.deepEqual(compose.services.app.tmpfs, ['/tmp:size=16m,mode=1777'])
  assert.equal(compose.services.app.read_only, true)
  assert.equal(
    compose.services.app.environment.NUXT_PUBLIC_WEB_ORIGIN,
    'https://preview.nurevolution.net',
  )
  assert.equal(
    compose.services.app.environment.NUXT_PUBLIC_MEDIA_ORIGIN,
    'https://podcast-preview.nurevolution.net',
  )
  await execute(
    'docker',
    ['compose', '-f', 'deploy/edge.compose.yaml', 'config', '--quiet'],
    {
      CADDY_IMAGE: caddyImage,
      CLOUDFLARE_API_TOKEN: 'synthetic-validation-only',
    },
  )
  // Exercise the initial configuration before any application routes exist.
  // Validation uses a synthetic account token; issuance uses only a local CA.
  const bootstrapConfig = JSON.parse(
    await fs.readFile('deploy/caddy/initial.example.json', 'utf8'),
  )
  await docker([
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--tmpfs',
    '/tmp',
    '--tmpfs',
    '/data',
    '--tmpfs',
    '/config',
    '-e',
    'CLOUDFLARE_API_TOKEN=cfat_' + 'A'.repeat(64),
    '-e',
    'BOOTSTRAP_JSON=' + serialize(bootstrapConfig),
    caddyImage,
    'sh',
    '-c',
    'printf %s "$BOOTSTRAP_JSON" > /tmp/bootstrap.json; exec caddy validate --config /tmp/bootstrap.json',
  ])
  for (const policy of bootstrapConfig.apps.tls.automation.policies)
    policy.issuers = [{ module: 'internal' }]
  const bootstrap = await create(prefix + '-bootstrap', [
    '--network',
    'none',
    '--read-only',
    '--tmpfs',
    '/tmp',
    '--tmpfs',
    '/data',
    '--tmpfs',
    '/config',
    '-e',
    'BOOTSTRAP_JSON=' + serialize(bootstrapConfig),
    caddyImage,
    'sh',
    '-c',
    'printf %s "$BOOTSTRAP_JSON" > /tmp/bootstrap.json; exec caddy run --config /tmp/bootstrap.json',
  ])
  await start(bootstrap)
  await waitReady(async () => {
    for (const host of [
      'nurevolution.net',
      'www.nurevolution.net',
      'podcast.nurevolution.net',
      'preview.nurevolution.net',
      'podcast-preview.nurevolution.net',
    ])
      await docker([
        'exec',
        bootstrap,
        'test',
        '-s',
        `/data/caddy/certificates/local/${host}/${host}.crt`,
      ])
  }, 30)
  await docker(['stop', bootstrap])
  console.log(
    'Initial edge: account token format and issuance for all five hosts before routes passed (offline local CA)',
  )
  await docker(['network', 'create', network])
  madeNetwork = true
  await docker(['volume', 'create', volume])
  madeVolume = true
  const app = await create(prefix + '-app', [
    '--network',
    network,
    '--read-only',
    '--memory',
    '384m',
    '--memory-swap',
    '384m',
    '--pids-limit',
    '64',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '-p',
    address + '::3000',
    appImage,
  ])
  await start(app)
  const appOrigin = 'http://' + address + ':' + (await port(app, '3000/tcp'))
  await waitReady(
    async () =>
      assert.equal((await get(appOrigin + '/api/health')).status, 200),
    30,
  )
  assert.deepEqual(await (await get(appOrigin + '/api/health')).json(), {
    healthy: true,
    release: commit,
  })
  for (const episode of manifest.episodes)
    assert.equal(
      (await get(appOrigin + '/episodes/' + episode.slug)).status,
      200,
    )
  const feed = await (await get(appOrigin + '/feed/podcast')).text()
  assert.equal((feed.match(/<item>/g) ?? []).length, 55)
  for (const path of [
    '/player-test',
    '/media-test',
    '/media/sample.mp3',
    '/private.json',
  ])
    assert.equal((await get(appOrigin + path)).status, 404)
  const info = JSON.parse(await docker(['inspect', app])) as {
    HostConfig: { ReadonlyRootfs: boolean; Memory: number }
    Config: { User: string }
  }[]
  assert.equal(info[0]!.Config.User, 'node')
  assert.equal(info[0]!.HostConfig.ReadonlyRootfs, true)
  console.log(
    'Exact runtime: all 55 episode URLs, feed, health, fixture isolation and memory limit passed',
  )

  const fixtureSources = resolve(local, 'source-files')
  const fixture = await deliveryFixture(fixtureSources, commit)
  const operatorUmask = process.umask(0o077)
  try {
    await stageAssets(
      fixture.manifest,
      {
        audio: resolve(fixtureSources, 'audio'),
        uploads: resolve(fixtureSources, 'uploads'),
      },
      fixtureDirectory,
    )
  } finally {
    process.umask(operatorUmask)
  }
  await fs.copyFile(
    resolve(fixtureSources, 'private.json'),
    resolve(fixtureDirectory, 'private.json'),
  )
  const context = resolve(local, 'fixture-context')
  await fs.mkdir(context, { recursive: true })
  await fs.cp('test/fixtures/media-app/.output', resolve(context, '.output'), {
    recursive: true,
  })
  await fs.copyFile('Dockerfile', resolve(context, 'Dockerfile'))
  await fs.copyFile('.dockerignore', resolve(context, '.dockerignore'))
  await docker([
    'build',
    '--provenance=false',
    '--build-arg',
    'RELEASE_COMMIT=' + commit,
    '-t',
    fixtureImage,
    context,
  ])
  const fixtureApp = await create(prefix + '-fixture', [
    '--network',
    network,
    '--network-alias',
    'nurevolution-preview',
    fixtureImage,
  ])
  await start(fixtureApp)
  const edge = await create(prefix + '-edge', [
    '--cap-drop',
    'ALL',
    '--cap-add',
    'NET_BIND_SERVICE',
    '--security-opt',
    'no-new-privileges:true',
    '--network',
    network,
    '--read-only',
    '-v',
    volume + ':/media:ro',
    '-p',
    address + '::8080',
    '-p',
    address + '::8081',
    caddyImage,
    'caddy',
    'run',
    '--config',
    '/media/.edge/caddy.json',
  ])
  // Allocate the port before writing redirect origins. The idle copy container
  // makes this independent of whether the Docker daemon shares the host paths.
  const copier = await create(prefix + '-copy', [
    '-v',
    volume + ':/files',
    appImage,
    'node',
    '-e',
    'setInterval(()=>{},1000)',
  ])
  await start(copier)
  // Docker assigns published ports at start; use a reserved HTTP server first.
  await fs.mkdir(resolve(fixtureDirectory, '.edge'), { recursive: true })
  const config = {
    admin: { listen: 'localhost:2019' },
    apps: {
      http: {
        servers: {
          media: {
            listen: [':8081'],
            automatic_https: { disable: true },
            routes: [] as unknown[],
          },
          https: {
            listen: [':8080'],
            automatic_https: { disable: true },
            routes: [] as unknown[],
          },
        },
      },
    },
  }
  await atomicWrite(
    resolve(fixtureDirectory, '.edge/caddy.json'),
    serialize(config),
    0o644,
  )
  await atomicWrite(
    resolve(fixtureDirectory, '.edge/private-control.json'),
    serialize(config),
  )
  await docker(['cp', fixtureDirectory + '/.', copier + ':/files'])
  await docker([
    'exec',
    '--user',
    '0',
    copier,
    'chown',
    '-R',
    '1000:1000',
    '/files',
  ])
  for (const directory of ['/files', '/files/audio', '/files/uploads'])
    assert.equal(
      await docker(['exec', copier, 'stat', '-c', '%a:%u', directory]),
      '755:1000',
    )
  await start(edge)
  await assert.rejects(
    docker([
      'exec',
      edge,
      'caddy',
      'validate',
      '--config',
      '/media/.edge/private-control.json',
    ]),
    /permission denied/,
  )
  await docker([
    'exec',
    edge,
    'caddy',
    'validate',
    '--config',
    '/media/.edge/caddy.json',
  ])
  async function stageEdgeConfig(value: unknown) {
    const path = resolve(fixtureDirectory, '.edge/caddy.json')
    await atomicWrite(path, serialize(value), 0o644)
    await docker(['cp', path, copier + ':/files/.edge/caddy.json'])
    await docker([
      'exec',
      '--user',
      '0',
      copier,
      'chown',
      '1000:1000',
      '/files/.edge/caddy.json',
    ])
    assert.equal(
      await docker([
        'exec',
        '--user',
        '0',
        copier,
        'stat',
        '-c',
        '%a:%u',
        '/files/.edge/caddy.json',
      ]),
      '644:1000',
    )
  }
  const edgePort = await port(edge, '8080/tcp')
  const webOrigin = 'http://' + address + ':' + edgePort,
    mediaOrigin = 'http://' + address + ':' + (await port(edge, '8081/tcp'))
  const profile = profileSchema.parse({
    environment: 'preview',
    webOrigin: 'https://localhost',
    mediaOrigin: 'https://127.0.0.1',
    appMemoryMiB: 384,
    reserveMemoryMiB: 256,
    minimumFreeDiskMiB: 2048,
    readinessSeconds: 30,
  })
  // Only substitute the local HTTP transport; routes/headers remain generated by
  // production code. Trusted public TLS is a separately recorded live check.
  const site = JSON.parse(
    JSON.stringify(renderSite(fixture.manifest, profile)).replaceAll(
      'https://127.0.0.1/downloads/',
      mediaOrigin + '/downloads/',
    ),
  )
  const sentinel = {
    match: [{ path: ['/sentinel'] }],
    handle: [{ handler: 'static_response', body: 'other site' }],
    terminal: true,
  }
  function localSite(host: string, source = site) {
    const value = structuredClone(source) as {
      match?: unknown
      '@id'?: string
      handle: { handler: string; routes?: { match: { host?: string[] }[] }[] }[]
    }
    delete value.match
    delete value['@id']
    const subroute = value.handle.find((h) => h.handler === 'subroute')!
    subroute.routes = subroute.routes!.filter((r) =>
      r.match[0]!.host!.includes(host),
    )
    for (const r of subroute.routes) delete r.match[0]!.host
    return value
  }
  config.apps.http.servers.https.routes = [sentinel, localSite('localhost')]
  config.apps.http.servers.media.routes = [localSite('127.0.0.1')]
  await stageEdgeConfig(config)
  await docker([
    'exec',
    edge,
    'caddy',
    'reload',
    '--config',
    '/media/.edge/caddy.json',
  ])
  await waitReady(
    async () =>
      assert.equal((await get(webOrigin + '/player-test')).status, 200),
    30,
  )
  const mp3Url = mediaOrigin + '/' + encodeURI(fixture.names[1]!)
  const head = await get(mp3Url, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(head.headers.get('content-length'), String(fixture.mp3.length))
  assert.equal(head.headers.get('content-disposition'), null)
  for (const [range, startByte, endByte] of [
    ['bytes=0-99', 0, 99],
    ['bytes=100-', 100, fixture.mp3.length - 1],
    ['bytes=-99', fixture.mp3.length - 99, fixture.mp3.length - 1],
  ] as const) {
    const response = await get(mp3Url, { headers: { Range: range } })
    assert.equal(response.status, 206)
    assert.equal(
      response.headers.get('content-range'),
      `bytes ${startByte}-${endByte}/${fixture.mp3.length}`,
    )
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      fixture.mp3.subarray(startByte, endByte + 1),
    )
  }
  assert.equal(
    (await get(mp3Url, { headers: { Range: 'bytes=999999-' } })).status,
    416,
  )
  const etag = head.headers.get('etag')!
  assert.equal(
    (await get(mp3Url, { headers: { 'If-None-Match': etag } })).status,
    304,
  )
  assert.equal(
    (
      await get(mp3Url, {
        headers: { Range: 'bytes=10-', 'If-Range': '"wrong"' },
      })
    ).status,
    200,
  )
  const first = await get(mp3Url, { headers: { Range: 'bytes=0-1023' } })
  const rest = await get(mp3Url, {
    headers: { Range: 'bytes=1024-', 'If-Range': etag },
  })
  assert.deepEqual(
    Buffer.concat([
      Buffer.from(await first.arrayBuffer()),
      Buffer.from(await rest.arrayBuffer()),
    ]),
    fixture.mp3,
  )
  for (const path of [
    '/downloads/missing',
    '/private.json',
    '/.edge/caddy.json',
    '/wp/wp-content/uploads/missing.png',
  ])
    assert.equal((await get(mediaOrigin + path)).status, 404)
  assert.equal((await get(webOrigin + '/downloads/missing')).status, 404)
  assert.equal(
    (await get(webOrigin + '/downloads/first', { method: 'POST' })).status,
    405,
  )
  assert.equal(
    (await get(webOrigin + '/downloads/first', { redirect: 'manual' })).status,
    307,
  )
  await execute(
    'pnpm',
    ['exec', 'playwright', 'test', '--config', 'playwright.delivery.config.ts'],
    { DELIVERY_WEB_ORIGIN: webOrigin },
  )
  // App replacement must not interrupt the shared edge or media.
  await docker(['stop', fixtureApp])
  assert.equal(await (await get(webOrigin + '/sentinel')).text(), 'other site')
  assert.deepEqual(
    Buffer.from(await (await get(mp3Url)).arrayBuffer()),
    fixture.mp3,
  )
  assert.equal((await get(webOrigin + '/player-test')).status, 502)
  await start(fixtureApp)
  await waitReady(
    async () =>
      assert.equal((await get(webOrigin + '/player-test')).status, 200),
    30,
  )
  const before = await docker([
    'inspect',
    '--format',
    '{{.State.StartedAt}}',
    edge,
  ])
  await docker([
    'exec',
    edge,
    'caddy',
    'reload',
    '--config',
    '/media/.edge/caddy.json',
  ])
  assert.equal(
    await docker(['inspect', '--format', '{{.State.StartedAt}}', edge]),
    before,
  )
  assert.equal(await (await get(webOrigin + '/sentinel')).text(), 'other site')
  // Exercise the exact canonical runtime through the same edge, independently
  // of the tiny catalog used by the attachment/browser fixture.
  const canonicalSite = JSON.parse(
    JSON.stringify(site).replaceAll('nurevolution-preview:3000', app + ':3000'),
  )
  // Preserve the existing www redirect without relying on WordPress or its TLS.
  const wwwSite = localSite('www.nurevolution.net', canonicalSite)
  config.apps.http.servers.https.routes = [sentinel, wwwSite]
  await stageEdgeConfig(config)
  await docker([
    'exec',
    edge,
    'caddy',
    'reload',
    '--config',
    '/media/.edge/caddy.json',
  ])
  for (const path of [
    '/',
    '/feed/podcast',
    '/episodes/a%20b?q=two%20words&x=1',
  ]) {
    const redirect = await get(webOrigin + path, { redirect: 'manual' })
    assert.equal(redirect.status, 301)
    assert.equal(
      redirect.headers.get('location'),
      'https://nurevolution.net' + path,
    )
  }
  assert.equal(await (await get(webOrigin + '/sentinel')).text(), 'other site')
  config.apps.http.servers.https.routes = [
    sentinel,
    localSite('localhost', canonicalSite),
  ]
  await stageEdgeConfig(config)
  await docker([
    'exec',
    edge,
    'caddy',
    'reload',
    '--config',
    '/media/.edge/caddy.json',
  ])
  assert.equal(
    (await (await get(webOrigin + '/api/health')).json()).release,
    commit,
  )
  const proxiedFeed = await get(webOrigin + '/feed/podcast')
  assert.equal((await proxiedFeed.text()).match(/<item>/g)!.length, 55)
  const feedTag = proxiedFeed.headers.get('etag')!
  assert.ok(feedTag)
  assert.equal(
    (
      await get(webOrigin + '/feed/podcast', {
        headers: { 'If-None-Match': feedTag },
      })
    ).status,
    304,
  )
  // Invalid edge configuration must leave the active configuration intact.
  await fs.writeFile(
    resolve(fixtureDirectory, '.edge/invalid.json'),
    '{"invalid":true}',
  )
  await docker([
    'cp',
    resolve(fixtureDirectory, '.edge/invalid.json'),
    copier + ':/files/.edge/invalid.json',
  ])
  await assert.rejects(
    docker([
      'exec',
      edge,
      'caddy',
      'reload',
      '--config',
      '/media/.edge/invalid.json',
    ]),
  )
  assert.equal(await (await get(webOrigin + '/sentinel')).text(), 'other site')
  assert.equal((await get(webOrigin + '/api/health')).status, 200)
  await docker([
    'save',
    '--platform',
    'linux/amd64',
    '-o',
    resolve(artifacts, 'runtime.tar'),
    appImage,
  ])
  await docker([
    'save',
    '--platform',
    'linux/amd64',
    '-o',
    resolve(artifacts, 'caddy.tar'),
    caddyImage,
  ])
  const imageId = await archiveConfigDigest(
    resolve(artifacts, 'runtime.tar'),
    execute,
  )
  const caddyImageId = await archiveConfigDigest(
    resolve(artifacts, 'caddy.tar'),
    execute,
  )
  const caddyBinarySha256 = (
    await docker(['exec', edge, 'sha256sum', '/usr/bin/caddy'])
  ).split(/\s+/)[0]!
  await fs.writeFile(
    resolve(artifacts, 'images.json'),
    serialize({
      sourceCommit: commit,
      appTag: appImage,
      caddyTag: caddyImage,
      imageId,
      caddyImageId,
      caddyBinarySha256,
    }),
  )
  await fs.writeFile(
    resolve(artifacts, 'delivery-evidence.json'),
    serialize({
      sourceCommit: commit,
      imageId,
      caddyImageId,
      caddyBinarySha256,
      episodePages: 55,
      browserEngines: 3,
      memoryLimitMiB: 384,
      passedAt: new Date().toISOString(),
      publicTls: 'pending live rehearsal',
    }),
  )
  console.log(
    'Delivery passed: proxy, ranges/resume, three browser downloads, restart isolation; exact tested images exported',
  )
} finally {
  for (const container of containers.reverse())
    await docker(['rm', '-f', container]).catch((error) =>
      console.error('Cleanup:', error),
    )
  if (madeVolume) await docker(['volume', 'rm', volume])
  if (madeNetwork) await docker(['network', 'rm', network])
  for (const image of [appImage, caddyImage, fixtureImage])
    await docker(['image', 'rm', image]).catch(() => {})
}
