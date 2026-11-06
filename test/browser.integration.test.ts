import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { chromium, type Browser } from 'playwright';
import { createBrowserApi } from '../src/browser.js';

const executable = process.env.DSH_TEST_CHROME
  ?? (process.platform === 'darwin' && existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : chromium.executablePath());

const fixture = `<!doctype html><title>Computer Use fixture</title><h1>Local test page</h1>
<label>Name <input id="name"></label><label>Password <input type="password" value="TEST_SECRET_DO_NOT_CAPTURE"></label>
<button id="increment">Increment 0</button><button hidden>Hidden control</button><output id="result"></output>
<a href="/next">Next page</a><div style="height:1800px">Scroll area</div>
<script>let n=0;document.querySelector('#increment').onclick=()=>{document.querySelector('#increment').textContent='Increment '+(++n);document.querySelector('#result').textContent=document.querySelector('#name').value};</script>`;

async function endpointFor(directory: string, process: ChildProcess) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Fixture browser exited: ${process.exitCode}`);
    try {
      const lines = (await readFile(join(directory, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
      if (/^\d+$/.test(lines[0] ?? '')) return `http://127.0.0.1:${lines[0]}`;
    } catch { /* The fixture is still starting. */ }
    await delay(50);
  }
  throw new Error('Isolated fixture browser did not expose its CDP endpoint within 20 seconds.');
}

function indexFor(snapshot: string, text: string) {
  const line = snapshot.split('\n').find(line => line.includes(text));
  assert.ok(line, `No snapshot element matching ${text}`);
  const index = Number.parseInt(line, 10);
  assert.ok(Number.isInteger(index), `No index on ${line}`);
  return index;
}

test('real CDP browser: DOM, input, screenshots, navigation, stale indices and safe detach', { skip: !existsSync(executable), timeout: 60_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-browser-fixture-'));
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(request.url === '/next' ? '<!doctype html><title>Next fixture</title><h1>Second page</h1>' : fixture);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  // This is a fresh temporary profile, not the user's existing Chrome profile.
  const child = spawn(executable, ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${directory}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--no-sandbox', 'about:blank'], { stdio: 'ignore' });
  let external: Browser | undefined;
  let observer: Browser | undefined;
  let adapter: ReturnType<typeof createBrowserApi> | undefined;
  try {
    const endpoint = await endpointFor(directory, child);
    external = await chromium.connectOverCDP(endpoint, { noDefaults: true });
    const userPage = await external.contexts()[0]!.newPage();
    await userPage.goto(base);
    const images: Uint8Array[] = [];
    adapter = createBrowserApi({ cdpEndpoint: endpoint }, { image: image => { images.push(image.bytes); } });
    const tab = await adapter.getTab({ url: base + '/' });

    await t.test('snapshot is meaningful and redacts password values', async () => {
      const state = await tab.getAXState({ emit: false });
      assert.match(state, /Local test page/);
      assert.match(state, /Name/);
      assert.match(state, /<redacted>/);
      assert.doesNotMatch(state, /TEST_SECRET_DO_NOT_CAPTURE/);
      assert.doesNotMatch(state, /Hidden control/);
    });

    await t.test('input and fresh-state requirements work in the actual DOM', async () => {
      let state = await tab.getAXState({ emit: false });
      await tab.setValue(indexFor(state, 'textbox "Name"'), 'Ada');
      await assert.rejects(tab.click(0), /OBSERVATION_REQUIRED/);
      state = await tab.getAXState({ emit: false });
      await tab.click(indexFor(state, 'Increment 0'));
      assert.equal(await tab.playwright.locator('#result').innerText(), 'Ada');
      state = await tab.getAXState({ emit: false });
      const button = indexFor(state, 'Increment 1');
      await tab.playwright.getByRole('button', { name: 'Increment 1' }).click();
      await assert.rejects(tab.click(button), /STALE_ELEMENT/);
      assert.equal(await tab.playwright.getByRole('button').innerText(), 'Increment 2');
    });

    await t.test('screenshots contain an actual image and coordinate bounds are checked', async () => {
      const image = await tab.getScreenshot();
      assert.equal(Buffer.from(image).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(images.length, 1);
      await assert.rejects(tab.click([-1, 0]), /INVALID_ARGUMENT/);
      await assert.rejects(tab.click([1_000_000, 0]), /INVALID_ARGUMENT/);
    });

    await t.test('oversized screenshot is refused before emission, without writing files', async () => {
      let emitted = false;
      const limited = createBrowserApi({ cdpEndpoint: endpoint, maxScreenshotBytes: 1024 }, { image: () => { emitted = true; } });
      try {
        const target = await limited.getTab({ url: base + '/' });
        await assert.rejects(target.getScreenshot(), /SCREENSHOT_TOO_LARGE/);
        assert.equal(emitted, false);
      } finally { await limited.dispose(); }
    });

    await t.test('history and URL selection work without changing a user profile', async () => {
      await tab.goto(base + '/next');
      assert.match(await tab.getAXState({ emit: false }), /Second page/);
      await tab.back();
      assert.match(await tab.getAXState({ emit: false }), /Local test page/);
      await tab.forward();
      assert.match(await tab.getAXState({ emit: false }), /Second page/);
      await tab.reload();
      await tab.goto(base);
    });

    await t.test('existing tabs cannot be closed through the lifecycle API', async () => {
      await assert.rejects(tab.close(), /TAB_NOT_OWNED/);
      assert.equal(userPage.isClosed(), false);
    });

    const temporary = await adapter.createBrowserTab('chromium', base + '/next');
    const retained = await adapter.createBrowserTab('chromium', base + '/?retained');
    await retained.markDeliverable();
    await adapter.dispose();
    await t.test('cleanup removes only temporary owned tabs and disconnects safely', async () => {
      assert.equal(child.exitCode, null, 'CDP detach must not terminate external Chromium');
      observer = await chromium.connectOverCDP(endpoint, { noDefaults: true });
      const urls = observer.contexts().flatMap(context => context.pages()).map(page => page.url());
      assert.ok(urls.includes(base + '/'), 'The pre-existing user page must survive');
      assert.ok(urls.includes(base + '/?retained'), 'Deliverable page must survive');
      assert.ok(!urls.includes(base + '/next'), 'Unmarked adapter-owned page must be cleaned up');
      await assert.rejects(temporary.getAXState(), /BROWSER_DISPOSED/);
    });
  } finally {
    await adapter?.dispose();
    await observer?.close();
    await external?.close();
    child.kill('SIGTERM');
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), delay(3000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
