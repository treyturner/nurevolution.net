export const visitKey = 'nurevolution.playback.visit.v1'
export const resumeKey = 'nurevolution.playback.resume.v1'
export const visitWindow = 86_400_000

export interface ResumeRecord {
  schemaVersion: 1
  episodeId: string
  positionSeconds: number
  updatedAt: number
}
export type PlaybackStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>

function record(value: string | null): Record<string, unknown> | null {
  if (!value || value.length > 2048) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
function timestamp(value: unknown, now: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= now
  )
}
export function parseResume(value: string | null, now: number) {
  const item = record(value)
  if (
    !item ||
    Object.keys(item).length !== 4 ||
    item.schemaVersion !== 1 ||
    typeof item.episodeId !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.episodeId) ||
    typeof item.positionSeconds !== 'number' ||
    !Number.isFinite(item.positionSeconds) ||
    item.positionSeconds < 0 ||
    !timestamp(item.updatedAt, now)
  )
    return null
  return item as unknown as ResumeRecord
}

/** One origin-local resume slot. Storage failure never interrupts listening. */
export function createPlaybackStorage(
  storage: () => PlaybackStorage,
  now: () => number = Date.now,
) {
  let disabled = false
  let dirty: ResumeRecord | null = null
  let lastWrite = -Infinity
  function access<T>(operation: (port: PlaybackStorage) => T): T | undefined {
    if (disabled) return
    try {
      return operation(storage())
    } catch {
      disabled = true
      dirty = null
    }
  }
  function visit(restore = true): ResumeRecord | null {
    return (
      access((port) => {
        const at = now()
        const previous = record(port.getItem(visitKey))
        const saved = parseResume(port.getItem(resumeKey), at)
        const validVisit =
          previous?.schemaVersion === 1 &&
          Object.keys(previous).length === 2 &&
          timestamp(previous.lastVisitedAt, at) &&
          at - previous.lastVisitedAt < visitWindow
        if (restore && (!validVisit || !saved)) port.removeItem(resumeKey)
        port.setItem(
          visitKey,
          JSON.stringify({ schemaVersion: 1, lastVisitedAt: at }),
        )
        return restore && validVisit ? saved : null
      }) ?? null
    )
  }
  function flush() {
    if (!dirty) return
    const candidate = dirty
    dirty = null
    access((port) => {
      const at = now()
      const current = parseResume(port.getItem(resumeKey), at)
      if (current && current.updatedAt > candidate.updatedAt) return
      port.setItem(resumeKey, JSON.stringify(candidate))
      lastWrite = at
    })
  }
  return {
    visit,
    discard() {
      dirty = null
      access((port) => port.removeItem(resumeKey))
    },
    capture(episodeId: string, positionSeconds: number, immediate = false) {
      if (disabled || !Number.isFinite(positionSeconds) || positionSeconds < 0)
        return
      dirty = {
        schemaVersion: 1,
        episodeId,
        positionSeconds,
        updatedAt: now(),
      }
      if (immediate || now() - lastWrite >= 5000) flush()
    },
    flush,
  }
}
