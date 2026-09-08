import { defineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-07',
  ssr: true,
  devtools: { enabled: false },
  nitro: { preset: 'node-server' },
  app: { head: { title: 'Audio fixture', htmlAttrs: { lang: 'en' } } },
})
