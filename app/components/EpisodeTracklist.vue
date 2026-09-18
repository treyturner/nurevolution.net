<script setup lang="ts">
import type { EpisodeDetail } from '../../shared/content/public'
import type { PodcastPlayer } from '../composables/usePodcastPlayer'
import { formatTime } from '../services/episode-page'
import { useCompactContainer } from '../composables/useCompactContainer'
import TimestampCopyButton from './TimestampCopyButton.vue'
import { useCopyLink } from '../composables/useCopyLink'
import CopyLinkToast from './CopyLinkToast.vue'
const { toast, copyLink } = useCopyLink()
const { container, compact } = useCompactContainer(24, true)
const props = defineProps<{
  tracks: EpisodeDetail['tracks']
  durationSeconds?: number | null
  timeDisplay?: 'timestamp' | 'duration'
  player?: PodcastPlayer
  episodePath?: string
}>()
function displayTime(index: number) {
  const start = props.tracks[index]!.startTime
  if (props.timeDisplay === 'timestamp') return formatTime(start)
  const end =
    index + 1 < props.tracks.length
      ? props.tracks[index + 1]!.startTime
      : props.durationSeconds
  if (start === null || end == null || end <= start) return '-:-'
  const seconds = Math.floor(end - start)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
const playing = ref(false)
watch(
  () =>
    [
      props.player?.state.sourceId,
      props.player?.state.status,
      props.player?.state.wantsPlay,
    ] as const,
  ([sourceId, status, wantsPlay], previous) => {
    // Keep an established indicator through seek buffering for this source.
    playing.value =
      wantsPlay === true &&
      (status === 'playing' ||
        (status === 'buffering' && playing.value && sourceId === previous?.[0]))
  },
  { immediate: true },
)
const timed = (position: number) =>
  props.player?.tracks.positions.includes(position) ?? false
const canToggle = (position: number) =>
  props.player?.tracks.current === position &&
  (props.player.state.duration === null
    ? props.player.state.status !== 'ended'
    : props.player.state.currentTime < props.player.state.duration)
const action = (position: number) =>
  canToggle(position)
    ? props.player?.state.wantsPlay
      ? 'Pause'
      : 'Play'
    : 'Seek to'
function activate(position: number) {
  const player = props.player
  if (!player || !timed(position)) return
  if (!canToggle(position)) player.seekTrack(position)
  else if (player.state.wantsPlay) player.pause()
  else player.play()
}
</script>

<template>
  <ol
    v-if="tracks.length"
    ref="container"
    class="track-list"
    :class="{
      'compact-tracks': compact,
      'has-track-links': episodePath,
    }"
  >
    <li
      v-for="(track, index) in tracks"
      :key="track.position"
      :aria-current="
        player?.tracks.current === track.position ? 'true' : undefined
      "
    >
      <button
        v-if="timed(track.position)"
        class="track-row"
        type="button"
        :aria-label="`${action(track.position)} track ${track.position}: ${track.artist} - ${track.title}, ${formatTime(track.startTime)}`"
        :disabled="
          !player?.state.attached ||
          player.state.restoring ||
          player.state.status === 'error'
        "
        @click="activate(track.position)"
      />
      <div class="track-content">
        <span class="track-number" aria-hidden="true">{{
          String(track.position).padStart(2, '0')
        }}</span>
        <span>
          <span class="track-artist">{{ track.artist }}</span>
          <span class="track-title-line">
            <span class="track-title">{{ track.title }}</span>
            <TimestampCopyButton
              v-if="episodePath && track.startTime !== null"
              :episode-path="episodePath"
              :seconds="track.startTime"
              :label="`Copy link to track ${track.position}: ${track.artist} - ${track.title}`"
              @copy="copyLink({ ...$event, message: 'Timestamp link copied' })"
            />
          </span>
        </span>
        <span v-if="track.startTime !== null" class="track-meta">
          <Transition name="track-current" appear>
            <span
              v-if="playing && player?.tracks.current === track.position"
              class="track-current"
            >
              <span>now playing</span>
              <svg
                class="track-equalizer"
                :class="{ 'is-playing': playing }"
                viewBox="0 0 18 16"
                aria-hidden="true"
                focusable="false"
              >
                <rect x="0" y="8" width="2" height="8" rx="0.5" />
                <rect x="4" y="3" width="2" height="13" rx="0.5" />
                <rect x="8" y="0" width="2" height="16" rx="0.5" />
                <rect x="12" y="5" width="2" height="11" rx="0.5" />
                <rect x="16" y="9" width="2" height="7" rx="0.5" />
              </svg>
            </span>
          </Transition>
          <span
            class="track-time"
            :title="
              displayTime(index) === '-:-' ? 'Duration unavailable' : undefined
            "
            >{{ displayTime(index) }}</span
          >
        </span>
      </div>
    </li>
  </ol>
  <p v-else class="empty-tracks">No tracklist is available for this episode.</p>
  <span class="sr-only" role="status" aria-atomic="true">{{
    toast?.message
  }}</span>
  <CopyLinkToast v-if="toast" :target="toast.target" :message="toast.message" />
</template>
