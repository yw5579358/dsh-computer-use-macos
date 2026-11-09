# Computer Use for DeepSeek Harness on macOS

[简体中文](README.zh-CN.md) · [Capabilities](docs/capabilities.md) · [Security](SECURITY.md)

An independent community plugin with a familiar app/window API, native macOS accessibility and screenshots, and opt-in Chromium DOM automation. Native execution uses the official MIT-licensed DeepSeek Harness CUA provider; this project adds an original compatibility facade and a browser adapter. It contains no OpenAI implementation code and is not affiliated with OpenAI or DeepSeek.

**This is not a complete clone of Codex's private runtime.** Locked-desktop control, OpenAI's browser extension and signed-in profile integration, Appshots, browser-history authorization, and WebMCP are not supplied. See the capability matrix before installation.

## Requirements

- macOS 14 or newer, Apple Silicon or Intel; an unlocked desktop.
- Node.js 24.9+ and DeepSeek Harness **0.2.2-rc.1** (the tested prerelease).
- A model route declaring image input for screenshots.
- Accessibility and Screen Recording permissions for the official `DSH Computer Use.app`, followed by Harness's separate app-consent prompts.
- Optional browser control: a browser **you explicitly started** with a loopback CDP listener and a dedicated profile. Browser control is disabled until its endpoint is configured.

The official provider dependency ships signed, precompiled native helpers. This plugin neither recompiles nor re-signs them. Older Harness 0.2.1 profiles are intentionally excluded because their CUA contracts differ.

## Install

### Desktop application

Desktop manages its own profile. In **Plugins**, enable the experimental **Custom plugin indexes**, open **Discover**, and add the [JSON index below](#discover-index). Select this plugin, review the repository and pinned commit, choose **Install**, then **Enable now**. In **Settings → Agent presets**, choose **PTC mode** for new tasks. Existing conversations keep their previous preset.

Alternatively, use the Desktop **Add plugin** dialog to select a reviewed release tarball or pinned Git source. Do not use `dsh plugin --profile desktop`: the CLI intentionally rejects the Electron-managed profile.

### Non-Desktop CLI profiles

For a separate CLI profile:

```sh
dsh plugin --profile computer-demo add ./dsh-computer-use-macos-0.1.1.tgz
# Or replace <commit> with the release's full reviewed SHA:
dsh plugin --profile computer-demo add github:yw5579358/dsh-computer-use-macos#<commit>
dsh --profile computer-demo --dump-config
```

Built `lib/` files are committed; there is no prepare/install script. Enable only one native computer-use provider per profile. The bundle mounts the official provider with `agentPreset: ptc`, preserving its authorization flow. It does not change existing conversations or grant macOS permissions. Restart the host if it does not support hot reload.

## Discover index

For Harness's experimental **Custom plugin indexes**, add this explicitly trusted source:

```text
https://raw.githubusercontent.com/yw5579358/dsh-computer-use-macos/codex/initial-release/plugin-index.json
```

The format-1 index pins the tested plugin source to an immutable commit. This is a self-hosted community index, not an official curated listing.

## Use native apps

In a persistent PTC execution:

```js
const entry = await tools.computer_use_bootstrap({})
const { connectComputerUse } = await import(entry.nativeBridgeUrl)
const cua = connectComputerUse(() => tools.cua, {
  text: value => console.log(value),
})
const app = await cua.getApp('Calculator')
// Initial AX state is emitted automatically. Use an element from that observation.
await app.click(elementIndex)
await app.getAXState()
```

The getter resolves the **current execution's** `tools.cua` every time. Never capture an expired execution's binding. The Host continues to own approval, cancellation, logging, target identity, image admission and saved application consent.

Methods include app discovery, explicit window selection, AX observations, screenshots, click/hover/drag, value replacement, literal text selection, advertised secondary actions, Unicode input, shortcuts, and plain/HTML clipboard paste with the upstream clipboard-preservation semantics.

Important differences from the Codex interface:

- Screenshot results retain `{bytes, mimeType, pixelWidth, pixelHeight, windowId}`; the image is already admitted by the Host. Do not print Base64 or upload it a second time.
- `scroll({x, y, deltaLinesX, deltaLinesY})` uses bounded line deltas. It does not accept page counts or an AX scroll-target index.
- `click(index, {key:'super', durationMs:800})` maps to native modifiers and a bounded click hold.
- AX reads are full observations, not Codex's incremental diff format.
- Keyboard/paste require the intended focus. Raw Unicode HTML has an AppKit encoding limitation in the tested text field; prefer plain text. See the validation report.
- After an input action, **including a failed one**, observe again before further input. Do not automatically retry an uncertain action.

## Optional browser tool

DOM control is already implemented. Start the included `scripts/start-browser.command` launcher, explicitly configure the loopback endpoint, and open a new PTC conversation. The launcher uses a separate persistent Chrome profile and refuses to reuse a foreign listener on port 9222. It does not install a login daemon. `computer_use_bootstrap({}).browserConfigured` reports configuration, not connection health.

Browser configuration and examples are in [the browser guide](docs/browser.md). The supported model path is `computer_browser` through the Harness tool pipeline, with declarative locator operations. Access is opt-in, profile-wide and bounded by Harness's normal tool policy; it is **not** per-domain authorization. CDP can access all tabs in the configured browser, so use an isolated profile.

The lower-level `./browser` export is a developer library for testing or embedding, not a substitute for the Host tool approval pipeline.

## Test and develop

```sh
npm ci --ignore-scripts
npm run check
npm run test:browser
npm pack
```

The browser integration test starts an owned headless Chrome/Chromium process with a temporary profile and a local fixture page. Set `DSH_TEST_CHROME` when the standard macOS Chrome executable is unavailable. It never uses your daily browser profile. Native desktop testing requires explicit system grants and an owned fixture; a mock test does not establish real desktop behavior.

See [validation results](docs/testing.md), [research sources](docs/research.md), [contribution instructions](CONTRIBUTING.md), and [third-party notices](THIRD_PARTY_NOTICES.md).

## Remove

In Desktop, open the plugin details and choose **Uninstall**. For a non-Desktop CLI profile:

```sh
dsh plugin --profile computer-demo remove dsh-computer-use-macos
```

Removal does not revoke macOS TCC permissions or erase upstream Harness application grants. Revoke those separately in System Settings and the Harness CUA permission page. No tokens, personal screenshots, session logs or browser profiles belong in this repository.
