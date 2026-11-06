import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import { admitEncodedImages, AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { Locator, FrameLocator } from 'playwright'
import { createBrowserApi, validateCdpEndpoint, BrowserAdapterError } from './browser.js'
import type { BrowserApi, BrowserTab } from './browser.js'

/** Browser access is opt-in and fixed by the host; tool arguments cannot select an endpoint. */
export interface BrowserHostConfig {
  configuredCDPEndpoint?: string
  browserTimeoutMs?: number
  browserMaxElements?: number
}

export interface BrowserRequest { method: string; params: Record<string, JsonValue> }
export interface LocatorStep { method: string; args: JsonValue[] }
export interface LocatorRequest { steps: LocatorStep[]; action: LocatorStep }
export interface BrowserScreenshotAdmission {
  prepare(signal: AbortSignal): Promise<void>
  admit(bytes: Uint8Array, signal: AbortSignal): Promise<JsonValue>
}

const methods = ['listBrowsers', 'listTabs', 'getBrowser', 'getTab', 'createTab', 'getAXState', 'getScreenshot', 'getAXStateAndScreenshot', 'info', 'goto', 'back', 'forward', 'reload', 'close', 'markDeliverable', 'markHandoff', 'click', 'setValue', 'typeText', 'paste', 'pressKey', 'scroll', 'drag', 'locator'] as const
const builders = new Set(['getByRole', 'getByLabel', 'getByPlaceholder', 'getByText', 'getByTestId', 'locator', 'frameLocator', 'filter', 'first', 'last', 'nth'])
const actions = new Set(['click', 'dblclick', 'fill', 'press', 'pressSequentially', 'innerText', 'textContent', 'allTextContents', 'count', 'isVisible', 'isEnabled', 'getAttribute', 'selectOption', 'check', 'uncheck', 'setChecked', 'hover', 'focus', 'scrollIntoViewIfNeeded', 'waitFor'])
const readonlyActions = new Set(['innerText', 'textContent', 'allTextContents', 'count', 'isVisible', 'isEnabled', 'getAttribute', 'waitFor'])
const roles = new Set(['alert', 'alertdialog', 'application', 'article', 'banner', 'blockquote', 'button', 'caption', 'cell', 'checkbox', 'code', 'columnheader', 'combobox', 'complementary', 'contentinfo', 'definition', 'deletion', 'dialog', 'directory', 'document', 'emphasis', 'feed', 'figure', 'form', 'generic', 'grid', 'gridcell', 'group', 'heading', 'img', 'insertion', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 'marquee', 'math', 'meter', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'navigation', 'none', 'note', 'option', 'paragraph', 'presentation', 'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider', 'spinbutton', 'status', 'strong', 'subscript', 'superscript', 'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox', 'time', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem'])

function invalid(message: string): never { throw new BrowserAdapterError('INVALID_BROWSER_REQUEST', message) }
function record(value: unknown): Record<string, JsonValue> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid('Expected a JSON object.')
  return value as Record<string, JsonValue>
}
function keys(value: Record<string, JsonValue>, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`Unknown field: ${key}`)
}
function string(value: unknown, name: string, max = 16384): string {
  if (typeof value !== 'string' || value.length > max) invalid(`${name} must be a string of at most ${max} characters.`)
  return value
}
function number(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`${name} must be finite.`)
  return value
}
function index(value: unknown): number {
  const result = number(value, 'index')
  if (!Number.isInteger(result) || result < 0) invalid('An element index must be a nonnegative integer.')
  return result
}
function point(value: JsonValue | undefined): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) invalid('Expected an [x,y] point.')
  return [number(value[0], 'x'), number(value[1], 'y')]
}
function target(value: JsonValue | undefined): number | readonly [number, number] { return Array.isArray(value) ? point(value) : index(value) }
function json(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue }

