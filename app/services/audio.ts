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
  | 'timeupdate'
  | 'seeking'
  | 'seeked'

export type AudioPort = Pick<
  HTMLAudioElement,
  | 'src'
  | 'currentSrc'
  | 'currentTime'
  | 'seeking'
  | 'seekable'
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
      const duration = element.duration
      const readyState = element.readyState
      return {
        src: element.src,
        currentSrc: element.currentSrc,
        currentTime: element.currentTime,
        seeking: element.seeking,
        // Reading seekable before a finite duration can pin WebKit's early
        // metadata duration at zero. Leave ranges untouched until ready.
        seekable: Array.from(
          {
            length:
              readyState >= 1 && Number.isFinite(duration) && duration > 0
                ? element.seekable.length
                : 0,
          },
          (_, index) => ({
            start: element.seekable.start(index),
            end: element.seekable.end(index),
          }),
        ),
        paused: element.paused,
        ended: element.ended,
        readyState,
        duration,
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
      const request = element.play()
      const stopAfterDisposal = () => {
        if (disposed && !element.paused) element.pause()
      }
      // Keep teardown protection on the element: public commands reject after
      // disposal, and the controller's listeners have already been removed.
      void request.then(stopAfterDisposal, stopAfterDisposal)
      return request
    },
    seek(seconds: number) {
      assertActive()
      element.currentTime = seconds
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
