import type { BrowserRequest, LocatorRequest, LocatorStep } from './browser-host.js'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Resolve the current Host tool binding on every operation, preserving its authority and log. */
export type BrowserToolBinding = (request: BrowserRequest) => Promise<JsonValue>
export interface BrowserBridgeOptions { text?: (value: string) => void | Promise<void> }
export interface LocatorTextOptions { exact?: boolean }
export interface LocatorRoleOptions extends LocatorTextOptions {
  name?: string
  level?: number
  checked?: boolean
  disabled?: boolean
  expanded?: boolean
  includeHidden?: boolean
  pressed?: boolean
  selected?: boolean
}
export interface LocatorActionOptions {
  timeout?: number
  force?: boolean
  noWaitAfter?: boolean
  button?: 'left' | 'right' | 'middle'
  clickCount?: number
  delay?: number
  modifiers?: ('Alt' | 'Control' | 'ControlOrMeta' | 'Meta' | 'Shift')[]
  position?: { x: number; y: number }
}
export interface BrowserBridgeTabInfo { id: string; title: string; url: string; browserId: string; owned: boolean }

function object(value: JsonValue): Record<string, JsonValue> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Host returned an invalid browser object.')
  return value
}
function json(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue }
function optional(value: unknown): JsonValue[] { return value === undefined ? [] : [json(value)] }

/** A serializable locator chain. It has no evaluate, raw Playwright page, or CDP connection. */
export class BrowserBridgeLocator {
  constructor(
    private readonly dispatch: (request: LocatorRequest) => Promise<JsonValue>,
    private readonly steps: readonly LocatorStep[] = [],
  ) {}
  private chain(method: string, args: unknown[]): BrowserBridgeLocator {
    return new BrowserBridgeLocator(this.dispatch, [...this.steps, { method, args: args.map(json) }])
  }
  private run(method: string, args: JsonValue[] = []): Promise<JsonValue> {
    return this.dispatch({ steps: [...this.steps], action: { method, args } })
  }
  getByRole(role: string, options?: LocatorRoleOptions) { return this.chain('getByRole', [role, ...optional(options)]) }
  getByLabel(text: string, options?: LocatorTextOptions) { return this.chain('getByLabel', [text, ...optional(options)]) }
  getByPlaceholder(text: string, options?: LocatorTextOptions) { return this.chain('getByPlaceholder', [text, ...optional(options)]) }
  getByText(text: string, options?: LocatorTextOptions) { return this.chain('getByText', [text, ...optional(options)]) }
  getByTestId(id: string) { return this.chain('getByTestId', [id]) }
  locator(selector: string) { return this.chain('locator', [selector]) }
  frameLocator(selector: string) { return this.chain('frameLocator', [selector]) }
  filter(options: { hasText?: string; hasNotText?: string; visible?: boolean }) { return this.chain('filter', [options]) }
  first() { return this.chain('first', []) }
  last() { return this.chain('last', []) }
  nth(index: number) { return this.chain('nth', [index]) }
  click(options?: LocatorActionOptions) { return this.run('click', optional(options)) }
  dblclick(options?: LocatorActionOptions) { return this.run('dblclick', optional(options)) }
  fill(value: string, options?: LocatorActionOptions) { return this.run('fill', [value, ...optional(options)]) }
  press(key: string, options?: LocatorActionOptions) { return this.run('press', [key, ...optional(options)]) }
  pressSequentially(value: string, options?: LocatorActionOptions) { return this.run('pressSequentially', [value, ...optional(options)]) }
  type(value: string, options?: LocatorActionOptions) { return this.pressSequentially(value, options) }
  async innerText(options?: Pick<LocatorActionOptions, 'timeout'>): Promise<string> { return String(await this.run('innerText', optional(options))) }
  async textContent(options?: Pick<LocatorActionOptions, 'timeout'>): Promise<string | null> { const value = await this.run('textContent', optional(options)); return value === null ? null : String(value) }
  async allTextContents(): Promise<string[]> { return await this.run('allTextContents') as string[] }
  async count(): Promise<number> { return Number(await this.run('count')) }
  async isVisible(): Promise<boolean> { return Boolean(await this.run('isVisible')) }
  async isEnabled(): Promise<boolean> { return Boolean(await this.run('isEnabled')) }
  async getAttribute(name: string, options?: Pick<LocatorActionOptions, 'timeout'>): Promise<string | null> { const value = await this.run('getAttribute', [name, ...optional(options)]); return value === null ? null : String(value) }
  selectOption(value: string | string[], options?: LocatorActionOptions) { return this.run('selectOption', [json(value), ...optional(options)]) }
  check(options?: LocatorActionOptions) { return this.run('check', optional(options)) }
  uncheck(options?: LocatorActionOptions) { return this.run('uncheck', optional(options)) }
  setChecked(value: boolean, options?: LocatorActionOptions) { return this.run('setChecked', [value, ...optional(options)]) }
  hover(options?: LocatorActionOptions) { return this.run('hover', optional(options)) }
  focus() { return this.run('focus') }
  scrollIntoViewIfNeeded() { return this.run('scrollIntoViewIfNeeded') }
  waitFor(options?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) { return this.run('waitFor', optional(options)) }
}

