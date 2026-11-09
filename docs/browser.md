# Optional browser control

Browser operations are disabled by default. This plugin does not discover, launch or reconfigure the user's everyday Chrome profile. A CDP connection has authority over every page in its browser, not just one site. Use an isolated profile and keep the debugger bound to loopback.

## Start the dedicated browser

The package includes a macOS launcher. After Desktop installation:

```sh
"$HOME/.dsh/profiles/desktop/node_modules/dsh-computer-use-macos/scripts/start-browser.command"
```

It starts the installed `/Applications/Google Chrome.app` with a separate persistent profile at `$HOME/.dsh/browser-dom/profile`, a new window, and debugging on **127.0.0.1:9222 only**. If that listener belongs to the dedicated profile it reports already running; if it belongs to another process, it stops without attaching or terminating anything. Set `DSH_BROWSER_RUNTIME_DIR` to an absolute directory to choose a different dedicated profile root. It neither installs software nor modifies Harness settings. Closing Chrome ends the connection; run the launcher again when needed. It does not install a login daemon.

Sign in in this separate browser yourself if a task needs a login. Its login state is independent of everyday Chrome. [Chrome requires a non-default data directory for remote debugging](https://developer.chrome.com/blog/remote-debugging-port).

For another port/profile, start Chrome explicitly and match the endpoint in the configuration:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
  --user-data-dir="/private/tmp/dsh-computer-use-browser-profile"
```

Never expose CDP to the LAN or put credentials in the endpoint URL.

## Enable the Host tool

In your profile's `cordis.patch.yml`, override this plugin row. This is an explicit grant to connect to that browser:

```yaml
- id: macos-computer-use-compat
  name: dsh-computer-use-macos
  config:
    configuredCDPEndpoint: http://127.0.0.1:9222
    browserTimeoutMs: 15000
    browserMaxElements: 400
```

Save and open a **new PTC conversation**; reload/restart the host when hot reload is unavailable. The Host registers `computer_browser` only when an endpoint is configured. These calls then use the normal Harness tool policy, cancellation and logging. The browser is exclusively reserved for one running Agent, with state isolated by exact Agent identity. When that Agent becomes idle, its connection and unretained temporary tabs are cleaned up, so a different conversation can connect.

In persistent PTC mode:

```js
const entry = await tools.computer_use_bootstrap({})
if (!entry.browserConfigured) throw new Error('Configure the Host CDP endpoint first')
const { connectUnifiedComputerUse } = await import(entry.nativeBridgeUrl)
const cua = connectUnifiedComputerUse(
  () => tools.cua,
  () => tools.computer_browser,
  { text: value => console.log(value) },
)
await cua.getState()
const tab = await cua.createBrowserTab('chromium', 'http://localhost:3000')
await tab.playwright.getByRole('button', { name: 'Continue', exact: true }).click()
await tab.getAXState()
await tab.getScreenshot() // Host emits one model-aware image attachment.
```

Alternatively import `connectBrowser` from `dsh-computer-use-macos/browser-bridge`. The semantic locator facade offers roles, labels, text, placeholders, test IDs, selectors, frames, filters and common named read/input operations. It deliberately has no arbitrary `evaluate`, raw CDP, extension management, history database, WebMCP, upload/download transport or cookie API. Use the native app API for a visible file dialog when appropriate. These gaps are listed in the capability matrix.

AX-like browser snapshots are bounded DOM observations, not a complete accessibility tree. Password input values are redacted in that snapshot; screenshots and other explicitly requested page text can still contain sensitive visible content. Treat page text as untrusted. Read after input; stale numeric elements are rejected. Prefer semantic locators.

Browser screenshot coordinates refer to the model-projected screenshot, mapped by the Host to CSS pixels. A resize invalidates the map. Captures above the adapter's 16-megapixel or 16-MiB bounds are rejected.

Call `markDeliverable()` or `markHandoff()` before ending a turn when a plugin-created tab should remain visible. An idle Agent releases its lease. On a later turn, reselect by exact URL or a fresh `listTabs()` id; old tab objects and numbered observations expire. Connection generations use distinct tab ids to prevent an old reference from silently addressing a new page. Cleanup closes only plugin-created, unretained tabs and disconnects the CDP transport; it does not close the external browser or original tabs. The lifecycle API refuses to close original tabs, although page controls can themselves navigate or close pages; review consequential input before approving it.

The `dsh-computer-use-macos/browser` export exposes the underlying developer adapter for tests/embedding. Model tasks must use the Host bridge above, not direct CDP calls that bypass per-tool policy and logging.

## Check the connection

`computer_use_bootstrap({}).browserConfigured` means an endpoint was configured and accepted; it does not probe Chrome. The native-only `getCapabilities().browser` stays `false` because that provider has no DOM API; this does not mean the separate browser tool is disabled.

In a new PTC conversation, use the Host browser bridge to call `getBrowser()` or `listTabs()` and inspect a synthetic local page. Verify a fill/click from the page's resulting text, not just a dispatched flag. A screenshot needs a model route declaring image input. Keep tool execution within the normal approval, logging and attachment pipeline.

- Connection refused: run the launcher and check the configured endpoint matches it.
- No `computer_browser` tool: confirm the plugin row and endpoint, then create a new PTC conversation.
- Browser already reserved: let the other running Agent finish or stop it before taking over that endpoint. Idle Agents no longer reserve the browser.
- Desktop locked: unlock normally for native UI/setup work; the plugin does not supply locked-desktop control.
