// Actual Analyzer SPC Note-ish UI, worker analysis and original AudioWorklet PCM.
// Every SPC/BRR fixture below is authored synthetic data, without game assets.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const {pathToFileURL} = require('node:url');
const {chromium,webkit} = require('playwright');
const root = path.resolve(__dirname,'..'), stageAt = process.argv.indexOf('--stage');
const docs = stageAt < 0 ? path.join(root,'docs') : path.resolve(process.argv[stageAt + 1]);
const entry = stageAt < 0 ? '/vgm_analyzer/' : '/';
const mime = {'.js':'text/javascript','.wasm':'application/wasm','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const server = http.createServer(async (request,response) => {
  try {
    let file = path.resolve(docs,'.' + decodeURIComponent(new URL(request.url,'http://localhost').pathname));
    if (file !== docs && !file.startsWith(docs + path.sep)) throw Error('Outside test root');
    if ((await fs.stat(file)).isDirectory()) file = path.join(file,'index.html');
    let body = await fs.readFile(file);
    if (path.basename(file) === 'vgm_analyzer.js') body = Buffer.from(body.toString() + `
window.__spcNoteishTest={view:spcView,notes:spcNoteish,getContext:()=>audioContext,channels:()=>noteishChannels(),chip:()=>currentChipKind};
`);
    response.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream'); response.end(body);
  } catch (error) {response.writeHead(404).end(String(error));}
});
function observeWorkers() {
  window.__spcNoteishWorkers = [];
  const NativeWorker = window.Worker, post = NativeWorker.prototype.postMessage;
  const descriptor = Object.getOwnPropertyDescriptor(NativeWorker.prototype,'onmessage');
  const urls = new WeakMap();
  window.Worker = new Proxy(NativeWorker,{construct(Target,args) {
    const worker = Reflect.construct(Target,args), url = String(args[0]); urls.set(worker,url);
    if (url.includes('spc_noteish_worker.js')) {
      let assigned = null;
      Object.defineProperty(worker,'onmessage',{configurable:true,get:() => assigned,set(fn) {
        assigned = fn;
        descriptor.set.call(worker,fn ? event => {
          const gate = window.__spcNoteishGate;
          if (gate?.armed && event.data?.type === 'result') {
            gate.armed = false; gate.entered = true;
            // Hold the real completed result, then deliberately deliver it to
            // the original listener even if its Worker has since terminated.
            gate.release = () => fn.call(worker,event); return;
          }
          fn.call(worker,event);
        } : null);
      }});
    }
    return worker;
  }});
  NativeWorker.prototype.postMessage = function(message,...args) {
    if ((urls.get(this) || '').includes('spc_noteish_worker.js')) window.__spcNoteishWorkers.push({
      action:message?.action,durationSeconds:message?.durationSeconds,controlStepMs:message?.controlStepMs});
    return Reflect.apply(post,this,[message,...args]);
  };
}
function withMusicalEvents(bytes) {
  const fixture = Buffer.from(bytes), ram = fixture.subarray(0x100,0x10100), code = [];
  const write = (register,value) => code.push(0x8f,register,0xf2,0x8f,value,0xf3);
  const delay = () => {
    code.push(0xcd,160); const outer = code.length;
    code.push(0x8d,255,0xfe,0xfe,0x1d,0xd0,0); code[code.length - 1] = (outer - code.length) & 255;
  };
  delay(); write(3,8); delay(); write(0x5c,1);
  delay(); write(0x5c,0); write(0x4c,1); delay(); write(0x5c,1);
  code.push(0x2f,0xfe); ram.set(code,0x200); return fixture;
}
async function openSpc(page,fixture,name) {
  await page.locator('#fileInput').setInputFiles({name,mimeType:'application/octet-stream',buffer:fixture});
  await page.waitForFunction(name => window.__spcNoteishTest?.view.active
    && document.getElementById('spcInfoPanel').textContent.includes(name.replace(/\.spc$/i,''))
    && !document.getElementById('inlinePlayButton').disabled,name);
  assert.equal(await page.locator('#noteishTab').isDisabled(),false,'SPC enables the shared Note-ish tab');
}
async function openNotes(page) {
  await page.locator('#noteishTab').click();
  await page.locator('#spcNoteishControls').waitFor({state:'visible'});
}
async function readyNotes(page) {
  await page.locator('#spcNoteishControls[data-spc-notes-state="ready"]').waitFor({state:'visible'});
  assert.equal(await page.locator('#spcNoteishControls [data-spc-note-sample]').count(),1,
    'Offline capture identifies the one actual BRR version, independently of all 256 directory entries');
}
async function captureNotes(page,seconds = 2) {
  const controls = page.locator('#spcNoteishControls');
  await controls.locator('[data-spc-notes-seconds]').fill(String(seconds));
  await controls.locator('[data-spc-notes-control-step]').fill('20');
  await controls.locator('[data-spc-notes-analyze]').click();
  await readyNotes(page);
}
async function installAudioCommandProbe(page) {
  await page.evaluate(async () => {
    const {SpcRuntimeSynth} = await import(new URL('../js/spc_audio.js',location.href).href);
    window.__spcNoteishAudioCalls = [];
    for (const method of ['loadSPC','play','pause','stop','seek','setMuteMask']) {
      const original = SpcRuntimeSynth.prototype[method];
      SpcRuntimeSynth.prototype[method] = function(...args) {
        window.__spcNoteishAudioCalls.push({method,args:method === 'loadSPC' ? [] : args});
        return original.apply(this,args);
      };
    }
  });
}
async function signal(page) {
  return page.evaluate(async () => {
    const p = window.__spcNoteishTest, context = p.getContext(), output = p.view.outputNode;
    const meter = context.createAnalyser(), sink = context.createGain(); meter.fftSize = 8192;
    sink.gain.value = 0; output.connect(meter); meter.connect(sink); sink.connect(context.destination);
    let peak = 0, rms = 0, frequency = 0, bad = 0;
    try {
      const pcm = new Float32Array(meter.fftSize), spectrum = new Float32Array(meter.frequencyBinCount);
      for (let batch = 0; batch < 4; batch++) {
        await new Promise(resolve => setTimeout(resolve,50));
        meter.getFloatTimeDomainData(pcm); meter.getFloatFrequencyData(spectrum);
        let sum = 0, peakBin = 1;
        for (const value of pcm) {if (!Number.isFinite(value)) bad++; else {peak = Math.max(peak,Math.abs(value)); sum += value * value;}}
        rms = Math.max(rms,Math.sqrt(sum / pcm.length));
        for (let bin = 2; bin < spectrum.length; bin++) if (spectrum[bin] > spectrum[peakBin]) peakBin = bin;
        frequency = peakBin * context.sampleRate / meter.fftSize;
      }
    } finally {output.disconnect(meter); meter.disconnect(); sink.disconnect();}
    return {peak,rms,frequency,bad};
  });
}
async function stop(page) {
  await page.locator('#inlineStopButton').click();
  await page.waitForFunction(() => !window.__spcNoteishTest.view.state.playing
    && window.__spcNoteishTest.view.state.positionSeconds === 0);
  const silence = await signal(page); assert.equal(silence.bad,0); assert(silence.peak < .00001,JSON.stringify(silence));
  return silence;
}
async function workerRequests(page) {return page.evaluate(() => window.__spcNoteishWorkers);}
async function channelState(page) {
  return page.evaluate(() => window.__spcNoteishTest.channels().map(channel => ({
    channel:channel.channel,label:channel.label,keyOn:channel.keyOn,muted:channel.muted,
    toneMidi:channel.toneMidi,pitch:channel.pitch,snes:channel.snes,
    referenceKind:channel.referenceKind,sourceNumber:channel.sourceNumber,sampleId:channel.sampleId,
  })));
}
async function expectMidi(page,midi) {
  await page.waitForFunction(midi => {
    const channel = window.__spcNoteishTest.channels()[0];
    return Number.isFinite(channel?.toneMidi) && Math.abs(channel.toneMidi - midi) < .000001;
  },midi);
}
async function armAnalysisResult(page) {
  await page.evaluate(() => {window.__spcNoteishGate = {armed:true,entered:false,release:null};});
  await page.locator('#spcNoteishControls [data-spc-notes-analyze]').click();
  await page.waitForFunction(() => window.__spcNoteishGate?.entered);
  await page.locator('#spcNoteishControls[data-spc-notes-state="loading"]').waitFor({state:'visible'});
}
async function releaseAnalysisResult(page) {
  await page.evaluate(() => {window.__spcNoteishGate?.release?.(); window.__spcNoteishGate = null;});
}
async function referenceUi(page) {
  return page.locator('#spcNoteishControls').evaluate(root => ({
    status:root.querySelector('[data-spc-notes-status]').textContent,
    rows:[...root.querySelectorAll('[data-spc-note-sample]')].map(row => ({
      id:row.dataset.spcNoteSample,note:row.querySelector('[data-spc-note-reference]').value,
      cents:row.querySelector('[data-spc-note-cents]').value,text:row.textContent,
    })),
  }));
}

