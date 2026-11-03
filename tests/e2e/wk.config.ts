import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: /wk-probe\.spec\.ts/, timeout: 180_000, projects: [
  { name: 'webkit', use: { ...devices['Desktop Safari'], baseURL: 'http://localhost:3000' } },
  { name: 'chromium', use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3000' } } ] });
