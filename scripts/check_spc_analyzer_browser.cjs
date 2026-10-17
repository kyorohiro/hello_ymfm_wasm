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
(async () => {
  const {createSyntheticSpc} = await import(pathToFileURL(path.join(root, 'web/spc_test_fixture.mjs')));
  const fixture = Buffer.from(createSyntheticSpc({voices:2}));
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
        console.log(JSON.stringify({browser:name, passed:true, playing, muted, brrWavBytes:wav.length, tagFade:true, staleLoadFenced:true, vgmAfterSpc:true}));
        await page.close();
      } finally {await browser.close();}
    }
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); process.exitCode = 1; server.close();});
