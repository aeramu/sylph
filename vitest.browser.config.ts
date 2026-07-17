import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';
import { playwright } from '@vitest/browser-playwright';

// Interaction tests for critical UI surfaces. Kept in a separate project so the
// fast node suite (vitest.config.ts) stays free of a browser dependency.
export default defineConfig({
  plugins: [solid()],
  test: {
    include: ['src/**/*.browser.test.tsx'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
});
