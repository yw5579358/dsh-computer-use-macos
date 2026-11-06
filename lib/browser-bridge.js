function object(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Host returned an invalid browser object.');
    return value;
}
function json(value) { return JSON.parse(JSON.stringify(value)); }
function optional(value) { return value === undefined ? [] : [json(value)]; }
/** A serializable locator chain. It has no evaluate, raw Playwright page, or CDP connection. */
export class BrowserBridgeLocator {
    dispatch;
    steps;
    constructor(dispatch, steps = []) {
        this.dispatch = dispatch;
        this.steps = steps;
    }
    chain(method, args) {
        return new BrowserBridgeLocator(this.dispatch, [...this.steps, { method, args: args.map(json) }]);
    }
    run(method, args = []) {
        return this.dispatch({ steps: [...this.steps], action: { method, args } });
    }
    getByRole(role, options) { return this.chain('getByRole', [role, ...optional(options)]); }
    getByLabel(text, options) { return this.chain('getByLabel', [text, ...optional(options)]); }
    getByPlaceholder(text, options) { return this.chain('getByPlaceholder', [text, ...optional(options)]); }
    getByText(text, options) { return this.chain('getByText', [text, ...optional(options)]); }
    getByTestId(id) { return this.chain('getByTestId', [id]); }
    locator(selector) { return this.chain('locator', [selector]); }
    frameLocator(selector) { return this.chain('frameLocator', [selector]); }
    filter(options) { return this.chain('filter', [options]); }
    first() { return this.chain('first', []); }
    last() { return this.chain('last', []); }
    nth(index) { return this.chain('nth', [index]); }
    click(options) { return this.run('click', optional(options)); }
    dblclick(options) { return this.run('dblclick', optional(options)); }
    fill(value, options) { return this.run('fill', [value, ...optional(options)]); }
    press(key, options) { return this.run('press', [key, ...optional(options)]); }
    pressSequentially(value, options) { return this.run('pressSequentially', [value, ...optional(options)]); }
    type(value, options) { return this.pressSequentially(value, options); }
    async innerText(options) { return String(await this.run('innerText', optional(options))); }
    async textContent(options) { const value = await this.run('textContent', optional(options)); return value === null ? null : String(value); }
    async allTextContents() { return await this.run('allTextContents'); }
    async count() { return Number(await this.run('count')); }
    async isVisible() { return Boolean(await this.run('isVisible')); }
    async isEnabled() { return Boolean(await this.run('isEnabled')); }
    async getAttribute(name, options) { const value = await this.run('getAttribute', [name, ...optional(options)]); return value === null ? null : String(value); }
    selectOption(value, options) { return this.run('selectOption', [json(value), ...optional(options)]); }
    check(options) { return this.run('check', optional(options)); }
    uncheck(options) { return this.run('uncheck', optional(options)); }
    setChecked(value, options) { return this.run('setChecked', [value, ...optional(options)]); }
    hover(options) { return this.run('hover', optional(options)); }
    focus() { return this.run('focus'); }
    scrollIntoViewIfNeeded() { return this.run('scrollIntoViewIfNeeded'); }
    waitFor(options) { return this.run('waitFor', optional(options)); }
}
/** Connect browser objects to tools.computer_browser without granting direct network access. */
export function connectBrowser(getTool, output = {}) {
    const call = (method, params = {}) => getTool()({ method, params: object(json(params)) });
    const emit = async (value, options) => {
        if (options?.emit !== false)
            await output.text?.(typeof value === 'string' ? value : JSON.stringify(value));
        return value;
    };
    function makeTab(initial) {
        if (typeof initial.id !== 'string')
            throw new Error('Host returned no tab id.');
        const id = initial.id;
        const run = (method, params = {}) => call(method, { tabId: id, ...params });
        const root = new BrowserBridgeLocator(locator => run('locator', { locator }));
        const tab = {
            id,
            browserId: String(initial.browserId),
            playwright: {
                getByRole: root.getByRole.bind(root), getByLabel: root.getByLabel.bind(root),
                getByPlaceholder: root.getByPlaceholder.bind(root), getByText: root.getByText.bind(root),
                getByTestId: root.getByTestId.bind(root), locator: root.locator.bind(root), frameLocator: root.frameLocator.bind(root),
                domSnapshot: async () => String(await run('getAXState')),
            },
            async info() {
                const value = object(await run('info'));
                if (typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.url !== 'string' || typeof value.browserId !== 'string' || typeof value.owned !== 'boolean')
                    throw new Error('Host returned invalid tab metadata.');
                return { id: value.id, title: value.title, url: value.url, browserId: value.browserId, owned: value.owned };
            },
            async getAXState(options) { return String(await emit(await run('getAXState'), options)); },
            /** The image was already admitted by the Host. Returns attachment metadata, never raw Base64. */
            async getScreenshot(_options) { return run('getScreenshot'); },
            async getAXStateAndScreenshot(options) {
                const result = await run('getAXStateAndScreenshot');
                const state = object(result).state;
                if (state !== undefined)
                    await emit(state, options);
                return result;
            },
            click(target, options) { return run('click', { target, ...(options === undefined ? {} : { options }) }); },
            setValue(index, value) { return run('setValue', { index, value }); },
            typeText(index, text) { return run('typeText', { index, text }); },
            paste(index, text, options) { return run('paste', { index, text, ...(options?.format === undefined ? {} : { format: options.format }) }); },
            pressKey(index, key) { return run('pressKey', { index, key }); },
            scroll(target, direction, pages = 1) { return run('scroll', { target, direction, pages }); },
            drag(from, to) { return run('drag', { from, to }); },
            goto(url) { return run('goto', { url }); },
            back() { return run('back'); }, forward() { return run('forward'); }, reload() { return run('reload'); }, close() { return run('close'); },
            markDeliverable() { return run('markDeliverable'); }, markHandoff() { return run('markHandoff'); },
        };
        return tab;
    }
    return {
        async listBrowsers(options) { return await emit(await call('listBrowsers'), options); },
        async listTabs(options) { return emit(await call('listTabs', options?.browser === undefined ? {} : { browser: options.browser }), options); },
        async getState(options) {
            const browsers = await call('listBrowsers');
            return emit({ browsers }, options);
        },
        async getBrowser(options) {
            const result = object(await call('getBrowser', options?.id === undefined ? {} : { browser: options.id }));
            return { browserId: String(result.browserId), documentation: async () => String(result.documentation) };
        },
        async getTab(reference, options) {
            const result = object(await call('getTab', { reference, ...(options?.browser === undefined ? {} : { browser: options.browser }) }));
            if (result.state !== undefined)
                await emit(result.state);
            return makeTab(result);
        },
        async createBrowserTab(browserId, url = 'about:blank', options) {
            const result = object(await call('createTab', { browser: browserId, url, ...options }));
            if (result.state !== undefined)
                await emit(result.state);
            return makeTab(result);
        },
    };
}
//# sourceMappingURL=browser-bridge.js.map