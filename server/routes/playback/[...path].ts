import { playbackHandler } from '../../playback/handler.ts'
import { findPlayback, playbackHeader } from '../../utils/playback.ts'

export default playbackHandler(() => {
  const config = useRuntimeConfig()
  return config.virtualPlayback
    ? {
        root: config.audioRoot,
        find: findPlayback,
        header: playbackHeader,
        log: () => console.error('Virtual playback source unavailable'),
      }
    : null
})
