// Actual Analyzer UI and AudioWorklet, using original synthetic SPC data.
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');
const root = path.resolve(__dirname, '..'), docs = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'docs');
const analyzerPath = process.argv[2] ? '' : '/vgm_analyzer';
const mime = {'.js':'text/javascript', '.wasm':'application/wasm', '.html':'text/html', '.css':'text/css', '.json':'application/json'};
const server = http.createServer(async (request, response) => {
  try {
    let file = path.resolve(docs, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (file !== docs && !file.startsWith(docs + path.sep)) throw Error('Outside docs');
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
    let body = await fs.readFile(file);
    if (file === path.join(docs, analyzerPath, 'vgm_analyzer.js')) body = Buffer.concat([body, Buffer.from('\nwindow.__spcTest={view:spcView,getContext:()=>audioContext};\n')]);
    response.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream'); response.end(body);
  } catch (error) {response.writeHead(404); response.end(error.message);}
});
async function signal(page) {
  return page.evaluate(async () => {
    const context = window.__spcTest.getContext(), output = window.__spcTest.view.outputNode;
    const meter = context.createAnalyser(), gain = context.createGain(); meter.fftSize = 2048; gain.gain.value = 0;
    output.connect(meter); meter.connect(gain); gain.connect(context.destination);
    let peak = 0, low = Infinity, high = -Infinity, bad = 0;
    try {
      const pcm = new Float32Array(2048);
      for (let sample = 0; sample < 4; sample++) {
        await new Promise(resolve => setTimeout(resolve, 50)); meter.getFloatTimeDomainData(pcm);
        for (const value of pcm) {if (!Number.isFinite(value)) bad++; else {peak = Math.max(peak, Math.abs(value)); low = Math.min(low, value); high = Math.max(high, value);}}
      }
    } finally {output.disconnect(meter); meter.disconnect(); gain.disconnect();}
    return {peak, range:high - low, bad};
  });
}
function withUnusedSamples(original) {
  const bytes = Buffer.from(original), ram = bytes.subarray(0x100, 0x10100);
  // Every unused slot points to the same deliberately unterminated chain.
  // Clear END only at that chain's 9-byte header positions, including wrapping
  // RAM. The chosen alignment preserves the CPU program and the two real BRR
  // headers. Some real payload low bits change, which is harmless authored data.
  for (let srcn = 0; srcn < 256; srcn++) ram.set([0x04,0x30,0x04,0x30], 0x1000 + srcn * 4);
  ram.set([0x00,0x20,0x00,0x20], 0x1000);
  ram.set([0x00,0x20,0x00,0x20], 0x1000 + 42 * 4); // Unused alias.
  ram.set([0x00,0x21,0x00,0x21], 0x1000 + 127 * 4); // Unused distinct sample.
  ram.set([0xc3,0x76,0x54,0x32,0x10,0xfe,0xdc,0xba,0x98], 0x2100);
  for (let block = 0; block < Math.floor(65536 / 9); block++) ram[(0x3004 + block * 9) & 65535] &= 0xfe;
  return bytes;
}
async function downloadBytes(page, button) {
  const downloaded = page.waitForEvent('download'); await button.click();
  return fs.readFile(await (await downloaded).path());
}
(async () => {
  const {createSyntheticSpc} = await import(pathToFileURL(path.join(root, 'web/spc_test_fixture.mjs')));
  const original = Buffer.from(createSyntheticSpc({voices:2})), fixture = withUnusedSamples(original);
  const {extractBrrSamples} = await import(pathToFileURL(path.join(root, 'web/snes_brr.js')));
  const badSource = extractBrrSamples({ram:fixture.subarray(0x100,0x10100),dsp:fixture.subarray(0x10100,0x10180)}, {sourceNumbers:[255]});
  assert.equal(badSource.samples.length, 0, 'The synthetic invalid SRCN must have no complete BRR segment');
  assert.match(badSource.rejected[0].reason, /No BRR END/);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch({headless:true});
      try {
        const page = await browser.newPage({serviceWorkers:'block', acceptDownloads:true}), errors = [];
        page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {if (message.type() === 'error') console.error(name + ': ' + message.text());});
        await page.goto(`http://127.0.0.1:${server.address().port}${analyzerPath}/`);
        await page.waitForFunction(() => window.__spcTest);
        await page.locator('#fileInput').setInputFiles({name:'original.spc', mimeType:'application/octet-stream', buffer:fixture});
        await page.waitForFunction(() => window.__spcTest.view.active && !document.querySelector('#inlinePlayButton').disabled).catch(async error => {
          console.error({errors, status:await page.locator('body').innerText()}); throw error;
        });
        assert.match(await page.locator('#detectedChips').textContent(), /SPC700/);
        await page.locator('#sampleExplorerTab').click();
        assert(await page.locator('#spcInfoPanel').isVisible());
        assert.equal(await page.locator('#spcInfoPanel .monitor-toggles button').count(), 8);
        assert((await page.locator('#spcInfoPanel').getByRole('button', {name:'WAV', exact:true}).count()) > 0);
        const scan = page.locator('#spcInfoPanel').getByRole('button', {name:'Scan all SRCNs', exact:true});
        await scan.click();
        await page.waitForFunction(() => /256 SRCNs checked/.test(document.getElementById('spcInfoPanel').textContent));
        const aliasRow = page.locator('#spcInfoPanel [data-source-numbers="0,42"]');
        const unusedRow = page.locator('#spcInfoPanel [data-source-numbers="127"]');
        assert.equal(await aliasRow.count(), 1, 'Unused aliases must share one candidate');
        assert.equal(await unusedRow.count(), 1, 'An unused valid SRCN must be discoverable');
        assert.equal(await page.locator('#spcInfoPanel').getByRole('button', {name:'WAV', exact:true}).count(), 2,
          'Scanning must deduplicate aliases and skip unterminated BRR entries');
        assert.match(await page.locator('#spcInfoPanel').innerText(), /false.?positive|may not|not guaranteed|may include unused or unrelated data/i,
          'Scanning must explain that plausible RAM data is not guaranteed to be an instrument');
        const aliasMetadata = JSON.parse((await downloadBytes(page, aliasRow.getByRole('button', {name:'Metadata', exact:true}))).toString());
        assert.deepEqual(aliasMetadata.sourceNumbers, [0,42], 'Exported metadata must preserve unused SRCN aliases');
        assert.deepEqual(aliasMetadata.sourceEntries.map(entry => entry.sourceNumber).sort((a,b) => a-b), [0,42]);
        for (const entry of aliasMetadata.sourceEntries) {
          assert.equal(entry.startAddress, 0x2000); assert.equal(entry.loopAddress, 0x2000);
        }
        const unusedMetadata = JSON.parse((await downloadBytes(page, unusedRow.getByRole('button', {name:'Metadata', exact:true}))).toString());
        assert.deepEqual(unusedMetadata.sourceNumbers, [127]);
        const unusedWav = await downloadBytes(page, unusedRow.getByRole('button', {name:'WAV', exact:true}));
        assert.equal(unusedWav.subarray(0,4).toString(), 'RIFF'); assert.equal(unusedWav.readUInt32LE(24), 32000);
        await page.screenshot({path:`/private/tmp/spc-brr-scan-${name}.png`, fullPage:true});
        await unusedRow.getByRole('button', {name:'Preview', exact:true}).click();
        await page.waitForFunction(() => window.__spcTest.view.state.paused && !!window.__spcTest.view.outputNode);
        assert((await signal(page)).peak > .001, 'An unused scanned sample must remain previewable');
        await page.locator('#spcInfoPanel').getByRole('button', {name:'Capture BRR samples', exact:true}).click();
        await page.locator('#spcInfoPanel [data-source-numbers="0"]').waitFor({state:'visible'});
        assert.equal(await page.locator('#spcInfoPanel').getByRole('button', {name:'WAV', exact:true}).count(), 1,
          'Capture current voice sources must retain its focused behavior');
        await page.locator('#spcInfoPanel input[type="number"]').fill('127');
        await page.locator('#spcInfoPanel').getByRole('button', {name:'Extract SRCN', exact:true}).click();
        await unusedRow.waitFor({state:'visible'});
        assert.equal(await page.locator('#spcInfoPanel').getByRole('button', {name:'WAV', exact:true}).count(), 1,
          'Explicit SRCN extraction must still work');
        await page.locator('#inlinePlayButton').click();
        await page.waitForFunction(() => window.__spcTest.view.state.playing);
        const playing = await signal(page); assert.equal(playing.bad, 0); assert(playing.peak > .001 && playing.range > .001, JSON.stringify(playing));
        for (const button of await page.locator('#spcInfoPanel .monitor-toggles button').all()) await button.click();
        await page.waitForTimeout(100);
        const muted = await signal(page); assert(muted.peak < .00001, JSON.stringify(muted));
        await page.locator('#spcInfoPanel .monitor-toggles button').first().click();
        assert((await signal(page)).range > .001);
        await page.locator('#inlinePauseButton').click();
        await page.waitForFunction(() => window.__spcTest.view.state.paused);
        const paused = await page.evaluate(() => window.__spcTest.view.state.positionSeconds);
        await page.waitForTimeout(250); assert.equal(await page.evaluate(() => window.__spcTest.view.state.positionSeconds), paused);
        await page.locator('#inlinePlaybackSeek').evaluate(input => {input.value = '5000'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change'));});
        await page.waitForFunction(() => window.__spcTest.view.state.positionSeconds === 5);
        await page.locator('#inlineStopButton').click();
        await page.waitForFunction(() => window.__spcTest.view.state.positionSeconds === 0);
        await page.locator('#inlinePlayButton').click(); assert((await signal(page)).range > .001);
        await page.locator('#inlineStopButton').click();
        const downloaded = page.waitForEvent('download');
        await page.locator('#spcInfoPanel').getByRole('button', {name:'WAV', exact:true}).first().click();
        const wav = await fs.readFile(await (await downloaded).path());
        assert.equal(wav.subarray(0, 4).toString(), 'RIFF'); assert.equal(wav.readUInt32LE(24), 32000);
        // Hold a real Worklet snapshot after it has resolved, then switch files
        // through the Analyzer input. A completed obsolete scan must not publish
        // its rows or status over the newly selected SPC.
        await page.evaluate(async () => {
          const {SpcRuntimeSynth} = await import('/js/spc_audio.js');
          const original = SpcRuntimeSynth.prototype.snapshot;
          let release;
          const barrier = new Promise(resolve => {release = resolve;});
          window.__spcScanRace = {entered:false, release, restore:() => {SpcRuntimeSynth.prototype.snapshot = original;}};
          SpcRuntimeSynth.prototype.snapshot = async function(...args) {
            const snapshot = await original.apply(this, args);
            window.__spcScanRace.entered = true;
            await barrier;
            return snapshot;
          };
        });
        try {
          await scan.click();
          await page.waitForFunction(() => window.__spcScanRace.entered);
          await page.locator('#fileInput').setInputFiles({name:'scan-race-next.spc', mimeType:'application/octet-stream', buffer:original});
          await page.waitForFunction(() => /scan-race-next/.test(document.querySelector('#spcInfoPanel p').textContent)
            && !document.getElementById('inlinePlayButton').disabled);
        } finally {
          await page.evaluate(() => {window.__spcScanRace.release(); window.__spcScanRace.restore();});
        }
        await page.waitForTimeout(100);
        assert.equal(await page.locator('#spcInfoPanel [data-source-numbers="127"]').count(), 0,
          'A stale full scan must not publish candidates into the replacement file');
        assert.doesNotMatch(await page.locator('#spcInfoPanel').innerText(), /256 SRCNs checked/,
          'A stale scan must not replace the new file capture status');
        assert.equal(await page.locator('#spcInfoPanel').getByRole('button', {name:'WAV', exact:true}).count(), 1);
        const tagged=Buffer.from(fixture); tagged[0x23]=0x1a;
        tagged.write('001',0xa9,'ascii'); tagged.write('01000',0xac,'ascii');
        await page.locator('#fileInput').setInputFiles({name:'tagged.spc',mimeType:'application/octet-stream',buffer:tagged});
        await page.waitForFunction(()=>window.__spcTest.view.state.durationSeconds===2);
        await page.evaluate(()=>window.__spcTest.view.seek(1.5));
        await page.waitForFunction(()=>Math.abs(window.__spcTest.view.outputNode.gain.value-.5)<.01);
        await page.locator('#inlinePlayButton').click();
        await page.waitForFunction(()=>window.__spcTest.view.state.playing);
        await page.waitForFunction(()=>window.__spcTest.view.outputNode.gain.value<.35);
        await page.waitForFunction(()=>!window.__spcTest.view.state.playing);
        assert.equal(await page.evaluate(()=>window.__spcTest.view.outputNode.gain.value),0,'tag fade reaches silence');
        const race=await page.evaluate(async bytes=>{
          const {SpcRuntimeSynth}=await import('/js/spc_audio.js');
          const close=SpcRuntimeSynth.prototype.close; let release;
          const barrier=new Promise(resolve=>{release=resolve;});
          SpcRuntimeSynth.prototype.close=async function(){await barrier;return close.call(this);};
          const view=window.__spcTest.view;
          try {
            const first=view.load(new Uint8Array(bytes),'old.spc').then(()=>null,error=>error.name);
            await view.load(new Uint8Array(bytes),'new.spc');
            release(); const stale=await first;
            return {stale,title:document.querySelector('#spcInfoPanel p').textContent,active:view.active};
          } finally {release();SpcRuntimeSynth.prototype.close=close;}
        },Array.from(fixture));
        assert.equal(race.stale,'AbortError'); assert.equal(race.active,true); assert.match(race.title,/new/);
        await page.locator('#fileInput').setInputFiles(path.join(root, 'test/fixtures/psg-tone.vgm'));
        await page.waitForFunction(() => !window.__spcTest.view.active && !document.querySelector('#inlinePlayButton').disabled);
        await page.locator('#inlinePlayButton').click();
        await page.waitForTimeout(100); await page.locator('#inlineStopButton').click();
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({browser:name, passed:true, playing, muted, brrWavBytes:wav.length, allSrcnScan:true,
          unusedSources:[42,127], aliasMetadata:true, staleScanFenced:true, tagFade:true, staleLoadFenced:true, vgmAfterSpc:true}));
        await page.close();
      } finally {await browser.close();}
    }
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); process.exitCode = 1; server.close();});
