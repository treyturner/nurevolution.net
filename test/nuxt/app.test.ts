import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import App from '../../app/app.vue'
import AppShell from '../../app/components/AppShell.vue'

describe('application shell', () => {
  it('renders the home route inside the real application landmark', async () => {
    const wrapper = await mountSuspended(App, { route: '/' })
    expect(wrapper.get('main h1').text()).toBe('Nurevolution')
    expect(wrapper.findAll('main')).toHaveLength(1)
    expect(wrapper.find('audio').exists()).toBe(false)
    wrapper.unmount()
  })

  it('provides a skip link to the focusable content slot', async () => {
    const wrapper = await mountSuspended(AppShell, {
      slots: { default: () => h('p', 'Episode content') },
    })
    expect(wrapper.get('a').text()).toBe('Skip to content')
    expect(wrapper.get('a').attributes('href')).toBe('#main-content')
    expect(wrapper.get('main').attributes('id')).toBe('main-content')
    expect(wrapper.get('main').attributes('tabindex')).toBe('-1')
    expect(wrapper.get('main').text()).toBe('Episode content')
    wrapper.unmount()
  })
})
