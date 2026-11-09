import { randomUUID } from 'node:crypto';
import type { Browser, BrowserContext, ElementHandle, Page } from 'playwright';

/** A deliberately explicit connection: this adapter never launches a browser/profile. */
export interface BrowserOptions {
  cdpEndpoint?: string;
  browserId?: string;
  timeoutMs?: number;
  maxElements?: number;
  maxScreenshotBytes?: number;
}

export interface BrowserSink {
  text?(text: string): void | Promise<void>;
  image?(image: { bytes: Uint8Array; mimeType: 'image/png'; pixelWidth: number; pixelHeight: number }): void | Promise<void>;
}

export class BrowserAdapterError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'BrowserAdapterError';
  }
}

/** Refuse credentials, non-loopback listeners and implicit profile discovery. */
export function validateCdpEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new BrowserAdapterError('INVALID_CDP_ENDPOINT', 'Expected an explicit loopback HTTP or WebSocket URL.'); }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.hash) {
    throw new BrowserAdapterError('INVALID_CDP_ENDPOINT', 'CDP must use localhost, 127.0.0.1 or [::1], without credentials or a fragment.');
  }
  // Pin localhost to an IP literal so DNS changes cannot redirect a CDP session.
  // IPv6-only listeners can be selected explicitly with [::1].
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url.toString();
}

export interface BrowserTabInfo { id: string; title: string; url: string; browserId: string; owned: boolean }
export interface BrowserObservationOptions { emit?: boolean }
export type BrowserTarget = number | readonly [number, number];
export interface BrowserClickOptions { mouseButton?: 'left' | 'right' | 'middle'; clickCount?: number; key?: string; durationMs?: number }
export interface BrowserActionResult { dispatched: true; verified: false }
export type BrowserPlaywright = Pick<Page, 'getByRole' | 'getByLabel' | 'getByPlaceholder' | 'getByText' | 'getByTestId' | 'locator' | 'frameLocator' | 'evaluate' | 'waitForEvent'> & { domSnapshot(): Promise<string> };
export interface BrowserTab {
  readonly id: string;
  readonly browserId: string;
  readonly playwright: BrowserPlaywright;
  info(): Promise<BrowserTabInfo>;
  getAXState(options?: BrowserObservationOptions): Promise<string>;
  getScreenshot(options?: BrowserObservationOptions): Promise<Uint8Array>;
  getAXStateAndScreenshot(options?: BrowserObservationOptions): Promise<{ state: string; screenshot: Uint8Array }>;
  click(target: BrowserTarget, options?: BrowserClickOptions): Promise<BrowserActionResult>;
  setValue(index: number, value: string): Promise<BrowserActionResult>;
  typeText(index: number | null, text: string): Promise<BrowserActionResult>;
  paste(index: number | null, text: string, options?: { format?: 'text' | 'md' | 'html' }): Promise<BrowserActionResult>;
  pressKey(index: number | null, key: string): Promise<BrowserActionResult>;
  scroll(target: BrowserTarget, direction: 'up' | 'down' | 'left' | 'right', count?: number): Promise<BrowserActionResult>;
  drag(from: readonly [number, number], to: readonly [number, number]): Promise<BrowserActionResult>;
  goto(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  close(): Promise<void>;
  markDeliverable(): Promise<void>;
  markHandoff(): Promise<void>;
  /** Host integration: invalidate numbered targets after semantic locator actions. */
  releaseSnapshot(): Promise<void>;
}
interface BrowserSurface extends BrowserTab {}
export interface BrowserApi {
  listBrowsers(options?: BrowserObservationOptions): Promise<{ id: string; name: string; family: string; type: string }[]>;
  listTabs(options?: { browser?: string; emit?: boolean }): Promise<BrowserTabInfo[]>;
  getBrowser(options?: { id?: string }): Promise<{ browserId: string; documentation(): Promise<string> }>;
  getTab(reference: string | { url: string }, options?: { browser?: string }): Promise<BrowserTab>;
  createBrowserTab(id: string, url?: string, options?: { visible?: boolean; sessionName?: string }): Promise<BrowserTab>;
  dispose(): Promise<void>;
}

const selectable = 'a[href],button,input:not([type="hidden"]),textarea,select,[contenteditable="true"],[role],h1,h2,h3,h4,h5,h6,label,img[alt]';

function keyChord(value: string): string {
  const names: Record<string, string> = { super: 'Meta', cmd: 'Meta', command: 'Meta', ctrl: 'Control', alt: 'Alt', option: 'Alt', shift: 'Shift', Return: 'Enter', Esc: 'Escape' };
  return value.split('+').map(part => names[part] ?? part).join('+');
}

function boundedNumber(value: number, name: string, minimum: number, maximum: number): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new BrowserAdapterError('INVALID_ARGUMENT', `${name} must be between ${minimum} and ${maximum}.`);
}

