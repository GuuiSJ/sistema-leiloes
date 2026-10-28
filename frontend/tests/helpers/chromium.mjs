import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

// Run the real browser through its built-in DevTools pipe, without a test dependency.
export async function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  const root = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
  for (const name of await readdir(root).catch(() => [])) {
    const candidate = join(root, name, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

export async function openChromium(executable) {
  const child = spawn(executable, ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe'], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
  })
  const pending = new Map()
  let sequence = 0, buffer = '', diagnostic = ''
  child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-2000) })
  const fail = error => { for (const item of pending.values()) item.reject(error); pending.clear() }
  child.on('error', fail)
  child.on('exit', () => fail(new Error(`Chromium exited: ${diagnostic}`)))
  child.stdio[4].on('data', chunk => {
    buffer += chunk.toString()
    let index
    while ((index = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1)
      const item = pending.get(message.id)
      if (item) {
        pending.delete(message.id)
        if (message.error) item.reject(new Error(message.error.message))
        else item.resolve(message.result)
      }
    }
  })
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Chromium timed out: ${method}; ${diagnostic}`)) }, 15000)
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
      child.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0')
    })
  }
  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
      return result.result.value
    }
    return {
      evaluate,
      navigate: url => send('Page.navigate', { url }, sessionId),
      async wait(expression) {
        const end = Date.now() + 15000
        while (Date.now() < end) {
          if (await evaluate(expression)) return
          await new Promise(resolve => setTimeout(resolve, 30))
        }
        throw new Error(`Browser condition timed out: ${expression}\n${await evaluate('document.body.innerText')}`)
      },
      close: () => child.kill(),
    }
  } catch (error) { child.kill(); throw error }
}
