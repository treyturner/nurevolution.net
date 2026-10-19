import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const host = '0.0.0.0'
const port = 3001
const probe = createServer()

try {
  await new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.listen({ host, port }, () => {
      probe.close((error) => (error ? reject(error) : resolve()))
    })
  })
} catch (error) {
  if (error.code !== 'EADDRINUSE') throw error
  console.error(
    `Dev server port ${port} is already in use. Reuse the running preview or stop it before restarting; the preview stays on port ${port}.`,
  )
  process.exit(1)
}

const cli = fileURLToPath(
  new URL('bin/nuxt.mjs', import.meta.resolve('nuxt/package.json')),
)
const child = spawn(
  process.execPath,
  [cli, 'dev', '--host', host, '--port', String(port)],
  {
    stdio: 'inherit',
  },
)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1)
})
