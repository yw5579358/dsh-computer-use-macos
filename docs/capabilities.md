# Capabilities and compatibility

This project supplies an independently written, Codex-style application-control adapter for DeepSeek Harness on macOS. It uses Harness's existing Computer Use services. It does not include OpenAI's Computer Use runtime, browser extension, native helper, or host services, and it does not claim complete compatibility with those products.

## Architecture

- `@deepseek-ai/dsh-cua@0.2.2-rc.1` supplies shared application objects, application consent, and logged tool execution.
- `@deepseek-ai/dsh-experimental-cua-macos@0.2.2-rc.1` supplies macOS observation and input through the upstream `DSH Computer Use.app` helper. Published upstream packages contain prebuilt helpers; their distributed signatures must be preserved.
- This project's adapter supplies its own API ergonomics, target bookkeeping, observation freshness rules, and integration guidance.
- The optional browser adapter uses Playwright 1.65 over an explicitly configured, loopback-only CDP endpoint. A separate browser profile is recommended.

The native provider requires macOS 14 or later. Accessibility and Screen Recording permission belong to the helper application, and must be granted through macOS. Merely enabling this adapter does not grant either permission.

## Native application surface

The following is the adapter surface. Verification levels distinguish actual desktop effects from wrapper-unit tests; see the dated test report. Upstream support is not evidence that every target application will accept an action.

| Capability | Behavior and boundary | Release verification |
| --- | --- | --- |
| Application discovery | Discover applications and resolve an explicit application identity. Ambiguous selections must be rejected. | Upstream support; wrapper discovery tested with controlled responses |
| Application selection | Bind the approved application; upstream consent and process ownership checks remain in force. | Owned fixture PID/ownership verified; Host consent UI not E2E-tested |
| Accessibility observation | Read the selected application's window tree, including supported actions and editable attributes. | Live owned AppKit fixture: passed |
| Window screenshot | Capture the selected application window by default, rather than the entire desktop. | Live window PNG/geometry: passed |
| Combined observation | Return AX text and a screenshot for the selected target. They are sequential observations, not an atomic desktop transaction. | Facade implementation; not separately exercised live |
| Indexed click | Address an element from a fresh AX observation; use the backend's semantic or pointer route. | Live independent button counter: passed |
| Coordinate click | Address points in the returned target screenshot, including the title bar. Coordinate conversion is backend-owned. | Live independent button counter: passed |
| Drag and scroll | Send bounded pointer actions to the selected window. | Live scroll offset: passed; drag is facade-tested only |
| Keyboard input | Send text and supported key chords to the selected application's focus. | Live focused Cmd+A and Unicode input/readback: passed; pure background input unqualified |
| Editable values | Replace a writable AX value; unsupported controls must produce a failure. | Live Unicode value and independent readback: passed |
| Text selection | Select a unique literal match, or place the caret before or after it, where the control supports selection. | Live emoji literal match and UTF-16 selection readback: passed |
| Secondary AX action | Invoke an action exposed by the observed element. | Facade arguments tested; target-app support not universally qualified |
| Paste | Use the native provider's paste operation and clipboard-ownership safeguards. | Live plain text and numeric-reference HTML fragment: passed with all clipboard representation digests restored; raw Unicode HTML has a known AppKit encoding limitation |
| Freshness | Require a new AX observation after native actions before another indexed native action. | Facade + live obsolete native snapshot rejection: passed |
| Cancellation | Propagate cancellation and dispose plugin-owned resources through Harness and the upstream provider. | Host/browser tests passed; native partial-input cancellation not qualified |

An input result can confirm dispatch while the target application ignores it. Always observe the resulting UI before claiming a task succeeded. In particular, arbitrary canvas applications and custom text controls can have incomplete AX support.

## Browser surface

The optional browser path is a CDP integration, separate from native application control. Its intended scope is tab discovery/selection, navigation, screenshots, DOM/locator observation and interaction through the configured endpoint. Each exposed operation must be tested before its release status is marked verified.

The endpoint must be explicitly selected and bound to loopback. The plugin does not discover or attach to every browser on the machine. Existing user profiles require explicit authorization. Prefer a new, isolated profile containing only the accounts and sites required for the task.

| Feature | Scope |
| --- | --- |
| Native control of a browser window | Available through the native app path, subject to its normal limitations; this does not provide a browser DOM API. |
| Playwright/CDP browser control | Optional loopback endpoint; real Chrome and Host-route integration tests passed. |
| Existing signed-in profile | Explicit user authorization required; no automatic profile reuse. |
| OpenAI Chrome/Edge extension sessions | Not integrated. |
| Browser history access | Not supported. |
| WebMCP discovery and calls | Not supported. |
| ChatGPT in-app browser and MCP app panels | Not integrated. |

## Deliberate compatibility gaps

- **Locked desktop:** unsupported. Unlock macOS normally before continuing. The plugin does not install an authorization plug-in or bypass the lock screen.
- **Background input:** app and OS dependent. AX observations/actions can differ from keyboard, clipboard and pointer interactions. Do not assume that every operation works without foreground activation.
- **Stage Manager and Spaces:** background windows can become thumbnails or unavailable. Full-window screenshots and coordinate input are not guaranteed in that state.
- **AX diffs:** the upstream macOS provider does not promise Codex's AX-diff behavior. A full observation is the reliable reference.
- **Protected fields:** do not extract passwords or secrets from secure inputs. This is a task and usage constraint; the adapter is not a general-purpose screen-redaction or data-loss-prevention system.
- **Unassociated system panels and accessory-only apps:** subject to upstream provider limitations.
- **Multiple monitors:** no cross-monitor qualification is claimed until tested. Screenshot scaling, window motion and target ownership must be verified on actual hardware.
- **Host product features:** Codex Appshots, picture-in-picture, remote-device control, proprietary tab mentions and host-specific permission UI are not reproduced.
- **Platform support:** this package targets macOS. A successful mocked test on Linux does not establish native macOS behavior, and an Apple Silicon test does not establish Intel support.

See [security](security.md), [research](research.md), and the release's test report for the evidence behind supported claims.
