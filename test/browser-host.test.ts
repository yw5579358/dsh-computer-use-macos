import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { boundLocatorTimeout, BrowserToolDispatcher, installBrowserTool, parseBrowserRequest, renderBrowserResult, validateLocatorRequest } from '../src/browser-host.js'
import type { BrowserRequest } from '../src/browser-host.js'
import { connectBrowser } from '../src/browser-bridge.js'

const signal = () => new AbortController().signal

test('an absent endpoint contributes no browser tool and performs no host registration', async () => {
  const emptyContext: Context = Object.create(null)
  installBrowserTool(emptyContext, {})
  const dispatcher = new BrowserToolDispatcher({ configuredCDPEndpoint: '  ' })
  assert.equal(dispatcher.enabled, false)
  await assert.rejects(dispatcher.dispatch({ method: 'listBrowsers', params: {} }, {}, signal()), /BROWSER_NOT_CONFIGURED/)
  await dispatcher.dispose()
})

test('endpoint and model operations reject unsafe fields before a browser is acquired', async () => {
  assert.throws(() => new BrowserToolDispatcher({ configuredCDPEndpoint: 'http://example.com:9222' }), /INVALID_CDP_ENDPOINT/)
  const dispatcher = new BrowserToolDispatcher({ configuredCDPEndpoint: 'http://127.0.0.1:1' })
  for (const request of [
    { method: 'evaluate', params: { code: 'globalThis' } },
    { method: 'listBrowsers', params: { endpoint: 'http://127.0.0.1:9999' } },
    { method: 'goto', params: { tabId: 'x', url: 'javascript:alert(1)' } },
    { method: 'goto', params: { tabId: 'x', url: 'file:///etc/passwd' } },
    { method: 'goto', params: { tabId: 'x', url: 'https://user:secret@example.com' } },
    { method: 'click', params: { tabId: 'x', target: [Number.NaN, 3] } },
    { method: 'pressKey', params: { tabId: 'x', index: -1, key: 'Enter' } },
  ]) await assert.rejects(dispatcher.dispatch(request, {}, signal()), /INVALID_BROWSER_REQUEST/)
  await dispatcher.dispose()
})

test('locator wire format admits named semantic operations and rejects executable or extra data', () => {
  const valid = { steps: [{ method: 'getByRole', args: ['button', { name: 'Save', exact: true }] }], action: { method: 'click', args: [{ timeout: 1000 }] } }
  assert.deepEqual(validateLocatorRequest(valid), valid)
  assert.deepEqual(validateLocatorRequest({ steps: [{ method: 'getByText', args: ['row'] }, { method: 'nth', args: [1] }], action: { method: 'innerText', args: [] } }).action.method, 'innerText')
  for (const value of [
    { ...valid, code: 'alert(1)' },
    { ...valid, action: { method: 'evaluate', args: ['() => 1'] } },
    { ...valid, steps: [{ method: 'locator', args: ['javascript:alert(1)'] }] },
    { ...valid, steps: [{ method: 'getByRole', args: ['button', { name: { source: '.*' } }] }] },
    { ...valid, action: { method: 'click', args: [{ timeout: 0 }] } },
    { ...valid, action: { method: 'click', args: [{ force: true, script: 'x' }] } },
  ]) assert.throws(() => validateLocatorRequest(value), /INVALID_BROWSER_REQUEST/)
})

test('one exact live Session exclusively owns the endpoint and stale owners cannot reacquire it', async () => {
  const dispatcher = new BrowserToolDispatcher({ configuredCDPEndpoint: 'http://127.0.0.1:1' })
  const first = {}, second = {}
  const listing = { method: 'listBrowsers', params: {} }
  assert.ok(Array.isArray(await dispatcher.dispatch(listing, first, signal())))
  await assert.rejects(dispatcher.dispatch(listing, second, signal()), /BROWSER_BUSY/)
  await assert.rejects(dispatcher.dispatch({ method: 'getAXState', params: { tabId: 'tab-1' } }, first, signal()), /TAB_ACCESS_REQUIRED/)
  await dispatcher.disposeOwner(first)
  await assert.rejects(dispatcher.dispatch(listing, first, signal()), /BROWSER_DISPOSED/)
  assert.ok(Array.isArray(await dispatcher.dispatch(listing, second, signal())))
  await dispatcher.dispose()
  await assert.rejects(dispatcher.dispatch(listing, {}, signal()), /BROWSER_DISPOSED/)
})

test('pre-cancelled browser calls do not reserve the endpoint for their stale caller', async () => {
  const dispatcher = new BrowserToolDispatcher({ configuredCDPEndpoint: 'http://127.0.0.1:1' })
  const controller = new AbortController(); controller.abort(new Error('cancelled by test'))
  await assert.rejects(dispatcher.dispatch({ method: 'listBrowsers', params: {} }, {}, controller.signal), /cancelled by test/)
  assert.ok(Array.isArray(await dispatcher.dispatch({ method: 'listBrowsers', params: {} }, {}, signal())))
  await dispatcher.dispose()
})

test('screenshot rendering emits one durable image and omits encoded source bytes', () => {
  const attachment = { attachmentId: 'test-image', mediaType: 'image/png', bytes: 123, width: 800, height: 600 }
  const screenshot = { attachment, mimeType: 'image/png', data: 'SECRET_BASE64_DATA', bytes: [1, 2, 3], pixelWidth: 800, pixelHeight: 600 }
  for (const value of [screenshot, { state: 'Page snapshot', screenshot }]) {
    const result = renderBrowserResult({}, value)
    assert.equal(result.filter(block => block.type === 'image').length, 1)
    const text = result.filter(block => block.type === 'text').map(block => block.text).join('')
    assert.ok(!text.includes('SECRET_BASE64_DATA'))
    assert.ok(!text.includes('[1,2,3]'))
    assert.deepEqual(result.find(block => block.type === 'image')?.attachment, attachment)
  }
})

