import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-07',
  ssr: true,
  devtools: { enabled: false },
  runtimeConfig: {
    public: { webOrigin: '', mediaOrigin: '' },
  },
  modules: ['@nuxt/eslint'],
  css: ['~/assets/main.css'],
  app: {
    head: {
      title: 'nurevolution studios',
      htmlAttrs: { lang: 'en' },
      meta: [{ name: 'color-scheme', content: 'dark' }],
      link: [
        {
          rel: 'icon',
          type: 'image/png',
          sizes: '300x300',
          href: '/brand/nu.png',
        },
      ],
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
