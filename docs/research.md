# Design research and provenance

Research date: 2026-11-06. This document describes public product behavior, open-source integration points, and independently written adapter design. It contains no copied OpenAI implementation, private runtime, credentials, personal captures or user-specific paths.

## Sources

| Source | What it establishes |
| --- | --- |
| [OpenAI Computer Use documentation](https://learn.chatgpt.com/docs/computer-use) | App observation/input, macOS permissions, background-operation positioning, and the distinct locked-use feature. |
| [OpenAI browser extension documentation](https://learn.chatgpt.com/docs/chrome-extension) | Browser profiles, extension-connected control, site permissions, and browser history authorization are a separate product integration. |
| [DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness) | The community plugin architecture and the upstream license. |
| [Shared Harness CUA service](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/experimental/cua) | Application object API, consent and logged execution. |
| [Harness macOS provider](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/experimental/cua-macos) | Native app/window observation and input, helper distribution, permission guidance and known limitations. |
| [Playwright documentation](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp) | Attaching to an explicitly provided Chromium CDP endpoint; the browser path does not depend on OpenAI's extension. |

Web documentation can change. Recheck it when upgrading a dependency or revising a compatibility claim.

## Versions selected for this design

- Shared Harness service: `@deepseek-ai/dsh-cua@0.2.2-rc.1`.
- Native provider: `@deepseek-ai/dsh-experimental-cua-macos@0.2.2-rc.1`.
- Browser client: Playwright 1.65.
- Minimum native OS: macOS 14.

The upstream macOS provider's `cua-helper.json` records helper provenance, supported architectures and digests. The inspected rc.1 manifest identifies upstream commit `c59d10aff167ad7eefead4b3a9082fb57c8fbfe8`. This records upstream provenance; it does not mean this adapter has independently tested every architecture or verified every runtime property of that helper.

## Decisions

### Reuse the upstream native provider

Harness already provides app-scoped AX observation, screenshots, input, application consent and permission guidance. Reusing that implementation preserves its established integration and distributed helper signature instead of introducing a second native driver. This project's original work is the adapter layer and optional browser connection, not a replacement Swift helper.

The macOS provider's upstream documentation notes application-dependent background behavior, Stage Manager limits, and the possibility that an input dispatch succeeds while the application ignores it. Tests must observe resulting state rather than treating dispatch as task success.

### Reproduce a workflow, not a proprietary host

The intended workflow is: select an explicit target, observe AX or screenshot state, perform a bounded action, then observe again. The adapter requires a new AX observation after native actions before another indexed action.

OpenAI's product also integrates a browser extension, an in-app browser, cross-device controls, Appshots and locked-use. Those features are not supplied by this adapter. In particular, the locked-use authorization flow is not implemented and must not be simulated through a lock-screen bypass.

### Keep native and browser capabilities separate

Native UI control of a browser window is useful but does not provide a DOM or stable tab identity. The optional Playwright adapter therefore connects only to an explicitly configured loopback CDP endpoint. An isolated browser profile is recommended, and existing-profile reuse needs explicit user authorization.

The first implementation does not integrate OpenAI's existing browser extension, browser history access or WebMCP. See the full [capability matrix](capabilities.md).

### Preserve host ownership

Harness owns model sessions, permissions, consent interactions and tool history. The adapter must not create a hidden approval bypass or treat tool execution as authorization for a more consequential downstream action. macOS TCC permission is an additional requirement, not a substitute for user intent.

## Evidence levels and pending work

- **Documented upstream:** behavior described in the cited public provider/product documentation.
- **Implemented adapter:** a code path present in this repository; this alone does not establish runtime success.
- **Unit-tested:** a named automated test has passed against the adapter or a controlled fixture.
- **Native integration-tested:** a real, logged-in Mac executed the operation with TCC permission and observed the expected result.
- **End-to-end tested:** Harness and the intended model completed the fixture workflow, with observable results.

Release 0.1.0 verification is recorded in the dated [validation report](testing.md), with exact versions, architecture, real browser/native results and remaining limitations. Re-run relevant checks for each release; mocked results do not establish native support.

## Publication rules

Publish original adapter source, reproducible package metadata, documentation, tests and notices. Keep all third-party license and provenance requirements intact. Do not include private local research files, OpenAI runtime artifacts, credentials or personal desktop screenshots. See [third-party notices](../THIRD_PARTY_NOTICES.md).
