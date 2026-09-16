import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-07',
  ssr: true,
  devtools: { enabled: false },
  vite: {
    server: { allowedHosts: ['.coder.treyturner.info'] },
  },
  runtimeConfig: {
    virtualPlayback: false,
    audioRoot: '',
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
        baseName: 'playback',
        dir: fileURLToPath(new URL('./playback', import.meta.url)),
      },
      {
        baseName: 'content',
        dir: fileURLToPath(new URL('./content', import.meta.url)),
      },
    ],
  },
  eslint: { config: { autoInit: false, stylistic: false } },
})
