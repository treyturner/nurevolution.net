<script setup lang="ts">
defineProps<{ src: string; alt: string }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const close = () => dialog.value?.close()
onMounted(() => dialog.value!.showModal())
onBeforeUnmount(close)
</script>

<template>
  <dialog
    ref="dialog"
    class="artwork-dialog"
    :aria-label="alt"
    @close="emit('close')"
    @click.self="close"
  >
    <div class="artwork-dialog-stage" @click.self="close">
      <img :src="src" :alt="alt" @error="close" />
    </div>
    <button
      type="button"
      class="artwork-dialog-close"
      aria-label="Close artwork"
      autofocus
      @click="close"
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="m6 6 12 12M18 6 6 18" />
      </svg>
    </button>
  </dialog>
</template>
