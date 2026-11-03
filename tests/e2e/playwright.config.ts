import { defineConfig, devices } from '@playwright/test';
const API = process.env.E2E_API_URL ?? 'http://localhost:8080';
const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3000';

const camera = () => ({
  ...devices['Desktop Chrome'],
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  },
  permissions: ['camera'],
});

export default defineConfig({
  testDir: './specs',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: WEB, trace: 'retain-on-failure', screenshot: 'only-on-failure', locale: 'ko-KR', timezoneId: 'Asia/Seoul' },
  projects: [
    { name: 'api', testMatch: /api\..*\.spec\.ts/, use: { baseURL: API } },
    { name: 'ui', testMatch: /ui\..*\.spec\.ts/, use: camera() },
    { name: 'camera-person', testMatch: /camera-person\.(monitoring|pipeline|soak)\.spec\.ts/, use: camera() },
    { name: 'camera-nobody', testMatch: /camera-nobody\..*\.spec\.ts/, use: camera() },
    {
      // WebKit engine (≈ Safari, but NOT Safari: no Safari power/autoplay policies). Canvas camera only.
      name: 'webkit-person',
      testMatch: /camera-person\.(monitoring|pipeline)\.spec\.ts/,
      grep: /teacher sees it live|nobody in frame|frozen camera|pauses the hidden/,
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'camera-denied',
      testMatch: /camera-denied\..*\.spec\.ts/,
      // No fake-UI flag and no permission grant → getUserMedia rejects with NotAllowedError.
      use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--use-fake-device-for-media-stream', '--deny-permission-prompts'] } },
    },
  ],
  webServer: [
    {
      command: './scripts/start-backend.sh',
      url: `${API}/actuator/health`,
      reuseExistingServer: true,
      timeout: 240_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npm --prefix ../../frontend run dev',
      url: `${WEB}/login`,
      reuseExistingServer: true,
      timeout: 180_000,
      env: { NEXT_PUBLIC_API_BASE_URL: API },
    },
  ],
});
