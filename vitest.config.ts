import { defineVitestProject } from '@nuxt/test-utils/config'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      await defineVitestProject({
        test: {
          name: 'nuxt',
          environment: 'nuxt',
          include: ['test/nuxt/**/*.test.ts'],
        },
      }),
    ],
    coverage: {
      provider: 'v8',
      include: [
        'app/**/*.{ts,vue}',
        'shared/**/*.ts',
        'server/**/*.ts',
        'tools/content/**/*.ts',
        'tools/deploy/**/*.ts',
      ],
      exclude: ['**/*.d.ts'],
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        statements: 95,
        lines: 95,
        functions: 95,
        branches: 90,
        autoUpdate: false,
      },
    },
  },
})
