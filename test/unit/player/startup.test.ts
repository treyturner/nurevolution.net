import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'

const code = readFileSync(
  new URL('../../../public/player-startup.js', import.meta.url),
  'utf8',
)
afterEach(() => vi.useRealTimers())
function fixture(pending = true, prerendering = false) {
  vi.useFakeTimers()
  let failed = false
  const node = {
    setAttribute: () => {
      failed = true
    },
    removeAttribute: () => {
      failed = false
    },
  }
  const document = Object.assign(new EventTarget(), {
    prerendering,
    querySelector: () => (pending ? node : null),
    querySelectorAll: (selector: string) =>
      selector.includes('failed')
        ? failed
          ? [node]
          : []
        : pending
          ? [node]
          : [],
  })
  runInNewContext(code, { document, window: { setTimeout, clearTimeout } })
  return {
    document,
    failed: () => failed,
    initialized: () => {
      pending = false
      document.dispatchEvent(new Event('nurevolution:player-ready'))
    },
  }
}
it('waits 15 seconds for missing application initialization and recovers on late success', () => {
  const state = fixture()
  vi.advanceTimersByTime(14999)
  expect(state.failed()).toBe(false)
  vi.advanceTimersByTime(1)
  expect(state.failed()).toBe(true)
  state.initialized()
  expect(state.failed()).toBe(false)
  vi.advanceTimersByTime(30000)
  expect(state.failed()).toBe(false)
})
it('does not warn for early success or an empty/already initialized player', () => {
  const complete = fixture(false)
  const early = fixture()
  early.initialized()
  vi.advanceTimersByTime(30000)
  expect(early.failed()).toBe(false)
  expect(complete.failed()).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})
it('starts its timeout on activation rather than during prerendering', () => {
  const state = fixture(true, true)
  vi.advanceTimersByTime(60000)
  expect(state.failed()).toBe(false)
  state.document.prerendering = false
  state.document.dispatchEvent(new Event('prerenderingchange'))
  vi.advanceTimersByTime(15000)
  expect(state.failed()).toBe(true)
  state.initialized()
  expect(state.failed()).toBe(false)
})
