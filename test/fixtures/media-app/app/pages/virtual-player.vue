<script setup lang="ts">
import ArchivePlayer from '../../../PlayerHarness.vue'
import { playerEpisodes } from '../../data/player'
import fixture from '../../../playback/fixture.json'
const origin = useRequestURL().origin
const episode = playerEpisodes(origin)[0]!
const v = fixture.entry.virtual
episode.durationSeconds = v.samples / v.sampleRate
episode.audio.url = origin + '/virtual-source.mp3'
episode.audio.playback = {
  url: useRoute().query.fail
    ? origin + '/playback/unavailable.m4a'
    : origin + `/playback/${fixture.entry.sourceSha256}/${v.sha256}.m4a`,
  mediaType: 'audio/mp4',
  codecs: 'mp4a.6B',
}
episode.tracks = [0, 3.28, 13.37].map((startTime, i) => ({
  position: i + 1,
  artist: 'Synthetic fixture',
  title: `Track ${i + 1}`,
  startTime,
}))
</script>

<template>
  <ArchivePlayer :episode="episode" />
</template>