export function createBrowserApi(options: BrowserOptions = {}, sink: BrowserSink = {}): BrowserApi {
  const endpoint = options.cdpEndpoint ? validateCdpEndpoint(options.cdpEndpoint) : undefined;
  const browserId = options.browserId ?? 'chromium';
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxElements = options.maxElements ?? 400;
  const maxScreenshotBytes = options.maxScreenshotBytes ?? 16 * 1024 * 1024;
  boundedNumber(timeoutMs, 'timeoutMs', 100, 120_000);
  boundedNumber(maxElements, 'maxElements', 1, 2000);
  if (!Number.isInteger(maxElements)) throw new BrowserAdapterError('INVALID_ARGUMENT', 'maxElements must be an integer.');
  boundedNumber(maxScreenshotBytes, 'maxScreenshotBytes', 1024, 32 * 1024 * 1024);
  let connection: Promise<Browser> | undefined;
  let disposed = false;
  let nextId = 1;
  const namespace = randomUUID();
  const pages = new Map<string, Page>();
  const ids = new WeakMap<Page, string>();
  const owned = new Set<Page>();
  const retained = new Set<Page>();
  const surfaces = new Map<Page, BrowserSurface>();

  async function connected(): Promise<Browser> {
    if (disposed) throw new BrowserAdapterError('BROWSER_DISPOSED', 'Create a new adapter for another session.');
    if (!endpoint) throw new BrowserAdapterError('BROWSER_NOT_CONFIGURED', 'Configure an explicit loopback cdpEndpoint for a browser you own and started with remote debugging. No browser was launched or inspected.');
    if (!connection) {
      connection = import('playwright').then(({ chromium }) => chromium.connectOverCDP(endpoint, { timeout: timeoutMs, noDefaults: true }));
      connection.catch(() => { connection = undefined; });
    }
    return connection;
  }

  function checkBrowser(id?: string) {
    if (id && id !== browserId) throw new BrowserAdapterError('BROWSER_NOT_FOUND', `Configured browser id is ${browserId}.`);
  }

  function remember(page: Page): string {
    let id = ids.get(page);
    if (!id) {
      id = `tab-${namespace}-${nextId++}`;
      ids.set(page, id);
      pages.set(id, page);
      page.once('close', () => { pages.delete(id!); owned.delete(page); retained.delete(page); surfaces.delete(page); });
    }
    return id;
  }

  async function allPages() {
    const browser = await connected();
    const result = browser.contexts().flatMap(context => context.pages()).filter(page => !page.isClosed());
    result.forEach(remember);
    return result;
  }

  async function emit(value: unknown, observation?: BrowserObservationOptions) {
    if (observation?.emit !== false) await sink.text?.(typeof value === 'string' ? value : JSON.stringify(value));
  }

  function makeTab(page: Page): BrowserSurface {
    const id = remember(page);
    let snapshot: { handle: ElementHandle; signature: string }[] | undefined;
    async function invalidate() {
      const previous = snapshot;
      snapshot = undefined;
      await Promise.allSettled((previous ?? []).map(entry => entry.handle.dispose()));
    }
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) void invalidate(); });

    async function element(index: number) {
      if (!snapshot) throw new BrowserAdapterError('OBSERVATION_REQUIRED', 'Read getAXState() again before using element indices.');
      const entry = snapshot[index];
      if (!Number.isInteger(index) || !entry) throw new BrowserAdapterError('ELEMENT_NOT_FOUND', 'Use an index from the latest snapshot.');
      const current = await describe(entry.handle);
      if (!current || current.signature !== entry.signature) throw new BrowserAdapterError('STALE_ELEMENT', 'The page changed. Read a fresh snapshot before acting.');
      return entry.handle;
    }

    async function describe(handle: ElementHandle) {
      return handle.evaluate(node => {
        if (!(node instanceof Element) || !node.isConnected) return null;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none') return null;
        const tag = node.tagName.toLowerCase();
        const input = node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement ? node : undefined;
        const nativeLabels = input && 'labels' in input ? Array.from(input.labels ?? []).map(label => label.textContent ?? '').join(' ') : '';
        const labelledBy = (node.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean).map(label => document.getElementById(label)?.textContent ?? '').join(' ');
        const name = (labelledBy || node.getAttribute('aria-label') || nativeLabels || node.getAttribute('alt') || node.getAttribute('title') || (node instanceof HTMLElement ? node.innerText : node.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 240);
        const roles: Record<string, string> = { a: 'link', button: 'button', input: 'textbox', textarea: 'textbox', select: 'combobox', img: 'image', h1: 'heading', h2: 'heading', h3: 'heading', label: 'label' };
        const inputRole = node instanceof HTMLInputElement
          ? ({ checkbox: 'checkbox', radio: 'radio', range: 'slider', submit: 'button', reset: 'button', button: 'button', image: 'button' } as Record<string, string>)[node.type]
          : undefined;
        const role = node.getAttribute('role') || inputRole || (roles[tag] ?? tag);
        const secret = node instanceof HTMLInputElement && node.type === 'password';
        const value = secret ? '<redacted>' : input?.value?.slice(0, 240);
        const disabled = node.getAttribute('aria-disabled') === 'true' || node.hasAttribute('disabled');
        const signature = JSON.stringify({ tag, role, name, value, disabled, secret });
        return { role, name, value, disabled, secret, signature };
      });
    }

    async function act(action: () => Promise<unknown>) {
      await connected();
      if (page.isClosed()) throw new BrowserAdapterError('TAB_CLOSED', `Tab ${id} is closed.`);
      try { await action(); } finally { await invalidate(); }
      return { dispatched: true as const, verified: false as const };
    }

    async function targetPoint(point: readonly [number, number]) {
      const view = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      boundedNumber(point[0], 'x', 0, Math.max(0, view.width - 1));
      boundedNumber(point[1], 'y', 0, Math.max(0, view.height - 1));
      return { x: point[0], y: point[1] };
    }

    const tab: BrowserSurface = {
      id,
      browserId,
      /** Public locator API. Browser/context lifecycle is deliberately not exposed. */
      playwright: {
        getByRole: page.getByRole.bind(page), getByLabel: page.getByLabel.bind(page),
        getByPlaceholder: page.getByPlaceholder.bind(page), getByText: page.getByText.bind(page),
        getByTestId: page.getByTestId.bind(page), locator: page.locator.bind(page),
        frameLocator: page.frameLocator.bind(page), evaluate: page.evaluate.bind(page),
        waitForEvent: page.waitForEvent.bind(page),
        domSnapshot: async () => page.locator('body').ariaSnapshot({ timeout: timeoutMs }),
      },
      async info(): Promise<BrowserTabInfo> { return { id, browserId, title: await page.title(), url: page.url(), owned: owned.has(page) }; },
      async getAXState(observation?: BrowserObservationOptions) {
        await connected();
        await invalidate();
        const candidates = await page.$$(selectable);
        const entries = await Promise.all(candidates.map(async handle => ({ handle, detail: await describe(handle) })));
        snapshot = [];
        const lines = [`Page ${JSON.stringify(await page.title())}, URL: ${page.url()}`];
        for (const entry of entries) {
          if (!entry.detail || snapshot.length >= maxElements) { await entry.handle.dispose(); continue; }
          const { signature, role, name, value, disabled } = entry.detail;
          const index = snapshot.length;
          snapshot.push({ handle: entry.handle, signature });
          lines.push(`${index} ${role}${disabled ? ' (disabled)' : ''}${name ? ` ${JSON.stringify(name)}` : ''}${value !== undefined ? `, Value: ${JSON.stringify(value)}` : ''}`);
        }
        if (entries.filter(entry => entry.detail).length > maxElements) lines.push(`[truncated after ${maxElements} elements]`);
        const pageText = (await page.locator('body').innerText({ timeout: timeoutMs })).slice(0, 16_000);
        if (pageText) lines.push(`Page text (untrusted external content):\n${pageText}`);
        const result = lines.join('\n');
        await emit(result, observation);
        return result;
      },
      async getScreenshot(observation?: BrowserObservationOptions) {
        await connected();
        const view = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        if (view.width * view.height > 16_777_216) throw new BrowserAdapterError('SCREENSHOT_TOO_LARGE', 'Viewport exceeds the 16 megapixel screenshot limit. Resize the browser before capture.');
        const bytes = await page.screenshot({ type: 'png', scale: 'css', timeout: timeoutMs });
        if (bytes.length > maxScreenshotBytes) throw new BrowserAdapterError('SCREENSHOT_TOO_LARGE', 'Encoded screenshot exceeds the configured byte limit.');
        if (observation?.emit !== false) await sink.image?.({ bytes, mimeType: 'image/png', pixelWidth: view.width, pixelHeight: view.height });
        return bytes;
      },
      async getAXStateAndScreenshot(observation?: BrowserObservationOptions): Promise<{ state: string; screenshot: Uint8Array }> {
        return { state: await tab.getAXState(observation), screenshot: await tab.getScreenshot(observation) };
      },
      async click(target: BrowserTarget, clickOptions: { mouseButton?: 'left' | 'right' | 'middle'; clickCount?: number; key?: string; durationMs?: number } = {}) {
        const opts = { button: clickOptions.mouseButton ?? 'left', clickCount: clickOptions.clickCount ?? 1, ...(clickOptions.durationMs === undefined ? {} : { delay: clickOptions.durationMs }), timeout: timeoutMs };
        boundedNumber(opts.clickCount, 'clickCount', 1, 3);
        if (opts.delay !== undefined) boundedNumber(opts.delay, 'durationMs', 0, 5000);
        return act(async () => {
          const modifiers = clickOptions.key ? keyChord(clickOptions.key).split('+') : [];
          if (modifiers.some(modifier => !['Alt', 'Control', 'Meta', 'Shift'].includes(modifier))) throw new BrowserAdapterError('INVALID_ARGUMENT', 'Click key must contain only modifier names.');
          for (const modifier of modifiers) await page.keyboard.down(modifier);
          try {
            if (typeof target === 'number') await (await element(target)).click(opts);
            else { const point = await targetPoint(target); await page.mouse.click(point.x, point.y, opts); }
          } finally { for (const modifier of modifiers.reverse()) await page.keyboard.up(modifier); }
        });
      },
      async setValue(index: number, value: string) { return act(async () => (await element(index)).fill(value, { timeout: timeoutMs })); },
      async typeText(index: number | null, text: string) {
        return act(async () => { if (index !== null) await (await element(index)).focus(); await page.keyboard.insertText(text); });
      },
      async paste(index: number | null, text: string, pasteOptions: { format?: 'text' | 'md' | 'html' } = {}) {
        if (pasteOptions.format === 'html') throw new BrowserAdapterError('UNSUPPORTED_FORMAT', 'Browser HTML clipboard injection is unsupported; use a semantic editor locator.');
        return tab.typeText(index, text);
      },
      async pressKey(index: number | null, key: string) {
        return act(async () => { if (index !== null) await (await element(index)).focus(); await page.keyboard.press(keyChord(key)); });
      },
      async scroll(target: BrowserTarget, direction: 'up' | 'down' | 'left' | 'right', count = 1) {
        boundedNumber(count, 'pages', 0.01, 10);
        if (!['up', 'down', 'left', 'right'].includes(direction)) throw new BrowserAdapterError('INVALID_ARGUMENT', 'Unknown scroll direction.');
        return act(async () => {
          if (typeof target === 'number') await (await element(target)).hover({ timeout: timeoutMs });
          else { const p = await targetPoint(target); await page.mouse.move(p.x, p.y); }
          const delta = await page.evaluate(() => Math.max(100, innerHeight * 0.8));
          const horizontal = direction === 'left' || direction === 'right';
          const sign = direction === 'up' || direction === 'left' ? -1 : 1;
          await page.mouse.wheel(horizontal ? sign * count * delta : 0, horizontal ? 0 : sign * count * delta);
        });
      },
      async drag(from: readonly [number, number], to: readonly [number, number]) {
        return act(async () => {
          const first = await targetPoint(from), last = await targetPoint(to);
          await page.mouse.move(first.x, first.y);
          await page.mouse.down();
          try { await page.mouse.move(last.x, last.y, { steps: 20 }); } finally { await page.mouse.up(); }
        });
      },
      async goto(url: string) { await connected(); await invalidate(); await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }); },
      // BFCache history restores need not emit DOMContentLoaded again. A commit
      // boundary plus the next state read avoids a spurious navigation timeout.
      async back() { await connected(); await invalidate(); await page.goBack({ waitUntil: 'commit', timeout: timeoutMs }); },
      async forward() { await connected(); await invalidate(); await page.goForward({ waitUntil: 'commit', timeout: timeoutMs }); },
      async reload() { await connected(); await invalidate(); await page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs }); },
      async close() {
        if (!owned.has(page)) throw new BrowserAdapterError('TAB_NOT_OWNED', 'This adapter will not close an existing user tab. Close it yourself if needed.');
        await invalidate(); await page.close();
      },
      async markDeliverable() { retained.add(page); },
      async markHandoff() { retained.add(page); },
      releaseSnapshot: invalidate,
    };
    return tab;
  }

  function surface(page: Page) {
    let result = surfaces.get(page);
    if (!result) { result = makeTab(page); surfaces.set(page, result); }
    return result;
  }

  const api: BrowserApi = {
    async listBrowsers(observation?: BrowserObservationOptions) {
      const result = endpoint ? [{ id: browserId, name: 'Explicitly connected Chromium', family: 'chromium', type: 'cdp' }] : [];
      await emit(result, observation); return result;
    },
    async listTabs(browserOptions?: { browser?: string; emit?: boolean }) {
      checkBrowser(browserOptions?.browser);
      const result = await Promise.all((await allPages()).map(page => surface(page).info()));
      await emit(result, browserOptions); return result;
    },
    async getBrowser(browserOptions?: { id?: string }) {
      checkBrowser(browserOptions?.id); await connected();
      return { browserId, documentation: async () => 'Chromium CDP, explicit loopback connection. Existing user tabs cannot be closed by this adapter; only created unmarked tabs are cleaned up. Use tab.playwright locators or fresh DOM indices, and re-observe after actions.' };
    },
    async getTab(reference: string | { url: string }, browserOptions?: { browser?: string }) {
      checkBrowser(browserOptions?.browser);
      const candidates = await allPages();
      let selected: Page | undefined;
      if (typeof reference === 'string') selected = pages.get(reference);
      else {
        const matches = candidates.filter(page => page.url() === reference.url);
        if (matches.length > 1) throw new BrowserAdapterError('AMBIGUOUS_TAB', 'Several tabs have this URL. Select an id from listTabs().');
        selected = matches[0];
      }
      if (!selected || selected.isClosed()) throw new BrowserAdapterError('TAB_NOT_FOUND', 'Select an existing id or exact URL from listTabs().');
      const tab = surface(selected); await tab.getAXState(); return tab;
    },
    async createBrowserTab(id: string, url = 'about:blank', _browserOptions?: { visible?: boolean; sessionName?: string }) {
      checkBrowser(id);
      const browser = await connected();
      // An existing CDP browser should have its default context. Creating a context
      // here could discard retained tabs on disconnect, so refuse that situation.
      const context: BrowserContext | undefined = browser.contexts()[0];
      if (!context) throw new BrowserAdapterError('BROWSER_CONTEXT_UNAVAILABLE', 'The attached browser has no existing context.');
      const page = await context.newPage(); owned.add(page);
      try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }); }
      catch (error) { await page.close(); throw error; }
      const tab = surface(page); await tab.getAXState(); return tab;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await Promise.allSettled([...surfaces.values()].map(tab => tab.releaseSnapshot()));
      await Promise.allSettled([...owned].filter(page => !retained.has(page) && !page.isClosed()).map(page => page.close()));
      if (connection) {
        // For connectOverCDP, Browser.close disconnects the WebSocket; it does not
        // send CDP Browser.close or terminate the external browser. Covered by E2E.
        const browser = await connection.catch(() => undefined);
        await browser?.close();
      }
      pages.clear(); surfaces.clear(); owned.clear(); retained.clear();
    },
  };
  return api;
}
