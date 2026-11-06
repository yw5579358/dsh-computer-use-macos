# Contributing

Contributions should improve independently implemented macOS computer use for DeepSeek Harness. Please read the [capability boundaries](docs/capabilities.md), [security model](docs/security.md), [Code of Conduct](CODE_OF_CONDUCT.md) and [security reporting policy](SECURITY.md) first.

## Before opening a change

- Search existing issues and pull requests for related work.
- For a new native permission, browser attachment mechanism, input backend or public API change, open a focused design issue first.
- Describe the user-visible problem, expected behavior and affected macOS/Harness versions.
- Use a synthetic fixture. Do not attach screenshots of private documents, logged-in accounts, secrets or a personal full desktop.

## Development and tests

Use the Node version declared by `package.json`. Install the locked dependency set with `npm ci`, then run the repository's build, type-check and test scripts as declared in `package.json`.

Native integration requires macOS 14 or later, an unlocked desktop, and normal user-granted Accessibility/Screen Recording permissions for the upstream helper. Do not change TCC databases, disable macOS protections or use a personal application account as an automated test fixture.

Separate tests into:

1. Adapter/schema/error tests that can run without desktop permissions.
2. Browser fixture tests using an isolated, loopback CDP browser profile.
3. Native fixture tests on a real logged-in Mac.
4. Harness/model end-to-end tests, when a configured model and user approval are available.

Record the commands run and their results. Label permission-denied, unavailable-hardware and manual tests honestly; a skipped native test is not a pass. Check cancellation, stale target references, clipboard races and input readback as well as the happy path.

## Pull requests

- Keep a change focused and preserve unrelated settings and application state.
- Explain the concrete before/after behavior, tests, platform coverage and limitations.
- Include regression tests for meaningful bugs, particularly scope validation and security boundary failures.
- Update public API documentation and the capability matrix when behavior changes.
- Include license notices for new third-party code or assets. Never copy proprietary runtime implementations or distribute private helper binaries.
- Do not commit credentials, personal paths, local captures, browser profiles, session logs or generated native build products unless an explicit distribution process requires them.

Changes may be requested or declined when support claims exceed evidence, required tests are missing, or a design weakens authorization boundaries.

## Upstream compatibility and distribution

Harness rc packages may change together. Upgrade related peer dependencies coherently and test the real host composition. Preserve distributed native-helper signatures and upstream notices. If a release includes a source-built helper, document the signing and notarization process and test its startup on a clean account.

Before a public release or community listing, verify package contents, installation instructions, license inventory and secret scans, and publish a test report with the exact supported versions. Do not claim official OpenAI or DeepSeek endorsement.

By submitting an original contribution, you agree that it may be distributed under this repository's [MIT license](LICENSE). You must have the right to contribute the code and materials you submit.
