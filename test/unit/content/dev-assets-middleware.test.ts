import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

it('leaves dev media and download URLs untouched outside the development runtime', async () => {
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal(
    'getRequestURL',
    (event: { path: string }) => new URL(event.path, 'http://localhost'),
  )
  const status = vi.fn()
  vi.stubGlobal('setResponseStatus', status)
  const handler = (await import('../../../server/middleware/dev-assets.ts'))
    .default as unknown as (event: { path: string }) => Promise<unknown>
  for (const path of [
    '/__dev/assets/audio/local.mp3',
    '/downloads/local',
    '/api/show',
  ])
    expect(await handler({ path })).toBeUndefined()
  expect(status).not.toHaveBeenCalled()
})
