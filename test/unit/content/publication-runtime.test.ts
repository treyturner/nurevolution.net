import * as fs from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import {
  publicationReader,
  publicationFile,
  publicationRoot,
} from '../../../server/utils/publication.ts'

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true })
})
async function fixture() {
  const root = await fs.mkdtemp(resolve(tmpdir(), 'publication-runtime-'))
  roots.push(root)
  await fs.mkdir(resolve(root, 'content/episodes'), { recursive: true })
  await fs.writeFile(resolve(root, 'content/show.json'), '{"title":"New show"}')
  await fs.writeFile(
    resolve(root, 'content/episodes/new.json'),
    '{"title":"New episode"}',
  )
  return root
}

it('reads the mounted catalog with relative paths and rejects traversal', async () => {
  const root = await fixture()
  const reader = publicationReader(resolve(root, 'content'))
  expect((await reader.list()).sort()).toEqual([
    'episodes/new.json',
    'show.json',
  ])
  expect(await reader.read('episodes/new.json')).toEqual({
    title: 'New episode',
  })
  await expect(reader.read('../outside.json')).rejects.toThrow('relative path')
  vi.stubEnv('NUXT_PUBLICATION_ROOT', root)
  expect(publicationRoot()).toBe(root)
  expect((await publicationFile('content/show.json')).toString()).toContain(
    'New show',
  )
  expect(() => publicationFile('/etc/passwd')).toThrow('relative path')
  vi.stubEnv('NUXT_PUBLICATION_ROOT', '')
  expect(() => publicationFile('content/show.json')).toThrow(
    'No publication snapshot',
  )
})

it('serves only snapshot artwork with immutable headers and never falls back to older images', async () => {
  const root = await fixture()
  vi.stubEnv('NUXT_PUBLICATION_ROOT', root)
  const path = '/episode-artwork/v1-' + 'a'.repeat(64) + '.jpg'
  await fs.mkdir(resolve(root, 'public/episode-artwork'), { recursive: true })
  await fs.writeFile(resolve(root, 'public' + path), 'image bytes')
  vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
  vi.stubGlobal(
    'getRequestURL',
    (event: { path: string }) => new URL(event.path, 'http://localhost'),
  )
  vi.stubGlobal('createError', (error: object) =>
    Object.assign(new Error('http error'), error),
  )
  const headers = vi.fn()
  vi.stubGlobal('setResponseHeaders', headers)
  const handler = (
    await import('../../../server/middleware/publication-artwork.ts')
  ).default as unknown as (event: {
    path: string
    method: string
  }) => Promise<Buffer | string | undefined>
  expect((await handler({ path, method: 'GET' }))?.toString()).toBe(
    'image bytes',
  )
  expect(headers.mock.calls.at(-1)?.[1]).toMatchObject({
    'content-type': 'image/jpeg',
    'content-length': 11,
    'cache-control': 'public, max-age=31536000, immutable',
  })
  expect(await handler({ path, method: 'HEAD' })).toBe('')
  await expect(handler({ path, method: 'POST' })).rejects.toMatchObject({
    statusCode: 405,
  })
  await fs.unlink(resolve(root, 'public' + path))
  await expect(handler({ path, method: 'GET' })).rejects.toMatchObject({
    statusCode: 404,
  })
  expect(
    await handler({ path: '/content/show.json', method: 'GET' }),
  ).toBeUndefined()
  vi.stubEnv('NUXT_PUBLICATION_ROOT', '')
  expect(await handler({ path, method: 'GET' })).toBeUndefined()
})
