<script setup lang="ts">
import type { EpisodeDetail, EpisodeSummary } from '../../shared/content/public'
import type { PodcastPlayer } from '../composables/usePodcastPlayer'
import EpisodeList from './EpisodeList.vue'
import EpisodeTracklist from './EpisodeTracklist.vue'
defineProps<{
  player?: PodcastPlayer
  episodes: EpisodeSummary[]
  siteUrl: string
  selected: EpisodeDetail | null
  pendingPath?: string | null
}>()
const narrow = ref(false)
const active = ref<'episodes' | 'tracks'>('episodes')
const trackTimeDisplay = ref<'timestamp' | 'duration'>('duration')
const trackTimeLabel = computed(() =>
  trackTimeDisplay.value === 'duration' ? 'Duration' : 'Timestamp',
)
const otherTrackTimeLabel = computed(() =>
  trackTimeDisplay.value === 'duration' ? 'Timestamp' : 'Duration',
)
const tabs = narrow
let media: MediaQueryList | undefined
const resize = () => {
  narrow.value = media!.matches
}
onMounted(() => {
  media = window.matchMedia('(max-width: 700px)')
  resize()
  media.addEventListener('change', resize)
})
onBeforeUnmount(() => media?.removeEventListener('change', resize))
function key(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  active.value =
    event.key === 'Home'
      ? 'episodes'
      : event.key === 'End'
        ? 'tracks'
        : active.value === 'episodes'
          ? 'tracks'
          : 'episodes'
  const parent = (event.target as HTMLElement).parentElement!
  ;(
    parent.querySelector(`[data-tab="${active.value}"]`) as HTMLButtonElement
  ).focus()
}
</script>

<template>
  <div>
    <div
      v-if="tabs"
      class="mobile-tabs"
      role="tablist"
      aria-label="Archive views"
      @keydown="key"
    >
      <button
        id="episodes-tab"
        type="button"
        role="tab"
        data-tab="episodes"
        :aria-selected="active === 'episodes'"
        :tabindex="active === 'episodes' ? 0 : -1"
        aria-controls="episodes-panel"
        @click="active = 'episodes'"
      >
        Episodes
      </button>
      <button
        id="tracks-tab"
        type="button"
        role="tab"
        data-tab="tracks"
        :aria-selected="active === 'tracks'"
        :tabindex="active === 'tracks' ? 0 : -1"
        aria-controls="tracks-panel"
        @click="active = 'tracks'"
      >
        Tracklist
      </button>
    </div>
    <div class="archive-grid">
      <section
        id="episodes-panel"
        :role="tabs ? 'tabpanel' : undefined"
        :aria-labelledby="tabs ? 'episodes-tab' : 'episodes-heading'"
        :hidden="tabs && active !== 'episodes'"
      >
        <div class="episode-list-heading">
          <h2 id="episodes-heading">
            Episodes <span>{{ episodes.length }}</span>
          </h2>
          <button
            v-if="player"
            type="button"
            class="episode-sort"
            :aria-label="
              player.sortOrder === 'newest-first'
                ? 'Sort: Newest. Click for Oldest'
                : 'Sort: Oldest. Click for Newest'
            "
            :title="
              player.sortOrder === 'newest-first'
                ? 'Click for Oldest'
                : 'Click for Newest'
            "
            :aria-disabled="
              !player.state.attached ||
              player.state.restoring ||
              player.sequencing.busy ||
              episodes.length < 2
            "
            @click="player.toggleSort()"
          >
            Sort:
            {{ player.sortOrder === 'newest-first' ? 'Newest' : 'Oldest' }}
          </button>
        </div>
        <EpisodeList
          :episodes="episodes"
          :site-url="siteUrl"
          :selected-id="selected?.id"
          :pending-path="pendingPath"
        />
      </section>
      <section
        id="tracks-panel"
        :role="tabs ? 'tabpanel' : undefined"
        :aria-labelledby="tabs ? 'tracks-tab' : 'tracks-heading'"
        :hidden="tabs && active !== 'tracks'"
      >
        <div class="track-list-heading">
          <h2 id="tracks-heading">
            Tracklist <span v-if="selected">{{ selected.tracks.length }}</span>
          </h2>
          <button
            v-if="selected?.tracks.length"
            type="button"
            class="track-time-toggle"
            :aria-label="`Show: ${trackTimeLabel}. Click for ${otherTrackTimeLabel}`"
            :title="`Click for ${otherTrackTimeLabel}`"
            @click="
              trackTimeDisplay =
                trackTimeDisplay === 'duration' ? 'timestamp' : 'duration'
            "
          >
            Show: {{ trackTimeLabel }}
          </button>
        </div>
        <EpisodeTracklist
          v-if="selected"
          :episode-path="selected.path"
          :tracks="selected.tracks"
          :duration-seconds="selected.durationSeconds"
          :time-display="trackTimeDisplay"
          :player="player"
        />
        <p v-else class="empty-tracks">
          Choose an episode to see its tracklist.
        </p>
      </section>
    </div>
  </div>
</template>
