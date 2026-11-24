import { defineConfig, devices } from '@playwright/test'

const PORT = 3100

// The SPA as production serves it: built, and from the API's own origin.
export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Pixel 7'] } },
    { name: 'webkit', use: { ...devices['iPhone 15'] } },
  ],
  webServer: {
    command: 'bun --env-file=../api/.env.test ../api/src/index.ts',
    env: { PORT: String(PORT), WEB_DIST: 'dist' },
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
  },
})