test('PTC objects resolve each current Host tool binding and send locator descriptions only', async () => {
  const calls: { binding: string; request: BrowserRequest }[] = []
  let binding = 'first'
  const output: string[] = []
  const bridge = connectBrowser(() => async request => {
    calls.push({ binding, request })
    if (request.method === 'getTab') return { id: 'fixture', title: 'Fixture', url: 'http://localhost', browserId: 'chromium', owned: false, state: 'Initial state' }
    if (request.method === 'locator') return request.params.locator && typeof request.params.locator === 'object' ? 'Save' : null
    return { dispatched: true, verified: false }
  }, { text: value => { output.push(value) } })
  const tab = await bridge.getTab('fixture')
  assert.deepEqual(output, ['Initial state'])
  binding = 'second'
  await tab.playwright.getByRole('button', { name: 'Save' }).first().click({ timeout: 1000 })
  const request = calls.at(-1)!
  assert.equal(request.binding, 'second')
  assert.deepEqual(request.request, { method: 'locator', params: { tabId: 'fixture', locator: { steps: [{ method: 'getByRole', args: ['button', { name: 'Save' }] }, { method: 'first', args: [] }], action: { method: 'click', args: [{ timeout: 1000 }] } } } })
  assert.equal('evaluate' in tab.playwright, false)
  assert.equal('cdpEndpoint' in tab, false)
})

test('screenshot bridge returns Host attachment metadata without uploading or printing image data', async () => {
  const rendered: string[] = []
  const screenshot: JsonValue = { attachment: { attachmentId: 'image' }, pixelWidth: 800, pixelHeight: 600 }
  const bridge = connectBrowser(() => async request => request.method === 'getTab'
    ? { id: 't', browserId: 'chromium', state: 'State' }
    : screenshot, { text: value => { rendered.push(value) } })
  const tab = await bridge.getTab('t')
  assert.deepEqual(await tab.getScreenshot(), screenshot)
  assert.deepEqual(rendered, ['State'])
})

test('wire envelopes prohibit extra top-level fields and unsupported paste representations', () => {
  assert.throws(() => parseBrowserRequest({ method: 'listBrowsers', params: {}, code: 'x' }), /Unknown field/)
  assert.throws(() => parseBrowserRequest({ method: 'paste', params: { tabId: 't', index: null, text: 'x', format: 'html' } }), /paste accepts text or md/)
})

test('locator timeouts default to the Host budget and cannot extend or disable it', () => {
  for (const action of [
    { method: 'click', args: [] },
    { method: 'fill', args: ['Ada'] },
    { method: 'waitFor', args: [{ state: 'visible' }] },
    { method: 'focus', args: [] },
  ]) {
    const original = validateLocatorRequest({ steps: [{ method: 'getByText', args: ['Fixture'] }], action })
    const bounded = boundLocatorTimeout(original, 500)
    const position = action.method === 'fill' ? 1 : 0
    assert.equal((bounded.action.args[position] as { timeout: number }).timeout, 500)
    assert.deepEqual(original.action, action, 'Host must not mutate frozen model arguments')
  }
  for (const timeout of [0, 501, 30000]) {
    const request = { steps: [{ method: 'getByText', args: ['Fixture'] }], action: { method: 'waitFor', args: [{ timeout }] } }
    assert.throws(() => boundLocatorTimeout(request, 500), /Locator timeout/)
  }
})


test('Host idle status releases the lease without retiring a resumable Agent', async () => {
  const tools: import('@deepseek-ai/dsh-tools').ToolDefinition[] = []
  const agents = new Map<string, {id: string; status: 'idle' | 'running'; ctx: {effect: () => void}}>()
  let onStatus: (payload: {agent: object; status: string}) => unknown = () => {}
  const context = {
    tools: { register: (tool: import('@deepseek-ai/dsh-tools').ToolDefinition) => { tools.push(tool) } },
    effect: () => {},
    on: (_name: string, listener: typeof onStatus) => { onStatus = listener },
    agents: { get: (id: string) => agents.get(id) },
  }
  installBrowserTool(context as unknown as Context, {configuredCDPEndpoint: 'http://127.0.0.1:1'})
  const tool = tools[0]!
  const first = {id: 'first', status: 'running' as 'idle' | 'running', ctx: {effect: () => {}}}
  const second = {id: 'second', status: 'running' as 'idle' | 'running', ctx: {effect: () => {}}}
  agents.set(first.id, first); agents.set(second.id, second)
  const call = (agent: typeof first) => tool.execute({method:'listBrowsers',params:{}}, {agent,signal:signal()} as never)
  await call(first)
  await assert.rejects(call(second), /BROWSER_BUSY/)
  await onStatus({agent:first,status:'idle'}) // A stale event cannot release a currently running Agent.
  await assert.rejects(call(second), /BROWSER_BUSY/)
  first.status='idle'; await onStatus({agent:first,status:'idle'})
  await call(second)
  second.status='idle'; await onStatus({agent:second,status:'idle'})
  first.status='running'; await call(first)
  first.status='idle'; await onStatus({agent:first,status:'idle'})
})
