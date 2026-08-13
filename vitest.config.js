import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: [
        'src/core/**/*.js',
        'src/solver/**/*.js',
      ],
      exclude: [
        'src/main.js',
        'src/app/**',
        'src/components/**',
        'src/pages/**',
        'src/storage/**',
        'src/utils/**',
      ],
    },
  },
});
