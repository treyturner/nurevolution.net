<script setup lang="ts">
import type { PodcastPlayer } from '../composables/usePodcastPlayer'
import { formatTime } from '../services/episode-page'
import { useCompactContainer } from '../composables/useCompactContainer'
import PlayheadContextMenu from './PlayheadContextMenu.vue'
const props = defineProps<{
  player: PodcastPlayer
  sourceUrl?: string
  canCopyTimestamp?: boolean
}>()
const emit = defineEmits<{ copyTimestamp: [target: HTMLElement] }>()
const { container, compact } = useCompactContainer(319)
const state = computed(() => props.player.state)
const draft = ref<number | null>(null)
const showPause = computed(
  () => state.value.wantsPlay || state.value.continuing,
)
const time = computed(() => draft.value ?? state.value.currentTime)
const seekable = computed(
  () =>
    state.value.duration !== null &&
    !state.value.restoring &&
    state.value.status !== 'error',
)
const available = computed(
  () =>
    Boolean(state.value.sourceId) &&
    !state.value.restoring &&
    state.value.status !== 'error',
)
const volumeWaves = computed(() => Math.ceil(state.value.volume * 3))
const muteLabel = computed(() =>
  state.value.muted || state.value.volume === 0 ? 'Unmute' : 'Mute',
)
const volumeDescription = computed(() =>
  state.value.muted
    ? 'Muted'
    : `Volume ${Math.round(state.value.volume * 100)} percent`,
)
function spoken(seconds: number) {
  const whole = Math.floor(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const tail = whole % 60
  return [
    [hours, 'hour'],
    [minutes, 'minute'],
    [tail, 'second'],
  ]
    .filter(([value, unit]) => value || unit === 'second')
    .map(([value, unit]) => `${value} ${unit}${value === 1 ? '' : 's'}`)
    .join(', ')
}
const seekDescription = computed(() =>
  state.value.duration === null
    ? 'Duration unavailable'
    : `${spoken(time.value)} of ${spoken(state.value.duration)}`,
)
function preview(event: Event, suppressed = false) {
  if (suppressed) {
    ;(event.target as HTMLInputElement).value = String(time.value)
    return
  }
  draft.value = Number((event.target as HTMLInputElement).value)
}
function commit() {
  if (draft.value === null) return
  const target = draft.value
  draft.value = null
  props.player.seek(target)
}
function key(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    draft.value = null
    return
  }
  if (!seekable.value) return
  const current = Math.min(
    state.value.duration!,
    state.value.pendingSeek ?? state.value.currentTime,
  )
  const targets: Record<string, number> = {
    ArrowLeft: current - 5,
    ArrowDown: current - 5,
    ArrowRight: current + 5,
    ArrowUp: current + 5,
    PageDown: current - 30,
    PageUp: current + 30,
    Home: 0,
    End: state.value.duration!,
  }
  const target = targets[event.key]
  if (target === undefined) return
  event.preventDefault()
  draft.value = null
  props.player.seek(Math.min(state.value.duration!, Math.max(0, target)))
}
watch(
  [
    () => state.value.sourceId,
    () => props.sourceUrl,
    () => state.value.status === 'error' || state.value.status === 'ended',
  ],
  () => {
    draft.value = null
  },
)
</script>

