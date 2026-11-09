# Computer Use for DeepSeek Harness on macOS

[简体中文](README.zh-CN.md) · [Browser setup](docs/browser.md) · [Test report](docs/testing.md)

Control Mac applications and web pages from a Harness conversation. Start a PTC session, describe the target and the action, and the model can inspect the interface, operate it, and read back the result.

The interaction pattern follows [Codex Computer Use](https://learn.chatgpt.com/docs/computer-use): select an application or tab, observe its state and screenshot, act, then observe again. Applications and windows are exposed as objects that can be used across calls in a persistent PTC execution.

Native operations use [DeepSeek Harness's macOS CUA provider](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/experimental/cua-macos) (`@deepseek-ai/dsh-cua` and `@deepseek-ai/dsh-experimental-cua-macos`) for accessibility, window capture and input. Browser operations use [Playwright over CDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp) to address elements by role, label and text in a dedicated Chrome profile.

This plugin brings those pieces together with an app/window API, installed-module loading for PTC, observation freshness checks, browser connection management and screenshot delivery. Calls use Harness's existing authorization, logging and attachment pipeline.

## What you can do

**Mac applications:** select apps and windows, read accessibility trees, capture a window, click, enter Unicode text, send shortcuts, scroll, select text and paste.

**Web pages:** read page content, fill inputs, click buttons, extract tables, locate DOM elements and capture the current viewport.

When a task becomes idle, the browser connection is released for the next conversation. Pages marked as deliverables or handoffs stay open for the user.

Version `0.1.1` was exercised in the actual Harness Desktop application: Chinese form input, button clicks, result readback, screenshots and browser reuse across conversations. **44 automated tests** passed locally and in GitHub CI, alongside **12 native desktop checks**. The [test report](docs/testing.md) records the environment and results.

## Install

Requirements:

- macOS 14+
- DeepSeek Harness `0.2.2-rc.1`
- Node.js 24.9+; an image-capable model for screenshots
- Accessibility and Screen Recording permissions for `DSH Computer Use.app`

### Desktop

1. Open **Plugins** and enable the experimental **Custom plugin indexes**.
2. Open **Discover** and add the JSON URL below.
3. Select **Computer Use for macOS**, review the version and source, then choose **Install → Enable now**.
4. Select **PTC mode** under **Settings → Agent presets**, then start a new conversation.

```text
https://raw.githubusercontent.com/yw5579358/dsh-computer-use-macos/codex/initial-release/plugin-index.json
```

The Desktop **Add plugin** dialog also accepts a tarball from [Releases](https://github.com/yw5579358/dsh-computer-use-macos/releases). Each index version points to a specific Git commit, and built `lib/` files are included in the repository.

To update a third-party plugin, back up the profile configuration, then uninstall the old version and install the new one in Desktop. Existing conversations keep their previous preset.

### CLI profile

For a separate CLI profile:

```sh
dsh plugin --profile computer-demo add ./dsh-computer-use-macos-0.1.1.tgz
dsh --profile computer-demo --dump-config
```

Desktop manages its own `desktop` profile through the app's plugin page. Use one native Computer Use provider per profile.

## Ask Harness to operate an app or page

Native application:

```text
Use Computer Use to open Calculator, calculate 123 × 456, and report the result shown in the window.
```

```text
Open TextEdit with Computer Use. Create a document titled “Weekly plan” with three action items. Leave the window open for me to review.
```

Browser DOM:

```text
Use browser DOM control to open http://localhost:3000, check the navigation links and main buttons, and capture the result. Leave the tab open for review.
```

```text
Use browser DOM control to open the dashboard I specify. After I sign in, read the visible table and count records by status.
```

Replace the app, URL and task with your own. Ask Harness to **leave the tab open for review** when you want to keep a page after the task.

## Enable browser DOM control

Start the dedicated Chrome instance:

```sh
"$HOME/.dsh/profiles/desktop/node_modules/dsh-computer-use-macos/scripts/start-browser.command"
```

The launcher stores browser data in `$HOME/.dsh/browser-dom/profile` and exposes the debugging connection at `127.0.0.1:9222`. Sign in to sites in that window when needed. Run the launcher again after closing the browser.

Add this row to the profile's `cordis.patch.yml`:

```yaml
- id: macos-computer-use-compat
  name: dsh-computer-use-macos
  config:
    configuredCDPEndpoint: http://127.0.0.1:9222
    browserTimeoutMs: 15000
    browserMaxElements: 400
```

Save and start a new PTC conversation. The [browser guide](docs/browser.md) covers configuration, retained pages and connection troubleshooting.

## Call the API from PTC

Native application:

```js
const entry = await tools.computer_use_bootstrap({})
const { connectComputerUse } = await import(entry.nativeBridgeUrl)
const cua = connectComputerUse(() => tools.cua, {
  text: value => console.log(value),
})
const app = await cua.getApp('Calculator')
await app.getAXState()
// Use an elementIndex from this observation.
await app.click(elementIndex)
await app.getAXState()
```

Browser:

```js
const { connectBrowser } = await import(entry.browserBridgeUrl)
const browser = connectBrowser(() => tools.computer_browser)
const tab = await browser.createBrowserTab('chromium', 'http://localhost:3000')
await tab.playwright.getByRole('button', { name: 'Continue', exact: true }).click()
await tab.getAXState()
await tab.markHandoff()
```

The getter resolves the current tool binding on each call. Read fresh state after input. Reselect browser tabs when resuming after an idle boundary. Harness delivers screenshots to the model as attachments.

## Development and documentation

```sh
npm ci --ignore-scripts
npm run check
npm pack
```

Browser tests use temporary Chrome profiles and local fixture pages. Native tests use an owned AppKit window.

- [API and capabilities](docs/capabilities.md)
- [Browser configuration](docs/browser.md)
- [Validation report](docs/testing.md)
- [Sources and design](docs/research.md)
- [Contributing](CONTRIBUTING.md)
- [Security](docs/security.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## Remove

In Desktop, open the plugin details and choose **Uninstall**. For a separate CLI profile:

```sh
dsh plugin --profile computer-demo remove dsh-computer-use-macos
```

Manage macOS permissions in System Settings and saved application grants in Harness's Computer Use permissions page.

## License

[MIT](LICENSE)
