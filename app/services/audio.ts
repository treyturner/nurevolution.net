export type AudioEvent = 'loadedmetadata' | 'play' | 'pause' | 'ended' | 'error'

export type AudioPort = Pick<
  HTMLAudioElement,
  'src' | 'load' | 'play' | 'pause' | 'addEventListener' | 'removeEventListener'
>

export function createAudioAdapter(element: AudioPort) {
  const subscriptions = new Set<() => void>()
  let disposed = false

  function assertActive() {
    if (disposed) throw new Error('The audio adapter has been disposed.')
  }

  return {
    load(sourceUrl: string) {
      assertActive()
      element.src = sourceUrl
      element.load()
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
      element.pause()
    },
  }
}
