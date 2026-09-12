import { z } from 'zod'
import { safeAsset, validateManifest, type MediaManifest } from './manifest.ts'

const origin = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.origin === value &&
      !url.username &&
      !url.password
    )
  }, 'Expected an HTTPS origin without credentials or path')
export const profileSchema = z
  .strictObject({
    environment: z.enum(['preview', 'production']),
    webOrigin: origin,
    mediaOrigin: origin,
    appMemoryMiB: z.int().min(128).max(512),
    reserveMemoryMiB: z.int().min(128),
    minimumFreeDiskMiB: z.int().min(1024),
    readinessSeconds: z.int().min(10).max(120),
  })
  .refine(
    (p) => p.webOrigin !== p.mediaOrigin,
    'Website and media origins must differ',
  )
export type Profile = z.infer<typeof profileSchema>
export type JsonObject = { [key: string]: unknown }
const response = (
  status: number,
  body = '',
  headers: Record<string, string[]> = {},
) => ({ handler: 'static_response', status_code: status, body, headers })
const route = (match: JsonObject, handle: JsonObject[]) => ({
  match: [match],
  handle,
  terminal: true,
})

export function renderSite(manifest: MediaManifest, profile: Profile) {
  validateManifest(manifest)
  profileSchema.parse(profile)
  const web = new URL(profile.webOrigin).hostname
  const media = new URL(profile.mediaOrigin).hostname
  const webHosts = [...new Set([web, 'nurevolution.net'])]
  const mediaHosts = [...new Set([media, 'podcast.nurevolution.net'])]
  const www = 'www.nurevolution.net'
  if (
    webHosts.some((host) => mediaHosts.includes(host)) ||
    [...webHosts, ...mediaHosts].includes(www)
  )
    throw new Error('Host mappings overlap')
  const routes: JsonObject[] = []
  routes.push(
    route({ host: [www] }, [
      response(301, '', {
        Location: ['https://nurevolution.net{http.request.uri}'],
      }),
    ]),
  )
  routes.push(
    route(
      {
        not: [{ method: ['GET', 'HEAD'] }],
        path: ['/downloads', '/downloads/*'],
        host: [...webHosts, ...mediaHosts],
      },
      [response(405, '', { Allow: ['GET, HEAD'] })],
    ),
  )
  for (const entry of manifest.assets.filter((entry) => entry.public)) {
    const path = safeAsset(entry.asset)
    const headers = {
      'Content-Type': [entry.asset.mediaType],
      'X-Content-Type-Options': ['nosniff'],
    }
    const serve = (extra: Record<string, string[]> = {}) => [
      { handler: 'headers', response: { set: { ...headers, ...extra } } },
      {
        handler: 'rewrite',
        uri: encodeURI(
          '/' + entry.asset.sourceRoot + '/' + entry.asset.relativePath,
        )
          .replaceAll('?', '%3F')
          .replaceAll('#', '%23'),
      },
      { handler: 'file_server', root: '/media', hide: ['/media/.*'] },
    ]
    routes.push(
      route(
        {
          host: entry.asset.kind === 'audio' ? mediaHosts : webHosts,
          path: [path],
          method: ['GET', 'HEAD'],
        },
        serve(),
      ),
    )
    for (const download of entry.downloads) {
      const path = '/downloads/' + download.slug
      routes.push(
        route({ host: webHosts, path: [path], method: ['GET', 'HEAD'] }, [
          response(307, '', {
            Location: [profile.mediaOrigin + path],
            'Cache-Control': ['no-store'],
          }),
        ]),
      )
      routes.push(
        route(
          { host: mediaHosts, path: [path], method: ['GET', 'HEAD'] },
          serve({
            // WebKit treats redirected audio/mpeg as playable media despite
            // Content-Disposition. This endpoint exists only for saving bytes.
            'Content-Type': ['application/octet-stream'],
            'Content-Disposition': [download.disposition],
            'Cache-Control': ['no-store'],
          }),
        ),
      )
    }
  }
  routes.push(
    route(
      {
        host: [...webHosts, ...mediaHosts],
        path: [
          '/downloads',
          '/downloads/*',
          '/wp/wp-content/uploads',
          '/wp/wp-content/uploads/*',
        ],
      },
      [response(404)],
    ),
  )
  routes.push(
    route({ host: webHosts }, [
      {
        handler: 'reverse_proxy',
        upstreams: [{ dial: `nurevolution-${profile.environment}:3000` }],
      },
    ]),
  )
  routes.push(route({ host: mediaHosts }, [response(404)]))
  return {
    '@id': 'nurevolution',
    match: [{ host: [...webHosts, ...mediaHosts, www] }],
    handle: [
      ...(profile.environment === 'preview'
        ? [
            {
              handler: 'headers',
              response: { set: { 'X-Robots-Tag': ['noindex, nofollow'] } },
            },
          ]
        : []),
      { handler: 'subroute', routes },
    ],
    terminal: true,
  }
}

// Preserve every unrelated route and all operator-owned server/TLS settings.
export function replaceSite(config: JsonObject, site: JsonObject): JsonObject {
  const value = structuredClone(config)
  const servers = (
    value.apps as
      | { http?: { servers?: Record<string, { routes: JsonObject[] }> } }
      | undefined
  )?.http?.servers
  if (!servers?.https || !Array.isArray(servers.https.routes))
    throw new Error('Missing operator-owned https server')
  const routes = servers.https.routes
  const matches = routes.filter((r) => r['@id'] === 'nurevolution')
  if (matches.length > 1) throw new Error('Duplicate owned proxy route')
  if (matches.length) routes.splice(routes.indexOf(matches[0]!), 1, site)
  else routes.unshift(site)
  return value
}
