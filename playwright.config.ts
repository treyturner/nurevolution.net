import { defineConfig, devices } from '@playwright/test'

const appPort = process.env.NUREVOLUTION_TEST_PORT ?? '3100'
const mediaPort = process.env.NUREVOLUTION_MEDIA_TEST_PORT ?? '3101'
const previewPort = process.env.NUREVOLUTION_PREVIEW_TEST_PORT ?? '3102'

export const mediaBaseURL = `http://127.0.0.1:${mediaPort}`
export const previewBaseURL = `http://127.0.0.1:${previewPort}`
export const previewWebOrigin = 'https://preview-web.example.test'
export const previewMediaOrigin = 'https://preview-media.example.test'

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 1 : 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${appPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    {
      command: 'node .output/server/index.mjs',
      url: previewBaseURL,
      env: {
        HOST: '127.0.0.1',
        PORT: previewPort,
        NUXT_PUBLIC_WEB_ORIGIN: previewWebOrigin,
        NUXT_PUBLIC_MEDIA_ORIGIN: previewMediaOrigin,
      },
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
    {
      command: 'node .output/server/index.mjs',
      url: `http://127.0.0.1:${appPort}`,
      env: { HOST: '127.0.0.1', PORT: appPort },
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
    {
      command: 'node test/fixtures/media-app/.output/server/index.mjs',
      url: `${mediaBaseURL}/media-test`,
      env: { HOST: '127.0.0.1', PORT: mediaPort },
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
  ],
})
