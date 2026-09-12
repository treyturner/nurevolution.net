export type AudioEvent =
  | 'loadedmetadata'
  | 'loadeddata'
  | 'canplay'
  | 'canplaythrough'
  | 'durationchange'
  | 'progress'
  | 'play'
  | 'playing'
  | 'waiting'
  | 'pause'
  | 'ended'
  | 'error'

export type AudioPort = Pick<
  HTMLAudioElement,
  | 'src'
  | 'currentSrc'
  | 'currentTime'
  | 'paused'
  | 'ended'
  | 'readyState'
  | 'duration'
  | 'preload'
  | 'error'
  | 'load'
  | 'play'
  | 'pause'
  | 'addEventListener'
  | 'removeEventListener'
>

export function createAudioAdapter(element: AudioPort) {
  const subscriptions = new Set<() => void>()
  let disposed = false

  function assertActive() {
    if (disposed) throw new Error('The audio adapter has been disposed.')
  }

  return {
    snapshot() {
      assertActive()
      return {
        src: element.src,
        currentSrc: element.currentSrc,
        currentTime: element.currentTime,
        paused: element.paused,
        ended: element.ended,
        readyState: element.readyState,
        duration: element.duration,
        error: element.error,
      }
    },
    load(sourceUrl: string) {
      assertActive()
      element.src = sourceUrl
      element.load()
    },
    setPreload(value: 'auto' | 'metadata') {
      assertActive()
      element.preload = value
    },
    play(): Promise<void> {
      assertActive()
      return element.play()
    },
    pause() {
      assertActive()
      element.pause()
    },
    subscribe(event: AudioEvent, listener: (event: Event) => void) {
      assertActive()
      // A wrapper makes subscriptions independent even with the same callback.
      const handler = (event: Event) => listener(event)
      element.addEventListener(event, handler)
      const unsubscribe = () => {
        element.removeEventListener(event, handler)
        subscriptions.delete(unsubscribe)
      }
      subscriptions.add(unsubscribe)
      return unsubscribe
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const unsubscribe of subscriptions) unsubscribe()
      element.preload = 'metadata'
      element.pause()
    },
  }
}

export type AudioAdapter = ReturnType<typeof createAudioAdapter>
