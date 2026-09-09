import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  // Prettier owns template tag formatting.
  rules: { 'vue/html-self-closing': 'off' },
  ignores: [
    '**/.nuxt/**',
    '**/.output/**',
    '.local/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
  ],
})
