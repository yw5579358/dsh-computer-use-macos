import { type CuaToolBinding } from '@deepseek-ai/dsh-cua/bridge';
import type { CuaApi, CuaApp, CuaSurface, CuaObservationOptions, CuaClickOptions } from '@deepseek-ai/dsh-cua/api';
export type ObservationOptions = CuaObservationOptions;
export interface CompatClickOptions extends CuaClickOptions {
    /** Codex-style modifier chord, e.g. "super" or "shift+alt". */
    key?: string;
    /** Codex-style alias of holdMs; specifying both is rejected. */
    durationMs?: number;
}
export interface CompatSink {
    text(value: string): void | Promise<void>;
}
export interface ConnectOptions {
    requireFreshState?: boolean;
}
export declare function normalizeClickOptions(options?: CompatClickOptions): CuaClickOptions;
export type CompatSurface = Omit<CuaSurface, 'click'> & {
    click(target: number | readonly [number, number], options?: CompatClickOptions): ReturnType<CuaSurface['click']>;
};
export type CompatWindow = CompatSurface & {
    readonly windowId: number;
};
export type CompatApp = Omit<CuaApp, keyof CuaSurface | 'getWindow'> & CompatSurface & {
    getWindow(windowId: number): Promise<CompatWindow>;
};
export type ComputerApi = Omit<CuaApi, 'getApp'> & {
    getApp(selector: string): Promise<CompatApp>;
};
/** Resolve getTool for EVERY operation; never retain a previous run_code execution's authority. */
export declare function connectComputerUse(getTool: () => CuaToolBinding, sink?: CompatSink, options?: ConnectOptions): ComputerApi;
/** A single familiar entry point; both native and browser paths retain Host tool authority. */
export declare function connectUnifiedComputerUse(getNativeTool: () => CuaToolBinding, getBrowserTool?: () => import('./browser-bridge.js').BrowserToolBinding, sink?: CompatSink, options?: ConnectOptions): {
    getApp: (selector: string) => Promise<CompatApp>;
    getCapabilities: (options?: CuaObservationOptions) => Promise<import("@deepseek-ai/dsh-cua/api").CuaCapabilities>;
    getState(observation?: ObservationOptions): Promise<{
        apps: import("@deepseek-ai/dsh-cua/api").CuaAppInfo[];
        browsers: import("@deepseek-ai/dsh-util-values").JsonValue;
    }>;
    listBrowsers(options?: {
        emit?: boolean;
    }): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
    listTabs(options?: {
        browser?: string;
        emit?: boolean;
    }): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
    getBrowser(options?: {
        id?: string;
    }): Promise<{
        browserId: string;
        documentation: () => Promise<string>;
    }>;
    getTab(reference: string | {
        url: string;
    }, options?: {
        browser?: string;
    }): Promise<{
        id: string;
        browserId: string;
        playwright: {
            getByRole: (role: string, options?: import("./browser-bridge.js").LocatorRoleOptions) => import("./browser-bridge.js").BrowserBridgeLocator;
            getByLabel: (text: string, options?: import("./browser-bridge.js").LocatorTextOptions) => import("./browser-bridge.js").BrowserBridgeLocator;
            getByPlaceholder: (text: string, options?: import("./browser-bridge.js").LocatorTextOptions) => import("./browser-bridge.js").BrowserBridgeLocator;
            getByText: (text: string, options?: import("./browser-bridge.js").LocatorTextOptions) => import("./browser-bridge.js").BrowserBridgeLocator;
            getByTestId: (id: string) => import("./browser-bridge.js").BrowserBridgeLocator;
            locator: (selector: string) => import("./browser-bridge.js").BrowserBridgeLocator;
            frameLocator: (selector: string) => import("./browser-bridge.js").BrowserBridgeLocator;
            domSnapshot: () => Promise<string>;
        };
        info(): Promise<import("./browser-bridge.js").BrowserBridgeTabInfo>;
        getAXState(options?: {
            emit?: boolean;
        }): Promise<string>;
        getScreenshot(_options?: {
            emit?: boolean;
        }): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        getAXStateAndScreenshot(options?: {
            emit?: boolean;
        }): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        click(target: number | readonly [number, number], options?: {
            mouseButton?: "left" | "right" | "middle";
            clickCount?: number;
            key?: string;
            durationMs?: number;
        }): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        setValue(index: number, value: string): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        typeText(index: number | null, text: string): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        paste(index: number | null, text: string, options?: {
            format?: "text" | "md";
        }): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        pressKey(index: number | null, key: string): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        scroll(target: number | readonly [number, number], direction: "up" | "down" | "left" | "right", pages?: number): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        drag(from: readonly [number, number], to: readonly [number, number]): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        goto(url: string): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        back(): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        forward(): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        reload(): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        close(): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        markDeliverable(): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        markHandoff(): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
    }>;
    createBrowserTab(browserId: string, url?: string, options?: {
        visible?: boolean;
        sessionName?: string;
    }): Promise<{
        id: string;
        browserId: string;
        playwright: {
            getByRole: (role: string, options?: import("./browser-bridge.js").LocatorRoleOptions) => import("./browser-bridge.js").BrowserBridgeLocator;
            getByLabel: (text: string, options?: import("./browser-bridge.js").LocatorTextOptions) => import("./browser-bridge.js").BrowserBridgeLocator;
            getByPlaceholder: (text: string, options?: import("./browser-bridge.js").LocatorTextOptions) => import("./browser-bridge.js").BrowserBridgeLocator;
            getByText: (text: string, options?: import("./browser-bridge.js").LocatorTextOptions) => import("./browser-bridge.js").BrowserBridgeLocator;
            getByTestId: (id: string) => import("./browser-bridge.js").BrowserBridgeLocator;
            locator: (selector: string) => import("./browser-bridge.js").BrowserBridgeLocator;
            frameLocator: (selector: string) => import("./browser-bridge.js").BrowserBridgeLocator;
            domSnapshot: () => Promise<string>;
        };
        info(): Promise<import("./browser-bridge.js").BrowserBridgeTabInfo>;
        getAXState(options?: {
            emit?: boolean;
        }): Promise<string>;
        getScreenshot(_options?: {
            emit?: boolean;
        }): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        getAXStateAndScreenshot(options?: {
            emit?: boolean;
        }): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        click(target: number | readonly [number, number], options?: {
            mouseButton?: "left" | "right" | "middle";
            clickCount?: number;
            key?: string;
            durationMs?: number;
        }): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        setValue(index: number, value: string): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        typeText(index: number | null, text: string): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        paste(index: number | null, text: string, options?: {
            format?: "text" | "md";
        }): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        pressKey(index: number | null, key: string): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        scroll(target: number | readonly [number, number], direction: "up" | "down" | "left" | "right", pages?: number): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        drag(from: readonly [number, number], to: readonly [number, number]): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        goto(url: string): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        back(): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        forward(): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        reload(): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        close(): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        markDeliverable(): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
        markHandoff(): Promise<import("@deepseek-ai/dsh-util-values").JsonValue>;
    }>;
    listApps: (options?: CuaObservationOptions) => Promise<import("@deepseek-ai/dsh-cua/api").CuaAppInfo[]>;
    findApps: (query: string, options?: CuaObservationOptions) => Promise<import("@deepseek-ai/dsh-cua/api").CuaFoundAppInfo[]>;
};
