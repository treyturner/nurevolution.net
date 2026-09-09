<script setup lang="ts">
import type { NuxtError } from '#app'
defineProps<{ error: NuxtError }>()
</script>

<template>
  <AppShell>
    <h1>
      {{
        error.statusCode === 404
          ? 'Episode not found'
          : 'Archive temporarily unavailable'
      }}
    </h1>
    <p>
      {{
        error.statusCode === 404
          ? 'This page is not available in the archive.'
          : 'Please try again in a moment.'
      }}
    </p>
    <a href="/">Back to the archive</a>
    <button
      v-if="error.statusCode !== 404"
      type="button"
      @click="reloadNuxtApp({ force: true })"
    >
      Try again
    </button>
  </AppShell>
</template>