function options(value: JsonValue | undefined, kind: 'text' | 'role' | 'filter' | 'action'): Record<string, JsonValue> {
  if (value === undefined) return {}
  const result = record(value)
  const allowed = kind === 'text' ? ['exact'] : kind === 'role' ? ['name', 'exact', 'level', 'checked', 'disabled', 'expanded', 'includeHidden', 'pressed', 'selected'] : kind === 'filter' ? ['hasText', 'hasNotText', 'visible'] : ['button', 'clickCount', 'delay', 'modifiers', 'timeout', 'force', 'noWaitAfter', 'position', 'state']
  keys(result, allowed)
  for (const [key, item] of Object.entries(result)) {
    if (['name', 'hasText', 'hasNotText', 'button', 'state'].includes(key)) string(item, key, 4096)
    else if (['level', 'clickCount', 'delay', 'timeout'].includes(key)) {
      const n = number(item, key)
      if (n < 0 || (key === 'timeout' && (n === 0 || n > 120000)) || (key === 'delay' && n > 5000) || (key === 'clickCount' && (!Number.isInteger(n) || n < 1 || n > 3))) invalid(`Invalid ${key} bound.`)
    } else if (key === 'modifiers') {
      if (!Array.isArray(item) || !item.every(v => typeof v === 'string' && ['Alt', 'Control', 'ControlOrMeta', 'Meta', 'Shift'].includes(v))) invalid('Invalid pointer modifiers.')
    } else if (key === 'position') {
      const position = record(item); keys(position, ['x', 'y']); number(position.x, 'x'); number(position.y, 'y')
    } else if (typeof item !== 'boolean') invalid(`${key} must be boolean.`)
  }
  if (result.button !== undefined && !['left', 'right', 'middle'].includes(String(result.button))) invalid('Invalid mouse button.')
  if (result.state !== undefined && !['attached', 'detached', 'visible', 'hidden'].includes(String(result.state))) invalid('Invalid wait state.')
  return result
}

/** Admit only declarative locator builders and named operations; no evaluate or code fields exist. */
export function validateLocatorRequest(value: unknown): LocatorRequest {
  const request = record(value); keys(request, ['steps', 'action'])
  if (!Array.isArray(request.steps) || request.steps.length === 0 || request.steps.length > 20) invalid('A locator needs 1–20 steps.')
  function step(value: JsonValue, allowed: Set<string>): LocatorStep {
    const item = record(value); keys(item, ['method', 'args'])
    const method = string(item.method, 'locator method', 64)
    if (!allowed.has(method)) invalid(`Unsupported locator method: ${method}`)
    if (!Array.isArray(item.args) || item.args.length > 2) invalid('Expected a locator argument array.')
    const args = item.args
    if (['first', 'last', 'count', 'isVisible', 'isEnabled', 'allTextContents', 'focus', 'scrollIntoViewIfNeeded'].includes(method)) {
      if (args.length !== 0) invalid(`${method} takes no arguments.`)
    } else if (method === 'nth') { if (args.length !== 1) invalid('nth needs one index.'); index(args[0]) }
    else if (method === 'filter') { if (args.length !== 1) invalid('filter needs one object.'); options(args[0], 'filter') }
    else if (builders.has(method)) {
      if (args.length < 1) invalid(`${method} needs a selector.`)
      const text = string(args[0], method, 4096)
      if (method === 'getByRole' && !roles.has(text)) invalid('Unsupported ARIA role.')
      if (['locator', 'frameLocator'].includes(method) && /(?:javascript:|js=|internal:)/i.test(text)) invalid('Only declarative selectors are accepted.')
      if (['getByTestId', 'locator', 'frameLocator'].includes(method) && args.length !== 1) invalid(`${method} takes one selector.`)
      if (args[1] !== undefined) options(args[1], method === 'getByRole' ? 'role' : 'text')
    } else if (['fill', 'press', 'pressSequentially', 'getAttribute'].includes(method)) {
      if (args.length < 1) invalid(`${method} needs text.`)
      string(args[0], method)
      if (args[1] !== undefined) options(args[1], 'action')
    } else if (method === 'setChecked') {
      if (typeof args[0] !== 'boolean') invalid('setChecked needs a boolean.')
      if (args[1] !== undefined) options(args[1], 'action')
    } else if (method === 'selectOption') {
      if (!(typeof args[0] === 'string' || Array.isArray(args[0]) && args[0].every(v => typeof v === 'string'))) invalid('selectOption accepts a string or string array.')
      if (args[1] !== undefined) options(args[1], 'action')
    } else { if (args.length > 1) invalid(`${method} accepts at most one options object.`); options(args[0], 'action') }
    return { method, args }
  }
  return { steps: request.steps.map(value => step(value, builders)), action: step(request.action!, actions) }
}

