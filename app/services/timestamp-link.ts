export type TimestampIntent =
  { kind: 'none' } | { kind: 'invalid' } | { kind: 'time'; seconds: number }

const maximumLength = 64
/** Compare only the explicit parameter, preserving duplicates and invalid input. */
export function timestampKey(route: string) {
  return JSON.stringify(
    new URL(route, 'https://timestamp.invalid').searchParams.getAll('t'),
  )
}
export function timestampIntent(
  path: string,
  query: Record<string, unknown>,
): TimestampIntent {
  if (
    !/^\/episodes\/[^/?#]+\/?$/.test(path) ||
    !Object.prototype.hasOwnProperty.call(query, 't')
  )
    return { kind: 'none' }
  const input = query.t
  if (
    typeof input !== 'string' ||
    input.length > maximumLength ||
    !/^\d+(?:\.\d+)?$/.test(input)
  )
    return { kind: 'invalid' }
  const seconds = Number(input)
  return Number.isFinite(seconds) && seconds <= Number.MAX_SAFE_INTEGER
    ? { kind: 'time', seconds }
    : { kind: 'invalid' }
}

export function sameTimestamp(left: TimestampIntent, right: TimestampIntent) {
  return (
    left.kind === right.kind &&
    (left.kind !== 'time' ||
      (right.kind === 'time' && left.seconds === right.seconds))
  )
}

/** Round-trip numeric precision, with no exponent or later-time rounding. */
export function timestampSeconds(seconds: number): string | null {
  if (
    !Number.isFinite(seconds) ||
    seconds < 0 ||
    seconds > Number.MAX_SAFE_INTEGER
  )
    return null
  const [mantissa, exponent] = String(seconds).split('e')
  if (exponent === undefined) return mantissa!
  // The safe-integer bound excludes positive exponents in Number#toString.
  const expanded = `0.${'0'.repeat(-Number(exponent) - 1)}${mantissa!.replace('.', '')}`
  // Do not generate a URL that our bounded parser cannot accept.
  return expanded.length <= maximumLength ? expanded : null
}

export function timestampUrl(baseUrl: string, path: string, seconds: number) {
  const value = timestampSeconds(seconds)
  if (value === null) return null
  const url = new URL(path, baseUrl)
  url.search = ''
  url.hash = ''
  url.searchParams.set('t', value)
  return url.href
}
