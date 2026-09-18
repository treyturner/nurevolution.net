import { afterEach, expect, it, vi } from 'vitest'
import { openModal } from '../../app/services/modal'

const disposals: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposals.splice(0).reverse()) dispose()
  vi.restoreAllMocks()
})

function fixture(native = false) {
  const host = document.createElement('div')
  host.innerHTML =
    '<button id="modal-trigger">Open</button><section><button id="modal-background" aria-hidden="false">Background</button><dialog><button autofocus>First</button><button>Middle</button><button>Last</button><button disabled>Disabled</button><button hidden>Hidden</button><button style="display:none">CSS hidden</button><a href="#" style="visibility:hidden">Invisible</a></dialog></section>'
  document.body.appendChild(host)
  const dialog = host.querySelector('dialog')!
  const trigger = host.querySelector<HTMLButtonElement>('#modal-trigger')!
  const background = host.querySelector<HTMLButtonElement>('#modal-background')!
  Object.defineProperty(dialog, 'showModal', {
    configurable: true,
    value: native ? () => dialog.setAttribute('open', '') : undefined,
  })
  const close = vi.spyOn(dialog, 'close').mockImplementation(() => {
    dialog.removeAttribute('open')
    dialog.dispatchEvent(new Event('close'))
  })
  trigger.focus()
  const dismiss = vi.fn()
  const dispose = openModal(dialog, dismiss)
  disposals.push(() => {
    dispose()
    host.remove()
  })
  return { host, dialog, trigger, background, dismiss, dispose, close }
}

it('provides focus, background isolation, dismissal, and exact restoration without native dialogs', () => {
  const { host, dialog, trigger, background, dismiss, dispose, close } =
    fixture()
  const [first, middle, last] = dialog.querySelectorAll('button')
  expect(dialog.open).toBe(true)
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(document.activeElement).toBe(first)
  expect(background.getAttribute('aria-hidden')).toBe('true')
  expect(background.hasAttribute('inert')).toBe(true)
  background.focus()
  expect(document.activeElement).toBe(first)
  const click = vi.fn()
  background.addEventListener('click', click)
  background.click()
  expect(click).not.toHaveBeenCalled()
  first!.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  )
  expect(document.activeElement).toBe(last)
  last!.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    }),
  )
  expect(document.activeElement).toBe(first)
  middle!.focus()
  const tab = new KeyboardEvent('keydown', {
    key: 'Tab',
    bubbles: true,
    cancelable: true,
  })
  middle!.dispatchEvent(tab)
  expect(tab.defaultPrevented).toBe(false)
  dialog.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'x', bubbles: true }),
  )
  expect(dismiss).not.toHaveBeenCalled()
  dialog.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }),
  )
  expect(dismiss).toHaveBeenCalledTimes(1)
  host.querySelector<HTMLElement>('.modal-fallback-backdrop')!.click()
  expect(dismiss).toHaveBeenCalledTimes(2)
  dispose()
  dispose()
  expect(close).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(trigger)
  expect(background.getAttribute('aria-hidden')).toBe('false')
  expect(background.hasAttribute('inert')).toBe(false)
  expect(host.querySelector('.modal-fallback-backdrop')).toBeNull()
  expect(document.documentElement.classList.contains('modal-open')).toBe(false)
  background.click()
  expect(click).toHaveBeenCalledOnce()
})

it('retains native dialogs, handles cancel/close and bounds, and removes listeners on disposal', () => {
  const { dialog, dismiss, dispose, close } = fixture(true)
  expect(dialog.classList.contains('modal-fallback')).toBe(false)
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(100, 100, 100, 100),
  )
  dialog.dispatchEvent(
    new MouseEvent('click', { clientX: 150, clientY: 150, bubbles: true }),
  )
  expect(dismiss).not.toHaveBeenCalled()
  for (const [clientX, clientY] of [
    [99, 150],
    [201, 150],
    [150, 99],
    [150, 201],
  ])
    dialog.dispatchEvent(
      new MouseEvent('click', { clientX, clientY, bubbles: true }),
    )
  const cancel = new Event('cancel', { cancelable: true })
  dialog.dispatchEvent(cancel)
  expect(cancel.defaultPrevented).toBe(true)
  dialog.dispatchEvent(new Event('close'))
  expect(dismiss).toHaveBeenCalledTimes(6)
  dispose()
  expect(close).toHaveBeenCalledOnce()
  expect(dismiss).toHaveBeenCalledTimes(6)
})

it('keeps only the upper modal active and releases overlapping masks and locks safely', () => {
  document.documentElement.classList.add('modal-open')
  disposals.push(() => document.documentElement.classList.remove('modal-open'))
  const lower = fixture()
  const upper = fixture()
  lower.dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
  expect(lower.dismiss).not.toHaveBeenCalled()
  expect(upper.dialog.contains(document.activeElement)).toBe(true)
  lower.dispose()
  lower.host.remove()
  expect(document.documentElement.classList.contains('modal-open')).toBe(true)
  upper.dispose()
  expect(document.documentElement.classList.contains('modal-open')).toBe(true)
})

it('handles failed native opening, no focusable children, and preexisting background attributes', () => {
  const host = document.createElement('div')
  host.innerHTML =
    '<div aria-hidden="false" inert="existing"></div><dialog></dialog>'
  document.body.appendChild(host)
  const dialog = host.querySelector('dialog')!
  Object.defineProperty(dialog, 'showModal', {
    value: () => {
      throw new Error('unsupported')
    },
  })
  const dispose = openModal(dialog, vi.fn())
  disposals.push(() => {
    dispose()
    host.remove()
  })
  expect(document.activeElement).toBe(dialog)
  const tab = new KeyboardEvent('keydown', {
    key: 'Tab',
    bubbles: true,
    cancelable: true,
  })
  dialog.dispatchEvent(tab)
  expect(tab.defaultPrevented).toBe(true)
  dispose()
  expect(host.firstElementChild!.getAttribute('inert')).toBe('existing')
  expect(host.firstElementChild!.getAttribute('aria-hidden')).toBe('false')
})
