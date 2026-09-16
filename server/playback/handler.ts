import { pipeline } from 'node:stream/promises'
import { createPlaybackResponder, type PlaybackOptions } from './response.ts'
export function playbackHandler(options: () => PlaybackOptions | null) {
  return defineEventHandler(async (event) => {
    const selected = options()
    if (!selected) throw createError({ statusCode: 404 })
    const controller = new AbortController()
    const disconnect = () => {
      if (!event.node.res.writableFinished) controller.abort()
    }
    event.node.res.on('close', disconnect)
    try {
      const url = getRequestURL(event)
      const respond = createPlaybackResponder(selected)
      const response = await respond(
        url.pathname,
        new Request(url, {
          method: event.method,
          headers: getRequestHeaders(event) as HeadersInit,
          signal: controller.signal,
        }),
      )
      setResponseStatus(event, response.status)
      setResponseHeaders(event, response.headers)
      if (!response.body) {
        event.node.res.end()
        return
      }
      try {
        await pipeline(response.body, event.node.res, {
          signal: controller.signal,
        })
      } catch {
        controller.abort()
        event.node.res.destroy()
      }
    } finally {
      event.node.res.off('close', disconnect)
    }
  })
}
