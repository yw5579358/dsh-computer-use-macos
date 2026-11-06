import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { chromium, type Browser } from 'playwright'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { BrowserToolDispatcher } from '../src/browser-host.js'
import type { BrowserScreenshotAdmission } from '../src/browser-host.js'
import { connectBrowser } from '../src/browser-bridge.js'

const executable = process.env.DSH_TEST_CHROME
  ?? (process.platform === 'darwin' && existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : chromium.executablePath())

const fixture = `<!doctype html><title>Browser Host integration fixture</title>
<style>body{margin:0}#name{position:absolute;left:20px;top:20px}#send{position:absolute;left:120px;top:180px;width:120px;height:50px}#result{position:absolute;left:20px;top:250px}</style>
<label>Name<input id="name"></label><button id="send">Send fixture</button><output id="result"></output>
<script>window.clicks=[];document.querySelector('#send').onclick=e=>{window.clicks.push([e.clientX,e.clientY]);document.querySelector('#result').textContent='Hello '+document.querySelector('#name').value}</script>`

async function findEndpoint(directory: string, child: ChildProcess): Promise<string> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Isolated browser exited: ${child.exitCode}`)
    try {
      const port = (await readFile(join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0]
      if (port && /^\d+$/.test(port)) return `http://127.0.0.1:${port}`
    } catch { /* Fresh browser has not written its endpoint yet. */ }
    await delay(50)
  }
  throw new Error('Isolated CDP browser did not start within 20 seconds.')
}

function object(value: JsonValue): Record<string, JsonValue> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, JsonValue>
}

