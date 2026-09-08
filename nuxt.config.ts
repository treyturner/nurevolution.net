import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-07',
  ssr: true,
  devtools: { enabled: false },
  modules: ['@nuxt/eslint'],
  css: ['~/assets/main.css'],
  app: {
    head: {
      title: 'Nurevolution',
      htmlAttrs: { lang: 'en' },
      meta: [{ name: 'color-scheme', content: 'dark' }],
    },
  },
  typescript: { strict: true },
  nitro: {
    preset: 'node-server',
    serverAssets: [
      {
        baseName: 'content',
        dir: fileURLToPath(new URL('./content', import.meta.url)),
      },
    ],
  },
  eslint: { config: { autoInit: false, stylistic: false } },
})
