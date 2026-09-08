import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  ignores: [
    '**/.nuxt/**',
    '**/.output/**',
    '.local/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
  ],
})
