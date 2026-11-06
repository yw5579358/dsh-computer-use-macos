# Optional browser control

Browser operations are disabled by default. This plugin does not discover, launch or reconfigure the user's everyday Chrome profile. A CDP connection has authority over every page in its browser, not just one site. Use an isolated profile and keep the debugger bound to loopback.

For a disposable test browser on macOS, explicitly start Chrome with a dedicated data directory:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
  --user-data-dir="/private/tmp/dsh-computer-use-browser-profile"
```

This creates a separate browser session. Sign in there yourself if a task needs a login. Do not point this command at your normal Chrome profile. Do not expose CDP to the LAN or put credentials in the endpoint URL.

In your profile's `cordis.patch.yml`, override this plugin row. This is an explicit grant to connect to that browser:

```yaml
- id: macos-computer-use-compat
  config:
    configuredCDPEndpoint: http://127.0.0.1:9222
    browserTimeoutMs: 15000
    browserMaxElements: 400
```

Save and reload/restart the profile. The Host registers `computer_browser` only when an endpoint is configured. These calls then use the normal Harness tool policy, cancellation and logging. The browser is exclusively reserved for one live Agent, with state isolated by exact Agent identity.

In persistent PTC mode:

```js
const entry = await tools.computer_use_bootstrap({})
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

`markDeliverable()` and `markHandoff()` retain plugin-created tabs. Cleanup closes only plugin-created, unretained tabs and disconnects the CDP transport; it does not close the external browser or original tabs. The lifecycle API refuses to close original tabs, although page controls can themselves navigate or close pages; review consequential input before approving it.

The `dsh-computer-use-macos/browser` export exposes the underlying developer adapter for tests/embedding. Model tasks must use the Host bridge above, not direct CDP calls that bypass per-tool policy and logging.
