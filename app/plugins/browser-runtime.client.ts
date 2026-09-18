// Static imports run before Nuxt calls any plugin setup, including payload revival.
// Nuxt's router needs Array#at; its devalue dependency needs Object.hasOwn.
import 'core-js/modules/es.array.at.js'
import 'core-js/modules/es.object.has-own.js'

export default defineNuxtPlugin(() => {})
