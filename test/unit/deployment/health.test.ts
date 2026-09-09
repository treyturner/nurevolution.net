import { afterEach, expect, it, vi } from 'vitest'
import { healthStatus } from '../../../server/health/status.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

it('reports catalog readiness and release identity without exposing errors', async () => {
  const load = vi.fn().mockResolvedValue({})
  expect(await healthStatus(load, 'a'.repeat(40))).toEqual({
    status: 200,
    body: { healthy: true, release: 'a'.repeat(40) },
  })
  expect((await healthStatus(load, 'development')).status).toBe(200)
  expect((await healthStatus(load, 'invalid')).status).toBe(503)
  load.mockRejectedValue(new Error('private path / secret'))
  expect(await healthStatus(load, 'a'.repeat(40))).toEqual({
    status: 503,
    body: { healthy: false },
  })
})

it('binds the endpoint to packaged content and disables caching', async () => {
  const show = vi.fn().mockResolvedValue({})
  vi.doMock('../../../server/utils/content.ts', () => ({
    contentRepository: { show },
  }))
  vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
  const status = vi.fn(),
    header = vi.fn()
  vi.stubGlobal('setResponseStatus', status)
  vi.stubGlobal('setHeader', header)
  const { default: endpoint } =
    await import('../../../server/api/health.get.ts')
  const invoke = endpoint as unknown as (event: object) => Promise<unknown>
  vi.stubEnv('NUREVOLUTION_RELEASE', undefined)
  expect(await invoke({})).toEqual({ healthy: true, release: 'development' })
  vi.stubEnv('NUREVOLUTION_RELEASE', 'b'.repeat(40))
  expect(await invoke({})).toEqual({ healthy: true, release: 'b'.repeat(40) })
  show.mockRejectedValue(new Error('bad content'))
  expect(await invoke({})).toEqual({ healthy: false })
  expect(status).toHaveBeenLastCalledWith({}, 503)
  expect(header).toHaveBeenLastCalledWith({}, 'Cache-Control', 'no-store')
})
