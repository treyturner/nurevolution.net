/** Also supports browsers predating CSS container queries. */
export function useCompactContainer(limit: number, rem = false) {
  const container = ref<HTMLElement | null>(null)
  const compact = ref(false)
  let observer: ResizeObserver | undefined
  function measure() {
    if (!container.value) return
    const threshold =
      limit *
      (rem
        ? Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
        : 1)
    compact.value = container.value.clientWidth <= threshold
  }
  onMounted(() => {
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure)
      if (container.value) observer.observe(container.value)
    }
    window.addEventListener('resize', measure)
    measure()
  })
  watch(
    container,
    (element, previous) => {
      if (previous) observer?.unobserve(previous)
      if (element) observer?.observe(element)
      measure()
    },
    { flush: 'post' },
  )
  onBeforeUnmount(() => {
    observer?.disconnect()
    window.removeEventListener('resize', measure)
  })
  return { container, compact }
}
