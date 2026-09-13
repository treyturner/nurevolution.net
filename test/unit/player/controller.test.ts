import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAudioAdapter, type AudioPort } from '../../../app/services/audio'
import { createPlayer } from '../../../app/services/player'

class Media extends EventTarget implements AudioPort {
  src = ''
  currentSrc = ''
  currentTime = 0
  seeking = false
  volume = 1
  muted = false
  seekable = { length: 0, start: () => 0, end: () => 0 }
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

describe('restored positions and explicit playback intent', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })
  it('waits for metadata, preserves precise position through the bounded retry, and restores paused', () => {
    const { media, player } = setup()
    player.select(a, { position: 8.25, paused: true })
    expect(media.currentTime).toBe(0)
    expect(player.snapshot().pendingSeek).toBe(8.25)
    vi.advanceTimersByTime(10_000)
    media.ready()
    expect(media.currentTime).toBe(8.25)
    expect(player.snapshot().pendingSeek).toBeNull()
    expect(media.play).not.toHaveBeenCalled()
  })
  it('clamps saved time to changed duration and never plays or advances at the end', () => {
    const { media, player } = setup()
    player.select(a, { position: 150 })
    media.ready()
    expect(media.currentTime).toBe(120)
    media.ended = true
    media.emit('ended')
    expect(player.snapshot().wantsPlay).toBe(false)
    expect(media.play).not.toHaveBeenCalled()
    player.play()
    expect(media.currentTime).toBe(0)
    expect(media.play).toHaveBeenCalledOnce()
  })
  it('replaces pending seeks and cancels a queued restored Play synchronously', () => {
    const { media, player } = setup()
    player.select(a, { position: 20 })
    player.play()
    expect(player.snapshot().wantsPlay).toBe(true)
    expect(media.play).not.toHaveBeenCalled()
    player.seek(8.25)
    player.pause()
    media.ready()
    expect(media.currentTime).toBe(8.25)
    expect(media.play).not.toHaveBeenCalled()
    player.play()
    expect(media.play).toHaveBeenCalledOnce()
    player.play()
    expect(media.play).toHaveBeenCalledOnce()
  })
  it('attempts Play once after a restored seek becomes ready and leaves rejection recoverable', async () => {
    const { media, player } = setup()
    player.select(a, { position: 20 })
    media.play.mockRejectedValueOnce(new Error('denied'))
    player.play()
    media.ready()
    expect(media.currentTime).toBe(20)
    await Promise.resolve()
    expect(player.snapshot().status).toBe('blocked')
    media.emit('loadedmetadata')
    expect(media.play).toHaveBeenCalledOnce()
  })
  it('invalidates a restored seek on selection, honors same-ID source changes, and retries at zero', () => {
    const { media, player } = setup()
    player.select(a, { position: 20 })
    player.select(b)
    media.ready()
    expect(media.currentTime).toBe(0)
    player.seek(14)
    player.select({ ...b })
    expect(media.currentTime).toBe(14)
    player.select({ ...b, url: c.url })
    expect(media.currentTime).toBe(0)
    player.seek(8)
    player.retry()
    media.ready()
    expect(media.currentTime).toBe(0)
  })
  it('corrects a late successful play after Pause without stopping a newer authorized Play', async () => {
    const { media, player } = setup()
    let resolve!: () => void
    media.play.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done
        }),
    )
    player.select(a)
    media.ready()
    player.play()
    player.pause()
    media.paused = false
    resolve()
    await Promise.resolve()
    expect(media.paused).toBe(true)
    media.play.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done
        }),
    )
    player.play()
    player.pause()
    player.play()
    resolve()
    await Promise.resolve()
    expect(media.paused).toBe(false)
  })
  it('reports a failed/late seek without reloading and rejects stale-source progress', () => {
    const { media, player } = setup()
    player.select(a)
    media.ready()
    media.seeking = true
    player.seek(30)
    vi.advanceTimersByTime(5000)
    expect(player.snapshot().seekMessage).toBe('Could not seek. Try again.')
    media.emit('progress')
    expect(player.snapshot().seekMessage).toBe('Could not seek. Try again.')
    media.seeking = false
    media.emit('seeked')
    expect(player.snapshot().seekMessage).toBeNull()
    expect(media.load).toHaveBeenCalledOnce()
    player.select(b)
    media.currentSrc = a.url
    media.currentTime = 90
    media.emit('timeupdate')
    expect(player.snapshot().currentTime).toBe(0)
  })
  it('contains seek and synchronous Play exceptions, and no-ops unavailable commands', () => {
    const { media, player } = setup()
    player.play()
    player.seek(1)
    player.select(a, { position: 20 })
    Object.defineProperty(media, 'currentTime', {
      configurable: true,
      get: () => 0,
      set: () => {
        throw new Error('seek')
      },
    })
    media.ready()
    expect(player.snapshot().seekMessage).toBe(
      'Saved position could not be restored.',
    )
    media.play.mockImplementationOnce(() => {
      throw new Error('blocked')
    })
    player.play()
    expect(player.snapshot().status).toBe('blocked')
    player.seek(NaN)
    player.dispose()
    player.play()
    player.pause()
    player.seek(1)
    expect(media.load).toHaveBeenCalledOnce()
  })
})

