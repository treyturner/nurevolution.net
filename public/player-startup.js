// Keep this file classic ES5: it must work even when the application cannot load.
;(function () {
  var timer
  var selector = '[data-player-startup="pending"]'
  function ready() {
    window.clearTimeout(timer)
    var failed = document.querySelectorAll('[data-player-startup-failed]')
    for (var i = 0; i < failed.length; i++) {
      failed[i].removeAttribute('data-player-startup-failed')
    }
    document.removeEventListener('nurevolution:player-ready', ready)
    document.removeEventListener('prerenderingchange', start)
  }
  function start() {
    if (document.prerendering) return
    if (!document.querySelector(selector)) {
      ready()
      return
    }
    window.clearTimeout(timer)
    timer = window.setTimeout(function () {
      var pending = document.querySelectorAll(selector)
      for (var i = 0; i < pending.length; i++) {
        pending[i].setAttribute('data-player-startup-failed', '')
      }
    }, 15000)
  }
  document.addEventListener('nurevolution:player-ready', ready)
  document.addEventListener('prerenderingchange', start)
  start()
})()
