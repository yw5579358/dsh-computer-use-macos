# Third-party notices

The MIT license at the repository root covers this project's original contributions. Dependencies and upstream native applications retain their respective licenses, copyright notices and distribution requirements. This document is not a replacement for the licenses included in installed dependencies.

## DeepSeek Harness Computer Use

This adapter uses the following upstream packages at version `0.2.2-rc.1`:

- `@deepseek-ai/dsh-cua`: shared application objects, application consent and logged execution.
- `@deepseek-ai/dsh-experimental-cua-macos`: macOS native observation and input, including the upstream distributed helper.

Source: https://github.com/deepseek-ai/deepseek-harness

License: MIT. The upstream repository's notice is reproduced below:

> MIT License
>
> Copyright (c) 2026 DeepSeek
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

The upstream macOS provider documents adaptations of MIT-licensed Cua Driver behavior and provides native provenance and additional notices through its source/distribution. Preserve all notices included by that upstream package. This adapter does not relabel the helper as original work and does not replace its distributed signature. Any future vendoring or redistribution of upstream native source, binaries or icons must include the applicable component notices and an explicit provenance inventory.

## Playwright

The optional CDP browser integration uses Playwright 1.65.

- Source: https://github.com/microsoft/playwright
- License: Apache License 2.0; see the installed package's `LICENSE` and any `NOTICE` file.
- License text: https://github.com/microsoft/playwright/blob/main/LICENSE

Playwright and any browser executable are separate components. Browser engines have additional notices and distribution conditions. Do not remove these when producing a bundled distribution.

## OpenAI references

OpenAI's public Computer Use documentation informed a behavioral comparison. This project does not distribute OpenAI's proprietary Computer Use implementation, native helper, browser extension, private SDK or branding assets. Product names are used only to identify the compared workflow; this project is not an official OpenAI or DeepSeek product.

## Release inventory

The lockfile and published package contents determine the exact dependency inventory. The 0.1.0 production-only tarball installation contained 41 installed packages, including this plugin: 39 declared MIT and two declared Apache-2.0 in package metadata, with none missing a license declaration. Dependencies are installed separately rather than vendored into this tarball, retaining their package notices. This metadata check is not an exhaustive audit of every file or browser binary. Recheck the inventory and preserve applicable notices whenever dependencies change.