/** Fill omitted locator timeouts and reject attempts to exceed the Host's operation budget. */
export function boundLocatorTimeout(request: LocatorRequest, timeoutMs: number): LocatorRequest {
  const method = request.action.method
  if (['count', 'isVisible', 'isEnabled', 'allTextContents'].includes(method)) return request
  const position = ['fill', 'press', 'pressSequentially', 'getAttribute', 'selectOption', 'setChecked'].includes(method) ? 1 : 0
  const args = [...request.action.args]
  const supplied = args[position] === undefined ? {} : record(args[position])
  const timeout = supplied.timeout === undefined ? timeoutMs : number(supplied.timeout, 'timeout')
  if (timeout <= 0 || timeout > timeoutMs) invalid(`Locator timeout must be greater than zero and at most browserTimeoutMs (${timeoutMs} ms).`)
  args[position] = { ...supplied, timeout }
  return { steps: request.steps, action: { method, args } }
}

/** Validate the wire envelope before creating any browser connection. */
export function parseBrowserRequest(value: unknown): BrowserRequest {
  const request = record(value); keys(request, ['method', 'params'])
  const method = string(request.method, 'method', 64)
  if (!(methods as readonly string[]).includes(method)) invalid(`Unsupported browser operation: ${method}`)
  const params = record(request.params)
  const allowed: Record<string, string[]> = {
    listBrowsers: [], listTabs: ['browser'], getBrowser: ['browser'], getTab: ['reference', 'browser'], createTab: ['browser', 'url', 'visible', 'sessionName'],
    getAXState: ['tabId'], getScreenshot: ['tabId'], getAXStateAndScreenshot: ['tabId'], info: ['tabId'], goto: ['tabId', 'url'], back: ['tabId'], forward: ['tabId'], reload: ['tabId'], close: ['tabId'], markDeliverable: ['tabId'], markHandoff: ['tabId'],
    click: ['tabId', 'target', 'options'], setValue: ['tabId', 'index', 'value'], typeText: ['tabId', 'index', 'text'], paste: ['tabId', 'index', 'text', 'format'], pressKey: ['tabId', 'index', 'key'], scroll: ['tabId', 'target', 'direction', 'pages'], drag: ['tabId', 'from', 'to'], locator: ['tabId', 'locator'],
  }
  keys(params, allowed[method]!)
  if (allowed[method]!.includes('tabId')) string(params.tabId, 'tabId', 128)
  if (params.browser !== undefined) string(params.browser, 'browser', 64)
  if (method === 'getTab') {
    if (typeof params.reference !== 'string') { const reference = record(params.reference); keys(reference, ['url']); string(reference.url, 'url') }
  }
  if (method === 'goto' || method === 'createTab') {
    if (params.url !== undefined) {
      const url = string(params.url, 'url')
      let parsed: URL; try { parsed = new URL(url) } catch { invalid('Expected an absolute URL.') }
      if (!['http:', 'https:', 'about:'].includes(parsed.protocol) || parsed.username || parsed.password || (parsed.protocol === 'about:' && parsed.href !== 'about:blank')) invalid('Navigation accepts http(s) or about:blank without embedded credentials.')
    } else if (method === 'goto') invalid('goto needs a URL.')
    if (params.visible !== undefined && typeof params.visible !== 'boolean') invalid('visible must be boolean.')
    if (params.sessionName !== undefined) string(params.sessionName, 'sessionName', 100)
  }
  if (method === 'locator') validateLocatorRequest(params.locator)
  if (method === 'click' || method === 'scroll') target(params.target)
  if (method === 'click' && params.options !== undefined) {
    const opt = record(params.options); keys(opt, ['mouseButton', 'clickCount', 'key', 'durationMs'])
    if (opt.mouseButton !== undefined && !['left', 'right', 'middle'].includes(String(opt.mouseButton))) invalid('Invalid mouse button.')
    if (opt.clickCount !== undefined && (!Number.isInteger(opt.clickCount) || number(opt.clickCount, 'clickCount') < 1 || Number(opt.clickCount) > 3)) invalid('Invalid click count.')
    if (opt.durationMs !== undefined && (number(opt.durationMs, 'durationMs') < 0 || Number(opt.durationMs) > 5000)) invalid('Invalid click duration.')
    if (opt.key !== undefined) string(opt.key, 'key', 100)
  }
  if (['setValue', 'typeText', 'paste', 'pressKey'].includes(method)) {
    if (params.index !== null) index(params.index)
    if (method === 'setValue') { index(params.index); string(params.value, 'value') }
    else string(method === 'pressKey' ? params.key : params.text, method === 'pressKey' ? 'key' : 'text')
    if (params.format !== undefined && !['text', 'md'].includes(String(params.format))) invalid('Browser paste accepts text or md.')
  }
  if (method === 'scroll') {
    if (!['up', 'down', 'left', 'right'].includes(String(params.direction))) invalid('Invalid scroll direction.')
    if (params.pages !== undefined && (number(params.pages, 'pages') <= 0 || Number(params.pages) > 10)) invalid('pages must be >0 and <=10.')
  }
  if (method === 'drag') { point(params.from); point(params.to) }
  return { method, params }
}

