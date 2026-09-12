import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAudioAdapter, type AudioPort } from '../../../app/services/audio'
import { createPlayer } from '../../../app/services/player'

class Media extends EventTarget implements AudioPort {
  src = ''
  currentSrc = ''
  currentTime = 0
  paused = true
  ended = false
  readyState = 0
  duration = NaN
  preload: AudioPort['preload'] = 'metadata'
  error: MediaError | null = null
  load = vi.fn(() => {
    this.currentSrc = ''
    this.paused = true
    this.ended = false
    this.currentTime = 0
    this.readyState = 0
    this.duration = NaN
    this.error = null
  })
  play = vi.fn(async () => {
    this.paused = false
    this.emit('play')
  })
  pause = vi.fn(() => {
    this.paused = true
    this.emit('pause')
  })
  emit(name: string) {
    this.dispatchEvent(new Event(name))
  }
  ready() {
    this.currentSrc = this.src
    this.readyState = 4
    this.duration = 120
    this.emit('loadedmetadata')
  }
}
const a = { id: 'a', url: 'https://media.example/a.mp3' },
  b = { id: 'b', url: 'https://media.example/b.mp3' },
  c = { id: 'c', url: 'https://media.example/c.mp3' }
function setup() {
  const media = new Media(),
    changed = vi.fn()
  return {
    media,
    changed,
    player: createPlayer(createAudioAdapter(media), changed),
  }
}

