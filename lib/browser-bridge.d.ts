import type { BrowserRequest, LocatorRequest, LocatorStep } from './browser-host.js';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
/** Resolve the current Host tool binding on every operation, preserving its authority and log. */
export type BrowserToolBinding = (request: BrowserRequest) => Promise<JsonValue>;
export interface BrowserBridgeOptions {
    text?: (value: string) => void | Promise<void>;
}
export interface LocatorTextOptions {
    exact?: boolean;
}
export interface LocatorRoleOptions extends LocatorTextOptions {
    name?: string;
    level?: number;
    checked?: boolean;
    disabled?: boolean;
    expanded?: boolean;
    includeHidden?: boolean;
    pressed?: boolean;
    selected?: boolean;
}
export interface LocatorActionOptions {
    timeout?: number;
    force?: boolean;
    noWaitAfter?: boolean;
    button?: 'left' | 'right' | 'middle';
    clickCount?: number;
    delay?: number;
    modifiers?: ('Alt' | 'Control' | 'ControlOrMeta' | 'Meta' | 'Shift')[];
    position?: {
        x: number;
        y: number;
    };
}
export interface BrowserBridgeTabInfo {
    id: string;
    title: string;
    url: string;
    browserId: string;
    owned: boolean;
}
/** A serializable locator chain. It has no evaluate, raw Playwright page, or CDP connection. */
export declare class BrowserBridgeLocator {
    private readonly dispatch;
    private readonly steps;
    constructor(dispatch: (request: LocatorRequest) => Promise<JsonValue>, steps?: readonly LocatorStep[]);
    private chain;
    private run;
    getByRole(role: string, options?: LocatorRoleOptions): BrowserBridgeLocator;
    getByLabel(text: string, options?: LocatorTextOptions): BrowserBridgeLocator;
    getByPlaceholder(text: string, options?: LocatorTextOptions): BrowserBridgeLocator;
    getByText(text: string, options?: LocatorTextOptions): BrowserBridgeLocator;
    getByTestId(id: string): BrowserBridgeLocator;
    locator(selector: string): BrowserBridgeLocator;
    frameLocator(selector: string): BrowserBridgeLocator;
    filter(options: {
        hasText?: string;
        hasNotText?: string;
        visible?: boolean;
    }): BrowserBridgeLocator;
    first(): BrowserBridgeLocator;
    last(): BrowserBridgeLocator;
    nth(index: number): BrowserBridgeLocator;
    click(options?: LocatorActionOptions): Promise<JsonValue>;
    dblclick(options?: LocatorActionOptions): Promise<JsonValue>;
    fill(value: string, options?: LocatorActionOptions): Promise<JsonValue>;
    press(key: string, options?: LocatorActionOptions): Promise<JsonValue>;
    pressSequentially(value: string, options?: LocatorActionOptions): Promise<JsonValue>;
    type(value: string, options?: LocatorActionOptions): Promise<JsonValue>;
    innerText(options?: Pick<LocatorActionOptions, 'timeout'>): Promise<string>;
    textContent(options?: Pick<LocatorActionOptions, 'timeout'>): Promise<string | null>;
    allTextContents(): Promise<string[]>;
    count(): Promise<number>;
    isVisible(): Promise<boolean>;
    isEnabled(): Promise<boolean>;
    getAttribute(name: string, options?: Pick<LocatorActionOptions, 'timeout'>): Promise<string | null>;
    selectOption(value: string | string[], options?: LocatorActionOptions): Promise<JsonValue>;
    check(options?: LocatorActionOptions): Promise<JsonValue>;
    uncheck(options?: LocatorActionOptions): Promise<JsonValue>;
    setChecked(value: boolean, options?: LocatorActionOptions): Promise<JsonValue>;
    hover(options?: LocatorActionOptions): Promise<JsonValue>;
    focus(): Promise<JsonValue>;
    scrollIntoViewIfNeeded(): Promise<JsonValue>;
    waitFor(options?: {
        state?: 'attached' | 'detached' | 'visible' | 'hidden';
        timeout?: number;
    }): Promise<JsonValue>;
}
/** Connect browser objects to tools.computer_browser without granting direct network access. */
export declare function connectBrowser(getTool: () => BrowserToolBinding, output?: BrowserBridgeOptions): {
    listBrowsers(options?: {
        emit?: boolean;
    }): Promise<JsonValue>;
    listTabs(options?: {
        browser?: string;
        emit?: boolean;
    }): Promise<JsonValue>;
    getState(options?: {
        emit?: boolean;
    }): Promise<JsonValue>;
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
            getByRole: (role: string, options?: LocatorRoleOptions) => BrowserBridgeLocator;
            getByLabel: (text: string, options?: LocatorTextOptions) => BrowserBridgeLocator;
            getByPlaceholder: (text: string, options?: LocatorTextOptions) => BrowserBridgeLocator;
            getByText: (text: string, options?: LocatorTextOptions) => BrowserBridgeLocator;
            getByTestId: (id: string) => BrowserBridgeLocator;
            locator: (selector: string) => BrowserBridgeLocator;
            frameLocator: (selector: string) => BrowserBridgeLocator;
            domSnapshot: () => Promise<string>;
        };
        info(): Promise<BrowserBridgeTabInfo>;
        getAXState(options?: {
            emit?: boolean;
        }): Promise<string>;
        /** The image was already admitted by the Host. Returns attachment metadata, never raw Base64. */
        getScreenshot(_options?: {
            emit?: boolean;
        }): Promise<JsonValue>;
        getAXStateAndScreenshot(options?: {
            emit?: boolean;
        }): Promise<JsonValue>;
        click(target: number | readonly [number, number], options?: {
            mouseButton?: "left" | "right" | "middle";
            clickCount?: number;
            key?: string;
            durationMs?: number;
        }): Promise<JsonValue>;
        setValue(index: number, value: string): Promise<JsonValue>;
        typeText(index: number | null, text: string): Promise<JsonValue>;
        paste(index: number | null, text: string, options?: {
            format?: "text" | "md";
        }): Promise<JsonValue>;
        pressKey(index: number | null, key: string): Promise<JsonValue>;
        scroll(target: number | readonly [number, number], direction: "up" | "down" | "left" | "right", pages?: number): Promise<JsonValue>;
        drag(from: readonly [number, number], to: readonly [number, number]): Promise<JsonValue>;
        goto(url: string): Promise<JsonValue>;
        back(): Promise<JsonValue>;
        forward(): Promise<JsonValue>;
        reload(): Promise<JsonValue>;
        close(): Promise<JsonValue>;
        markDeliverable(): Promise<JsonValue>;
        markHandoff(): Promise<JsonValue>;
    }>;
    createBrowserTab(browserId: string, url?: string, options?: {
        visible?: boolean;
        sessionName?: string;
    }): Promise<{
        id: string;
        browserId: string;
        playwright: {
            getByRole: (role: string, options?: LocatorRoleOptions) => BrowserBridgeLocator;
            getByLabel: (text: string, options?: LocatorTextOptions) => BrowserBridgeLocator;
            getByPlaceholder: (text: string, options?: LocatorTextOptions) => BrowserBridgeLocator;
            getByText: (text: string, options?: LocatorTextOptions) => BrowserBridgeLocator;
            getByTestId: (id: string) => BrowserBridgeLocator;
            locator: (selector: string) => BrowserBridgeLocator;
            frameLocator: (selector: string) => BrowserBridgeLocator;
            domSnapshot: () => Promise<string>;
        };
        info(): Promise<BrowserBridgeTabInfo>;
        getAXState(options?: {
            emit?: boolean;
        }): Promise<string>;
        /** The image was already admitted by the Host. Returns attachment metadata, never raw Base64. */
        getScreenshot(_options?: {
            emit?: boolean;
        }): Promise<JsonValue>;
        getAXStateAndScreenshot(options?: {
            emit?: boolean;
        }): Promise<JsonValue>;
        click(target: number | readonly [number, number], options?: {
            mouseButton?: "left" | "right" | "middle";
            clickCount?: number;
            key?: string;
            durationMs?: number;
        }): Promise<JsonValue>;
        setValue(index: number, value: string): Promise<JsonValue>;
        typeText(index: number | null, text: string): Promise<JsonValue>;
        paste(index: number | null, text: string, options?: {
            format?: "text" | "md";
        }): Promise<JsonValue>;
        pressKey(index: number | null, key: string): Promise<JsonValue>;
        scroll(target: number | readonly [number, number], direction: "up" | "down" | "left" | "right", pages?: number): Promise<JsonValue>;
        drag(from: readonly [number, number], to: readonly [number, number]): Promise<JsonValue>;
        goto(url: string): Promise<JsonValue>;
        back(): Promise<JsonValue>;
        forward(): Promise<JsonValue>;
        reload(): Promise<JsonValue>;
        close(): Promise<JsonValue>;
        markDeliverable(): Promise<JsonValue>;
        markHandoff(): Promise<JsonValue>;
    }>;
};
export type BrowserBridge = ReturnType<typeof connectBrowser>;
export type BrowserBridgeTab = Awaited<ReturnType<BrowserBridge['getTab']>>;
