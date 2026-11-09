import type { Context } from '@deepseek-ai/cordis';
import '@deepseek-ai/dsh-system-prompt';
import Schema from '@deepseek-ai/schemastery';
import { type BrowserHostConfig } from './browser-host.js';
export declare const name = "macos-computer-use-compat";
export declare const inject: string[];
export type Config = BrowserHostConfig;
export declare const Config: Schema<Schemastery.ObjectS<NoInfer<{
    configuredCDPEndpoint: Schema<string, string, "defined">;
    browserTimeoutMs: Schema<number, number, "defined">;
    browserMaxElements: Schema<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    configuredCDPEndpoint: Schema<string, string, "defined">;
    browserTimeoutMs: Schema<number, number, "defined">;
    browserMaxElements: Schema<number, number, "defined">;
}>>, "plain">;
export declare const GUIDANCE = "macOS Computer Use compatibility API is available in PTC sessions.\nUse the official, authorized tools.cua binding for every native operation:\nconst entry = await tools.computer_use_bootstrap({});\nconst { connectComputerUse } = await import(entry.nativeBridgeUrl);\nconst cua = connectComputerUse(() => tools.cua, { text: value => console.log(value) });\nconst app = await cua.getApp('Calculator');\nApp/window methods: getAXState, getScreenshot, getAXStateAndScreenshot, click, hover,\nsetValue, selectText, performSecondaryAction, scroll, drag; app also has show, activate,\ngetWindows, getWindow, typeText, paste and pressKey. Keep variables only in persistent PTC mode.\nAfter EVERY input action, read getAXState before further input. Never retry failed input blindly.\nCoordinates are pixels in the latest screenshot, or explicit relative:true integer thousandths.\nUse scroll({x,y,deltaLinesX,deltaLinesY}), not Codex's page-count scroll signature.\nScreenshots enter the Host attachment pipeline once; do not print image bytes/base64.\nSystem permissions and app consent are required and cannot be granted by this API.\nKeep the Mac unlocked. Prefer background AX actions; activate only when necessary.\nDo not read password values. Obtain user confirmation before consequential submissions.\nThis is an independent community adapter, not OpenAI's private Computer Use runtime.\nThe bootstrap field browserConfigured reports whether the Host browser endpoint is configured;\nit is not a reachability check. Native getCapabilities().browser describes only the native provider.\nOptional browser automation, when entry.browserConfigured is true and tools.computer_browser is registered, must use\nconnectBrowser(() => tools.computer_browser) from entry.browserBridgeUrl (dynamic import).\nEvery call then crosses the Host approval/log/attachment pipeline.\nThe browser lease ends when this Agent becomes idle. Before ending a turn, mark\nuser-facing pages with markDeliverable() or markHandoff(); unretained temporary tabs\nare closed. After resuming, getTab by exact URL or a fresh listTabs id; old tab objects expire. The ./browser export is\na low-level developer library and MUST NOT be used to bypass that pipeline.\nThe Host fixes the explicit loopback CDP endpoint; tool arguments cannot change it.\nLocked-desktop automation, OpenAI browser extensions, appshots and private connectors are not implemented.";
export declare function bridgeManifest(config?: Config): {
    nativeBridgeUrl: string;
    browserBridgeUrl: string;
    packageVersion: string;
    browserConfigured: boolean;
};
export declare function apply(ctx: Context, config?: Config): void;