async function runLocator(tab: BrowserTab, request: LocatorRequest): Promise<JsonValue> {
  let selected: BrowserTab['playwright'] | Locator | FrameLocator = tab.playwright
  for (const { method, args } of request.steps) {
    switch (method) {
      case 'getByRole': selected = selected.getByRole(args[0] as Parameters<Locator['getByRole']>[0], args[1] as Parameters<Locator['getByRole']>[1]); break
      case 'getByLabel': selected = selected.getByLabel(args[0] as string, args[1] as { exact?: boolean }); break
      case 'getByPlaceholder': selected = selected.getByPlaceholder(args[0] as string, args[1] as { exact?: boolean }); break
      case 'getByText': selected = selected.getByText(args[0] as string, args[1] as { exact?: boolean }); break
      case 'getByTestId': selected = selected.getByTestId(args[0] as string); break
      case 'locator': selected = selected.locator(args[0] as string); break
      case 'frameLocator': selected = selected.frameLocator(args[0] as string); break
      case 'filter': if (!('filter' in selected)) invalid('filter requires a locator.'); selected = (selected as Locator).filter(args[0] as { hasText?: string; hasNotText?: string; visible?: boolean }); break
      case 'first': if (!('first' in selected)) invalid('first requires a locator.'); selected = (selected as Locator).first(); break
      case 'last': if (!('last' in selected)) invalid('last requires a locator.'); selected = (selected as Locator).last(); break
      case 'nth': if (!('nth' in selected)) invalid('nth requires a locator.'); selected = (selected as Locator).nth(args[0] as number); break
      default: invalid('Unrecognized locator builder.')
    }
  }
  if (!('click' in selected)) invalid('Select an element locator before acting.')
  const { method, args } = request.action
  let result: unknown
  try {
    switch (method) {
      case 'click': result = await selected.click(args[0] as Parameters<Locator['click']>[0]); break
      case 'dblclick': result = await selected.dblclick(args[0] as Parameters<Locator['dblclick']>[0]); break
      case 'fill': result = await selected.fill(args[0] as string, args[1] as Parameters<Locator['fill']>[1]); break
      case 'press': result = await selected.press(args[0] as string, args[1] as Parameters<Locator['press']>[1]); break
      case 'pressSequentially': result = await selected.pressSequentially(args[0] as string, args[1] as Parameters<Locator['pressSequentially']>[1]); break
      case 'innerText': result = await selected.innerText(args[0] as Parameters<Locator['innerText']>[0]); break
      case 'textContent': result = await selected.textContent(args[0] as Parameters<Locator['textContent']>[0]); break
      case 'allTextContents': result = await selected.allTextContents(); break
      case 'count': result = await selected.count(); break
      case 'isVisible': result = await selected.isVisible(); break
      case 'isEnabled': result = await selected.isEnabled(); break
      case 'getAttribute': result = await selected.getAttribute(args[0] as string, args[1] as Parameters<Locator['getAttribute']>[1]); break
      case 'selectOption': result = await selected.selectOption(args[0] as string | string[], args[1] as Parameters<Locator['selectOption']>[1]); break
      case 'check': result = await selected.check(args[0] as Parameters<Locator['check']>[0]); break
      case 'uncheck': result = await selected.uncheck(args[0] as Parameters<Locator['uncheck']>[0]); break
      case 'setChecked': result = await selected.setChecked(args[0] as boolean, args[1] as Parameters<Locator['setChecked']>[1]); break
      case 'hover': result = await selected.hover(args[0] as Parameters<Locator['hover']>[0]); break
      case 'focus': result = await selected.focus(args[0] as Parameters<Locator['focus']>[0]); break
      case 'scrollIntoViewIfNeeded': result = await selected.scrollIntoViewIfNeeded(args[0] as Parameters<Locator['scrollIntoViewIfNeeded']>[0]); break
      case 'waitFor': result = await selected.waitFor(args[0] as Parameters<Locator['waitFor']>[0]); break
      default: invalid('Unrecognized locator action.')
    }
  } finally { if (!readonlyActions.has(method)) await tab.releaseSnapshot() }
  return result === undefined ? { dispatched: true, verified: false } : json(result)
}

