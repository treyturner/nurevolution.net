import { onBeforeUnmount, shallowRef } from 'vue'

export function useCopyLink() {
  const toast = shallowRef<{
    target: HTMLElement
    message: string
    inlineId?: string
    showPopup: boolean
  } | null>(null)
  let sequence = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  async function copyLink({
    url,
    target,
    message,
    androidInlineId,
    errorMessage = 'Couldn’t copy link. Please try again.',
  }: {
    url: string
    target: HTMLElement
    message: string
    androidInlineId?: string
    errorMessage?: string
  }) {
    const own = ++sequence
    clearTimeout(timer)
    toast.value = null
    let inlineId: string | undefined
    let showPopup = true
    let copied = false
    try {
      await navigator.clipboard.writeText(url)
      copied = true
      // Android already confirms successful clipboard writes. Keep the live
      // announcement and optional inline check, without a duplicate popup.
      if (/Android/i.test(navigator.userAgent)) {
        showPopup = false
        inlineId = androidInlineId
      }
    } catch {
      message = errorMessage
    }
    if (own !== sequence) return
    toast.value = { target, message, inlineId, showPopup }
    timer = setTimeout(() => {
      toast.value = null
    }, 3000)
    return copied
  }
  onBeforeUnmount(() => {
    sequence++
    clearTimeout(timer)
  })
  return { toast, copyLink }
}
