/** One byte range; undefined means ignore, null means unsatisfiable. */
export function byteRange(value: string | null, length: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value ?? '')
  if (!match || (!match[1] && !match[2])) return undefined
  const first = match[1] ? Number(match[1]) : null
  const last = match[2] ? Number(match[2]) : null
  if ([first, last].some((n) => n !== null && !Number.isSafeInteger(n)))
    return null
  const start = first ?? Math.max(0, length - last!)
  const end =
    first !== null && last !== null ? Math.min(last, length - 1) : length - 1
  return start > end ? null : { start, end }
}
