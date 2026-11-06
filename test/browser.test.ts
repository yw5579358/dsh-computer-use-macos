import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserAdapterError, createBrowserApi, validateCdpEndpoint } from '../src/browser.js';

test('CDP is explicit and loopback only, with no credential-bearing endpoints', () => {
  for (const value of ['http://127.0.0.1:9222', 'http://localhost:9222/', 'ws://[::1]:9222/devtools/browser/local']) {
    assert.ok(['127.0.0.1', '[::1]'].includes(new URL(validateCdpEndpoint(value)).hostname));
  }
  assert.equal(validateCdpEndpoint('http://localhost:9222/'), 'http://127.0.0.1:9222/');
  assert.equal(validateCdpEndpoint('http://127.1:9222/'), 'http://127.0.0.1:9222/');
  for (const value of ['', 'chrome', 'file:///tmp/socket', 'https://example.com', 'http://0.0.0.0:9222', 'http://127.0.0.1.evil.example:9222', 'http://user:password@localhost:9222', 'http://127.0.0.1:9222/#secret']) {
    assert.throws(() => validateCdpEndpoint(value), (error: unknown) => error instanceof BrowserAdapterError && error.code === 'INVALID_CDP_ENDPOINT');
  }
});

test('unconfigured browser remains unavailable and never silently launches a profile', async () => {
  const browser = createBrowserApi();
  assert.deepEqual(await browser.listBrowsers({ emit: false }), []);
  await assert.rejects(browser.listTabs(), /BROWSER_NOT_CONFIGURED/);
  await assert.rejects(browser.createBrowserTab('chromium'), /BROWSER_NOT_CONFIGURED/);
  await browser.dispose();
  await assert.rejects(browser.getBrowser(), /BROWSER_DISPOSED/);
});

test('browser IDs and resource bounds reject before any connection', async () => {
  assert.throws(() => createBrowserApi({ timeoutMs: 0 }), /INVALID_ARGUMENT/);
  assert.throws(() => createBrowserApi({ maxElements: 2001 }), /INVALID_ARGUMENT/);
  assert.throws(() => createBrowserApi({ maxElements: 2.5 }), /INVALID_ARGUMENT/);
  assert.throws(() => createBrowserApi({ maxScreenshotBytes: 1 }), /INVALID_ARGUMENT/);
  const browser = createBrowserApi({ browserId: 'fixture' });
  await assert.rejects(browser.listTabs({ browser: 'other' }), /BROWSER_NOT_FOUND/);
  await browser.dispose();
});
