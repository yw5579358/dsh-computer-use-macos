# Security policy

This plugin can observe application windows and send real desktop input. Scope/consent bypasses, unsafe target selection, stale-reference actions, exposed debugging endpoints, secret leakage and compromised release artifacts are security concerns.

## Supported releases

Security fixes are maintained for the newest published release. Prereleases are experimental; use the dependency versions and platform limits recorded in that release. Older releases should be upgraded before a fix is expected to be backported.

## Report a vulnerability

Use the repository's **Security → Report a vulnerability** private reporting flow when it is available:

https://github.com/yw5579358/dsh-computer-use-macos/security/advisories/new

If private reporting is unavailable, open a public issue asking the maintainer to establish a private reporting channel. Do not put exploitation details, private screenshots, passwords, tokens, session logs or personal application data in that issue.

Provide privately:

- Affected plugin, Harness, native-provider, macOS and browser versions.
- Whether the issue requires a preexisting permission grant or signed-in session.
- Minimal reproduction using a synthetic application/page fixture.
- Expected and observed behavior, impact, and a suggested fix if available.

Please allow time for triage and a coordinated fix before public disclosure. Response and remediation depend on maintainer availability; no fixed response-time guarantee is made.

## Boundaries

The plugin cannot undo arbitrary input already accepted by an application. It is not a secret-redaction or DLP system. TCC and user consent are required, and locked-screen use is unsupported. See [the detailed security model](docs/security.md).

Issues in upstream Harness, its native helper, Playwright, macOS or a browser may also require an upstream report. Coordinate disclosure without forwarding personal data or credentials.
