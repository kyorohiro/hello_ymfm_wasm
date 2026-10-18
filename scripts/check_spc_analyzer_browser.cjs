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
    if (path.basename(file) === 'spc_brr_preview.js') {
      // Hold the result of the real offline DSP renderer, never substitute PCM.
      // This makes stale-preview continuation races deterministic in the UI.
      const source = body.toString().replace(/export\s+(async\s+)?function\s+renderSpcBrrVoicePreview\b/, '$1function __renderSpcBrrVoicePreview');
      if (source === body.toString()) throw Error('Voice preview renderer export was not found');
      body = Buffer.from(source + `\nexport async function renderSpcBrrVoicePreview(...args) {
        const result = await __renderSpcBrrVoicePreview(...args);
        const gate = globalThis.__spcVoicePreviewGate;
        if (gate?.armed) {gate.armed = false; gate.entered = true; await gate.wait;}
        return result;
      }\n`);
    }
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
function observePreviewStarts() {
  window.__spcPreviewStarts = [];
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function(...args) {
    if (this.buffer) {
      const captured = {channels:this.buffer.numberOfChannels, frames:this.buffer.length, sampleRate:this.buffer.sampleRate, loop:this.loop};
      if (captured.channels === 2 && captured.frames === 64000) {
        const pcm = this.buffer.getChannelData(0);
        const rms = (from,to) => Math.sqrt(pcm.subarray(from,to).reduce((sum,sample) => sum + sample * sample,0) / (to-from));
        captured.attack = {early:rms(0,1600),late:rms(19200,22400)};
      }
      window.__spcPreviewStarts.push(captured);
    }
    return start.apply(this,args);
  };
}
async function stereoSignal(page) {
  return page.evaluate(async () => {
    const context = window.__spcTest.getContext(), output = window.__spcTest.view.outputNode;
    const splitter = context.createChannelSplitter(2), sink = context.createGain();
    sink.gain.value = 0; sink.connect(context.destination); output.connect(splitter);
    const meters = [0,1].map(channel => {
      const meter = context.createAnalyser(); meter.fftSize = 8192;
      splitter.connect(meter, channel); meter.connect(sink); return meter;
    });
    const result = meters.map(() => ({peak:0, rms:0, frequency:0, bad:0}));
    try {
      for (let batch = 0; batch < 4; batch++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        for (let channel = 0; channel < 2; channel++) {
          const pcm = new Float32Array(meters[channel].fftSize), spectrum = new Float32Array(meters[channel].frequencyBinCount);
          meters[channel].getFloatTimeDomainData(pcm); meters[channel].getFloatFrequencyData(spectrum);
          let sum = 0, peakBin = 1;
          for (const sample of pcm) {
            if (!Number.isFinite(sample)) result[channel].bad++;
            else {result[channel].peak = Math.max(result[channel].peak, Math.abs(sample)); sum += sample * sample;}
          }
          result[channel].rms = Math.max(result[channel].rms, Math.sqrt(sum / pcm.length));
          for (let bin = 2; bin < spectrum.length; bin++) if (spectrum[bin] > spectrum[peakBin]) peakBin = bin;
          result[channel].frequency = peakBin * context.sampleRate / meters[channel].fftSize;
        }
      }
    } finally {output.disconnect(splitter); splitter.disconnect(); for (const meter of meters) meter.disconnect(); sink.disconnect();}
    return result;
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
function withLongSampleList(original) {
  const bytes = Buffer.from(original), ram = bytes.subarray(0x100,0x10100);
  for (let srcn = 0; srcn < 256; srcn++) {
    const sample = srcn < 24 ? srcn : 0, address = 0x4000 + sample * 16;
    ram.set([address & 255,address >> 8,address & 255,address >> 8], 0x1000 + srcn * 4);
    ram.set([0xc3,0x13 + sample,0x57,0x75,0x31,0xfd,0xb9,0x9b,0xdf], address);
  }
  return bytes;
}
function withPreviewVoice(original) {
  const bytes = Buffer.from(original), dsp = bytes.subarray(0x10100,0x10180);
  dsp[0] = 64; dsp[1] = 0; // Left-only Voice 1.
  dsp[2] = 0; dsp[3] = 8; // PITCH $0800: half the raw sample frequency.
  dsp[5] = 0x86; dsp[6] = 0xe0; dsp[7] = 127; // Audible rising hardware attack.
  return bytes;
}
async function downloadBytes(page, button) {
  const downloaded = page.waitForEvent('download'); await button.click();
  return fs.readFile(await (await downloaded).path());
}
async function verifyVoiceModes(page, original, name) {
  await page.locator('#fileInput').setInputFiles({name:'preview-voice.spc',mimeType:'application/octet-stream',buffer:withPreviewVoice(original)});
  await page.waitForFunction(() => /preview-voice/.test(document.querySelector('#spcInfoPanel p').textContent)
    && !document.getElementById('inlinePlayButton').disabled);
  const row = page.locator('#spcInfoPanel [data-source-numbers="0"]');
  const mode = row.locator('select[data-spc-preview-mode]'), preview = row.getByRole('button',{name:'Preview',exact:true});
  assert.equal(await mode.inputValue(),'raw','Raw remains the default preview');
  assert.equal(await mode.locator('option[value="voice-0"]').count(),1,'Captured Voice 1 settings are selectable');
  assert.equal(await mode.locator('option[value="voice-1"]').count(),1,'Other captured voice settings remain independently selectable');
  const starts = () => page.evaluate(() => window.__spcPreviewStarts.length);
  let before = await starts(); await preview.click();
  await page.waitForFunction(before => window.__spcPreviewStarts.length > before,before);
  const raw = await stereoSignal(page);
  assert(raw.every(channel => channel.bad === 0 && channel.peak > .001),'Raw preview must produce finite stereo-upmixed audio');
  assert(Math.abs(raw[0].rms / raw[1].rms - 1) < .03,'Raw preview has no captured channel panning');
  await mode.selectOption('voice-0'); before = await starts(); await preview.click();
  await page.waitForFunction(before => window.__spcPreviewStarts.length > before,before);
  const voiceBuffer = await page.evaluate(() => window.__spcPreviewStarts.at(-1));
  const {attack,...voiceFormat} = voiceBuffer;
  assert.deepEqual(voiceFormat,{channels:2,frames:64000,sampleRate:32000,loop:false},
    'Voice preview must use actual two-second native-rate S-DSP stereo PCM');
  assert(attack.late > attack.early * 2 && attack.late > .001,
    'Captured ADSR attack must shape the real DSP preview: ' + JSON.stringify(attack));
  const voice = await stereoSignal(page);
  assert.equal(voice[0].bad + voice[1].bad,0);
  assert(voice[0].peak > .001 && voice[1].peak < voice[0].peak * .001,'Voice preview must preserve captured left-only volume');
  assert(Math.abs(raw[0].frequency - 2000) < 50 && Math.abs(voice[0].frequency - 1000) < 50,
    'Captured PITCH $0800 must halve the raw sample pitch: ' + JSON.stringify({raw,voice}));
  await page.screenshot({path:`/private/tmp/spc-brr-voice-preview-${name}.png`});

  // The helper still renders real PCM, but the test server can delay its return
  // to exercise a newer transport/file action winning over old async work.
  for (const action of ['stop','play','file']) {
    const previousStarts = await starts();
    await page.evaluate(() => {
      let release; const wait = new Promise(resolve => {release=resolve;});
      window.__spcVoicePreviewGate = {armed:true,entered:false,wait,release};
    });
    try {
      await preview.click();
      await page.waitForFunction(() => window.__spcVoicePreviewGate.entered);
      if (action === 'stop') await page.locator('#inlineStopButton').click();
      else if (action === 'play') {
        await page.locator('#inlinePlayButton').click();
        await page.waitForFunction(() => window.__spcTest.view.state.playing);
      } else {
        await page.locator('#fileInput').setInputFiles({name:'preview-replacement.spc',mimeType:'application/octet-stream',buffer:original});
        await page.waitForFunction(() => /preview-replacement/.test(document.querySelector('#spcInfoPanel p').textContent)
          && !document.getElementById('inlinePlayButton').disabled);
      }
    } finally {await page.evaluate(() => window.__spcVoicePreviewGate.release());}
    await page.waitForTimeout(120);
    assert.equal(await starts(),previousStarts,'A pending Voice preview must not restart after ' + action);
    assert.equal(await page.evaluate(() => window.__spcTest.view.state.playing),action === 'play',
      'A stale Voice preview must preserve the newer transport state');
    await page.evaluate(() => {window.__spcVoicePreviewGate=null;});
  }
  return {raw,voice,attack,cancelledBy:['stop','play','file']};
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
        await page.addInitScript(observePreviewStarts);
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
        const unavailableVoice = unusedRow.locator('select[data-spc-preview-mode] option').filter({hasText:'Voice settings unavailable'});
        assert.equal(await unavailableVoice.count(),1,'Unused samples must explain that captured voice settings are unavailable');
        assert.equal(await unavailableVoice.isDisabled(),true);
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
        // A real long candidate list must show the selected waveform alongside
        // its controls instead of sending the user back to the panel header.
        await page.locator('#fileInput').setInputFiles({name:'long-list.spc',mimeType:'application/octet-stream',buffer:withLongSampleList(original)});
        await scan.click();
        await page.waitForFunction(() => /24 candidate\(s\).*256 SRCNs checked/.test(document.getElementById('spcInfoPanel').textContent));
        const last = page.locator('#spcInfoPanel [data-source-numbers="23"]');
        const previous = page.locator('#spcInfoPanel [data-source-numbers="22"]');
        const lastWaveform = last.getByRole('button', {name:'Waveform', exact:true});
        const previousWaveform = previous.getByRole('button', {name:'Waveform', exact:true});
        const inlineCanvas = page.locator('#spcInfoPanel .spc-brr-waveform canvas');
        await lastWaveform.scrollIntoViewIfNeeded();
        await lastWaveform.click();
        await page.waitForFunction(() => document.querySelector('#spcInfoPanel canvas')?.closest('[data-source-numbers]')?.dataset.sourceNumbers === '23');
        assert.equal(await lastWaveform.getAttribute('aria-expanded'), 'true');
        const controlsId = await lastWaveform.getAttribute('aria-controls');
        assert(controlsId, 'A waveform control must identify its inline region');
        assert.equal(await last.locator(`[id="${controlsId}"]`).count(), 1, 'The expanded region belongs to the selected row');
        const waveformBounds = await inlineCanvas.boundingBox(), viewport = page.viewportSize();
        assert(waveformBounds.y >= 0 && waveformBounds.y + waveformBounds.height <= viewport.height,
          'Opening a waveform near the bottom must bring that row waveform into the viewport');
        const listHeading = await page.locator('#spcInfoPanel h2').boundingBox();
        assert(listHeading.y + listHeading.height < 0, 'Opening the last waveform must keep the long-list header offscreen');
        assert.equal(await page.locator('#spcInfoPanel canvas').count(), 1, 'The list must reuse one canvas');
        await page.screenshot({path:`/private/tmp/spc-brr-inline-waveform-${name}.png`});
        await previousWaveform.click();
        await page.waitForFunction(() => document.querySelector('#spcInfoPanel canvas')?.closest('[data-source-numbers]')?.dataset.sourceNumbers === '22');
        assert.equal(await lastWaveform.getAttribute('aria-expanded'), 'false');
        assert.equal(await previousWaveform.getAttribute('aria-expanded'), 'true');
        assert.equal(await page.locator('#spcInfoPanel button[aria-expanded="true"]').count(), 1, 'Only one candidate waveform may be expanded');
        await previousWaveform.click();
        assert.equal(await previousWaveform.getAttribute('aria-expanded'), 'false');
        assert.equal(await inlineCanvas.isVisible(), false, 'Clicking Waveform again closes it');
        await last.getByRole('button', {name:'Preview', exact:true}).click();
        await page.waitForFunction(() => document.querySelector('#spcInfoPanel canvas')?.closest('[data-source-numbers]')?.dataset.sourceNumbers === '23');
        assert.equal(await lastWaveform.getAttribute('aria-expanded'), 'true', 'Preview opens the waveform for the same candidate');
        await page.waitForFunction(() => window.__spcTest.view.state.paused && !!window.__spcTest.view.outputNode);
        await page.locator('#spcInfoPanel').getByRole('button', {name:'Capture BRR samples', exact:true}).click();
        await page.locator('#spcInfoPanel [data-source-numbers="0"]').waitFor({state:'visible'});
        assert.equal(await page.locator('#spcInfoPanel button[aria-expanded="true"]').count(), 1, 'Capturing replaces the old waveform selection with the first new sample');
        assert.equal(await last.count(), 0, 'An old selected row must be discarded on capture');
        assert.equal(await inlineCanvas.evaluate(canvas => canvas.closest('[data-source-numbers]').dataset.sourceNumbers), '0');
        await page.locator('#spcInfoPanel input[type="number"]').fill('22');
        await page.locator('#spcInfoPanel').getByRole('button', {name:'Extract SRCN',exact:true}).click();
        await previous.waitFor({state:'visible'});
        assert.equal(await page.locator('#spcInfoPanel button[aria-expanded="true"]').count(), 1, 'Explicit extraction selects its new sample instead of retaining an old row');
        assert.equal(await inlineCanvas.evaluate(canvas => canvas.closest('[data-source-numbers]').dataset.sourceNumbers), '22');
        const previewModes = await verifyVoiceModes(page,original,name);
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
          unusedSources:[42,127], aliasMetadata:true, staleScanFenced:true, inlineWaveform:true, previewModes, tagFade:true, staleLoadFenced:true, vgmAfterSpc:true}));
        await page.close();
      } finally {await browser.close();}
    }
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); process.exitCode = 1; server.close();});