/** Connect browser objects to tools.computer_browser without granting direct network access. */
export function connectBrowser(getTool: () => BrowserToolBinding, output: BrowserBridgeOptions = {}) {
  const call = (method: string, params: Record<string, unknown> = {}) => getTool()({ method, params: object(json(params)) })
  const emit = async (value: JsonValue, options?: { emit?: boolean }) => {
    if (options?.emit !== false) await output.text?.(typeof value === 'string' ? value : JSON.stringify(value))
    return value
  }

  function makeTab(initial: Record<string, JsonValue>) {
    if (typeof initial.id !== 'string') throw new Error('Host returned no tab id.')
    const id = initial.id
    const run = (method: string, params: Record<string, unknown> = {}) => call(method, { tabId: id, ...params })
    const root = new BrowserBridgeLocator(locator => run('locator', { locator }))
    const tab = {
      id,
      browserId: String(initial.browserId),
      playwright: {
        getByRole: root.getByRole.bind(root), getByLabel: root.getByLabel.bind(root),
        getByPlaceholder: root.getByPlaceholder.bind(root), getByText: root.getByText.bind(root),
        getByTestId: root.getByTestId.bind(root), locator: root.locator.bind(root), frameLocator: root.frameLocator.bind(root),
        domSnapshot: async () => String(await run('getAXState')),
      },
      async info(): Promise<BrowserBridgeTabInfo> {
        const value = object(await run('info'))
        if (typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.url !== 'string' || typeof value.browserId !== 'string' || typeof value.owned !== 'boolean') throw new Error('Host returned invalid tab metadata.')
        return { id: value.id, title: value.title, url: value.url, browserId: value.browserId, owned: value.owned }
      },
      async getAXState(options?: { emit?: boolean }): Promise<string> { return String(await emit(await run('getAXState'), options)) },
      /** The image was already admitted by the Host. Returns attachment metadata, never raw Base64. */
      async getScreenshot(_options?: { emit?: boolean }): Promise<JsonValue> { return run('getScreenshot') },
      async getAXStateAndScreenshot(options?: { emit?: boolean }): Promise<JsonValue> {
        const result = await run('getAXStateAndScreenshot')
        const state = object(result).state
        if (state !== undefined) await emit(state, options)
        return result
      },
      click(target: number | readonly [number, number], options?: { mouseButton?: 'left' | 'right' | 'middle'; clickCount?: number; key?: string; durationMs?: number }) { return run('click', { target, ...(options === undefined ? {} : { options }) }) },
      setValue(index: number, value: string) { return run('setValue', { index, value }) },
      typeText(index: number | null, text: string) { return run('typeText', { index, text }) },
      paste(index: number | null, text: string, options?: { format?: 'text' | 'md' }) { return run('paste', { index, text, ...(options?.format === undefined ? {} : { format: options.format }) }) },
      pressKey(index: number | null, key: string) { return run('pressKey', { index, key }) },
      scroll(target: number | readonly [number, number], direction: 'up' | 'down' | 'left' | 'right', pages = 1) { return run('scroll', { target, direction, pages }) },
      drag(from: readonly [number, number], to: readonly [number, number]) { return run('drag', { from, to }) },
      goto(url: string) { return run('goto', { url }) },
      back() { return run('back') }, forward() { return run('forward') }, reload() { return run('reload') }, close() { return run('close') },
      markDeliverable() { return run('markDeliverable') }, markHandoff() { return run('markHandoff') },
    }
    return tab
  }

  return {
    async listBrowsers(options?: { emit?: boolean }) { return await emit(await call('listBrowsers'), options) },
    async listTabs(options?: { browser?: string; emit?: boolean }) { return emit(await call('listTabs', options?.browser === undefined ? {} : { browser: options.browser }), options) },
    async getState(options?: { emit?: boolean }) {
      const browsers = await call('listBrowsers')
      return emit({ browsers }, options)
    },
    async getBrowser(options?: { id?: string }) {
      const result = object(await call('getBrowser', options?.id === undefined ? {} : { browser: options.id }))
      return { browserId: String(result.browserId), documentation: async () => String(result.documentation) }
    },
    async getTab(reference: string | { url: string }, options?: { browser?: string }) {
      const result = object(await call('getTab', { reference, ...(options?.browser === undefined ? {} : { browser: options.browser }) }))
      if (result.state !== undefined) await emit(result.state)
      return makeTab(result)
    },
    async createBrowserTab(browserId: string, url = 'about:blank', options?: { visible?: boolean; sessionName?: string }) {
      const result = object(await call('createTab', { browser: browserId, url, ...options }))
      if (result.state !== undefined) await emit(result.state)
      return makeTab(result)
    },
  }
}

export type BrowserBridge = ReturnType<typeof connectBrowser>
export type BrowserBridgeTab = Awaited<ReturnType<BrowserBridge['getTab']>>
