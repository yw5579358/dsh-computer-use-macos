import type { Context } from '@deepseek-ai/cordis';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
/** Browser access is opt-in and fixed by the host; tool arguments cannot select an endpoint. */
export interface BrowserHostConfig {
    configuredCDPEndpoint?: string;
    browserTimeoutMs?: number;
    browserMaxElements?: number;
}
export interface BrowserRequest {
    method: string;
    params: Record<string, JsonValue>;
}
export interface LocatorStep {
    method: string;
    args: JsonValue[];
}
export interface LocatorRequest {
    steps: LocatorStep[];
    action: LocatorStep;
}
export interface BrowserScreenshotAdmission {
    prepare(signal: AbortSignal): Promise<void>;
    admit(bytes: Uint8Array, signal: AbortSignal): Promise<JsonValue>;
}
/** Admit only declarative locator builders and named operations; no evaluate or code fields exist. */
export declare function validateLocatorRequest(value: unknown): LocatorRequest;
/** Fill omitted locator timeouts and reject attempts to exceed the Host's operation budget. */
export declare function boundLocatorTimeout(request: LocatorRequest, timeoutMs: number): LocatorRequest;
/** Validate the wire envelope before creating any browser connection. */
export declare function parseBrowserRequest(value: unknown): BrowserRequest;
/** One explicitly configured browser is exclusively owned by one exact live Agent. */
export declare class BrowserToolDispatcher {
    private readonly config;
    readonly enabled: boolean;
    private readonly endpoint;
    private readonly timeoutMs;
    private readonly resources;
    private readonly retired;
    private activeOwner;
    private closed;
    constructor(config: BrowserHostConfig);
    dispatch(value: unknown, owner: object, signal: AbortSignal, screenshot?: BrowserScreenshotAdmission): Promise<JsonValue>;
    private run;
    /** Idle ends the lease, not the Agent. A later turn may claim a fresh connection. */
    releaseOwner(owner: object): Promise<void>;
    disposeOwner(owner: object): Promise<void>;
    private closeOwner;
    dispose(): Promise<void>;
}
/** Images are rendered once as durable attachments; encoded source bytes never enter text. */
export declare function renderBrowserResult(_args: unknown, value: JsonValue): ({
    type: "text";
    text: string;
    attachment?: never;
} | {
    type: "image";
    attachment: ImageAttachmentRef;
    text?: never;
})[];
/** Register the optional browser tool in the Host's normal approval and logging pipeline. */
export declare function installBrowserTool(ctx: Context, config: BrowserHostConfig): void;