async function checkBrowser(name,engine,url,fixture,musical) {
  const browser = await engine.launch({headless:true,...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1400,height:1000},serviceWorkers:'block'}), errors = [];
    page.setDefaultTimeout(30000); page.on('pageerror',error => errors.push({message:error.message,stack:error.stack}));
    page.on('dialog',dialog => {errors.push({message:'Unexpected dialog: ' + dialog.message()}); return dialog.dismiss();});
    await page.addInitScript(observeWorkers);
    await page.goto(url); await page.waitForFunction(() => window.__spcNoteishTest);
    await installAudioCommandProbe(page);
    await openSpc(page,fixture,'noteish-original.spc');
    assert.equal((await workerRequests(page)).length,0,'Opening an SPC must not analyze a long interval until Note-ish is requested');
    await page.locator('#spcNoteishControls [data-spc-notes-seconds]').evaluate(input => {
      input.value = '2'; input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await openNotes(page);
    await readyNotes(page);
    assert((await workerRequests(page)).length > 0,'SPC Note-ish captures in a dedicated Worker');
    assert.equal((await workerRequests(page)).at(-1).durationSeconds,2,'Lazy analysis uses the selected interval');
    assert.equal((await channelState(page)).length,8,'All eight physical S-DSP voices use the shared Note-ish view');
    assert.equal(await page.locator('#exportMidiButton').isDisabled(),true,'SPC note estimates do not imply MIDI export support');
    await page.locator('#notePitchTab').click();
    await page.locator('#inlinePlayButton').click();
    await page.waitForFunction(() => window.__spcNoteishTest.view.state.playing);
    const before = await signal(page);
    assert.equal(before.bad,0); assert(before.rms > .001 && Math.abs(before.frequency - 2000) < 30,JSON.stringify(before));
    const channels = await channelState(page);
    assert(channels.every(channel => channel.snes));
    assert(channels[0].keyOn && channels[0].pitch === 4096);
    assert(Math.abs(channels[0].toneMidi - (69 + 12 * Math.log2(2000 / 440))) < .01,
      'Detected BRR frequency and raw PITCH determine the displayed note');
    await page.locator('#spcNoteishControls').evaluate(root => root.scrollIntoView({block:'start'}));
    await page.screenshot({path:`/private/tmp/spc-noteish-ready-${name}.png`});

    await page.locator('#spcNoteishControls details > summary').click();
    const row = page.locator('#spcNoteishControls [data-spc-note-sample="0"]');
    const requestsBefore = await workerRequests(page);
    const callsBefore = await page.evaluate(() => window.__spcNoteishAudioCalls);
    await row.locator('[data-spc-note-reference]').fill('C5');
    await row.locator('[data-spc-note-cents]').fill('23.25');
    await expectMidi(page,72.2325);
    await page.waitForFunction(() => /C5/.test(document.querySelector('#noteishGrid .noteish-note')?.textContent || ''));
    assert.match(await row.innerText(),/manual/i);
    const manual = await signal(page);
    assert.equal(manual.bad,0); assert(Math.abs(manual.frequency - before.frequency) < 8);
    assert(Math.abs(manual.rms / before.rms - 1) < .05,'Reference edits must not change the original SPC audio level');
    // Correct a detector octave mistake by editing only its reference note.
    await row.locator('[data-spc-note-reference]').fill('C4');
    await expectMidi(page,60.2325);
    assert.equal(await row.locator('[data-spc-note-cents]').inputValue(),'23.25');
    await row.locator('[data-spc-note-reference]').fill('not-a-note');
    assert.equal(await row.locator('[data-spc-note-reference]').evaluate(input => input.checkValidity()),false);
    await expectMidi(page,60.2325);
    await row.locator('[data-spc-note-reference]').fill('C4');
    await row.locator('[data-spc-note-cents]').fill('');
    assert.equal(await row.locator('[data-spc-note-cents]').evaluate(input => input.checkValidity()),false);
    await expectMidi(page,60.2325);
    await row.locator('[data-spc-note-cents]').fill('23.25');
    const octaveCorrected = await signal(page);
    assert.equal(octaveCorrected.bad,0); assert(Math.abs(octaveCorrected.frequency - before.frequency) < 8);
    assert.deepEqual(await workerRequests(page),requestsBefore,'Changing a reference or octave must not repeat the capture');
    assert.deepEqual(await page.evaluate(() => window.__spcNoteishAudioCalls),callsBefore,
      'Reference and octave edits must not send commands to original SPC playback');
    await page.locator('#spcNoteishControls').evaluate(root => root.scrollIntoView({block:'start'}));
    await page.screenshot({path:`/private/tmp/spc-noteish-manual-${name}.png`});
    for (const [tab,pane] of [['noteLiveTab','noteLivePane'],['noteFretTab','noteFretPane'],
      ['noteAllFretTab','noteAllFretPane'],['noteKeyboardTab','noteKeyboardPane']]) {
      await page.locator('#' + tab).click();
      assert(await page.locator('#' + pane).isVisible(),`${tab} accepts the SPC note adapter`);
    }
    await page.locator('#notePitchTab').click();

    // Shared SPC voice controls still mute real audio and the Note-ish state.
    await page.locator('#sampleExplorerTab').click();
    for (const button of await page.locator('#spcInfoPanel .monitor-toggles button').all()) await button.click();
    const muted = await signal(page); assert(muted.peak < .00001 && muted.bad === 0,JSON.stringify(muted));
    await page.locator('#noteishTab').click();
    assert((await channelState(page)).every(channel => channel.muted));
    await page.locator('#sampleExplorerTab').click();
    await page.locator('#spcInfoPanel .monitor-toggles button').first().click();
    await page.locator('#noteishTab').click();
    assert((await signal(page)).rms > .001);
    await page.locator('#inlinePauseButton').click();
    await page.waitForFunction(() => window.__spcNoteishTest.view.state.paused);
    const paused = await page.evaluate(() => window.__spcNoteishTest.view.state.positionSeconds);
    const pausedChannels = await channelState(page);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.__spcNoteishTest.view.state.positionSeconds),paused);
    assert.deepEqual(await channelState(page),pausedChannels,'Paused notes stay at the paused SPC song position');
    const beforeInvalid = await workerRequests(page);
    await page.locator('#spcNoteishControls [data-spc-notes-seconds]').fill('0');
    await page.locator('#spcNoteishControls [data-spc-notes-analyze]').click();
    assert.deepEqual(await workerRequests(page),beforeInvalid,'Invalid analysis settings do not start a Worker');
    await page.locator('#spcNoteishControls [data-spc-notes-seconds]').fill('');
    assert.equal(await page.locator('#spcNoteishControls [data-spc-notes-seconds]').evaluate(input => input.checkValidity()),false);
    await page.locator('#spcNoteishControls [data-spc-notes-analyze]').click();
    assert.deepEqual(await workerRequests(page),beforeInvalid,'An empty required duration must not start a Worker');
    await page.locator('#spcNoteishControls [data-spc-notes-seconds]').fill('2');
    await page.locator('#spcNoteishControls [data-spc-notes-control-step]').fill('');
    assert.equal(await page.locator('#spcNoteishControls [data-spc-notes-control-step]').evaluate(input => input.checkValidity()),false);
    await page.locator('#spcNoteishControls [data-spc-notes-analyze]').click();
    assert.deepEqual(await workerRequests(page),beforeInvalid,'An empty required control step must not start a Worker');
    await page.locator('#spcNoteishControls [data-spc-notes-control-step]').fill('20');
    await armAnalysisResult(page);
    await page.locator('#spcNoteishControls [data-spc-notes-cancel]').click();
    assert.equal(await page.locator('#spcNoteishControls').getAttribute('data-spc-notes-state'),'idle');
    const canceled = await referenceUi(page);
    await releaseAnalysisResult(page); await page.waitForTimeout(150);
    assert.deepEqual(await referenceUi(page),canceled,'Cancel fences a completed but delayed analysis result');
    assert.equal(await page.evaluate(() => window.__spcNoteishTest.view.state.positionSeconds),paused,
      'Canceling display analysis must not seek or resume the paused player');
    await captureNotes(page);
    await stop(page);
    await readyNotes(page);
    assert((await channelState(page)).every(channel => !channel.keyOn),'Stop makes the live Note-ish voices inactive');

    // Real DSP writes change the observed pitch; seeking uses the same song
    // position rather than delayed callback arrival or wall-clock time.
    await openSpc(page,musical,'noteish-events.spc');
    await openNotes(page); await captureNotes(page);
    assert.doesNotMatch((await referenceUi(page)).rows[0].text,/manual/i,'A new SPC starts with its own references');
    await page.locator('#inlinePlaybackSeek').evaluate(input => {
      input.value = '400'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change'));
    });
    await page.waitForFunction(() => Math.abs(window.__spcNoteishTest.view.state.positionSeconds - .4) < .00001);
    await page.waitForFunction(() => window.__spcNoteishTest.channels()[0]?.pitch === 2048);
    assert((await channelState(page))[0].keyOn,'A paused seek inside the held note retains its musical key state');
    await page.locator('#noteSongTab').click();
    await page.waitForFunction(() => /2\.00 seconds/.test(document.querySelector('#noteTimeline [data-role="status"]').textContent));
    assert.match(await page.locator('#noteTimeline [data-role="legend"]').innerText(),/Voice 1/i,
      'The shared song timeline contains the actual SPC voice');
    await page.waitForFunction(() => {
      const canvas = document.querySelector('#noteTimeline canvas');
      const pixels = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      let colored = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] > pixels[index + 1] + 30 && pixels[index + 1] > pixels[index + 2] + 5) colored++;
      }
      window.__spcNoteishSongPixels = colored; return colored > 20;
    });
    await page.locator('#noteTimeline').evaluate(root => root.scrollIntoView({block:'start'}));
    // Offscreen canvas pixels can exist before a scroll's compositor frame.
    // Wait for ordinary browser frames, without resizing or forcing a canvas
    // screenshot, so this page image also verifies the user's visible chart.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({path:`/private/tmp/spc-noteish-song-${name}.png`});
    const songLayout = await page.locator('#noteTimeline canvas').evaluate(canvas => {
      const rect = node => {const r = node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
      const style = getComputedStyle(canvas);
      return {canvas:rect(canvas),scroll:rect(canvas.parentElement),style:{display:style.display,visibility:style.visibility,position:style.position,height:style.height,top:style.top},
        width:canvas.width,height:canvas.height,scrollTop:canvas.parentElement.scrollTop,scrollLeft:canvas.parentElement.scrollLeft};
    });
    await page.locator('#noteTimeline canvas').screenshot({path:`/private/tmp/spc-noteish-song-canvas-${name}.png`});
    await page.locator('#noteTimeline [data-role="position"]').fill('0.9');
    await page.locator('#noteTimeline [data-role="position"]').dispatchEvent('change');
    await captureNotes(page);
    assert.equal(Number(await page.locator('#noteTimeline [data-role="position"]').inputValue()),.9,
      'Reanalyzing must retain a pending selected Song cursor in 44,100-Hz display units');
    await page.locator('#noteTimeline [data-action="play"]').click();
    await page.waitForFunction(() => window.__spcNoteishTest.view.state.playing);
    const selectedSeek = await page.evaluate(() => window.__spcNoteishAudioCalls.filter(call => call.method === 'seek').at(-1));
    assert.equal(selectedSeek.args[0],.9,'Song timeline 44,100-Hz ticks must convert to SPC seconds exactly');
    await stop(page);

    // Analysis completion after Stop may update offline notes but never resume
    // audio; a completed obsolete file analysis may not update the next track.
    await armAnalysisResult(page);
    await page.locator('#inlinePlayButton').click();
    await page.waitForFunction(() => window.__spcNoteishTest.view.state.playing);
    await stop(page); await releaseAnalysisResult(page); await readyNotes(page);
    assert.equal(await page.evaluate(() => window.__spcNoteishTest.view.state.playing),false);
    assert((await signal(page)).peak < .00001);

    await armAnalysisResult(page);
    await openSpc(page,fixture,'noteish-replacement.spc');
    await openNotes(page); await readyNotes(page);
    const replacement = await referenceUi(page);
    await releaseAnalysisResult(page); await page.waitForTimeout(150);
    assert.deepEqual(await referenceUi(page),replacement,'A late old SPC analysis must not replace the new file references or status');
    assert.doesNotMatch(replacement.rows[0].text,/manual/i,'Manual references are local to one loaded SPC');

    await armAnalysisResult(page);
    await page.locator('#fileInput').setInputFiles(path.join(root,'test/fixtures/psg-tone.vgm'));
    await page.waitForFunction(() => !window.__spcNoteishTest.view.active && !document.getElementById('inlinePlayButton').disabled);
    await releaseAnalysisResult(page); await page.waitForTimeout(150);
    assert.equal(await page.locator('#spcNoteishControls').isVisible(),false);
    assert.equal(await page.locator('#spcNoteishControls [data-spc-note-sample]').count(),0);
    assert((await channelState(page)).every(channel => !channel.snes),'VGM note channels must not retain stale SNES notes');
    await page.locator('#inlinePlayButton').click(); await page.waitForTimeout(100);
    await page.locator('#inlineStopButton').click();
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({browser:name,passed:true,before,manual,octaveCorrected,muted,
      eightPhysicalVoices:true,workerAnalysis:true,noAudioCommandsForReference:true,pauseSeekStop:true,
      stopDoesNotResume:true,staleSpcFenced:true,staleVgmFenced:true,vgmAfterSpc:true,
      songNotePixels:await page.evaluate(() => window.__spcNoteishSongPixels),songLayout,workerRequests:await workerRequests(page)}));
    await page.close();
  } finally {await browser.close();}
}
(async () => {
  const {createSyntheticSpc} = await import(pathToFileURL(path.join(root,'web/spc_test_fixture.mjs')));
  const fixture = Buffer.from(createSyntheticSpc({voices:1})), musical = withMusicalEvents(fixture);
  await new Promise((resolve,reject) => {server.once('error',reject); server.listen(0,'127.0.0.1',resolve);});
  try {
    const browsers = process.argv.includes('--chromium') ? [['chromium',chromium]]
      : process.argv.includes('--webkit') ? [['webkit',webkit]] : [['chromium',chromium],['webkit',webkit]];
    for (const [name,engine] of browsers) await checkBrowser(name,engine,`http://127.0.0.1:${server.address().port}${entry}`,fixture,musical);
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); process.exitCode = 1; server.close();});
