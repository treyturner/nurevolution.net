const stack: HTMLDialogElement[] = []
const masked = new Map<
  Element,
  { users: number; hidden: string | null; inert: string | null }
>()
let previouslyLocked = false

function mask(element: Element) {
  const prior = masked.get(element)
  if (prior) prior.users++
  else {
    masked.set(element, {
      users: 1,
      hidden: element.getAttribute('aria-hidden'),
      inert: element.getAttribute('inert'),
    })
    element.setAttribute('aria-hidden', 'true')
    element.setAttribute('inert', '')
  }
  return () => {
    const state = masked.get(element)!
    if (--state.users) return
    for (const [name, value] of [
      ['aria-hidden', state.hidden],
      ['inert', state.inert],
    ] as const) {
      if (value === null) element.removeAttribute(name)
      else element.setAttribute(name, value)
    }
    masked.delete(element)
  }
}

/** Native modal when available; otherwise provide the missing modal behavior. */
export function openModal(dialog: HTMLDialogElement, dismiss: () => void) {
  const previous = document.activeElement
  const cleanups: (() => void)[] = []
  const top = () => stack[stack.length - 1] === dialog
  let disposed = false
  let native = false
  if (!stack.length)
    previouslyLocked = document.documentElement.classList.contains('modal-open')
  stack.push(dialog)
  document.documentElement.classList.add('modal-open')
  dialog.setAttribute('tabindex', '-1')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('role', 'dialog')
  try {
    if (typeof dialog.showModal === 'function') {
      dialog.showModal()
      native = true
    }
  } catch {
    // Some embedded browsers expose the method without supporting its behavior.
  }
  function listen<K extends keyof DocumentEventMap>(
    target: Document | HTMLElement,
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
  ) {
    target.addEventListener(type, listener as EventListener, true)
    cleanups.push(() =>
      target.removeEventListener(type, listener as EventListener, true),
    )
  }
  const buttons = () =>
    Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, [tabindex]',
      ),
    ).filter(
      (item) =>
        item.tabIndex >= 0 &&
        !item.hasAttribute('disabled') &&
        !item.closest('[hidden]') &&
        getComputedStyle(item).display !== 'none' &&
        getComputedStyle(item).visibility !== 'hidden',
    )
  const focus = () => {
    const available = buttons()
    ;(
      available.find((item) => item.hasAttribute('autofocus')) ??
      available[0] ??
      dialog
    ).focus({ preventScroll: true })
  }
  if (!native) {
    dialog.setAttribute('open', '')
    dialog.classList.add('modal-fallback')
    const backdrop = document.createElement('div')
    backdrop.className = 'modal-fallback-backdrop'
    backdrop.style.setProperty(
      '--modal-shade',
      getComputedStyle(dialog).getPropertyValue('--modal-shade'),
    )
    backdrop.setAttribute('aria-hidden', 'true')
    dialog.before(backdrop)
    cleanups.push(() => backdrop.remove())
    let branch: Element = dialog
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling !== backdrop)
          cleanups.push(mask(sibling))
      }
      branch = branch.parentElement
      if (branch === document.body) break
    }
    // Covers browsers without inert, including programmatic background clicks.
    listen(document, 'click', (event) => {
      if (!top() || dialog.contains(event.target as Node)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.target === backdrop) dismiss()
    })
  }
  listen(document, 'focusin', (event) => {
    if (top() && !dialog.contains(event.target as Node)) focus()
  })
  listen(document, 'keydown', (event) => {
    if (!top()) return
    if (event.key === 'Escape' && !native) {
      event.preventDefault()
      dismiss()
    } else if (event.key === 'Tab') {
      const available = buttons()
      const index = available.indexOf(document.activeElement as HTMLElement)
      if (!available.length || index < 0) {
        event.preventDefault()
        focus()
      } else if (
        event.shiftKey ? index === 0 : index === available.length - 1
      ) {
        event.preventDefault()
        available[event.shiftKey ? available.length - 1 : 0]!.focus()
      }
    }
  })
  listen(dialog, 'cancel', (event) => {
    event.preventDefault()
    if (top()) dismiss()
  })
  listen(dialog, 'close', () => {
    if (top()) dismiss()
  })
  listen(dialog, 'click', (event) => {
    if (!top() || event.target !== dialog) return
    const bounds = dialog.getBoundingClientRect()
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      dismiss()
  })
  focus()
  return () => {
    if (disposed) return
    disposed = true
    const wasTop = top()
    for (const stop of cleanups.reverse()) stop()
    stack.splice(stack.indexOf(dialog), 1)
    if (native) dialog.close()
    else dialog.removeAttribute('open')
    if (!stack.length && !previouslyLocked)
      document.documentElement.classList.remove('modal-open')
    if (wasTop && previous instanceof HTMLElement && previous.isConnected)
      previous.focus({ preventScroll: true })
  }
}
