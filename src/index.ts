import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-system-prompt'
import Schema from '@deepseek-ai/schemastery'
import { installBrowserTool, type BrowserHostConfig } from './browser-host.js'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'macos-computer-use-compat'
export const inject = ['systemPrompt', 'tools', 'agents']
export type Config = BrowserHostConfig
export const Config = Schema.object({
  configuredCDPEndpoint: Schema.string().default(''),
  browserTimeoutMs: Schema.number().step(1).min(100).max(120000).default(15000),
  browserMaxElements: Schema.number().step(1).min(1).max(2000).default(400),
})
export const GUIDANCE = `macOS Computer Use compatibility API is available in PTC sessions.
Use the official, authorized tools.cua binding for every native operation:
const entry = await tools.computer_use_bootstrap({});
const { connectComputerUse } = await import(entry.nativeBridgeUrl);
const cua = connectComputerUse(() => tools.cua, { text: value => console.log(value) });
const app = await cua.getApp('Calculator');
App/window methods: getAXState, getScreenshot, getAXStateAndScreenshot, click, hover,
setValue, selectText, performSecondaryAction, scroll, drag; app also has show, activate,
getWindows, getWindow, typeText, paste and pressKey. Keep variables only in persistent PTC mode.
After EVERY input action, read getAXState before further input. Never retry failed input blindly.
Coordinates are pixels in the latest screenshot, or explicit relative:true integer thousandths.
Use scroll({x,y,deltaLinesX,deltaLinesY}), not Codex's page-count scroll signature.
Screenshots enter the Host attachment pipeline once; do not print image bytes/base64.
System permissions and app consent are required and cannot be granted by this API.
Keep the Mac unlocked. Prefer background AX actions; activate only when necessary.
Do not read password values. Obtain user confirmation before consequential submissions.
This is an independent community adapter, not OpenAI's private Computer Use runtime.
The bootstrap field browserConfigured reports whether the Host browser endpoint is configured;
it is not a reachability check. Native getCapabilities().browser describes only the native provider.
Optional browser automation, when entry.browserConfigured is true and tools.computer_browser is registered, must use
connectBrowser(() => tools.computer_browser) from entry.browserBridgeUrl (dynamic import).
Every call then crosses the Host approval/log/attachment pipeline.
The browser lease ends when this Agent becomes idle. Before ending a turn, mark
user-facing pages with markDeliverable() or markHandoff(); unretained temporary tabs
are closed. After resuming, getTab by exact URL or a fresh listTabs id; old tab objects expire. The ./browser export is
a low-level developer library and MUST NOT be used to bypass that pipeline.
The Host fixes the explicit loopback CDP endpoint; tool arguments cannot change it.
Locked-desktop automation, OpenAI browser extensions, appshots and private connectors are not implemented.`

export function bridgeManifest(config: Config = {}) {
  return {
    nativeBridgeUrl: new URL('./bridge.js', import.meta.url).href,
    browserBridgeUrl: new URL('./browser-bridge.js', import.meta.url).href,
    packageVersion: '0.1.1',
    browserConfigured: Boolean(config.configuredCDPEndpoint?.trim()),
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  installBrowserTool(ctx, config)
  ctx.tools.register(defineTool({
    name: 'computer_use_bootstrap',
    description: 'Get the installed local Computer Use bridge module URLs and whether the Host browser endpoint is configured. Call this before importing in PTC; bare package imports are not guaranteed to resolve from the working directory. Does not access any app or browser.',
    parameters: {},
    output: { render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }], schema: { type: 'json' } },
    async execute() { return bridgeManifest(config) },
  }))
  ctx.systemPrompt.section({ name: 'macos-computer-use:compat', order: 650, text: () => GUIDANCE })
}
