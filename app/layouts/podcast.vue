<script setup lang="ts">
import { episodeHead, formatDate, formatTime } from '../services/episode-page'
const state = useEpisodePage()
useHead(() =>
  state.value.model ? episodeHead(state.value.model, state.value.path) : {},
)
</script>

<template>
  <div v-if="state.model" class="podcast">
    <header class="site-header">
      <NuxtLink to="/" :prefetch="false" class="wordmark"
        >Nurevolution<span>Independent transmissions</span></NuxtLink
      >
      <a :href="state.model.show.feedUrl"
        >Subscribe via RSS <span aria-hidden="true">↗</span></a
      >
    </header>
    <p v-if="state.failedPath" role="alert">
      Could not load this episode.
      <NuxtLink :to="state.failedPath" :prefetch="false">Try again</NuxtLink>
    </p>
    <section v-if="state.model.selected" aria-labelledby="episode-title">
      <p>{{ state.model.selected.artist }}</p>
      <h1 id="episode-title">{{ state.model.selected.title }}</h1>
      <p>
        {{ formatDate(state.model.selected.publishedAt) }} ·
        {{ formatTime(state.model.selected.durationSeconds) }}
      </p>
      <img
        :src="state.model.selected.artworkUrl"
        :alt="`${state.model.selected.artist} — ${state.model.selected.title} cover art`"
        width="320"
        height="320"
      />
      <!-- This HTML has passed the canonical content sanitizer on the server. -->
      <div class="description" v-html="state.model.selected.descriptionHtml" />
    </section>
    <section v-else>
      <h1>Podcast archive</h1>
      <p>No episodes are available yet.</p>
    </section>
    <div class="archive-grid">
      <section aria-labelledby="episodes-heading">
        <h2 id="episodes-heading">
          Episodes <span>{{ state.model.episodes.length }}</span>
        </h2>
        <ol class="episode-list">
          <li v-for="episode in state.model.episodes" :key="episode.id">
            <NuxtLink
              :to="episode.path"
              :prefetch="false"
              :aria-current="
                episode.id === state.model.selected?.id ? 'page' : undefined
              "
              :aria-busy="state.pendingPath === episode.path || undefined"
              >{{ episode.title }} <span>{{ episode.artist }}</span></NuxtLink
            >
          </li>
        </ol>
      </section>
      <section v-if="state.model.selected" aria-labelledby="tracks-heading">
        <h2 id="tracks-heading">Tracklist</h2>
        <ol v-if="state.model.selected.tracks.length">
          <li
            v-for="track in state.model.selected.tracks"
            :key="track.position"
          >
            {{ track.artist }} — {{ track.title }}
            <span v-if="track.startTime !== null">{{
              formatTime(track.startTime)
            }}</span>
          </li>
        </ol>
        <p v-else>No tracklist is available for this episode.</p>
      </section>
    </div>
    <slot />
  </div>
</template>
