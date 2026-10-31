// Check public octave controls against the actual FM voice pitches. Physical output is muted.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const {chromium, webkit} = require('playwright');
const docs = path.resolve(__dirname, '../docs');
const hook = '\nwindow.__octaveTest = {voices:()=>structuredClone(voices), layout:()=>fretboardLayout.entries.map(e=>({key:e.key,midi:e.midi,pitch:e.pitch})), audio:()=>Boolean(synth)};';
const server = http.createServer(async (request, response) => {
  try {
    const filename = path.resolve(docs, '.' + new URL(request.url, 'http://localhost').pathname);
    assert(filename.startsWith(docs + path.sep));
    let data = await fs.readFile(filename);
    if (filename === path.join(docs, 'synth/synth.js')) data = Buffer.from(data.toString() + hook);
    response.setHeader('Content-Type', {'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'}[path.extname(filename)] || 'application/octet-stream');
    response.end(data);
  } catch (error) {response.writeHead(404).end(error.message);}
});
function muteOutput() {
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function(destination, ...args) {
    if (destination === this.context.destination) {
      const gate = this.context.createGain(); gate.gain.value = 0;
      connect.call(gate, destination);
      return connect.call(this, gate, ...args);
    }
    return connect.call(this, destination, ...args);
  };
}
async function run(browser, name, origin) {
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(muteOutput);
  await page.goto(origin + '/synth/index.html');
  await page.waitForFunction(() => window.__octaveTest);
  assert.equal(await page.evaluate(() => __octaveTest.audio()), false);
  const initial = await page.locator('#keyboard .key span').first().textContent();
  for (let i = 0; i < 2; i++) await page.locator('#octaveUp').click();
  assert(await page.locator('#octaveUp').isDisabled());
  assert.equal(await page.locator('#octaveValue').textContent(), '+2');
  for (let i = 0; i < 4; i++) await page.locator('#octaveDown').click();
  assert(await page.locator('#octaveDown').isDisabled());
  assert.equal(await page.locator('#octaveValue').textContent(), '-2');
  for (let i = 0; i < 2; i++) await page.locator('#octaveUp').click();
  assert.equal(await page.locator('#keyboard .key span').first().textContent(), initial);
  assert.equal(await page.evaluate(() => __octaveTest.audio()), false, 'Octave editing remains audio-lazy');
  await page.locator('#keyboard .key').first().click();
  await page.waitForFunction(() => __octaveTest.audio() && document.getElementById('status').textContent.includes('Audio ready'));
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.down('y');
  await page.waitForFunction(() => __octaveTest.voices().some(v => v.held && v.key === 'y'));
  const base = await page.evaluate(() => __octaveTest.voices().find(v => v.held && v.key === 'y').basePitch);
  await page.locator('#octaveUp').click();
  assert.equal(await page.locator('#keyboard .is-active').count(), 0);
  assert(await page.evaluate(() => __octaveTest.voices().every(v => !v.held)), 'Changing octave releases held notes');
  await page.keyboard.up('y');
  // Button focus must still allow ordinary computer keyboard notes.
  await page.keyboard.down('y');
  await page.waitForFunction(() => __octaveTest.voices().some(v => v.held && v.key === 'y'));
  const raised = await page.evaluate(() => __octaveTest.voices().find(v => v.held && v.key === 'y').basePitch);
  assert.equal(raised.block, base.block + 1); assert.equal(raised.fnum, base.fnum);
  await page.keyboard.up('y');
  await page.waitForFunction(() => __octaveTest.voices().every(v => !v.held));
  const key = page.locator('#keyboard .key[data-key="y"]');
  await key.scrollIntoViewIfNeeded();
  const box = await key.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForFunction(() => __octaveTest.voices().some(v => v.held));
  assert.deepEqual(await page.evaluate(() => __octaveTest.voices().find(v => v.held).basePitch), raised);
  await page.mouse.up();
  await page.waitForFunction(() => __octaveTest.voices().every(v => !v.held));
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator('.fretboard-toolbar').screenshot({path:`/private/tmp/fm-octave-${name}-${width}.png`});
  }
  assert.deepEqual(errors, []);
  await page.close(); console.log(`PASS ${name}: octave limits, labels, held release, PC/pointer pitch, focus and layout`);
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const [name, engine] of Object.entries({chromium,webkit})) {
      const browser = await engine.launch({headless:true});
      try {await run(browser, name, `http://127.0.0.1:${server.address().port}`);} finally {await browser.close();}
    }
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error);process.exitCode = 1;});
