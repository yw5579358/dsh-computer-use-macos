import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connectComputerUse, normalizeClickOptions } from '../src/bridge.ts'
import type { CuaToolBinding } from '@deepseek-ai/dsh-cua/bridge'

function fixture() {
  const calls: Array<{method: string; params: Record<string, unknown>}> = []
  let generation = 1
  let failNext = false
  let wrongIdentity = false
  const dispatch: CuaToolBinding = async op => {
    calls.push(op)
    if (failNext) { failNext = false; throw new Error('Native partial dispatch failure') }
    const window = {windowId: 8, pid: 123, appName: 'Fixture', title: 'Fixture', bounds: {x: 0, y: 0, width: 400, height: 300}, isOnScreen: true, onCurrentSpace: true}
    switch (op.method) {
      case 'getApp': return {appHandle: 'fixture-app', pid: 123, name: 'Fixture'}
      case 'getState': return {appHandle: wrongIdentity ? 'foreign-app' : 'fixture-app', pid: 123, windowId: op.params.windowId ?? null, focusedWindowId: 8, snapshotId: `snapshot-${generation}`, tree: `0 window Fixture\n  1 button Press (${generation})`, windows: [window], truncated: false}
      case 'listWindows': return [window]
      case 'listApps': return [{pid: 123, name: 'Fixture', bundleId: 'test.fixture'}]
      case 'getCapabilities': return {platform: 'darwin', permissions: {accessibility: true, screenRecording: true}, sessionLocked: false, methods: [], coordinateSpace: 'screenshot-pixels', browser: false}
      case 'screenshot': return {mimeType: 'image/png', data: 'AQID', pixelWidth: 400, pixelHeight: 300, windowId: 8, bounds: window.bounds, coordinateSpace: 'screenshot-pixels'}
      case 'show': return {dispatched: true, verified: false, windowId: 8, foregroundChanged: false}
      case 'hover': return {dispatched: true, verified: false, hoverRoute: 'accessibility', systemPointerMoved: false}
      default: return {dispatched: true, verified: false}
    }
  }
  let current: CuaToolBinding = dispatch
  return {
    calls, api: connectComputerUse(() => current),
    rotate() { generation++; current = async op => dispatch(op) },
    fail() { failNext = true },
    foreign() { wrongIdentity = true },
  }
}

test('preserves current tool authority and fresh snapshot identity after actions', async () => {
  const f = fixture(); const app = await f.api.getApp('Fixture')
  await app.click(1)
  await assert.rejects(app.click(1), /FRESH_STATE_REQUIRED/)
  f.rotate(); await app.getAXState(); await app.click(1)
  const clicks = f.calls.filter(x => x.method === 'click')
  assert.equal(clicks[0]?.params.snapshotId, 'snapshot-1')
  assert.equal(clicks[1]?.params.snapshotId, 'snapshot-2')
})

test('keyboard input invalidates pointer, screenshot and further keyboard use', async () => {
  const f = fixture(); const app = await f.api.getApp('Fixture')
  await app.typeText('你好 👋')
  await assert.rejects(app.click(1), /FRESH_STATE_REQUIRED/)
  await assert.rejects(app.pressKey('super+a'), /FRESH_STATE_REQUIRED/)
  await app.getAXState(); await app.pressKey('super+a')
  assert.deepEqual(f.calls.at(-1)?.params, {appHandle: 'fixture-app', key: 'a', modifiers: ['command']})
})

test('failed input cannot be blindly replayed', async () => {
  const f = fixture(); const app = await f.api.getApp('Fixture')
  f.fail(); await assert.rejects(app.click(1), /partial dispatch/)
  await assert.rejects(app.click(1), /FRESH_STATE_REQUIRED/)
  await app.getAXState(); await app.click(1)
})

test('explicit windows carry identity and input invalidates other observations', async () => {
  const f = fixture(); const app = await f.api.getApp('Fixture')
  const win = await app.getWindow(8)
  await win.setValue(1, 'new value')
  await assert.rejects(app.click(1), /FRESH_STATE_REQUIRED/)
  await win.getAXState(); await app.pressKey('Return')
  await assert.rejects(win.click(1), /FRESH_STATE_REQUIRED/)
})

test('selection, secondary actions, scroll and drag preserve exact native arguments', async () => {
  const f = fixture(); const app = await f.api.getApp('Fixture')
  await app.selectText(1, 'one', {prefix: 'a ', selectionType: 'cursor_after'})
  assert.equal(f.calls.at(-1)?.params.selectionType, 'cursor_after')
  await app.getAXState(); await app.performSecondaryAction(1, 'raise')
  assert.equal(f.calls.at(-1)?.params.action, 'raise')
  await app.getAXState(); await app.scroll({x: 20, y: 30, deltaLinesX: 0, deltaLinesY: 3})
  assert.equal(f.calls.at(-1)?.params.deltaLinesY, 3)
  await app.getAXState(); await app.drag([1, 2], [10, 20])
  assert.equal(f.calls.at(-1)?.params.toX, 10)
})

test('screenshot bytes and metadata are preserved without an extra image sink', async () => {
  const f = fixture(); const app = await f.api.getApp('Fixture')
  const screenshot = await app.getScreenshot()
  assert.deepEqual([...screenshot.bytes], [1, 2, 3])
  assert.equal(screenshot.mimeType, 'image/png')
  assert.equal(screenshot.windowId, 8)
  assert.equal(f.calls.filter(x => x.method === 'screenshot').length, 1)
})

test('rejects native observations belonging to another target', async () => {
  const f = fixture(); f.foreign()
  await assert.rejects(f.api.getApp('Fixture'), /another application/)
})

test('validates pointer aliases, conflicting options and invalid arguments', async () => {
  assert.deepEqual(normalizeClickOptions({key: 'super+shift', durationMs: 800}), {modifiers: ['command', 'shift'], holdMs: 800})
  assert.throws(() => normalizeClickOptions({key: 'hyper'}), /Unsupported/)
  assert.throws(() => normalizeClickOptions({key: 'super', modifiers: []}), /not both/)
  assert.throws(() => normalizeClickOptions({durationMs: 2, holdMs: 3}), /not both/)
  assert.throws(() => normalizeClickOptions({durationMs: -1}), /0 to 5000/)
  const f = fixture(); const app = await f.api.getApp('Fixture')
  await assert.rejects(app.click([-1, 3]), /click/)
})

test('unified entry point keeps browser opt-in and merges inventory without extra native actions', async () => {
  const { connectUnifiedComputerUse } = await import('../src/bridge.ts')
  const nativeCalls: string[] = []
  const api = connectUnifiedComputerUse(() => async op => {
    nativeCalls.push(op.method)
    return [{pid: 123, name: 'Fixture', bundleId: 'test.fixture'}]
  })
  assert.deepEqual(await api.getState({emit:false}), {apps:[{id:'test.fixture',displayName:'Fixture',isRunning:true,pid:123}],browsers:[]})
  assert.deepEqual(nativeCalls, ['listApps'])
  await assert.rejects(api.listTabs(), /BROWSER_NOT_CONFIGURED/)
})