<template>
  <div
    ref="container"
    class="audio-controls"
    :class="{ 'compact-controls': compact }"
    role="group"
    aria-label="Audio player"
    aria-describedby="playback-status"
  >
    <PlayheadContextMenu
      v-slot="{ suppressSeek }"
      :enabled="Boolean(canCopyTimestamp)"
      :source-key="`${state.sourceId}:${sourceUrl}`"
      @open="draft = null"
      @copy="emit('copyTimestamp', $event)"
    >
      <span class="player-time" aria-hidden="true">{{ formatTime(time) }}</span>
      <input
        aria-label="Playback position"
        type="range"
        min="0"
        :max="state.duration ?? 0"
        step="any"
        :value="time"
        :aria-valuetext="seekDescription"
        :disabled="!seekable"
        :title="
          canCopyTimestamp
            ? 'Right-click or long-press the playhead to copy a timestamp link'
            : undefined
        "
        :aria-haspopup="canCopyTimestamp ? 'menu' : undefined"
        @input="preview($event, suppressSeek)"
        @change="!suppressSeek && commit()"
        @keydown="key"
        @pointercancel="draft = null"
        @blur="draft = null"
      />
      <span class="player-time" aria-hidden="true">{{
        state.duration === null ? '-:-' : formatTime(state.duration)
      }}</span>
    </PlayheadContextMenu>
    <div class="playback-row">
      <div class="transport-row">
        <button
          type="button"
          aria-label="Previous episode"
          title="Previous episode"
          :aria-busy="player.sequencing.busy"
          :aria-disabled="player.sequencing.busy || undefined"
          :disabled="
            state.restoring || !state.sourceId || !player.sequencing.available
          "
          @click="player.previousEpisode()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M5 5h3v14H5zm14 0v14L9 12z" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Previous track"
          :title="
            player.tracks.positions.length
              ? 'Previous track'
              : 'Unavailable for this episode'
          "
          :disabled="!available || player.tracks.previous === null"
          @click="player.previousTrack()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M11 5v14L1 12zm12 0v14l-10-7z" />
          </svg>
        </button>
        <button
          class="skip-control"
          type="button"
          aria-label="Back 30 seconds"
          title="Back 30 seconds"
          :disabled="!seekable || (state.pendingSeek ?? state.currentTime) <= 0"
          @click="player.skip(-30)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="m15 5-7 7 7 7"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <button
          class="play-toggle"
          type="button"
          :aria-label="showPause ? 'Pause' : 'Play'"
          :title="showPause ? 'Pause' : 'Play'"
          :disabled="!available"
          @click="showPause ? player.pause() : player.play()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path v-if="showPause" d="M6 4h4v16H6zm8 0h4v16h-4z" />
            <path v-else d="M8 5v14l11-7z" />
          </svg>
        </button>
        <button
          class="skip-control"
          type="button"
          aria-label="Forward 30 seconds"
          title="Forward 30 seconds"
          :disabled="
            !seekable ||
            (state.pendingSeek ?? state.currentTime) >= (state.duration ?? 0)
          "
          @click="player.skip(30)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="m9 5 7 7-7 7"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Next track"
          :title="
            player.tracks.positions.length
              ? 'Next track'
              : 'Unavailable for this episode'
          "
          :disabled="!available || player.tracks.next === null"
          @click="player.nextTrack()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M1 5v14l10-7zm12 0v14l10-7z" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Next episode"
          title="Next episode"
          :aria-busy="player.sequencing.busy"
          :aria-disabled="player.sequencing.busy || undefined"
          :disabled="
            state.restoring || !state.sourceId || !player.sequencing.available
          "
          @click="player.nextEpisode()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M16 5h3v14h-3zM5 5v14l10-7z" />
          </svg>
        </button>
      </div>
      <div
        v-if="state.muteSupported || state.volumeSupported"
        class="volume-group"
        :class="{ 'has-volume-control': state.volumeSupported }"
        role="group"
        aria-label="Volume controls"
      >
        <button
          v-if="state.muteSupported"
          class="mute-toggle"
          type="button"
          :aria-label="muteLabel"
          :title="`${muteLabel} (${volumeDescription})`"
          :disabled="!available"
          @click="player.toggleMute()"
        >
          <svg
            class="volume-icon"
            viewBox="0 0 32 32"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M3 12h5l6-5v18l-6-5H3z" fill="currentColor" />
            <g
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            >
              <path
                v-if="state.muted"
                class="volume-muted"
                d="m20 12 8 8m0-8-8 8"
              />
              <g v-else class="volume-waves">
                <path v-if="volumeWaves >= 1" d="M18 12a6 6 0 0 1 0 8" />
                <path v-if="volumeWaves >= 2" d="M22 8a12 12 0 0 1 0 16" />
                <path v-if="volumeWaves >= 3" d="M26 4a18 18 0 0 1 0 24" />
              </g>
            </g>
          </svg>
        </button>
        <input
          v-if="state.volumeSupported"
          class="volume-control"
          aria-label="Volume"
          :title="volumeDescription"
          type="range"
          min="0"
          max="1"
          step="0.05"
          :value="state.volume"
          :aria-valuetext="`${Math.round(state.volume * 100)} percent`"
          :disabled="!available"
          @input="
            player.setVolume(Number(($event.target as HTMLInputElement).value))
          "
        />
      </div>
      <p v-if="!state.volumeSupported" class="device-volume">
        Use your device's volume buttons.
      </p>
    </div>
  </div>
</template>
