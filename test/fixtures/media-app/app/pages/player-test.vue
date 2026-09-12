<script setup lang="ts">
import { ref } from 'vue'
import ArchivePlayer from '../../../../../app/components/ArchivePlayer.vue'
import ArchiveLists from '../../../../../app/components/ArchiveLists.vue'
import { playerEpisodes } from '../../data/player'
const siteUrl = useRequestURL().origin
const episodes = playerEpisodes(siteUrl)
const selected = ref(episodes[0]!)
const mounted = ref(true)
function play() {
  return document.querySelector('audio')!.play()
}
</script>

<template>
  <main>
    <nav aria-label="Fixture controls">
      <button type="button" @click="play">Play fixture</button>
      <button type="button" @click="selected = episodes[0]!">
        Select first
      </button>
      <button type="button" @click="selected = episodes[1]!">
        Select second
      </button>
      <button type="button" @click="selected = episodes[2]!">
        Select third
      </button>
      <button type="button" @click="mounted = !mounted">Toggle player</button>
    </nav>
    <ArchivePlayer v-if="mounted" :episode="selected" />
    <ArchiveLists
      :episodes="episodes"
      :selected="selected"
      :site-url="siteUrl"
    />
  </main>
</template>
