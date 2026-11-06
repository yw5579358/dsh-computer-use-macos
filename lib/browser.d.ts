import type { Page } from 'playwright';
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
    image?(image: {
        bytes: Uint8Array;
        mimeType: 'image/png';
        pixelWidth: number;
        pixelHeight: number;
    }): void | Promise<void>;
}
export declare class BrowserAdapterError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** Refuse credentials, non-loopback listeners and implicit profile discovery. */
export declare function validateCdpEndpoint(value: string): string;
export interface BrowserTabInfo {
    id: string;
    title: string;
    url: string;
    browserId: string;
    owned: boolean;
}
export interface BrowserObservationOptions {
    emit?: boolean;
}
export type BrowserTarget = number | readonly [number, number];
export interface BrowserClickOptions {
    mouseButton?: 'left' | 'right' | 'middle';
    clickCount?: number;
    key?: string;
    durationMs?: number;
}
export interface BrowserActionResult {
    dispatched: true;
    verified: false;
}
export type BrowserPlaywright = Pick<Page, 'getByRole' | 'getByLabel' | 'getByPlaceholder' | 'getByText' | 'getByTestId' | 'locator' | 'frameLocator' | 'evaluate' | 'waitForEvent'> & {
    domSnapshot(): Promise<string>;
};
export interface BrowserTab {
    readonly id: string;
    readonly browserId: string;
    readonly playwright: BrowserPlaywright;
    info(): Promise<BrowserTabInfo>;
    getAXState(options?: BrowserObservationOptions): Promise<string>;
    getScreenshot(options?: BrowserObservationOptions): Promise<Uint8Array>;
    getAXStateAndScreenshot(options?: BrowserObservationOptions): Promise<{
        state: string;
        screenshot: Uint8Array;
    }>;
    click(target: BrowserTarget, options?: BrowserClickOptions): Promise<BrowserActionResult>;
    setValue(index: number, value: string): Promise<BrowserActionResult>;
    typeText(index: number | null, text: string): Promise<BrowserActionResult>;
    paste(index: number | null, text: string, options?: {
        format?: 'text' | 'md' | 'html';
    }): Promise<BrowserActionResult>;
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
export interface BrowserApi {
    listBrowsers(options?: BrowserObservationOptions): Promise<{
        id: string;
        name: string;
        family: string;
        type: string;
    }[]>;
    listTabs(options?: {
        browser?: string;
        emit?: boolean;
    }): Promise<BrowserTabInfo[]>;
    getBrowser(options?: {
        id?: string;
    }): Promise<{
        browserId: string;
        documentation(): Promise<string>;
    }>;
    getTab(reference: string | {
        url: string;
    }, options?: {
        browser?: string;
    }): Promise<BrowserTab>;
    createBrowserTab(id: string, url?: string, options?: {
        visible?: boolean;
        sessionName?: string;
    }): Promise<BrowserTab>;
    dispose(): Promise<void>;
}
export declare function createBrowserApi(options?: BrowserOptions, sink?: BrowserSink): BrowserApi;
