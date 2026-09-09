import { describe, expect, it, vi } from 'vitest'
import { createAudioAdapter, type AudioPort } from '../../../app/services/audio'
import { createPlayer } from '../../../app/services/player'

class Media extends EventTarget implements AudioPort {
  src = ''
  currentSrc = ''
  currentTime = 0
  paused = true
  ended = false
  readyState = 0
  error: MediaError | null = null
  load = vi.fn(() => {
    this.currentSrc = ''
    this.paused = true
    this.ended = false
    this.currentTime = 0
    this.readyState = 0
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
