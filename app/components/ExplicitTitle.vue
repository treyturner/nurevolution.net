<script setup lang="ts">
import ExplicitBadge from './ExplicitBadge.vue'

const props = defineProps<{ title: string; explicit: boolean }>()
const parts = computed(() => {
  // Attach the final character so normal words stay with the badge, while
  // very long words can still wrap earlier on narrow screens.
  const match = /^(.*?)(\S\s*)$/su.exec(props.title)
  return {
    prefix: match?.[1] ?? '',
    ending: match?.[2] ?? props.title,
  }
})
</script>

<template>
  <template v-if="explicit"
    >{{ parts.prefix
    }}<span class="explicit-title-ending"
      >{{ parts.ending }}<ExplicitBadge /></span
  ></template>
  <template v-else>{{ title }}</template>
</template>
