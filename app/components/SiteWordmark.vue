<script setup lang="ts">
const name = ref<HTMLElement | null>(null)
const wrapped = ref(false)
let observer: ResizeObserver | undefined
function measure() {
  if (!name.value) return
  const lineHeight = Number.parseFloat(getComputedStyle(name.value).lineHeight)
  wrapped.value = name.value.getBoundingClientRect().height > lineHeight + 1
}
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure)
    observer.observe(name.value!)
  }
  window.addEventListener('resize', measure)
  measure()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('resize', measure)
})
</script>

<template>
  <div class="wordmark">
    <div ref="name">nurevolution studios</div>
    <span v-show="!wrapped">austin, tx</span>
  </div>
</template>