interface ScreenshotMapping { viewportWidth: number; viewportHeight: number; imageWidth: number; imageHeight: number }
interface Resource { api: BrowserApi; tabs: Map<string, BrowserTab>; screenshots: Map<string, ScreenshotMapping>; queue: Promise<void>; closing?: Promise<void>; closed: boolean }

/** One explicitly configured browser is exclusively owned by one exact live Agent. */
export class BrowserToolDispatcher {
  readonly enabled: boolean
  private readonly endpoint: string | undefined
  private readonly timeoutMs: number
  private readonly resources = new Map<object, Resource>()
  private readonly retired = new WeakSet<object>()
  private activeOwner: object | undefined
  private closed = false

  constructor(private readonly config: BrowserHostConfig) {
    const endpoint = config.configuredCDPEndpoint?.trim()
    this.endpoint = endpoint ? validateCdpEndpoint(endpoint) : undefined
    this.enabled = this.endpoint !== undefined
    this.timeoutMs = config.browserTimeoutMs ?? 15000
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 120000) invalid('browserTimeoutMs must be an integer from 100 to 120000.')
  }

  async dispatch(value: unknown, owner: object, signal: AbortSignal, screenshot?: BrowserScreenshotAdmission): Promise<JsonValue> {
    const request = parseBrowserRequest(value)
    if (request.method === 'locator') boundLocatorTimeout(validateLocatorRequest(request.params.locator), this.timeoutMs)
    signal.throwIfAborted()
    if (!this.enabled) throw new BrowserAdapterError('BROWSER_NOT_CONFIGURED', 'The host must opt in with configuredCDPEndpoint.')
    if (this.closed || this.retired.has(owner)) throw new BrowserAdapterError('BROWSER_DISPOSED', 'Create a new live Session.')
    if (this.activeOwner !== undefined && this.activeOwner !== owner) throw new BrowserAdapterError('BROWSER_BUSY', 'Another live Session owns this browser. Dispose it before using this browser from another Session.')
    let resource = this.resources.get(owner)
    if (!resource) {
      const api = createBrowserApi({ cdpEndpoint: this.endpoint!, ...(this.config.browserTimeoutMs === undefined ? {} : { timeoutMs: this.config.browserTimeoutMs }), ...(this.config.browserMaxElements === undefined ? {} : { maxElements: this.config.browserMaxElements }) })
      resource = { api, tabs: new Map(), screenshots: new Map(), queue: Promise.resolve(), closed: false }
      this.resources.set(owner, resource); this.activeOwner = owner
    }
    if (resource.closed) throw new BrowserAdapterError('BROWSER_DISPOSED', 'This Session browser is closing.')
    const selected = resource
    const onAbort = () => { void this.disposeOwner(owner).catch(() => { /* Disposal failure keeps the browser reserved. */ }) }
    signal.addEventListener('abort', onAbort, { once: true })
    const operation = selected.queue.then(async () => {
      signal.throwIfAborted()
      if (selected.closed) throw new BrowserAdapterError('BROWSER_DISPOSED', 'This Session browser is closing.')
      const deadline = new AbortController()
      const timer = request.method === 'locator' ? setTimeout(() => deadline.abort(new BrowserAdapterError('BROWSER_TIMEOUT', `Locator operation exceeded browserTimeoutMs (${this.timeoutMs} ms); create a new Session after cleanup.`)), this.timeoutMs) : undefined
      const activeSignal = timer === undefined ? signal : AbortSignal.any([signal, deadline.signal])
      activeSignal.addEventListener('abort', onAbort, { once: true })
      try {
        const result = await this.run(selected, request, activeSignal, screenshot)
        activeSignal.throwIfAborted()
        return result
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        activeSignal.removeEventListener('abort', onAbort)
      }
    })
    selected.queue = operation.then(() => {}, () => { /* A failed operation must not be replayed by the queue. */ })
    try { return await operation } finally {
      signal.removeEventListener('abort', onAbort)
      // The queue above has already settled, so joining cleanup here cannot
      // wait on this dispatch's own outer finally block.
      if (selected.closing) await selected.closing
    }
  }

  private async run(resource: Resource, { method, params: p }: BrowserRequest, signal: AbortSignal, screenshot?: BrowserScreenshotAdmission): Promise<JsonValue> {
    const api = resource.api
    if (method === 'listBrowsers') return json(await api.listBrowsers({ emit: false }))
    if (method === 'listTabs') return json(await api.listTabs({ ...(p.browser === undefined ? {} : { browser: p.browser as string }), emit: false }))
    if (method === 'getBrowser') { const browser = await api.getBrowser(p.browser === undefined ? {} : { id: p.browser as string }); return { browserId: browser.browserId, documentation: await browser.documentation() } }
    if (method === 'getTab' || method === 'createTab') {
      const tab = method === 'getTab'
        ? await api.getTab(p.reference as string | { url: string }, p.browser === undefined ? {} : { browser: p.browser as string })
        : await api.createBrowserTab(p.browser as string ?? 'chromium', p.url as string ?? 'about:blank')
      resource.screenshots.delete(tab.id)
      resource.tabs.set(tab.id, tab)
      return { ...await tab.info(), state: await tab.getAXState({ emit: false }) }
    }
    const tab = resource.tabs.get(p.tabId as string)
    if (!tab) throw new BrowserAdapterError('TAB_ACCESS_REQUIRED', 'Select a tab with getTab or createTab in this Session first.')
    const capture = async () => {
      if (!screenshot) throw new BrowserAdapterError('IMAGE_ADMISSION_REQUIRED', 'The host must supply a model-aware attachment store.')
      await screenshot.prepare(signal)
      const bytes = await tab.getScreenshot({ emit: false })
      signal.throwIfAborted()
      const admitted = await screenshot.admit(bytes, signal)
      const metadata = record(admitted)
      const source = Buffer.from(bytes)
      if (source.length < 24 || source.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('Browser screenshot is not PNG.')
      resource.screenshots.set(tab.id, { viewportWidth: source.readUInt32BE(16), viewportHeight: source.readUInt32BE(20), imageWidth: number(metadata.pixelWidth, 'pixelWidth'), imageHeight: number(metadata.pixelHeight, 'pixelHeight') })
      return admitted
    }
    const mapPoint = async (value: JsonValue | undefined): Promise<readonly [number, number]> => {
      const coordinates = point(value), mapping = resource.screenshots.get(tab.id)
      if (!mapping) throw new BrowserAdapterError('SCREENSHOT_REQUIRED', 'Capture this tab before coordinate input. Coordinates use the image returned to the model.')
      const view = await tab.playwright.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      if (view.width !== mapping.viewportWidth || view.height !== mapping.viewportHeight) throw new BrowserAdapterError('WINDOW_CHANGED', 'The viewport resized. Capture a fresh screenshot before input.')
      if (coordinates[0] < 0 || coordinates[1] < 0 || coordinates[0] >= mapping.imageWidth || coordinates[1] >= mapping.imageHeight) invalid('Coordinates must be inside the latest screenshot.')
      return [coordinates[0] * mapping.viewportWidth / mapping.imageWidth, coordinates[1] * mapping.viewportHeight / mapping.imageHeight]
    }
    switch (method) {
      case 'getAXState': return tab.getAXState({ emit: false })
      case 'getScreenshot': return capture()
      case 'getAXStateAndScreenshot': return { state: await tab.getAXState({ emit: false }), screenshot: await capture() }
      case 'info': return json(await tab.info())
      case 'goto': resource.screenshots.delete(tab.id); await tab.goto(p.url as string); break
      case 'back': resource.screenshots.delete(tab.id); await tab.back(); break
      case 'forward': resource.screenshots.delete(tab.id); await tab.forward(); break
      case 'reload': resource.screenshots.delete(tab.id); await tab.reload(); break
      case 'close': resource.screenshots.delete(tab.id); await tab.close(); resource.tabs.delete(tab.id); break
      case 'markDeliverable': await tab.markDeliverable(); break
      case 'markHandoff': await tab.markHandoff(); break
      case 'click': return json(await tab.click(Array.isArray(p.target) ? await mapPoint(p.target) : target(p.target), p.options as Parameters<BrowserTab['click']>[1]))
      case 'setValue': return json(await tab.setValue(p.index as number, p.value as string))
      case 'typeText': return json(await tab.typeText(p.index as number | null, p.text as string))
      case 'paste': return json(await tab.paste(p.index as number | null, p.text as string, p.format === undefined ? {} : { format: p.format as 'text' | 'md' }))
      case 'pressKey': return json(await tab.pressKey(p.index as number | null, p.key as string))
      case 'scroll': return json(await tab.scroll(Array.isArray(p.target) ? await mapPoint(p.target) : target(p.target), p.direction as 'up' | 'down' | 'left' | 'right', p.pages as number | undefined))
      case 'drag': return json(await tab.drag(await mapPoint(p.from), await mapPoint(p.to)))
      case 'locator': return runLocator(tab, boundLocatorTimeout(validateLocatorRequest(p.locator), this.timeoutMs))
      default: invalid('Unsupported operation.')
    }
    return { dispatched: true, verified: false }
  }

  async disposeOwner(owner: object): Promise<void> {
    const resource = this.resources.get(owner)
    this.retired.add(owner)
    if (!resource) return
    if (resource.closing) return resource.closing
    resource.closed = true
    resource.closing = (async () => {
      await resource.api.dispose()
      await resource.queue
      this.resources.delete(owner)
      if (this.activeOwner === owner) this.activeOwner = undefined
    })()
    return resource.closing
  }

  async dispose(): Promise<void> {
    this.closed = true
    await Promise.all([...this.resources.keys()].map(owner => this.disposeOwner(owner)))
  }
}

