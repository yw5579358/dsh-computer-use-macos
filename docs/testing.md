# Validation report — 0.1.0

Date: 2026-11-06 (Asia/Shanghai). This report distinguishes adapter tests, real browser tests, native-helper tests and Host/model loading. Upstream source support is not a local test result.

## Environment

- macOS 26.6.1, Apple Silicon
- Node.js 24.13.0; Playwright 1.65.0
- DeepSeek Harness and official CUA/macOS provider: 0.2.2-rc.1
- Existing Apple Swift 5.8.1 builds only the owned AppKit fixture; the official Swift 6 helper is precompiled.
- Gatekeeper `spctl --assess --type execute` passed. Official helper signature validated with `codesign --verify --deep --strict` in a non-cloud temporary directory. Documents File Provider metadata initially caused strict verification to reject the extracted `.app`; copying unchanged file contents and permissions to a local temporary directory, without the extra Finder metadata, verified successfully. No re-signing or Gatekeeper disabling was performed.

## Commands and results

| Check | Result | What it establishes |
| --- | --- | --- |
| `npm run check` | Pass: TypeScript, 41 Node test cases, build; 0 skips | Argument mapping, freshness, browser ownership and cancellation, real CDP and Host-declarative browser route |
| `npm exec --package=publint -- publint` | Pass | Package entry/type/export hygiene |
| Harness `dsh plugin ... add link:...` and `--dump-config` | Pass in an isolated matching-version profile | Bundle composition and engine compatibility |
| Actual headless PTC model call | Pass: `HARNESS_PLUGIN_OK`, `platform: macos`, both permission flags true | Real `computer_use_bootstrap` → installed module import → current `tools.cua` → native capabilities |
| Native owned-window smoke | Pass: 12 checks | Actual AX/coordinate button effects, Unicode values and focused keyboard input, literal selection, plain/HTML-fragment paste with clipboard restoration, stale snapshot rejection, PNG and scroll offset |
| Production-only tarball installation/import | Pass: clean prefix, `--omit=dev --ignore-scripts`, root and all bridge/library exports, installed bootstrap URLs | Runtime imports work without the source checkout or dev dependencies |

The headless test profile explicitly enabled the PTC executor and credentials store; its template normally disables them. It registered CUA globally (`agentPreset:false`) only because that standalone profile has no preset registry. The shipped bundle retains the documented `agentPreset:ptc`. No daily Desktop profile was modified.

## Real browser coverage

The tests start owned headless Chrome with a fresh temporary profile and a local HTTP fixture. They verify actual DOM values and counters, not only dispatched flags:

- Structured DOM snapshots and password-value redaction in that snapshot.
- Semantic fill/click, stale numeric index rejection and fresh observations.
- PNG capture, screenshot bounds and oversized capture rejection.
- Back/forward including BFCache, explicit URL/tab selection.
- Existing-tab close refusal; temporary-tab cleanup; retained/handoff pages and external browser process survive detach.
- Host locator allowlist rejects executable requests.
- Host screenshot projection maps model pixels back to CSS pixels; resize, explicit navigation and re-selection invalidate old coordinates.
- Locator waits obey the Host timeout, including omitted timeouts; zero/unlimited and larger client budgets are rejected.
- Cancellation settles a pending locator and cleans only owned resources.

The Host browser screenshot tests supply a controlled admission seam; they are not a live-provider image-token billing test.

## Native controlled fixture

Run manually with the official helper and user-granted permissions:

```sh
npm run test:native -- --helper '/absolute/DSH Computer Use.app/Contents/MacOS/dsh-cua-native' --artifacts /private/path/to/test-results
```

Missing permissions or a locked desktop produce **blocked / exit 77**, never pass. The script owns its AppKit process and writes synthetic state independently of helper replies. Its window screenshot contains only the synthetic fixture.

The 12 checks include fixture compilation, AX tree, AX-button counter, obsolete-snapshot rejection, Unicode value/readback, scoped PNG geometry, coordinate-button counter, focused Cmd+A/Unicode typing, emoji selection/UTF-16 range, plain paste/restoration, HTML-fragment paste/restoration and changed scroll offset. Clipboard verification compares all representation/type digests in the owned fixture without writing clipboard contents.

Keyboard/paste tests explicitly activate the owned fixture first. The passing HTML input uses numeric Unicode character references. Earlier raw Unicode fragments produced AppKit encoding corruption, and a complete HTML document did not complete input in that NSTextField. General Unicode/rich-HTML compatibility is **not** established; use plain text or test an encoded fragment against the intended control.

![Synthetic native test window](images/native-fixture.png)

Native direct-helper testing is not an end-to-end test of Harness's application-consent UI or revocation across multiple processes. No private desktop screenshot, user clipboard content, account credential, session log, or browser profile is published.

## Limits of validation

- Tested on Apple Silicon only; an Intel helper is provided upstream but not executed here.
- No multi-monitor/Spaces/Stage Manager qualification or locked-desktop support.
- Arbitrary third-party app controls, exceptional clipboard representations, every secondary AX action, pointer hover/holds, dragging and drag cancellation need app-specific testing.
- First-run consent/revocation UI and browser site permissions are not certified by these tests.
- The user's older 0.2.1-rc.5 Desktop installation is not a tested target. Upgrade to the documented runtime or use an isolated matching-version profile.
