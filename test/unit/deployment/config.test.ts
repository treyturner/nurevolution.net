import { expect, it } from 'vitest'
import profile from '../../../deploy/profile.example.json'
import initial from '../../../deploy/caddy/initial.example.json'
import {
  profileSchema,
  renderSite,
  replaceSite,
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
  expect(json).toContain('podcast-preview.nurevolution.net/downloads/')
  expect(json).toContain('noindex, nofollow')
  expect(json).toContain('nurevolution-preview:3000')
  expect(json).toContain('"not":[{"method":["GET","HEAD"]}]')
  expect(
    JSON.stringify(renderSite(m, { ...p, environment: 'production' })),
  ).not.toContain('noindex')
  expect(() =>
    renderSite(m, { ...p, webOrigin: 'https://podcast.nurevolution.net' }),
  ).toThrow('overlap')
  expect(() => renderSite(m, { ...p, mediaOrigin: p.webOrigin })).toThrow()
  for (const url of [
    'http://example.com',
    'https://example.com/path',
    'https://me:secret@example.com',
  ])
    expect(() => profileSchema.parse({ ...p, webOrigin: url })).toThrow()
})

it('replaces only the owned route while retaining other sites and TLS configuration', () => {
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
})
