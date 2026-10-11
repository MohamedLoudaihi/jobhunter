import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
export default defineConfig({
  testDir: './e2e-pages', workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173/jobhunter/', headless: true, launchOptions: { executablePath, args: ['--no-sandbox'] }, trace: 'retain-on-failure' },
  webServer: { command: 'npm run preview:pages', url: 'http://127.0.0.1:4173/jobhunter/', reuseExistingServer: !process.env.CI, timeout: 30000 },
});
