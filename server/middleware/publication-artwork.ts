import { publicationFile, publicationRoot } from '../utils/publication.ts'

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  if (
    !publicationRoot() ||
    !/^\/(?:episode-artwork\/v1-[a-f0-9]{64}\.jpg|artwork-thumbnails\/v1-[a-f0-9]{64}\.webp)$/.test(
      path,
    )
  )
    return
  if (!['GET', 'HEAD'].includes(event.method))
    throw createError({ statusCode: 405 })
  let bytes: Buffer
  try {
    bytes = await publicationFile('public' + path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      throw createError({ statusCode: 404 })
    throw error
  }
  setResponseHeaders(event, {
    'content-type': path.endsWith('.jpg') ? 'image/jpeg' : 'image/webp',
    'content-length': bytes.length,
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  })
  return event.method === 'HEAD' ? '' : bytes
})
