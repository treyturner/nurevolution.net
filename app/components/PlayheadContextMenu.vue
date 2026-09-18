<script setup lang="ts">
import type { CSSProperties } from 'vue'
import LinkIcon from './LinkIcon.vue'

const props = defineProps<{ enabled: boolean; sourceKey?: string }>()
const emit = defineEmits<{ open: []; copy: [target: HTMLElement] }>()
const row = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const item = ref<HTMLButtonElement | null>(null)
const opened = ref(false)
const suppressSeek = ref(false)
const position = ref<CSSProperties>({
  left: '0px',
  top: '0px',
  visibility: 'hidden',
})
let timer: ReturnType<typeof setTimeout> | undefined
let touch: { x: number; y: number } | undefined
let contextEligible: boolean | null = null

function thumb() {
  const input = row.value!.querySelector('input')!
  const box = input.getBoundingClientRect()
  const size =
    Number.parseFloat(
      getComputedStyle(input).getPropertyValue('--playhead-size'),
    ) || 16
  const min = Number(input.min)
  const span = Number(input.max) - min
  const fraction =
    span > 0 ? Math.max(0, Math.min(1, (Number(input.value) - min) / span)) : 0
  return {
    input,
    size,
    x: box.left + size / 2 + Math.max(0, box.width - size) * fraction,
    y: box.top + box.height / 2,
  }
}
function onThumb(event: MouseEvent, touchInput = false) {
  const head = thumb()
  const radius = Math.max(head.size, touchInput ? 32 : 0) / 2
  return (
    (event.target === head.input ||
      (touchInput && event.target === row.value)) &&
    !head.input.disabled &&
    Math.hypot(event.clientX - head.x, event.clientY - head.y) <= radius
  )
}

function cancelHold() {
  clearTimeout(timer)
  touch = undefined
}
function close(restoreFocus = false) {
  cancelHold()
  suppressSeek.value = false
  if (!opened.value) return
  opened.value = false
  if (restoreFocus)
    row.value?.querySelector('input')?.focus({ preventScroll: true })
}
async function open() {
  if (!props.enabled) return
  cancelHold()
  suppressSeek.value = true
  emit('open')
  position.value = { left: '0px', top: '0px', visibility: 'hidden' }
  opened.value = true
  await nextTick()
  if (!opened.value) return
  const head = thumb()
  const x = head.x
  const box = menu.value!.getBoundingClientRect()
  const y = head.y - head.size / 2 - 6 - box.height
  position.value = {
    left: `${Math.max(8, Math.min(x, window.innerWidth - box.width - 8))}px`,
    top: `${Math.max(8, Math.min(y, window.innerHeight - box.height - 8))}px`,
    visibility: 'visible',
  }
  await nextTick()
  if (opened.value) item.value!.focus({ preventScroll: true })
}
function context(event: MouseEvent) {
  // Check the start of the gesture: a touch elsewhere on the track may have
  // moved the native slider thumb by the time its contextmenu event arrives.
  const eligible = contextEligible ?? onThumb(event)
  contextEligible = null
  if (!props.enabled || !eligible) return
  event.preventDefault()
  void open()
}
function triggerKey(event: KeyboardEvent) {
  if (
    !props.enabled ||
    !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
  )
    return
  event.preventDefault()
  void open()
}
function pointerDown(event: PointerEvent) {
  cancelHold()
  suppressSeek.value = false
  contextEligible = onThumb(event, event.pointerType === 'touch')
  if (
    !props.enabled ||
    !contextEligible ||
    event.pointerType !== 'touch' ||
    !event.isPrimary
  )
    return
  touch = { x: event.clientX, y: event.clientY }
  timer = setTimeout(() => void open(), 600)
}
function pointerMove(event: PointerEvent) {
  if (
    touch &&
    Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 10
  ) {
    cancelHold()
    contextEligible = false
  }
}
function copy() {
  if (props.enabled) emit('copy', row.value!.querySelector('input')!)
  close(true)
}
function menuKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close(true)
  } else if (event.key === 'Tab') {
    close(true)
  } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    item.value!.focus()
  }
}
function outside(event: Event) {
  if (!opened.value && row.value?.contains(event.target as Node)) return
  if (!menu.value?.contains(event.target as Node)) close()
}
function dismiss() {
  close()
}
watch([() => props.enabled, () => props.sourceKey], () => close())
onMounted(() => {
  document.addEventListener('pointerdown', outside)
  document.addEventListener('focusin', outside)
  window.addEventListener('resize', dismiss)
  window.addEventListener('scroll', dismiss, true)
})
onBeforeUnmount(() => {
  close()
  document.removeEventListener('pointerdown', outside)
  document.removeEventListener('focusin', outside)
  window.removeEventListener('resize', dismiss)
  window.removeEventListener('scroll', dismiss, true)
})
</script>

<template>
  <div
    ref="row"
    class="seek-row"
    @contextmenu="context"
    @keydown="triggerKey"
    @pointerdown="pointerDown"
    @pointermove="pointerMove"
    @pointerup="cancelHold"
    @pointercancel="cancelHold"
    @pointerleave="cancelHold"
  >
    <slot :suppress-seek="suppressSeek || opened" />
  </div>
  <Teleport to="body">
    <div
      v-if="opened"
      ref="menu"
      class="playhead-menu"
      role="menu"
      aria-label="Playback position actions"
      :style="position"
      @keydown="menuKey"
      @contextmenu.prevent
    >
      <button ref="item" type="button" role="menuitem" @click="copy">
        <LinkIcon /> Copy timestamp link
      </button>
    </div>
  </Teleport>
</template>