/** Images are rendered once as durable attachments; encoded source bytes never enter text. */
export function renderBrowserResult(_args: unknown, value: JsonValue) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const image = value.attachment !== undefined ? value : value.screenshot
    if (image !== null && typeof image === 'object' && !Array.isArray(image) && image.attachment !== undefined) {
      const { attachment, data: _data, bytes: _bytes, ...metadata } = image
      const text = value.screenshot === undefined ? metadata : { state: value.state, screenshot: metadata }
      const ref = record(attachment), mediaType = ref.mediaType
      if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp' && mediaType !== 'image/gif') throw new Error('Invalid browser image attachment media type.')
      const admitted: ImageAttachmentRef = { attachmentId: AttachmentId(string(ref.attachmentId, 'attachmentId')), mediaType,
        bytes: number(ref.bytes, 'bytes'), width: number(ref.width, 'width'), height: number(ref.height, 'height') }
      if (typeof ref.name === 'string') admitted.name = ref.name
      if (ref.originalDimensions !== undefined) {
        const dimensions = record(ref.originalDimensions)
        admitted.originalDimensions = { width: number(dimensions.width, 'width'), height: number(dimensions.height, 'height') }
      }
      return [{ type: 'text' as const, text: JSON.stringify(text) }, { type: 'image' as const, attachment: admitted }]
    }
  }
  return [{ type: 'text' as const, text: JSON.stringify(value) }]
}

