import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Integration tests boot an in-process Postgres (PGlite); give them room.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
