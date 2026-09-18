export default defineNuxtPlugin(() => {
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:absolute;visibility:hidden;display:flex;flex-direction:column;row-gap:1px;padding:0;border:0'
  for (let i = 0; i < 2; i++) {
    const child = document.createElement('div')
    child.style.cssText = 'height:1px;flex:none'
    probe.appendChild(child)
  }
  document.body.appendChild(probe)
  document.documentElement.classList.toggle(
    'no-flex-gap',
    probe.scrollHeight !== 3,
  )
  probe.remove()
})