test('Host tool route: semantic actions, image projection, cancellation and browser ownership', { skip: !existsSync(executable), timeout: 60_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-browser-host-fixture-'))
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(fixture)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  // Every process and browser page in this fixture uses a new temporary profile.
  const child = spawn(executable, ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${directory}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--no-sandbox', 'about:blank'], { stdio: 'ignore' })
  let external: Browser | undefined
  let observer: Browser | undefined
  let dispatcher: BrowserToolDispatcher | undefined
  try {
    const endpoint = await findEndpoint(directory, child)
    external = await chromium.connectOverCDP(endpoint, { noDefaults: true })
    const userPage = await external.contexts()[0]!.newPage()
    await userPage.setViewportSize({ width: 800, height: 600 })
    await userPage.goto(base)
    dispatcher = new BrowserToolDispatcher({ configuredCDPEndpoint: endpoint, browserTimeoutMs: 10_000 })
    const host = dispatcher
    const owner = {}
    const signal = new AbortController().signal
    let prepared = 0
    let admitted = 0
    const projectedImage: BrowserScreenshotAdmission = {
      async prepare(currentSignal) { currentSignal.throwIfAborted(); prepared++ },
      async admit(bytes, currentSignal) {
        currentSignal.throwIfAborted()
        const png = Buffer.from(bytes)
        assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a')
        admitted++
        // Emulate the Host's image admission resizing for a vision model. Raw
        // bytes never cross the declarative bridge; the reported pixels do.
        return { attachment: { attachmentId: 'fixture-projected-image', mediaType: 'image/png', bytes: bytes.length, width: png.readUInt32BE(16), height: png.readUInt32BE(20) }, mimeType: 'image/png', pixelWidth: png.readUInt32BE(16) / 2, pixelHeight: png.readUInt32BE(20) / 2, coordinateSpace: 'screenshot-pixels' }
      },
    }
    const bridge = connectBrowser(() => request => host.dispatch(request, owner, signal, projectedImage))
    const tab = await bridge.getTab({ url: base + '/' })

    await t.test('PTC bridge and Host execute locator fill/click and require fresh observation', async () => {
      await tab.playwright.getByLabel('Name').fill('Ada')
      await tab.playwright.getByRole('button', { name: 'Send fixture', exact: true }).click()
      assert.equal(await tab.playwright.locator('#result').innerText(), 'Hello Ada')
      assert.match(await tab.getAXState({ emit: false }), /Hello Ada/)
      assert.equal(await userPage.locator('#name').inputValue(), 'Ada')
    })

    await t.test('wire rejects arbitrary evaluation and selector code without execution', async () => {
      assert.equal('evaluate' in tab.playwright, false)
      for (const request of [
        { method: 'evaluate', params: { tabId: tab.id, code: 'globalThis.__wireExecuted=true' } },
        { method: 'locator', params: { tabId: tab.id, locator: { steps: [{ method: 'getByRole', args: ['button'] }], action: { method: 'evaluate', args: ['globalThis.__wireExecuted=true'] } } } },
        { method: 'locator', params: { tabId: tab.id, locator: { steps: [{ method: 'locator', args: ['js=globalThis.__wireExecuted=true'] }], action: { method: 'click', args: [] } } } },
      ]) await assert.rejects(host.dispatch(request, owner, signal), /INVALID_BROWSER_REQUEST/)
      assert.equal(await userPage.evaluate(() => '__wireExecuted' in globalThis), false)
    })

    await t.test('screenshot admission pixels map back to CSS pixels for coordinate clicks', async () => {
      const image = object(await tab.getScreenshot())
      assert.equal(prepared, 1)
      assert.equal(admitted, 1)
      assert.equal(image.pixelWidth, 400)
      assert.equal(image.pixelHeight, 300)
      assert.equal('data' in image, false)
      assert.equal('bytes' in image, false)
      // Actual button centre is CSS (180,205), but the model sees half-size.
      await tab.click([90, 102.5])
      const clicks = await userPage.evaluate(() => (globalThis as typeof globalThis & { clicks: number[][] }).clicks)
      assert.deepEqual(clicks.at(-1), [180, 205])
    })

    await t.test('viewport resize rejects stale image coordinates until recaptured', async () => {
      await userPage.setViewportSize({ width: 700, height: 500 })
      await assert.rejects(tab.click([90, 102.5]), /WINDOW_CHANGED/)
      const image = object(await tab.getScreenshot())
      assert.equal(image.pixelWidth, 350)
      assert.equal(image.pixelHeight, 250)
      await tab.click([90, 102.5])
      const clicks = await userPage.evaluate(() => (globalThis as typeof globalThis & { clicks: number[][] }).clicks)
      assert.deepEqual(clicks.at(-1), [180, 205])
    })

    await t.test('navigation and explicit tab selection invalidate screenshot coordinates even at the same size', async () => {
      await tab.getScreenshot()
      await tab.goto(base + '/?another-page')
      await assert.rejects(tab.click([90, 102.5]), /SCREENSHOT_REQUIRED/)
      await tab.getScreenshot()
      await tab.reload()
      await assert.rejects(tab.click([90, 102.5]), /SCREENSHOT_REQUIRED/)
      await tab.getScreenshot()
      await tab.back()
      await assert.rejects(tab.click([90, 102.5]), /SCREENSHOT_REQUIRED/)
      await tab.getScreenshot()
      await tab.forward()
      await assert.rejects(tab.click([90, 102.5]), /SCREENSHOT_REQUIRED/)
      await tab.getScreenshot()
      await bridge.getTab(tab.id)
      await assert.rejects(tab.click([90, 102.5]), /SCREENSHOT_REQUIRED/)
      await tab.goto(base)
    })

    await t.test('Host browser timeout bounds omitted locator waits and rejects larger explicit timeouts', async () => {
      const limited = new BrowserToolDispatcher({ configuredCDPEndpoint: endpoint, browserTimeoutMs: 800 })
      const limitedOwner = {}
      const limitedBridge = connectBrowser(() => request => limited.dispatch(request, limitedOwner, signal))
      try {
        const selected = await limitedBridge.getTab({ url: base + '/' })
        await assert.rejects(selected.playwright.getByText('Missing element').waitFor({ timeout: 801 }), /Locator timeout/)
        await assert.rejects(selected.playwright.getByText('Missing element').waitFor({ timeout: 0 }), /Invalid timeout/)
        const started = Date.now()
        await assert.rejects(selected.playwright.getByText('Missing element').waitFor(), /timeout|closed|disposed/i)
        assert.ok(Date.now() - started < 2500, 'An omitted locator timeout must not wait for Playwright’s 30-second default')
        assert.equal(userPage.isClosed(), false)
        assert.equal(child.exitCode, null)
      } finally { await limited.dispose() }
    })

    await t.test('wire close protects a pre-existing page', async () => {
      await assert.rejects(tab.close(), /TAB_NOT_OWNED/)
      assert.equal(userPage.isClosed(), false)
    })

    const temporary = await bridge.createBrowserTab('chromium', base + '/?temporary')
    const retained = await bridge.createBrowserTab('chromium', base + '/?retained')
    await retained.markHandoff()
    await t.test('abort settles a pending locator operation and cleans temporary owned tabs', async () => {
      const controller = new AbortController()
      const waiting = host.dispatch({ method: 'locator', params: { tabId: tab.id, locator: { steps: [{ method: 'getByText', args: ['This element never appears'] }], action: { method: 'waitFor', args: [{ state: 'visible', timeout: 10_000 }] } } } }, owner, controller.signal)
      const failure = waiting.then(() => { throw new Error('Cancelled locator unexpectedly completed') }, error => error as unknown)
      await delay(100)
      controller.abort(new Error('Host integration cancellation'))
      const error = await failure
      assert.ok(error instanceof Error)
      assert.match(error.message, /cancel|abort|closed|disposed/i)
      await host.disposeOwner(owner)
      await assert.rejects(host.dispatch({ method: 'listBrowsers', params: {} }, owner, signal), /BROWSER_DISPOSED/)
      assert.equal(child.exitCode, null)
      assert.equal(userPage.isClosed(), false)
      observer = await chromium.connectOverCDP(endpoint, { noDefaults: true })
      const urls = observer.contexts().flatMap(context => context.pages()).map(page => page.url())
      assert.ok(urls.includes(base + '/'), 'Pre-existing page must survive')
      assert.ok(urls.includes(base + '/?retained'), 'Handoff page must survive')
      assert.ok(!urls.includes(base + '/?temporary'), 'Unmarked temporary page must be cleaned up')
      await assert.rejects(temporary.getAXState(), /BROWSER_DISPOSED/)
    })
  } finally {
    await dispatcher?.dispose()
    await observer?.close()
    await external?.close()
    child.kill('SIGTERM')
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), delay(3000)])
    if (child.exitCode === null) child.kill('SIGKILL')
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
