// Real app, AudioWorklets and WASM in both browsers and script execution modes.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {chromium, webkit} = require('playwright');
const docs = path.resolve(__dirname, '../docs');
const mime = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.wasm':'application/wasm', '.json':'application/json'};
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let filename = path.resolve(docs, '.' + pathname);
    if (!filename.startsWith(docs + path.sep)) throw Error('Invalid path');
    if ((await fs.stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
    let body = await fs.readFile(filename);
    if (pathname.endsWith('/playground.js')) body = Buffer.from(body.toString() +
      '\nwindow.__chipTabs={runtime,megaDrive,virtualFiles,chipTabs,mixerPanel,get editor(){return editorAdapter;}};');
    response.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream'); response.end(body);
  } catch (error) {response.writeHead(404).end(error.message);}
});
const code = `
fm.setPreset(CH1, FM_PRESETS['one-op-basic']); fm.setNote(CH1, 'A3'); fm.keyOn(CH1);
psg.tone(0, {frequency: 220, volume: 0.25});
const tone = await useSoundChip('segapsg'); tone.tone(0, {frequency: 440, volume: 0.5});
const pcm = await useSoundChip('rf5c164');
const pwm = await useSoundChip('pwm'); await pwm.writeRegister(1, 1024);
liveLoop('hold', async () => { await sleep(1); });
`;
async function run(page, worker, source = code, expectedId = 'pwm:shared') {
  await page.evaluate(({worker, source}) => {
    document.getElementById('workerExecution').checked = worker;
    window.__chipTabs.editor.setValue(source);
  }, {worker, source});
  await page.click('#runButton');
  await page.waitForFunction(id => window.__chipTabs.megaDrive.mixer.list().some(entry => entry.id === id), expectedId);
}
async function input(page, selector, value, event = 'input') {
  await page.locator(selector).evaluate((element, {value, event}) => {
    element.value = String(value); element.dispatchEvent(new Event(event, {bubbles: true}));
  }, {value, event});
}
const strip = id => `#mixerPanel [data-chip-id="${id}"]`;
const control = (kind, name) => `#${kind}Panel [data-chip-control="${name}"]`;
async function meterAbove(page, id, threshold) {
  await page.waitForFunction(({id, threshold}) => {
    const node = [...document.querySelectorAll('#mixerPanel [data-chip-id]')].find(node => node.dataset.chipId === id);
    return Number(node?.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')) > threshold;
  }, {id, threshold});
}
async function check(engine, name, url) {
  const demo = await fs.readFile(path.join(docs, 'playground/examples/genesis/mixer-chip-balance.js'), 'utf8');
  const browser = await engine.launch({headless: true, ...(name === 'chromium' ? {args: ['--autoplay-policy=no-user-gesture-required']} : {})});
  try {
    for (const worker of [false, true]) {
      console.log(JSON.stringify({browser: name, worker, stage: 'start'}));
      const page = await browser.newPage({viewport: {width: 1320, height: 960}, serviceWorkers: 'block'});
      page.setDefaultTimeout(15000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(url);
        await page.waitForFunction(() => window.__chipTabs?.editor?.kind === 'monaco');
        // Inspecting an empty runtime must neither open audio nor create an instance.
        for (const tab of ['segapsg', 'rf5c164', 'pwm', 'mixer']) await page.click(`#${tab}Tab`);
        assert.equal(await page.evaluate(() => window.__chipTabs.megaDrive.audioContext), null);
        assert.equal(await page.evaluate(() => window.__chipTabs.runtime.chipInspector.list().length), 0);
        await run(page, worker);
        await page.click('#mixerTab');
        await page.locator(strip('segapsg:shared')).waitFor();
        await meterAbove(page, 'ym2612', .0001); await meterAbove(page, 'segapsg', .0001); await meterAbove(page, 'segapsg:shared', .0001);
        // UI changes go to the same mixer read by scripts, and vice versa.
        await input(page, `${strip('segapsg:shared')} [data-setting="volume"]`, 37);
        assert.equal(await page.evaluate(() => window.__chipTabs.megaDrive.mixer.get('segapsg:shared').volume), .37);
        await page.evaluate(() => window.__chipTabs.megaDrive.mixer.set('segapsg:shared', {pan: -.5}));
        await page.waitForFunction(() => document.querySelector('#mixerPanel [data-chip-id="segapsg:shared"] [data-setting="pan"]').value === '-50');
        await page.locator(`${strip('ym2612')} button`).filter({hasText: 'Mute'}).click();
        await page.locator(`${strip('segapsg:shared')} button`).filter({hasText: 'Solo'}).click();
        assert.equal(await page.evaluate(() => window.__chipTabs.megaDrive.mixer.list().find(entry => entry.id === 'segapsg').effectiveMuted), true);
        await page.waitForFunction(() => Number(document.querySelector('#mixerPanel [data-chip-id="segapsg"] [role="meter"]').getAttribute('aria-valuenow')) === 0);
        await meterAbove(page, 'segapsg:shared', .0001);
        await page.locator(`${strip('segapsg:shared')} button`).filter({hasText: 'Solo'}).click();
        assert.equal(await page.evaluate(() => window.__chipTabs.megaDrive.mixer.get('ym2612').muted), true);
        await meterAbove(page, 'segapsg', .0001);
        await input(page, '#mixerPanel input[aria-label="Master volume"]', 165);
        assert.equal(await page.locator('#masterVolumeRange').inputValue(), '165');
        await input(page, '#masterVolumeRange', 123);
        assert.equal(await page.locator('#mixerPanel input[aria-label="Master volume"]').inputValue(), '123');
        await page.click('#consoleTab');
        assert.equal(await page.evaluate(() => window.__chipTabs.megaDrive.mixer.meterListeners.size), 0, 'hidden Mixer unsubscribes meters');

        // The active inspector can address both primary and Worker-owned extra instances.
        await page.click('#segapsgTab');
        await page.selectOption(control('segapsg', 'instance'), 'segapsg:shared');
        await page.waitForFunction(() => Number(document.querySelector('#segapsgPanel [data-chip-control="tone-0-frequency"]').value) > 430);
        await input(page, control('segapsg', 'tone-0-frequency'), 880, 'change');
        await page.waitForFunction(async () => {
          const state = await window.__chipTabs.runtime.chipInspector.read('segapsg:shared');
          return Math.abs(state.channels[0].frequency - 880) < 10;
        });
        await page.selectOption(control('segapsg', 'noise-rate'), 'tone3');
        await page.waitForFunction(async () => (await window.__chipTabs.runtime.chipInspector.read('segapsg:shared')).noise.rate === 'tone3');
        await page.selectOption(control('segapsg', 'instance'), 'segapsg');
        await page.waitForFunction(() => Number(document.querySelector('#segapsgPanel [data-chip-control="tone-0-frequency"]').value) < 230);

        // A short generated WAV exercises VFS selection, RAM allocation and waveform editing.
        await page.evaluate(() => {
          const frames = 4096, buffer = new ArrayBuffer(44 + frames * 2), view = new DataView(buffer);
          const ascii = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
          ascii(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
          view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
          view.setUint32(24, 44100, true); view.setUint32(28, 88200, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
          ascii(36, 'data'); view.setUint32(40, frames * 2, true);
          for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, Math.round(14000 * Math.sin(2 * Math.PI * i / 100)), true);
          window.__chipTabs.virtualFiles.writeBinary('/test-tone.wav', new Uint8Array(buffer));
        });
        await page.click('#rf5c164Tab');
        await page.selectOption(control('rf5c164', 'instance'), 'rf5c164:shared');
        await page.selectOption(control('rf5c164', 'rf-file'), '/test-tone.wav');
        await page.locator('#rf5c164Panel button').filter({hasText: /^Load/}).click();
        await page.waitForFunction(async () => (await window.__chipTabs.runtime.chipInspector.read('rf5c164:shared')).samples.length === 1);
        await page.waitForFunction(async () => (await window.__chipTabs.runtime.chipInspector.read('rf5c164:shared')).channels[0].step > 0);
        await page.selectOption(control('rf5c164', 'rf-loop-mode'), 'loop');
        await page.locator('#rf5c164Panel button').filter({hasText: /^On$/}).click();
        await page.click('#mixerTab'); await meterAbove(page, 'rf5c164:shared', .0001);
        await page.click('#rf5c164Tab');
        await page.selectOption(control('rf5c164', 'rf-marker'), 'loop');
        await page.locator('#rf5c164Panel canvas').click({position: {x: 180, y: 60}});
        await page.waitForFunction(async () => {
          const state = await window.__chipTabs.runtime.chipInspector.read('rf5c164:shared');
          return state.channels[0].loopStart > state.samples[0].address && state.channels[0].loopStart < state.samples[0].address + state.samples[0].frames;
        });
        await input(page, control('rf5c164', 'rf-speed'), .5, 'change');
        await page.waitForFunction(async () => {
          const state = await window.__chipTabs.runtime.chipInspector.read('rf5c164:shared');
          return Math.abs(state.channels[0].step / state.samples[0].step - .5) < .01;
        });
        await page.click('#pwmTab'); await page.selectOption(control('pwm', 'instance'), 'pwm:shared');
        await input(page, control('pwm', 'pwm-cycle'), 2048, 'change');
        await page.waitForFunction(async () => (await window.__chipTabs.runtime.chipInspector.read('pwm:shared')).cycle === 2048);

        // Code and Mixer can coexist; top/bottom keyboard navigation follows visible ordering.
        await page.click('#codeTab'); await page.click('#mixerTab');
        assert(await page.locator('#codePanel').isVisible()); assert(await page.locator('#mixerPanel').isVisible());
        await page.locator('#operatorTabButton').focus(); await page.keyboard.press('ArrowRight');
        assert(await page.locator('#segapsgPanel').isVisible()); assert(await page.locator('#mixerPanel').isVisible());
        await page.screenshot({path: path.join(os.tmpdir(), `playground-chip-tabs-${name}-${worker ? 'worker' : 'main'}.png`)});
        await page.setViewportSize({width: 640, height: 800});
        await page.click('#pwmTab'); await page.click('#mixerTab');
        assert(await page.locator('#pwmPanel').isVisible()); assert(await page.locator('#mixerPanel').isVisible());
        await page.click('#stopButton');
        await page.waitForFunction(() => window.__chipTabs.runtime.chipInspector.list().every(entry => !entry.id.endsWith(':shared')));
        await run(page, worker);
        assert.equal(await page.evaluate(() => window.__chipTabs.megaDrive.mixer.get('segapsg:shared').volume), .37);
        assert.equal(await page.evaluate(() => window.__chipTabs.megaDrive.mixer.get('segapsg:shared').pan), -.5);
        assert.equal(await page.locator('#masterVolumeRange').inputValue(), '123');
        await page.click('#stopButton');
        await page.waitForFunction(() => !window.__chipTabs.runtime.chipInspector.list().some(entry => entry.id.endsWith(':shared')));
        await run(page, worker, demo, 'segapsg:shared');
        await page.click('#mixerTab'); await meterAbove(page, 'segapsg:shared', .0001);
        await page.click('#stopButton');
        if (worker) {
          await page.waitForFunction(() => !window.__chipTabs.runtime.chipInspector.list().some(entry => entry.id.endsWith(':shared')));
          await run(page, worker, `
            const oldChip = await useSoundChip('segapsg'); oldChip.dispose();
            const freshChip = await useSoundChip('segapsg'); freshChip.tone(0, {frequency: 1000, attenuation: 8});
            liveLoop('retirement-test', async () => { await sleep(1); });
          `, 'segapsg:shared');
          await page.waitForFunction(async () => {
            try {return Math.abs((await window.__chipTabs.runtime.chipInspector.read('segapsg:shared')).channels[0].frequency - 1000) < 10;}
            catch {return false;}
          });
          await page.click('#mixerTab'); await meterAbove(page, 'segapsg:shared', .0001);
          await page.click('#stopButton');
        }
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({browser: name, worker, passed: true, mixer: true, realChipMeters: true, inspectors: true, ramSample: true, reconnect: true, errors}));
      } catch (error) {
        console.error(JSON.stringify({browser: name, worker, statuses: await page.locator('.chip-editor-status, .playground-mixer-status, #status').allTextContents()}));
        await page.screenshot({path: path.join(os.tmpdir(), `playground-chip-tabs-${name}-${worker ? 'worker' : 'main'}-failure.png`)});
        throw error;
      } finally {await page.close();}
    }
  } finally {await browser.close();}
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/playground/index.html?mode=genesis-full&no-sw=1`;
    const engines = process.argv.includes('--chromium') ? [[chromium, 'chromium']] : process.argv.includes('--webkit') ? [[webkit, 'webkit']] : [[chromium, 'chromium'], [webkit, 'webkit']];
    for (const [engine, name] of engines) await check(engine, name, url);
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); process.exitCode = 1;});
