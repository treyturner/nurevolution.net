import { defineConfig, devices } from '@playwright/test'

const appPort = process.env.NUREVOLUTION_TEST_PORT ?? '3100'
const mediaPort = process.env.NUREVOLUTION_MEDIA_TEST_PORT ?? '3101'

export const mediaBaseURL = `http://127.0.0.1:${mediaPort}`

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
