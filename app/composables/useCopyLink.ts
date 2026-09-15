import { onBeforeUnmount, shallowRef } from 'vue'

export function useCopyLink() {
  const toast = shallowRef<{
    target: HTMLElement
    message: string
    inlineId?: string
  } | null>(null)
  let sequence = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  async function copyLink({
    url,
    target,
    message,
    androidInlineId,
  }: {
    url: string
    target: HTMLElement
    message: string
    androidInlineId?: string
  }) {
    const own = ++sequence
    clearTimeout(timer)
    toast.value = null
    let inlineId: string | undefined
    try {
      await navigator.clipboard.writeText(url)
      // Episode buttons use an inline check on Android, which already confirms
      // copies. RSS always shows its explicit URL-copied toast.
      if (androidInlineId && /Android/i.test(navigator.userAgent))
        inlineId = androidInlineId
    } catch {
      message = 'Couldn’t copy link. Please try again.'
    }
    if (own !== sequence) return
    toast.value = { target, message, inlineId }
    timer = setTimeout(() => {
      toast.value = null
    }, 3000)
  }
  onBeforeUnmount(() => {
    sequence++
    clearTimeout(timer)
  })
  return { toast, copyLink }
}
