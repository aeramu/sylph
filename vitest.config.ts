import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The pure functions under test operate on plain objects and Solid stores,
    // neither of which needs a DOM — keep the fast node environment.
    environment: 'node',
    include: ['{src,server}/**/*.test.ts'],
  },
});
