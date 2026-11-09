# Changelog

## 0.1.1 — 2026-11-09

- Report `browserConfigured` from the real Host configuration in the bootstrap tool, without opening a browser.
- Include a dedicated Chrome launcher with a persistent separate profile, loopback-only debugging and foreign-port refusal.
- Explain Desktop JSON-index installation and PTC defaults; correct the rejected `--profile desktop` CLI examples.
- Expand DOM setup/troubleshooting documentation and distinguish native-only capabilities from the browser tool.
- Fix completed Desktop conversations retaining the browser lease: release on idle, allow later reacquisition, preserve marked tabs and reject stale tab references across connection generations.
- Validate real Desktop DOM fill/click/readback, a Host-admitted screenshot and browser reuse from a second conversation; rerun 44 automated tests and 12 native fixture checks.

## 0.1.0 — 2026-11-06

Initial community preview for macOS 14+ and DeepSeek Harness 0.2.2-rc.1.

- Compose the official signed native CUA provider without copying or re-signing it.
- Add an original app/window compatibility facade with current-tool dispatch, click aliases and observation freshness.
- Add a Host bootstrap tool so PTC imports resolve the actual installed bridge files.
- Add opt-in loopback CDP browser control, declarative locator transport, Agent ownership, screenshot admission and safe detach.
- Include unit tests, real Chrome/Host integration tests, an owned AppKit native fixture, CI, bilingual instructions and explicit capability boundaries.

Locked-desktop automation, OpenAI's extension/profile integration, Appshots, browser-history authorization, WebMCP and file-transfer transport are not included.
