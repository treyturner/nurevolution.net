import { describe, expect, it, vi } from 'vitest'
import {
  createAudioAdapter,
  type AudioEvent,
  type AudioPort,
} from '../../app/services/audio'

class ControlledAudio extends EventTarget implements AudioPort {
  src = ''
  currentSrc = ''
  currentTime = 0
  seeking = false
  seekable = { length: 0, start: () => 0, end: () => 0 }
  ended = false
  readyState = 0
  duration = NaN
  preload: AudioPort['preload'] = 'metadata'
  error = null
  paused = true
  load = vi.fn(() => {
    this.paused = true
  })
  play = vi.fn(async () => {
    this.paused = false
    this.dispatchEvent(new Event('play'))
  })
  pause = vi.fn(() => {
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  })
}

describe('audio adapter', () => {
  it('does not read seekable ranges until metadata has a finite positive duration', () => {
    const element = new ControlledAudio()
    const ranges = vi.fn(() => ({ length: 0, start: () => 0, end: () => 0 }))
    Object.defineProperty(element, 'seekable', { get: ranges })
    const audio = createAudioAdapter(element)
    for (const duration of [NaN, Infinity, 0]) {
      element.readyState = 4
      element.duration = duration
      expect(audio.snapshot().seekable).toEqual([])
    }
    expect(ranges).not.toHaveBeenCalled()
    element.duration = 120
    audio.snapshot()
    expect(ranges).toHaveBeenCalledOnce()
  })

  it('seeks without playing and returns independent seekable range snapshots', () => {
    const element = new ControlledAudio()
    element.seekable = { length: 2, start: () => 5, end: () => 10 }
    element.readyState = 1
    element.duration = 10
    const audio = createAudioAdapter(element)
    audio.seek(8.25)
    expect(element.currentTime).toBe(8.25)
    expect(element.play).not.toHaveBeenCalled()
    const snapshot = audio.snapshot()
    expect(snapshot.seekable).toEqual([
      { start: 5, end: 10 },
      { start: 5, end: 10 },
    ])
    snapshot.seekable[0]!.start = 7
    expect(audio.snapshot().seekable[0]!.start).toBe(5)
    audio.dispose()
    expect(() => audio.seek(0)).toThrow('disposed')
  })
  it('loads a source without initiating playback', () => {
    const element = new ControlledAudio()
    const audio = createAudioAdapter(element)
    expect(element.load).not.toHaveBeenCalled()
    audio.load('/episode.mp3')
    expect(element.src).toBe('/episode.mp3')
    expect(element.load).toHaveBeenCalledOnce()
    expect(element.paused).toBe(true)
    expect(element.play).not.toHaveBeenCalled()
  })

  it('allows explicit playback and pause', async () => {
    const element = new ControlledAudio()
    const audio = createAudioAdapter(element)
    await audio.play()
    expect(element.paused).toBe(false)
    audio.pause()
    expect(element.paused).toBe(true)
  })

  it('propagates a rejected play request without retrying', async () => {
    const element = new ControlledAudio()
    const rejection = new Error('Playback was denied')
    element.play.mockRejectedValueOnce(rejection)
    await expect(createAudioAdapter(element).play()).rejects.toBe(rejection)
    expect(element.play).toHaveBeenCalledOnce()
    expect(element.paused).toBe(true)
  })

  it.each<AudioEvent>(['loadedmetadata', 'play', 'pause', 'ended', 'error'])(
    'subscribes to %s and stops notifications after unsubscribe',
    (name) => {
      const element = new ControlledAudio()
      const listener = vi.fn()
      const unsubscribe = createAudioAdapter(element).subscribe(name, listener)
      const event = new Event(name)
      element.dispatchEvent(event)
      expect(listener).toHaveBeenCalledWith(event)
      unsubscribe()
      unsubscribe()
      element.dispatchEvent(new Event(name))
      expect(listener).toHaveBeenCalledOnce()
    },
  )

  it('keeps subscriptions with the same callback independent', () => {
    const element = new ControlledAudio()
    const audio = createAudioAdapter(element)
    const listener = vi.fn()
    const first = audio.subscribe('play', listener)
    const second = audio.subscribe('play', listener)
    element.dispatchEvent(new Event('play'))
    expect(listener).toHaveBeenCalledTimes(2)
    first()
    element.dispatchEvent(new Event('play'))
    expect(listener).toHaveBeenCalledTimes(3)
    second()
    element.dispatchEvent(new Event('play'))
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('disposes its own listeners, pauses, and tolerates repeated cleanup', async () => {
    const element = new ControlledAudio()
    const audio = createAudioAdapter(element)
    const owned = vi.fn()
    const external = vi.fn()
    element.addEventListener('pause', external)
    const unsubscribe = audio.subscribe('pause', owned)
    audio.subscribe('ended', owned)
    await audio.play()
    audio.dispose()
    expect(element.paused).toBe(true)
    expect(external).toHaveBeenCalledOnce()
    expect(owned).not.toHaveBeenCalled()
    audio.dispose()
    unsubscribe()
    element.dispatchEvent(new Event('ended'))
    expect(owned).not.toHaveBeenCalled()
    expect(element.pause).toHaveBeenCalledOnce()
  })

  it('rejects operations after disposal so stale owners cannot restart audio', () => {
    const element = new ControlledAudio()
    const audio = createAudioAdapter(element)
    audio.dispose()
    for (const operation of [
      () => audio.snapshot(),
      () => audio.setPreload('auto'),
      () => audio.load('/another.mp3'),
      () => audio.play(),
      () => audio.pause(),
      () => audio.subscribe('play', vi.fn()),
    ]) {
      expect(operation).toThrow('disposed')
    }
    expect(element.play).not.toHaveBeenCalled()
    expect(element.load).not.toHaveBeenCalled()
  })

  it('keeps separate players isolated', async () => {
    const first = new ControlledAudio()
    const second = new ControlledAudio()
    const firstAdapter = createAudioAdapter(first)
    const secondAdapter = createAudioAdapter(second)
    firstAdapter.load('/first.mp3')
    secondAdapter.load('/second.mp3')
    await firstAdapter.play()
    secondAdapter.dispose()
    expect(first.src).toBe('/first.mp3')
    expect(first.paused).toBe(false)
    expect(second.paused).toBe(true)
  })
})

it('stops a late rejected Play after disposal while preserving its rejection', async () => {
  const element = new ControlledAudio()
  let reject!: (reason: Error) => void
  element.play.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail
      }),
  )
  const audio = createAudioAdapter(element)
  const pending = audio.play()
  audio.dispose()
  element.paused = false
  const error = new Error('late rejection')
  reject(error)
  await expect(pending).rejects.toBe(error)
  expect(element.paused).toBe(true)
})