describe('review regressions for queued playback', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })
  it('keeps queued restored Play visible and cancellable through a metadata retry', () => {
    const { media, player } = setup()
    player.select(a, { position: 10 })
    player.play()
    vi.advanceTimersByTime(10_000)
    expect(media.load).toHaveBeenCalledTimes(2)
    expect(player.snapshot()).toMatchObject({
      wantsPlay: true,
      pendingSeek: 10,
    })
    player.pause()
    media.ready()
    expect(media.currentTime).toBe(10)
    expect(media.play).not.toHaveBeenCalled()
    expect(player.snapshot().wantsPlay).toBe(false)
  })
  it('releases deferred Play on a seek timeout without requiring a later event', () => {
    const { media, player } = setup()
    player.select(a, { position: 10 })
    player.play()
    media.seeking = true
    media.ready()
    expect(media.play).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    expect(media.play).toHaveBeenCalledOnce()
    expect(player.snapshot()).toMatchObject({
      pendingSeek: null,
      seekMessage: 'Saved position could not be restored.',
    })
  })
  it('does not label a pending seek request as a confirmed seeked event', () => {
    const media = new Media()
    const observed = vi.fn()
    const player = createPlayer(createAudioAdapter(media), vi.fn(), observed)
    player.select(a)
    player.seek(20)
    expect(observed.mock.calls.some((call) => call[1] === 'seeked')).toBe(false)
    media.ready()
    expect(observed.mock.calls.some((call) => call[1] === 'seeked')).toBe(false)
    media.emit('seeked')
    expect(observed).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentTime: 20, pendingSeek: null }),
      'seeked',
    )
  })
  it('native Pause cancels a Play promise that remains unresolved after playback starts', async () => {
    const { media, player } = setup()
    let finish!: () => void
    media.play.mockImplementationOnce(() => {
      media.paused = false
      media.emit('play')
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    player.select(a)
    media.ready()
    player.play()
    media.emit('playing')
    media.pause()
    expect(player.snapshot().wantsPlay).toBe(false)
    player.play()
    expect(media.play).toHaveBeenCalledTimes(2)
    finish()
    await Promise.resolve()
    expect(media.paused).toBe(false)
  })
  it('ignores a source-reset pause but honors a later real pause on the new source', async () => {
    const { media, player } = setup()
    player.select(a)
    media.ready()
    await media.play()
    media.play.mockImplementationOnce(() => new Promise<void>(() => {}))
    player.select(b)
    media.emit('pause')
    expect(player.snapshot().wantsPlay).toBe(true)
    media.ready()
    media.paused = false
    media.emit('playing')
    media.pause()
    expect(player.snapshot().wantsPlay).toBe(false)
  })
})

describe('native restart and changing seek bounds', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })
  it('accepts a fresh native Play after Pause even while the old promise remains unresolved', async () => {
    const { media, player } = setup()
    let finish!: () => void
    media.play.mockImplementationOnce(() => {
      media.paused = false
      media.emit('play')
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    player.select(a)
    media.ready()
    player.play()
    media.emit('playing')
    media.pause()
    expect(player.snapshot().wantsPlay).toBe(false)
    await media.play()
    expect(media.paused).toBe(false)
    expect(player.snapshot().wantsPlay).toBe(true)
    finish()
    await Promise.resolve()
    expect(media.paused).toBe(false)
  })
  it('cancels a deferred restored Play when selecting another source explicitly paused', () => {
    const { media, player } = setup()
    player.select(a, { position: 20 })
    player.play()
    expect(player.snapshot().wantsPlay).toBe(true)
    player.select(b, { paused: true, position: 30 })
    expect(player.snapshot().wantsPlay).toBe(false)
    media.ready()
    expect(media.currentTime).toBe(30)
    expect(media.play).not.toHaveBeenCalled()
  })
  it('recalculates a pending original target when duration or seekable ranges expand', () => {
    const { media, player } = setup()
    player.select(a, { position: 150 })
    media.seeking = true
    media.ready()
    expect(media.currentTime).toBe(120)
    expect(player.snapshot().pendingSeek).toBe(150)
    media.duration = 180
    media.emit('durationchange')
    expect(media.currentTime).toBe(150)
    media.seeking = false
    media.emit('seeked')
    expect(player.snapshot().pendingSeek).toBeNull()
    media.seeking = true
    media.seekable = { length: 1, start: () => 0, end: () => 60 }
    player.seek(100)
    expect(media.currentTime).toBe(60)
    vi.advanceTimersByTime(4000)
    media.seekable = { length: 1, start: () => 0, end: () => 180 }
    media.emit('progress')
    expect(media.currentTime).toBe(100)
    vi.advanceTimersByTime(1000)
    expect(player.snapshot()).toMatchObject({
      pendingSeek: null,
      seekMessage: 'Could not seek. Try again.',
    })
  })
})

