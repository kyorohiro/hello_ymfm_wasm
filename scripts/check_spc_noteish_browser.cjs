// Actual Analyzer SPC Note-ish / score UI, downloads, worker analysis and PCM.
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
    return {peak,rms,frequency,bad,contextState:context.state,positionSeconds:p.view.state.positionSeconds,
      playing:p.view.state.playing,paused:p.view.state.paused,muteMask:p.view.state.muteMask};
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

// Decode the actual downloaded SMF independently of the application's writer.
function decodeMidi(bytes) {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const ascii = (at,n) => bytes.subarray(at,at + n).toString('ascii');
  assert.equal(ascii(0,4),'MThd'); assert.equal(view.getUint32(4),6); assert.equal(view.getUint16(8),1);
  const count = view.getUint16(10), ppqn = view.getUint16(12), tracks = []; let position = 14;
  const variable = () => {let value = 0; for (let n = 0; n < 4; n++) {
    const b = bytes[position++]; value = value * 128 + (b & 127); if (!(b & 128)) return value;
  } assert.fail('Invalid MIDI VLQ');};
  for (let n = 0; n < count; n++) {
    assert.equal(ascii(position,4),'MTrk'); const end = position + 8 + view.getUint32(position + 4);
    position += 8; let tick = 0; const events = [];
    while (position < end) {
      tick += variable(); const status = bytes[position++];
      if (status === 255) {
        const type = bytes[position++], length = variable(), data = bytes.subarray(position,position + length);
        position += length; events.push({tick,status,type,data});
      } else {
        assert([0x80,0x90,0xb0,0xc0,0xe0].includes(status & 0xf0));
        const data = bytes.subarray(position,position + ((status & 0xf0) === 0xc0 ? 1 : 2));
        position += data.length; assert([...data].every(value => value < 128)); events.push({tick,status,data});
      }
    }
    assert.equal(position,end); assert.equal(events.at(-1).type,47); tracks.push(events);
  }
  assert.equal(position,bytes.length); return {ppqn,tracks};
}
async function downloadFrom(page,dialog,extension) {
  const download = page.waitForEvent('download'); await page.locator(`${dialog} button[value="export"]`).click();
  const file = await download; assert(file.suggestedFilename().endsWith(extension),file.suggestedFilename());
  return fs.readFile(await file.path());
}
async function midiExport(page) {
  await page.locator('#exportMidiButton').click();
  assert.match(await page.locator('#midiBpmHelp').innerText(),/Analyzed interval: 0[–-]2\.00 seconds/i,
    'SPC MIDI identifies the captured interval rather than promising the complete song');
  await page.locator('#midiBpmInput').fill('120');
  const midi = decodeMidi(await downloadFrom(page,'#midiExportDialog','.mid'));
  assert.equal(midi.ppqn,960); assert.equal(midi.tracks.length,9,'Conductor plus all eight physical S-DSP voices');
  for (const track of midi.tracks) assert.equal(track.at(-1).tick,3840,'Two actual seconds remain two seconds at 120 BPM');
  for (let ch = 1; ch <= 8; ch++) assert.match(midi.tracks[ch].find(e => e.type === 3)?.data.toString(),new RegExp(`Voice ${ch}\\b`));
  return midi;
}
async function openSheetSettings(page) {
  await page.locator('#sheetMusicTab').click();
  await page.locator('#showSheetMusicButton').click();
  await page.locator('#musicSheetExportDialog').waitFor({state:'visible'});
  assert.equal(await page.locator('#musicSheetChannels input').count(),8,'Sheet settings offer all eight SPC voices');
  assert.match(await page.locator('#musicSheetTempoHelp').innerText(),/Analyzed interval: 0[–-]2\.00 seconds/i);
  await page.locator('#musicSheetBpmInput').fill('120');
}
async function previewSheet(page,label) {
  await openSheetSettings(page);
  await page.locator('#musicSheetExportDialog button[value="preview"]').click();
  await page.locator('#sheetMusicPanel [data-pages] svg').first().waitFor({state:'visible'});
  await page.waitForFunction(() => /^\d+ notes/.test(document.querySelector('#sheetMusicPanel [data-status]').textContent));
  assert(await page.locator('#sheetMusicPanel [data-pages] svg path').count() > 5,'OSMD produced musical glyph paths');
  assert.match(await page.locator('#sheetMusicPanel [data-pages]').innerText(),/Voice 1/);
  await page.locator('#sheetMusicPanel').screenshot({path:`/private/tmp/spc-score-${label}.png`});
}
async function scoreExports(page) {
  await openSheetSettings(page);
  const musicXml = (await downloadFrom(page,'#musicSheetExportDialog','.musicxml')).toString();
  assert.match(musicXml,/<score-partwise/); assert.match(musicXml,/<part-name>SNES Voice 1<\/part-name>/);
  assert.match(musicXml,/<pitch><step>C<\/step><octave>4<\/octave><\/pitch>/,
    'MusicXML uses the corrected BRR reference');
  await page.locator('#exportLilyPondButton').click();
  assert.equal(await page.locator('#lilyPondChannels input').count(),8);
  assert.match(await page.locator('#lilyPondTempoHelp').innerText(),/Analyzed interval: 0[–-]2\.00 seconds/i);
  await page.locator('#lilyPondBpmInput').fill('120');
  const lilyPond = (await downloadFrom(page,'#lilyPondExportDialog','.ly')).toString();
  assert.match(lilyPond,/\\new Staff/); assert.match(lilyPond,/instrumentName = "SNES Voice 1"/);
  assert.match(lilyPond,/\bc'\d/,'LilyPond uses corrected C4 instead of the estimated B6');
  return {musicXmlBytes:Buffer.byteLength(musicXml),lilyPondBytes:Buffer.byteLength(lilyPond)};
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
    assert.equal(await page.locator('#sheetMusicTab').isDisabled(),false,
      'Sheet Music is available before the first offline capture');
    await page.locator('#sheetMusicTab').click();
    await page.locator('#spcNoteishControls').waitFor({state:'visible'});
    await readyNotes(page);
    assert((await workerRequests(page)).length > 0,'SPC Note-ish captures in a dedicated Worker');
    assert.equal((await workerRequests(page)).at(-1).durationSeconds,2,'Lazy analysis uses the selected interval');
    assert.equal((await channelState(page)).length,8,'All eight physical S-DSP voices use the shared Note-ish view');
    assert.equal(await page.locator('#exportMidiButton').isDisabled(),false,'Captured SPC notes enable MIDI export');
    assert.equal(await page.locator('#sheetMusicTab').isDisabled(),false,'SPC supports the shared sheet-music view');
    const estimatedMidi = await midiExport(page);
    const estimatedNote = estimatedMidi.tracks[1].find(event => (event.status & 0xf0) === 0x90)?.data[0];
    assert.equal(estimatedNote,95,'Estimated 2000-Hz BRR starts at B6');
    await previewSheet(page,`estimated-${name}`);
    await page.locator('#noteishTab').click();
    await page.locator('#notePitchTab').click();
    await page.locator('#inlinePlayButton').click();
    await page.waitForFunction(() => window.__spcNoteishTest.view.state.playing);
    // Wait for actual first Worklet PCM after starting the audio context.
    // OSMD has just initialized in this run and browser startup is variable.
    let before = await signal(page);
    for (let retry = 0; retry < 5 && before.rms <= .001; retry++) before = await signal(page);
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
    assert.equal(await page.locator('#sheetMusicPanel [data-pages] svg').count(),0,
      'Changing the display reference also invalidates the old score preview');
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
    assert.equal(await page.locator('#exportMidiButton').isDisabled(),true,
      'An invalid reference cannot silently export an older valid score');
    assert.equal(await page.locator('#exportLilyPondButton').isDisabled(),true);
    assert.equal(await page.locator('#showSheetMusicButton').isDisabled(),true);
    await row.locator('[data-spc-note-reference]').fill('C4');
    await row.locator('[data-spc-note-cents]').fill('');
    assert.equal(await row.locator('[data-spc-note-cents]').evaluate(input => input.checkValidity()),false);
    await expectMidi(page,60.2325);
    await row.locator('[data-spc-note-cents]').fill('23.25');
    assert.equal(await page.locator('#exportMidiButton').isDisabled(),false,
      'Correcting reference input restores exports');
    const octaveCorrected = await signal(page);
    assert.equal(octaveCorrected.bad,0); assert(Math.abs(octaveCorrected.frequency - before.frequency) < 8);
    assert.deepEqual(await workerRequests(page),requestsBefore,'Changing a reference or octave must not repeat the capture');
    assert.deepEqual(await page.evaluate(() => window.__spcNoteishAudioCalls),callsBefore,
      'Reference and octave edits must not send commands to original SPC playback');
    const correctedMidi = await midiExport(page);
    assert.equal(correctedMidi.tracks[1].find(event => (event.status & 0xf0) === 0x90)?.data[0],60,
      'The downloaded MIDI follows the corrected C4 BRR reference');
    assert(correctedMidi.tracks[1].some(event => (event.status & 0xf0) === 0xe0 && event.data[0] + event.data[1] * 128 !== 8192),
      'The cents correction survives as a MIDI pitch bend');
    const exportedScores = await scoreExports(page);
    await previewSheet(page,`corrected-${name}`);
    await page.locator('#noteishTab').click();
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
    assert.equal(await page.locator('#sheetMusicPanel [data-pages] svg').count(),0,
      'Reanalysis invalidates a previously rendered score');
    assert.equal(await page.locator('#exportMidiButton').isDisabled(),true,'No stale MIDI while analysis is pending');
    await page.locator('#sheetMusicTab').click();
    assert.equal(await page.locator('#spcNoteishControls').isVisible(),true,
      'Sheet Music retains access to SPC interval and BRR controls');
    assert.equal(await page.locator('#spcNoteishControls').getAttribute('data-spc-notes-state'),'loading',
      'Changing from Note-ish to Sheet Music does not cancel the shared Worker');
    await releaseAnalysisResult(page); await readyNotes(page);
    assert.equal(await page.locator('#sheetMusicTab').getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('#exportMidiButton').isDisabled(),false);
    await page.locator('#noteishTab').click();
    // A fresh pending capture is canceled explicitly; its delayed result may
    // not restore export settings or previews from the preceding capture.
    await armAnalysisResult(page);
    await page.locator('#spcNoteishControls [data-spc-notes-cancel]').click();
    assert.equal(await page.locator('#spcNoteishControls').getAttribute('data-spc-notes-state'),'idle');
    assert.equal(await page.locator('#exportMidiButton').isDisabled(),true);
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
    const bentMidi = await midiExport(page);
    assert.equal(bentMidi.tracks[1].filter(event => (event.status & 0xf0) === 0x90).length,2,
      'Held pitch changes remain bends while a real KON retrigger becomes a new MIDI note');
    assert(bentMidi.tracks[1].some(event => (event.status & 0xf0) === 0xe0 && event.tick > 0 && event.tick < 3840),
      'Mid-note hardware PITCH updates survive in the downloaded MIDI');
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

    // An open score settings dialog and its rendered source belong to one
    // captured SPC, including when a file changes through the file picker.
    await previewSheet(page,`events-${name}`);
    await openSheetSettings(page);
    await openSpc(page,fixture,'noteish-score-replacement.spc');
    assert.equal(await page.locator('#musicSheetExportDialog').isVisible(),false,
      'Replacing an SPC closes obsolete score settings');
    assert.equal(await page.locator('#sheetMusicPanel [data-pages] svg').count(),0,
      'Replacing an SPC clears its previously rendered music sheet');
    await openNotes(page); await readyNotes(page);

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
      scoreExports:exportedScores,midiTracks:correctedMidi.tracks.length,midiEstimatedNote:estimatedNote,
      midiCorrectedNote:60,midiCentsBend:true,osmdSvg:true,referenceInvalidatesScore:true,sheetRetainsWorker:true,
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
