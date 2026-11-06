/** Original compatibility facade. Native work always crosses the current Harness tool binding. */
import { connectBrowser } from './browser-bridge.js';
import { connectCua } from '@deepseek-ai/dsh-cua/bridge';
function modifiers(chord) {
    const names = {
        super: 'command', cmd: 'command', command: 'command', ctrl: 'control', control: 'control',
        alt: 'option', option: 'option', shift: 'shift', fn: 'fn',
    };
    return chord.split('+').map(part => {
        const result = names[part];
        if (!result)
            throw new Error(`Unsupported pointer modifier: ${part}`);
        return result;
    });
}
export function normalizeClickOptions(options = {}) {
    const { key, durationMs, ...native } = options;
    if (key !== undefined && native.modifiers !== undefined)
        throw new Error('Use key or modifiers, not both');
    if (durationMs !== undefined && native.holdMs !== undefined)
        throw new Error('Use durationMs or holdMs, not both');
    if (key !== undefined)
        native.modifiers = modifiers(key);
    if (durationMs !== undefined) {
        if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 5000)
            throw new Error('durationMs must be an integer from 0 to 5000');
        native.holdMs = durationMs;
    }
    return native;
}
/** Resolve getTool for EVERY operation; never retain a previous run_code execution's authority. */
export function connectComputerUse(getTool, sink, options = {}) {
    const native = connectCua(getTool, value => sink?.text(value));
    const strict = options.requireFreshState !== false;
    function wrapSurface(surface, epoch) {
        let freshAt = epoch.value;
        const requireState = () => {
            if (strict && freshAt !== epoch.value)
                throw new Error('FRESH_STATE_REQUIRED: read getAXState after the preceding action before using this surface again');
        };
        async function observe(args) {
            freshAt = -1;
            const result = await surface.getAXState(args);
            freshAt = epoch.value;
            epoch.observed = epoch.value;
            return result;
        }
        async function action(perform) {
            requireState();
            epoch.value++;
            return perform();
        }
        return {
            ...surface,
            getAXState: observe,
            async getAXStateAndScreenshot(args) {
                const state = await observe(args);
                return { state, screenshot: await surface.getScreenshot(args) };
            },
            async getScreenshot(args) { requireState(); return surface.getScreenshot(args); },
            async show() { epoch.value++; return surface.show(); },
            click: (target, args) => action(() => surface.click(target, normalizeClickOptions(args))),
            hover: (target, args) => action(() => surface.hover(target, args)),
            drag: (from, to, args) => action(() => surface.drag(from, to, args)),
            scroll: args => action(() => surface.scroll(args)),
            setValue: (index, value) => action(() => surface.setValue(index, value)),
            selectText: (index, text, args) => action(() => surface.selectText(index, text, args)),
            performSecondaryAction: (index, name) => action(() => surface.performSecondaryAction(index, name)),
        };
    }
    function wrapApp(app) {
        const epoch = { value: 0, observed: 0 };
        const surface = wrapSurface(app, epoch);
        async function input(perform) {
            if (strict && epoch.observed !== epoch.value)
                throw new Error('FRESH_STATE_REQUIRED: read getAXState after input');
            epoch.value++;
            return perform();
        }
        return {
            ...app, ...surface,
            async activate() { epoch.value++; return app.activate(); },
            async getWindow(windowId) {
                const selected = await app.getWindow(windowId);
                epoch.observed = epoch.value;
                return { ...wrapSurface(selected, epoch), windowId };
            },
            typeText: text => input(() => app.typeText(text)),
            paste: (text, args) => input(() => app.paste(text, args)),
            pressKey: key => input(() => app.pressKey(key)),
        };
    }
    return { ...native, async getApp(selector) { return wrapApp(await native.getApp(selector)); } };
}
/** A single familiar entry point; both native and browser paths retain Host tool authority. */
export function connectUnifiedComputerUse(getNativeTool, getBrowserTool, sink, options) {
    const desktop = connectComputerUse(getNativeTool, sink, options);
    const browser = connectBrowser(getBrowserTool ?? (() => async () => {
        throw new Error('BROWSER_NOT_CONFIGURED: enable the Host browser tool with an explicit loopback CDP endpoint');
    }), sink === undefined ? {} : { text: value => sink.text(value) });
    return {
        ...desktop, ...browser,
        getApp: desktop.getApp,
        getCapabilities: desktop.getCapabilities,
        async getState(observation) {
            const apps = await desktop.listApps({ emit: false });
            const browsers = getBrowserTool === undefined ? [] : await browser.listBrowsers({ emit: false });
            const state = { apps, browsers };
            if (observation?.emit !== false)
                await sink?.text(JSON.stringify(state));
            return state;
        },
    };
}
//# sourceMappingURL=bridge.js.map