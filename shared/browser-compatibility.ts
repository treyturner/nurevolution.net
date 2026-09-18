// iPadOS 14.3 predates import maps and several optional browser APIs.
// This is the client syntax/CSS floor; runtime APIs need separate fallbacks.
export const browserCompatibility = {
  experimental: { entryImportMap: false },
  vite: {
    build: {
      target: ['safari14', 'ios14.3'],
      cssTarget: ['safari14', 'ios14.3'],
    },
  },
}
