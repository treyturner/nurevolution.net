import { expect, it } from 'vitest'
import profile from '../../../deploy/profile.example.json'
import initial from '../../../deploy/caddy/initial.example.json'
import {
  profileSchema,
  renderSite,
  replaceSite,
  type JsonObject,
} from '../../../tools/deploy/render-config.ts'
import { createManifest } from '../../../tools/deploy/manifest.ts'
import { runnableCatalog } from '../content/fixtures.ts'

it('renders exact public routes, attachment redirects and a complete download fallback', () => {
  const c = runnableCatalog(),
    m = createManifest(c, 'a'.repeat(40), '2026-09-09T00:00:00.000Z', c.assets)
  const p = profileSchema.parse(profile)
  const site = renderSite(m, p)
  const json = JSON.stringify(site)
  expect(json).toContain('attachment;')
  expect(json).toContain('podcast.nurevolution.net/downloads/')
  expect(json).not.toContain('noindex')
  expect(json).toContain('nurevolution-production:3000')
  expect(json).toContain('"not":[{"method":["GET","HEAD"]}]')
  for (const environment of ['staging', 'development', undefined])
    expect(() => profileSchema.parse({ ...p, environment })).toThrow()
  expect(() =>
    renderSite(m, { ...p, webOrigin: 'https://podcast.nurevolution.net' }),
  ).toThrow('Website and media origins must differ')
  expect(() => renderSite(m, { ...p, mediaOrigin: p.webOrigin })).toThrow()
  for (const field of ['webOrigin', 'mediaOrigin'])
    expect(() =>
      renderSite(m, { ...p, [field]: 'https://www.nurevolution.net' }),
    ).toThrow('overlap')
  for (const url of [
    'http://example.com',
    'https://example.com/path',
    'https://me:secret@example.com',
  ])
    expect(() => profileSchema.parse({ ...p, webOrigin: url })).toThrow()
})

it('compares complete parsed hostnames when rejecting overlapping routes', () => {
  const catalog = runnableCatalog()
  const manifest = createManifest(
    catalog,
    'a'.repeat(40),
    '2026-09-09T00:00:00.000Z',
    catalog.assets,
  )
  const p = profileSchema.parse(profile)
  for (const origins of [
    { webOrigin: 'https://www.nurevolution.net:8443' },
    { mediaOrigin: 'https://www.nurevolution.net:8443' },
    { mediaOrigin: 'https://nurevolution.net:8443' },
    { webOrigin: 'https://podcast.nurevolution.net:8443' },
    {
      webOrigin: 'https://preview.example:8443',
      mediaOrigin: 'https://preview.example:9443',
    },
  ])
    expect(() => renderSite(manifest, { ...p, ...origins })).toThrow(
      'Host mappings overlap',
    )

  // Operator-configured alternate hosts remain supported. Text within a
  // different hostname must not be mistaken for the reserved www hostname.
  for (const hostname of [
    'www.nurevolution.net.example.org',
    'prefix-www.nurevolution.net',
    'nurevolution.net.example.org',
    'podcast.nurevolution.net.example.org',
  ])
    for (const field of ['webOrigin', 'mediaOrigin']) {
      const site = renderSite(manifest, {
        ...p,
        [field]: 'https://' + hostname,
      })
      expect(site.match[0]!.host).toContain(hostname)
      expect(site.handle[0]!.routes[0]).toMatchObject({
        match: [{ host: ['www.nurevolution.net'] }],
        handle: [{ status_code: 301 }],
      })
    }
})

it('replaces owned routes while retaining other sites and TLS configuration', () => {
  const config = structuredClone(initial) as unknown as Parameters<
    typeof replaceSite
  >[0]
  const first = replaceSite(config, { '@id': 'nurevolution', handle: [] })
  const next = replaceSite(first, { '@id': 'nurevolution', handle: ['new'] })
  expect(JSON.stringify(next)).toContain('new')
  expect(JSON.stringify(config)).not.toContain('nurevolution","handle')
  expect(() => replaceSite({}, {})).toThrow('Missing')
  const broken = {
    apps: {
      http: {
        servers: {
          https: {
            routes: [{ '@id': 'nurevolution' }, { '@id': 'nurevolution' }],
          },
        },
      },
    },
  }
  expect(() => replaceSite(broken, {})).toThrow('Duplicate')
  broken.apps.http.servers.https.routes = [
    { '@id': 'nurevolution-transport' },
    { '@id': 'nurevolution-transport' },
  ]
  expect(() => replaceSite(broken, {})).toThrow('Duplicate transport')
})

