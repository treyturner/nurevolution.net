/** Tiny, fixed test assets with real byte-range delivery for native seeking/looping. */
export default defineEventHandler(async (event) => {
  assertMethod(event, ['GET', 'HEAD'])
  const name = getRouterParam(event, 'name')
  if (name !== 'sample.wav' && name !== 'sample.mp3' && name !== 'long.wav')
    throw createError({ statusCode: 404 })
  const asset = await useStorage('assets:media').getItemRaw<Uint8Array>(name)
  if (!asset)
    throw createError({
      statusCode: 500,
      statusMessage: 'Missing media fixture',
    })
  const bytes = Buffer.from(asset)
  setResponseHeaders(event, {
    'Content-Type': name.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  })
  let start = 0
  let end = bytes.length - 1
  // HEAD ignores Range. Unsupported/malformed ranges and If-Range fall back to 200.
  const range =
    event.method === 'GET' && !getRequestHeader(event, 'if-range')
      ? /^bytes=(\d*)-(\d*)$/.exec(getRequestHeader(event, 'range') ?? '')
      : null
  if (range && (range[1] || range[2])) {
    start = range[1]
      ? Number(range[1])
      : Math.max(0, bytes.length - Number(range[2]))
    end = range[1] && range[2] ? Math.min(Number(range[2]), end) : end
    if (!Number.isSafeInteger(start) || start > end) {
      setResponseStatus(event, 416)
      setResponseHeaders(event, {
        'Content-Range': `bytes */${bytes.length}`,
        'Content-Length': '0',
      })
      return null
    }
    setResponseStatus(event, 206)
    setResponseHeader(
      event,
      'Content-Range',
      `bytes ${start}-${end}/${bytes.length}`,
    )
  }
  setResponseHeader(event, 'Content-Length', end - start + 1)
  // Node omits the body for HEAD while retaining the representation headers.
  return bytes.subarray(start, end + 1)
})
