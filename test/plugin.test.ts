import { test } from 'node:test'
import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { apply, bridgeManifest } from '../src/index.ts'

test('bootstrap exposes installed bridge files that resolve outside a project node_modules', async () => {
  const manifest = bridgeManifest()
  // Source tests use .js exports at runtime, so build artifacts must be present.
  const native = new URL(manifest.nativeBridgeUrl.replace('/src/', '/lib/'))
  const browser = new URL(manifest.browserBridgeUrl.replace('/src/', '/lib/'))
  assert.equal(native.protocol, 'file:')
  await access(fileURLToPath(native)); await access(fileURLToPath(browser))
  const module = await import(native.href)
  assert.equal(typeof module.connectComputerUse, 'function')
  assert.equal(typeof module.connectUnifiedComputerUse, 'function')
  const other = await import(browser.href)
  assert.equal(typeof other.connectBrowser, 'function')
})


test('Host plugin registers bootstrap with the actual Harness author-schema compiler', () => {
  const registered: string[] = []
  const context = {
    tools: { register: (tool: {name: string}) => { registered.push(tool.name) } },
    systemPrompt: { section: () => {} },
  }
  apply(context as unknown as Parameters<typeof apply>[0], {})
  assert.deepEqual(registered, ['computer_use_bootstrap'])
})
