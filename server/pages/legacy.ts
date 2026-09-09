export function createLegacyResponder(
  find: (path: string, asOf: number) => Promise<string | undefined>,
  now: () => number = Date.now,
  log: (error: unknown) => void = console.error,
) {
  return async (method: string, path: string) => {
    const headers: Record<string, string> = {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    }
    if (method !== 'GET' && method !== 'HEAD')
      return {
        status: 405,
        headers: { ...headers, allow: 'GET, HEAD' },
        body: 'Method not allowed.\n',
      }
    try {
      const location = await find(path, now())
      return {
        status: location ? 301 : 404,
        headers: { ...headers, ...(location ? { location } : {}) },
        body:
          method === 'HEAD'
            ? ''
            : location
              ? 'Moved permanently.\n'
              : 'Episode not found.\n',
      }
    } catch (error) {
      log(error)
      return {
        status: 503,
        headers,
        body: method === 'HEAD' ? '' : 'Archive temporarily unavailable.\n',
      }
    }
  }
}
