import { fileURLToPath } from 'node:url'
import { defineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-07',
  ssr: true,
  css: [
    fileURLToPath(new URL('../../../app/assets/main.css', import.meta.url)),
  ],
  devtools: { enabled: false },
  nitro: { preset: 'node-server' },
  app: { head: { title: 'Audio fixture', htmlAttrs: { lang: 'en' } } },
})
