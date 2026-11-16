import { pipeline } from 'node:stream/promises'

let responder: Awaited<ReturnType<typeof load>> | undefined
async function load() {
  const { createWorktreeMedia } = await import('../dev/worktree-media.ts')
  const { readCatalog } = await import('../content/repository.ts')
  const { fileReader } = await import('../../tools/content/files.ts')
  return createWorktreeMedia(
    process.cwd(),
    async () => (await readCatalog(fileReader('content'))).catalog,
  )
}

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  if (
    !import.meta.dev ||
    !(path.startsWith('/__dev/assets/') || path.startsWith('/downloads/'))
  )
    return
  responder ??= await load()
  const controller = new AbortController()
  const disconnect = () => {
    if (!event.node.res.writableFinished) controller.abort()
  }
  event.node.res.on('close', disconnect)
  try {
    const url = getRequestURL(event)
    const response = await responder(
      url.pathname,
      new Request(url, {
        method: event.method,
        headers: getRequestHeaders(event) as HeadersInit,
        signal: controller.signal,
      }),
    )
    // Keep the existing download proxy for episodes without local audio.
    if (path.startsWith('/downloads/') && response.status === 307) return
    setResponseStatus(event, response.status)
    setResponseHeaders(event, response.headers)
    if (response.body)
      await pipeline(response.body, event.node.res, {
        signal: controller.signal,
      })
    else event.node.res.end()
  } catch {
    controller.abort()
    event.node.res.destroy()
  } finally {
    event.node.res.off('close', disconnect)
  }
})