/** Register the optional browser tool in the Host's normal approval and logging pipeline. */
export function installBrowserTool(ctx: Context, config: BrowserHostConfig): void {
  const dispatcher = new BrowserToolDispatcher(config)
  if (!dispatcher.enabled) return
  const owners = new WeakSet<object>()
  ctx.effect(() => () => dispatcher.dispose(), 'computer-browser.cleanup')
  const tool: ToolDefinition = {
    name: 'computer_browser',
    description: 'Inspect or operate the explicitly configured Chromium browser. One live Session owns it. Use declarative locator steps; arbitrary evaluation is unavailable. Verify actions from fresh page state.',
    parameters: { type: 'object', properties: { method: { type: 'string', enum: [...methods] }, params: { type: 'object' } }, required: ['method', 'params'], additionalProperties: false },
    output: { schema: {}, render: renderBrowserResult },
    async execute(args, execution: Readonly<ToolExecution>) {
      const agent = execution.agent
      if (!agent || ctx.agents.get(agent.id) !== agent) throw new Error('Browser tools require an exact live Agent.')
      if (!owners.has(agent)) { owners.add(agent); agent.ctx.effect(() => () => dispatcher.disposeOwner(agent), 'computer-browser.session') }
      const admission: BrowserScreenshotAdmission = {
        async prepare(signal) {
          const llm = ctx.get('llm'), attachments = ctx.get('attachments')
          if (!llm || !attachments) throw new Error('Browser screenshots require llm and attachments services.')
          const route = agent.session.requestHeader()?.config
          const provider = route?.provider ?? agent.options.provider, model = route?.model ?? agent.options.model
          if (!provider || !model) throw new Error('Browser screenshot model route could not be resolved.')
          const info = await llm.resolveModelInfo(provider, model, signal)
          if (!info.inputModalities?.includes('image')) throw new Error(`Browser screenshots require model ${model} to declare image input.`)
        },
        async admit(bytes, signal) {
          signal.throwIfAborted()
          const attachments = ctx.get('attachments')
          if (!attachments) throw new Error('Browser screenshots require an attachment store.')
          const [attachment] = await admitEncodedImages(attachments, [{ data: Buffer.from(bytes).toString('base64'), mediaType: 'image/png' }])
          signal.throwIfAborted()
          if (!attachment) throw new Error('Screenshot admission returned no image.')
          const llm = ctx.get('llm'), route = agent.session.requestHeader()?.config
          const provider = route?.provider ?? agent.options.provider, model = route?.model ?? agent.options.model
          if (!llm || !provider || !model) throw new Error('Browser screenshot model route could not be resolved.')
          const image = await attachments.readImageRequest(attachment, llm.imageRequestTarget(provider, model, attachment), signal)
          signal.throwIfAborted()
          return json({ attachment, mimeType: image.mediaType, pixelWidth: image.width, pixelHeight: image.height, coordinateSpace: 'screenshot-pixels' })
        },
      }
      return dispatcher.dispatch(args, agent, execution.signal, admission)
    },
  }
  ctx.tools.register(tool)
}
