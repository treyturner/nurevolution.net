<script setup lang="ts">
const props = defineProps<{ target: HTMLElement; message: string }>()
const element = ref<HTMLElement | null>(null)
const position = ref<{ left: string; top: string } | null>(null)
function place() {
  const toast = element.value!
  const button = props.target.getBoundingClientRect()
  const width = window.innerWidth
  const height = window.innerHeight
  const margin = 12
  const gap = 8
  let left = (width - toast.offsetWidth) / 2
  let top = margin
  const visible =
    props.target.isConnected &&
    button.bottom > 0 &&
    button.top < height &&
    button.right > 0 &&
    button.left < width
  if (visible) {
    const above = button.top - toast.offsetHeight - gap
    const below = button.bottom + gap
    if (above >= margin || below + toast.offsetHeight <= height - margin) {
      top = above >= margin ? above : below
      left = Math.max(
        margin,
        Math.min(
          button.left + (button.width - toast.offsetWidth) / 2,
          width - toast.offsetWidth - margin,
        ),
      )
    }
  }
  position.value = { left: `${left}px`, top: `${top}px` }
}
watch(() => [props.target, props.message], place, { flush: 'post' })
onMounted(() => {
  place()
  window.addEventListener('resize', place)
  window.addEventListener('scroll', place, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', place)
  window.removeEventListener('scroll', place, true)
})
</script>

<template>
  <Teleport to="body">
    <span
      ref="element"
      class="copy-link-toast"
      :style="position ?? { visibility: 'hidden' }"
      aria-hidden="true"
      >{{ message }}</span
    >
  </Teleport>
</template>
