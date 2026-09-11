import { createAudioAdapter } from '../services/audio'
import { createPlayer, type PlayerStatus } from '../services/player'
import { deliveryAssetUrl } from '../services/delivery-assets'
import type { EpisodeDetail } from '../../shared/content/public'

export function usePodcastPlayer(episode: () => EpisodeDetail | null) {
  const config = useRuntimeConfig()
  const element = ref<HTMLAudioElement | null>(null)
  const status = ref<PlayerStatus>('idle')
  let controller: ReturnType<typeof createPlayer> | undefined
  const select = () => {
    const current = episode()
    controller?.select(
      current
        ? {
            id: current.id,
            url: deliveryAssetUrl(
              current.audio.url,
              'audio',
              config.public.mediaOrigin,
            ),
          }
        : null,
    )
  }
  onMounted(() => {
    controller = createPlayer(createAudioAdapter(element.value!), (value) => {
      status.value = value
    })
    select()
  })
  watch(episode, select)
  onBeforeUnmount(() => controller?.dispose())
  return { element, status, retry: () => controller?.retry() }
}