it.each([{ protocols: undefined }, { protocols: ['h1', 'h2', 'h3'] }])(
  'disables default or explicit HTTP/3 on the production listener while preserving other servers',
  ({ protocols }) => {
    const sentinel = { '@id': 'other-site', handle: [] }
    const diagnostic = {
      listen: [':38443'],
      protocols: ['h1', 'h2', 'h3'],
      routes: [{ '@id': 'quic-test', handle: [] }],
    }
    const https = {
      ...initial.apps.http.servers.https,
      protocols,
      listen_protocols: [['h3']],
      read_timeout: 30_000_000_000,
      routes: [sentinel, { '@id': 'nurevolution', handle: ['old'] }],
    }
    const config = {
      ...initial,
      apps: {
        ...initial.apps,
        http: { servers: { https, diagnostic } },
      },
    }
    const original = structuredClone(config)
    const site = { '@id': 'nurevolution', handle: ['new'] }
    const updated = replaceSite(config, site) as typeof config
    expect(updated.apps.http.servers.https).toEqual({
      ...https,
      protocols: ['h1', 'h2'],
      listen_protocols: undefined,
      routes: [
        {
          '@id': 'nurevolution-transport',
          handle: [
            {
              handler: 'headers',
              response: { set: { 'Alt-Svc': ['clear'] }, deferred: true },
            },
          ],
        },
        sentinel,
        site,
      ],
    })
    expect(updated.apps.http.servers.https).not.toHaveProperty(
      'listen_protocols',
    )
    expect(updated.apps.http.servers.diagnostic).toEqual(diagnostic)
    expect(updated.apps.tls).toEqual(initial.apps.tls)
    expect(config).toEqual(original)
  },
)

it.each(['before', 'after'])(
  'preserves listener-wide clearing when legacy rollback changes hosts and the policy was %s the site',
  (position) => {
    const sentinel = { '@id': 'other-site', handle: [] }
    const previousSite = {
      '@id': 'nurevolution',
      match: [{ host: ['restored-web.example', 'restored-media.example'] }],
      handle: [{ handler: 'static_response', body: 'previous release' }],
      terminal: true,
    }
    const stalePolicy = {
      '@id': 'nurevolution-transport',
      match: [{ host: ['old.example'] }],
      handle: [],
    }
    const config = {
      apps: {
        http: {
          servers: {
            https: {
              protocols: ['h1', 'h2', 'h3'],
              routes: [
                sentinel,
                ...(position === 'before'
                  ? [stalePolicy, previousSite]
                  : [previousSite, stalePolicy]),
              ] as JsonObject[],
            },
          },
        },
      },
    }
    const candidate = {
      ...previousSite,
      match: [{ host: ['current-web.example', 'current-media.example'] }],
      handle: [{ handler: 'static_response', body: 'candidate release' }],
    }
    const promoted = replaceSite(config, candidate) as typeof config
    expect(replaceSite(promoted, candidate)).toEqual(promoted)
    const rolledBack = structuredClone(promoted)
    const server = rolledBack.apps.http.servers.https
    // Pre-mitigation replaceSite replaces just this ID in place, preserving
    // all other routes and listener settings. Its renderSite has no headers
    // and uses the current profile, which may reintroduce alternate hosts.
    server.routes.splice(
      server.routes.findIndex((r) => r['@id'] === 'nurevolution'),
      1,
      previousSite,
    )
    expect(server.protocols).toEqual(['h1', 'h2'])
    expect(server.routes).toEqual([
      {
        '@id': 'nurevolution-transport',
        handle: [
          {
            handler: 'headers',
            response: { set: { 'Alt-Svc': ['clear'] }, deferred: true },
          },
        ],
      },
      sentinel,
      previousSite,
    ])
    expect(server.routes[0]).not.toHaveProperty('match')
    expect(JSON.stringify(previousSite)).not.toContain('Alt-Svc')
    expect(replaceSite(rolledBack, candidate)).toEqual(promoted)
  },
)
