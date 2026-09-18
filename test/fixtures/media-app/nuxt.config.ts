import { fileURLToPath } from 'node:url'
import { defineNuxtConfig } from 'nuxt/config'
import { browserCompatibility } from '../../../shared/browser-compatibility'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-07',
  ssr: true,
  experimental: browserCompatibility.experimental,
  plugins: [
    fileURLToPath(
      new URL(
        '../../../app/plugins/browser-runtime.client.ts',
        import.meta.url,
      ),
    ),
  ],
  vite: browserCompatibility.vite,
  css: [
    fileURLToPath(new URL('../../../app/assets/main.css', import.meta.url)),
  ],
  devtools: { enabled: false },
  runtimeConfig: { audioRoot: '', public: { webOrigin: '', mediaOrigin: '' } },
  nitro: {
    preset: 'node-server',
    serverAssets: [
      {
        baseName: 'playback-test',
        dir: fileURLToPath(new URL('../playback', import.meta.url)),
      },
      {
        baseName: 'media',
        dir: fileURLToPath(new URL('./public', import.meta.url)),
      },
    ],
  },
  app: { head: { title: 'Audio fixture', htmlAttrs: { lang: 'en' } } },
})
