import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import type { createDownloadResponder } from './response'

export function downloadHandler(
  respond: ReturnType<typeof createDownloadResponder>,
) {
  return defineEventHandler(async (event) => {
    const controller = new AbortController()
    const disconnect = () => {
      if (!event.node.res.writableFinished) controller.abort()
    }
    event.node.res.on('close', disconnect)
    try {
      const response = await respond(
        getRouterParam(event, 'slug') ?? '',
        new Request(getRequestURL(event), {
          method: event.method,
          signal: controller.signal,
        }),
      )
      setResponseStatus(event, response.status)
      setResponseHeaders(event, Object.fromEntries(response.headers))
      if (!response.body) {
        event.node.res.end()
        return
      }
      try {
        // H3 v1's web-stream bridge ignores write() backpressure. Node's pipeline
        // waits for drain, cancels its source on disconnect, and destroys failed transfers.
        await pipeline(
          Readable.fromWeb(response.body as NodeReadableStream),
          event.node.res,
          { signal: controller.signal },
        )
      } catch {
        controller.abort()
        event.node.res.destroy()
        // The connection is closed; return without rendering an error document.
      }
    } finally {
      event.node.res.off('close', disconnect)
    }
  })
}