describe('persistent episode controller', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })
  it('retries a stalled metadata request once without starting playback, then loads the real duration', () => {
    const { media, changed, player } = setup()
    player.select(a)
    vi.advanceTimersByTime(10_000)
    expect(media.load).toHaveBeenCalledTimes(2)
    expect(media.paused).toBe(true)
    expect(media.play).not.toHaveBeenCalled()
    expect(changed).toHaveBeenLastCalledWith('loading')
    media.ready()
    vi.advanceTimersByTime(30_000)
    expect(media.duration).toBe(120)
    expect(media.preload).toBe('metadata')
    expect(changed).toHaveBeenLastCalledWith('paused')
    expect(media.load).toHaveBeenCalledTimes(2)
    player.dispose()
  })
  it('allows slow downloads to keep progressing and waits for a finite duration', () => {
    const { media, changed, player } = setup()
    player.select(a)
    media.currentSrc = a.url
    media.readyState = 1
    media.duration = Infinity
    media.emit('loadedmetadata')
    expect(changed).toHaveBeenLastCalledWith('loading')
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(9_000)
      media.emit('progress')
    }
    expect(media.load).toHaveBeenCalledOnce()
    media.duration = 120
    media.emit('durationchange')
    vi.advanceTimersByTime(20_000)
    expect(changed).toHaveBeenLastCalledWith('paused')
    expect(media.load).toHaveBeenCalledOnce()
    player.dispose()
  })
  it.each(['loadeddata', 'canplay', 'canplaythrough'])(
    'accepts duration first exposed by %s after WebKit reports zero in its metadata events',
    (event) => {
      const { media, changed, player } = setup()
      player.select(a)
      media.currentSrc = a.url
      media.readyState = 4
      media.duration = 0
      media.emit('progress')
      media.emit('durationchange')
      media.emit('loadedmetadata')
      expect(changed).toHaveBeenLastCalledWith('loading')
      media.duration = 120
      media.emit(event)
      expect(changed).toHaveBeenLastCalledWith('paused')
      expect(media.preload).toBe('metadata')
      expect(media.paused).toBe(true)
      expect(media.play).not.toHaveBeenCalled()
      vi.advanceTimersByTime(30_000)
      expect(media.load).toHaveBeenCalledOnce()
      player.dispose()
    },
  )
  it.each(['loadeddata', 'canplay', 'canplaythrough'])(
    '%s respects source identity, active playback, blocked continuation, and real errors',
    async (event) => {
      const { media, changed, player } = setup()
      player.select(a)
      media.currentSrc = b.url
      media.readyState = 4
      media.duration = 120
      media.emit(event)
      expect(changed).toHaveBeenLastCalledWith('loading')
      media.currentSrc = a.url
      await media.play()
      media.emit('playing')
      media.emit(event)
      expect(changed).toHaveBeenLastCalledWith('playing')
      media.play.mockRejectedValueOnce(
        new DOMException('Blocked', 'NotAllowedError'),
      )
      player.select(b)
      await Promise.resolve()
      media.currentSrc = b.url
      media.readyState = 4
      media.duration = 120
      media.emit(event)
      expect(changed).toHaveBeenLastCalledWith('blocked')
      media.error = { code: 2 } as MediaError
      media.emit(event)
      expect(changed).toHaveBeenLastCalledWith('error')
      player.dispose()
    },
  )
  it('reconciles a duration that becomes positive after every readiness event without another notification', () => {
    const { media, changed, player } = setup()
    player.select(a)
    media.currentSrc = a.url
    media.readyState = 4
    media.duration = 0
    for (const event of [
      'durationchange',
      'loadedmetadata',
      'loadeddata',
      'canplay',
      'canplaythrough',
    ])
      media.emit(event)
    expect(changed).toHaveBeenLastCalledWith('loading')
    vi.advanceTimersByTime(50)
    media.duration = 120
    vi.advanceTimersByTime(250)
    expect(changed).toHaveBeenLastCalledWith('paused')
    expect(media.preload).toBe('metadata')
    expect(media.paused).toBe(true)
    expect(media.play).not.toHaveBeenCalled()
    expect(media.pause).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(30_000)
    expect(media.load).toHaveBeenCalledOnce()
    player.dispose()
  })
  it.each(['selection', 'clear', 'error', 'ended', 'dispose'])(
    'cancels pending duration checks on %s',
    (transition) => {
      const { media, player } = setup()
      player.select(a)
      media.currentSrc = a.url
      media.readyState = 4
      media.duration = 0
      media.emit('loadedmetadata')
      if (transition === 'selection') player.select(b)
      else if (transition === 'clear') player.select(null)
      else if (transition === 'error') {
        media.error = { code: 2 } as MediaError
        media.emit('error')
      } else if (transition === 'ended') {
        media.ended = true
        media.emit('ended')
      } else player.dispose()
      const readDuration = vi.fn(() => 120)
      Object.defineProperty(media, 'duration', { get: readDuration })
      vi.advanceTimersByTime(1_000)
      expect(readDuration).not.toHaveBeenCalled()
      player.dispose()
    },
  )
  it('treats deferred preload as a delay and preserves optional retry through queued events', () => {
    const { media, changed, player } = setup()
    player.select(a)
    vi.advanceTimersByTime(20_000)
    expect(changed).toHaveBeenLastCalledWith('delayed')
    media.emit('pause')
    media.emit('progress')
    vi.advanceTimersByTime(60_000)
    expect(changed).toHaveBeenLastCalledWith('delayed')
    expect(media.load).toHaveBeenCalledTimes(2)
    expect(media.error).toBeNull()
    expect(media.pause).not.toHaveBeenCalled()
    expect(media.preload).toBe('auto')
    player.retry()
    expect(changed).toHaveBeenLastCalledWith('loading')
    vi.advanceTimersByTime(10_000)
    expect(media.load).toHaveBeenCalledTimes(4)
    media.ready()
    expect(media.play).not.toHaveBeenCalled()
    player.dispose()
  })
  it('accepts late metadata after both timeouts without reloading or reporting an error', () => {
    const { media, changed, player } = setup()
    player.select(a)
    vi.advanceTimersByTime(20_000)
    media.ready()
    expect(changed).toHaveBeenLastCalledWith('paused')
    expect(changed).not.toHaveBeenCalledWith('error')
    expect(media.load).toHaveBeenCalledTimes(2)
    expect(media.pause).not.toHaveBeenCalled()
    player.dispose()
  })
  it.each([5_000, 15_000, 25_000])(
    'keeps Play requested after %i ms intact even when metadata remains unavailable',
    async (delay) => {
      const { media, changed, player } = setup()
      player.select(a)
      vi.advanceTimersByTime(delay)
      const loads = media.load.mock.calls.length
      await media.play()
      media.currentTime = 12
      media.emit('progress')
      vi.advanceTimersByTime(60_000)
      expect(changed).toHaveBeenLastCalledWith('buffering')
      expect(media.paused).toBe(false)
      expect(media.currentTime).toBe(12)
      expect(media.load).toHaveBeenCalledTimes(loads)
      expect(media.pause).not.toHaveBeenCalled()
      expect(media.play).toHaveBeenCalledOnce()
      expect(changed).not.toHaveBeenCalledWith('error')
      media.ready()
      media.emit('playing')
      expect(changed).toHaveBeenLastCalledWith('playing')
      player.dispose()
    },
  )
  it.each([5_000, 15_000, 25_000])(
    'resumes bounded recovery after Play then pause at %i ms with no further progress',
    async (delay) => {
      const { media, changed, player } = setup()
      player.select(a)
      vi.advanceTimersByTime(delay)
      await media.play()
      media.pause()
      vi.advanceTimersByTime(20_000)
      expect(changed).toHaveBeenLastCalledWith('delayed')
      expect(media.load).toHaveBeenCalledTimes(2)
      expect(media.play).toHaveBeenCalledOnce()
      expect(media.pause).toHaveBeenCalledOnce()
      expect(media.paused).toBe(true)
      media.ready()
      expect(changed).toHaveBeenLastCalledWith('paused')
      player.dispose()
    },
  )
  it('does not reload a pending Play request whose native event is still queued', async () => {
    const { media, changed, player } = setup()
    player.select(a)
    media.ready()
    await media.play()
    media.play.mockImplementationOnce(() => {
      media.paused = false
      return new Promise(() => {})
    })
    player.select(b)
    vi.advanceTimersByTime(30_000)
    expect(media.load).toHaveBeenCalledTimes(2)
    expect(media.pause).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalledWith('error')
    expect(media.paused).toBe(false)
    player.dispose()
  })
  it('preserves a blocked-play prompt when metadata never arrives', async () => {
    const { media, changed, player } = setup()
    player.select(a)
    media.ready()
    await media.play()
    media.play.mockRejectedValueOnce(
      new DOMException('Blocked', 'NotAllowedError'),
    )
    player.select(b)
    await Promise.resolve()
    media.emit('progress')
    vi.advanceTimersByTime(30_000)
    expect(changed).toHaveBeenLastCalledWith('blocked')
    expect(media.load).toHaveBeenCalledTimes(2)
    expect(media.pause).not.toHaveBeenCalled()
    player.dispose()
  })
  it('honors a real media error observed by the timeout before its event arrives', () => {
    const { media, changed, player } = setup()
    player.select(a)
    media.error = { code: 2 } as MediaError
    vi.advanceTimersByTime(10_000)
    expect(changed).toHaveBeenLastCalledWith('error')
    expect(media.load).toHaveBeenCalledOnce()
    player.dispose()
  })
  it('cancels obsolete recovery on selection, clearing, native errors, and disposal', () => {
    const { media, player } = setup()
    player.select(a)
    vi.advanceTimersByTime(9_000)
    player.select(b)
    vi.advanceTimersByTime(1_000)
    expect(media.load).toHaveBeenCalledTimes(2)
    player.select(null)
    vi.advanceTimersByTime(20_000)
    expect(media.load).toHaveBeenCalledTimes(2)
    player.select(c)
    media.error = { code: 2 } as MediaError
    media.emit('error')
    vi.advanceTimersByTime(20_000)
    expect(media.load).toHaveBeenCalledTimes(3)
    player.retry()
    player.dispose()
    vi.advanceTimersByTime(20_000)
    expect(media.load).toHaveBeenCalledTimes(4)
  })
  it('recovers a source that never became current and accepts metadata even if its event was missed', () => {
    const { media, changed, player } = setup()
    player.select(a)
    media.currentSrc = b.url
    vi.advanceTimersByTime(10_000)
    expect(media.load).toHaveBeenCalledTimes(2)
    media.currentSrc = a.url
    media.readyState = 1
    media.duration = 120
    vi.advanceTimersByTime(10_000)
    expect(changed).toHaveBeenLastCalledWith('paused')
    expect(media.preload).toBe('metadata')
    player.dispose()
  })
  it('loads metadata before offering Play and reports actual buffering after playback is requested', async () => {
    const { media, changed, player } = setup()
    player.select(a)
    expect(media.readyState).toBe(0)
    expect(changed).toHaveBeenLastCalledWith('loading')
    expect(media.preload).toBe('auto')
    media.emit('suspend')
    player.select(b)
    expect(changed).toHaveBeenLastCalledWith('loading')
    expect(media.play).not.toHaveBeenCalled()
    await media.play()
    expect(changed).toHaveBeenLastCalledWith('buffering')
    media.ready()
    media.emit('playing')
    expect(changed).toHaveBeenLastCalledWith('playing')
    expect(media.preload).toBe('metadata')
    player.retry()
    expect(media.readyState).toBe(0)
    expect(changed).toHaveBeenLastCalledWith('loading')
    expect(media.play).toHaveBeenCalledOnce()
    player.dispose()
  })
  it('starts paused, preserves the same episode, and changes paused sources at zero', () => {
    const { media, changed, player } = setup()
    player.select(a)
    media.ready()
    expect(changed).toHaveBeenLastCalledWith('paused')
    media.currentTime = 32
    player.select(a)
    expect(media.load).toHaveBeenCalledOnce()
    expect(media.currentTime).toBe(32)
    player.select(b)
    media.ready()
    expect(media.currentTime).toBe(0)
    expect(media.play).not.toHaveBeenCalled()
    player.select(null)
    expect(changed).toHaveBeenLastCalledWith('idle')
    player.select(null)
    player.retry()
    player.dispose()
  })
  it('continues only active playback, tolerates load-generated pauses, and reflects buffering/end/replay', async () => {
    const { media, changed, player } = setup()
    player.select(a)
    media.ready()
    await media.play()
    media.emit('playing')
    expect(changed).toHaveBeenLastCalledWith('playing')
    player.select(b)
    expect(media.play).toHaveBeenCalledTimes(2)
    media.emit('pause')
    expect(media.paused).toBe(false)
    media.emit('waiting')
    expect(changed).toHaveBeenLastCalledWith('buffering')
    media.ready()
    media.emit('playing')
    expect(changed).toHaveBeenLastCalledWith('playing')
    media.ended = true
    media.paused = true
    media.emit('ended')
    expect(changed).toHaveBeenLastCalledWith('ended')
    expect(media.src).toBe(b.url)
    player.select(c)
    expect(media.play).toHaveBeenCalledTimes(2)
  })
  it('keeps continuation through rapid selections and ignores obsolete play rejection', async () => {
    const { media, changed, player } = setup()
    player.select(a)
    media.ready()
    await media.play()
    let reject!: (reason: Error) => void
    media.play.mockImplementationOnce(() => {
      media.paused = false
      return new Promise((_resolve, no) => {
        reject = no
      })
    })
    player.select(b)
    player.select(c)
    reject(new Error('aborted'))
    await Promise.resolve()
    media.ready()
    media.emit('playing')
    expect(media.src).toBe(c.url)
    expect(changed).toHaveBeenLastCalledWith('playing')
  })
  it('leaves blocked continuation paused and lets user pause cancel pending starts', async () => {
    const { media, changed, player } = setup()
    player.select(a)
    media.ready()
    await media.play()
    media.play.mockImplementationOnce(async () => {
      media.paused = true
      throw new Error('blocked')
    })
    player.select(b)
    await Promise.resolve()
    media.ready()
    expect(changed).toHaveBeenLastCalledWith('blocked')
    await media.play()
    player.select(c)
    media.pause()
    media.ready()
    media.emit('playing')
    expect(changed).toHaveBeenLastCalledWith('paused')
    player.select(a)
    expect(media.paused).toBe(true)
  })
  it('ignores stale native events and recovers from errors without starting playback', () => {
    const { media, changed, player } = setup()
    media.emit('loadedmetadata')
    expect(changed).not.toHaveBeenCalled()
    player.select(a)
    media.currentSrc = b.url
    media.error = { code: 2 } as MediaError
    media.emit('error')
    expect(changed).toHaveBeenLastCalledWith('loading')
    media.currentSrc = a.url
    media.emit('error')
    expect(changed).toHaveBeenLastCalledWith('error')
    player.retry()
    media.ready()
    expect(media.play).not.toHaveBeenCalled()
    expect(changed).toHaveBeenLastCalledWith('paused')
    media.readyState = 0
    media.emit('loadedmetadata')
    expect(changed).toHaveBeenLastCalledWith('paused')
  })
  it('stops continuation after an error even when the browser still reports active playback', async () => {
    const { media, changed, player } = setup()
    player.select(a)
    media.ready()
    await media.play()
    media.error = { code: 3 } as MediaError
    media.emit('error')
    expect(changed).toHaveBeenLastCalledWith('error')
    expect(media.paused).toBe(true)
    player.select(b)
    media.ready()
    expect(media.play).toHaveBeenCalledOnce()
    expect(changed).toHaveBeenLastCalledWith('paused')
    await media.play()
    // Selection can precede delivery of the native error event.
    media.error = { code: 2 } as MediaError
    player.select(c)
    media.ready()
    expect(media.play).toHaveBeenCalledTimes(2)
    expect(changed).toHaveBeenLastCalledWith('paused')
  })

  it.each(['before', 'after'])(
    'preserves blocked continuation when the source-reset pause arrives %s rejection',
    async (order) => {
      const { media, changed, player } = setup()
      player.select(a)
      media.ready()
      await media.play()
      let reject!: (reason: Error) => void
      media.play.mockImplementationOnce(
        () =>
          new Promise((_resolve, no) => {
            reject = no
          }),
      )
      player.select(b)
      expect(media.paused).toBe(true)
      if (order === 'before') media.emit('pause')
      reject(new DOMException('Autoplay is blocked', 'NotAllowedError'))
      await Promise.resolve()
      if (order === 'after') media.emit('pause')
      media.ready()
      expect(changed).toHaveBeenLastCalledWith('blocked')
      await media.play()
      media.emit('playing')
      expect(changed).toHaveBeenLastCalledWith('playing')
    },
  )

  it('keeps an actual user pause paused when the pending continuation rejects with AbortError', async () => {
    const { media, changed, player } = setup()
    player.select(a)
    media.ready()
    await media.play()
    let reject!: (reason: Error) => void
    media.play.mockImplementationOnce(() => {
      media.paused = false
      return new Promise((_resolve, no) => {
        reject = no
      })
    })
    player.select(b)
    media.emit('pause') // Old source reset while the new play request is active.
    media.pause()
    reject(new DOMException('The user paused playback', 'AbortError'))
    await Promise.resolve()
    media.ready()
    expect(changed).toHaveBeenLastCalledWith('paused')
    player.select(c)
    expect(media.play).toHaveBeenCalledTimes(2)
  })
  it('keeps a failed continuation recoverable when its play promise also rejects', async () => {
    const { media, changed, player } = setup()
    player.select(a)
    media.ready()
    await media.play()
    media.play.mockImplementationOnce(async () => {
      media.currentSrc = media.src
      media.error = { code: 2 } as MediaError
      media.paused = true
      media.emit('error')
      throw new Error('network')
    })
    player.select(b)
    await Promise.resolve()
    expect(changed).toHaveBeenLastCalledWith('error')
    player.select(c)
    expect(media.paused).toBe(true)
  })

  it('cleans up once and prevents pending callbacks or stale owners from restarting audio', async () => {
    const { media, changed, player } = setup()
    player.select(a)
    media.ready()
    await media.play()
    media.play.mockRejectedValueOnce(new Error('aborted'))
    player.select(b)
    player.dispose()
    player.dispose()
    player.select(c)
    player.retry()
    const count = changed.mock.calls.length
    await Promise.resolve()
    media.emit('playing')
    expect(changed).toHaveBeenCalledTimes(count)
    expect(media.pause).toHaveBeenCalledOnce()
  })
})
