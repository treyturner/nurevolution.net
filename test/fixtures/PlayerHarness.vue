<script setup lang="ts">
import type { EpisodeDetail } from '../../shared/content/public'
import { usePodcastPlayer } from '../../app/composables/usePodcastPlayer'
import ArchivePlayer from '../../app/components/ArchivePlayer.vue'
const props = defineProps<{ episode: EpisodeDetail | null }>()
const player = usePodcastPlayer(() => props.episode)
</script>

<template>
  <ArchivePlayer :episode="episode" :player="player" />
</template>