it('allows native Play on a new source while an earlier source promise remains unresolved', async () => {
  const { media, player } = setup()
  let finish!: () => void
  media.play.mockImplementationOnce(() => {
    media.paused = false
    media.emit('play')
    return new Promise<void>((resolve) => {
      finish = resolve
    })
  })
  player.select(a)
  media.ready()
  player.play()
  media.emit('playing')
  media.pause()
  player.select(b)
  media.ready()
  await media.play()
  expect(media.paused).toBe(false)
  expect(player.snapshot().wantsPlay).toBe(true)
  finish()
  await Promise.resolve()
  expect(media.paused).toBe(false)
  player.dispose()
})

it('stops a late Play success after disposal without publishing or retaining listeners', async () => {
  const media = new Media()
  const changed = vi.fn()
  let finish!: () => void
  media.play.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const player = createPlayer(createAudioAdapter(media), changed)
  player.select(a)
  media.ready()
  player.play()
  player.dispose()
  const calls = changed.mock.calls.length
  media.paused = false
  finish()
  await Promise.resolve()
  expect(media.paused).toBe(true)
  media.emit('playing')
  expect(changed).toHaveBeenCalledTimes(calls)
})

it('does not publish queued source-reset pauses as new listening activity', async () => {
  const media = new Media()
  const observed = vi.fn()
  const player = createPlayer(createAudioAdapter(media), vi.fn(), observed)
  player.select(a)
  media.ready()
  await media.play()
  player.select(b)
  media.ready()
  observed.mockClear()
  media.emit('pause')
  expect(observed.mock.calls.some((call) => call[1] === 'pause')).toBe(false)
  media.pause()
  expect(observed.mock.calls.some((call) => call[1] === 'pause')).toBe(true)
  player.dispose()
})

it('clamps retained skip targets before rapid opposite actions', () => {
  const { media, player } = setup()
  player.select(a)
  media.ready()
  media.duration = 40
  media.currentTime = 35
  media.seeking = true
  player.skip(30)
  expect(player.snapshot().pendingSeek).toBe(40)
  player.skip(-30)
  expect(player.snapshot().pendingSeek).toBe(10)
  player.skip(-30)
  expect(player.snapshot().pendingSeek).toBe(0)
  player.skip(30)
  expect(player.snapshot().pendingSeek).toBe(30)
  player.seek(65)
  player.skip(-30)
  expect(player.snapshot().pendingSeek).toBe(10)
  player.dispose()
})

describe('eligible natural ends', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })
  it('arms only real playback and consumes an end once before the next active run', () => {
    const media = new Media()
    const ended = vi.fn()
    const player = createPlayer(
      createAudioAdapter(media),
      vi.fn(),
      vi.fn(),
      ended,
    )
    player.select(a)
    media.ready()
    player.seek(120)
    media.ended = true
    media.emit('ended')
    expect(ended).not.toHaveBeenCalled()
    media.ended = false
    player.play()
    media.emit('playing')
    media.currentTime = 120
    media.ended = true
    media.paused = true
    media.emit('timeupdate')
    media.emit('pause')
    media.emit('ended')
    media.emit('ended')
    expect(ended).toHaveBeenCalledExactlyOnceWith('a')
    media.ended = false
    player.play()
    media.emit('playing')
    media.ended = true
    media.emit('ended')
    expect(ended).toHaveBeenCalledTimes(2)
    player.dispose()
    media.emit('ended')
    expect(ended).toHaveBeenCalledTimes(2)
  })
  it('Pause, source changes and media failure disarm obsolete completions', () => {
    const media = new Media()
    const ended = vi.fn()
    const player = createPlayer(
      createAudioAdapter(media),
      vi.fn(),
      vi.fn(),
      ended,
    )
    player.select(a)
    media.ready()
    player.play()
    media.emit('playing')
    player.pause()
    media.ended = true
    media.emit('ended')
    expect(ended).not.toHaveBeenCalled()
    media.ended = false
    player.play()
    media.emit('playing')
    player.select(b)
    media.currentSrc = a.url
    media.ended = true
    media.emit('ended')
    expect(ended).not.toHaveBeenCalled()
    media.ended = false
    media.ready()
    player.play()
    media.emit('playing')
    media.error = { code: 2 } as MediaError
    media.emit('error')
    media.ended = true
    media.emit('ended')
    expect(ended).not.toHaveBeenCalled()
  })
})

it('keeps an immediate continuation rejection visible before currentSrc catches up to the new load', async () => {
  const { media, player } = setup()
  player.select(a)
  media.ready()
  await media.play()
  media.play.mockRejectedValueOnce(
    new DOMException('blocked', 'NotAllowedError'),
  )
  player.select(b)
  media.currentSrc = a.url
  await Promise.resolve()
  expect(player.snapshot().status).toBe('blocked')
  media.ready()
  expect(player.snapshot().status).toBe('blocked')
  expect(player.snapshot().wantsPlay).toBe(false)
  player.dispose()
})
