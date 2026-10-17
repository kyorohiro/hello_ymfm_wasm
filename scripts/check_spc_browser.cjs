// Real SPC700/S-DSP WASM in the production browser AudioWorklet graph.
// The fixture is authored test data: no game SPC, IPL ROM or external network.
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs/promises'), path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');
const root = path.resolve(__dirname, '..'), docs = path.join(root, 'docs');
const logPath = process.env.SPC_BROWSER_LOG ?? '/private/tmp/spc-browser-results.json';
const mime = {'.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html'};
let fixture;
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/') {response.setHeader('Content-Type', 'text/html'); response.end('<button>Enable audio</button>'); return;}
    if (pathname === '/fixture.spc') {response.end(fixture); return;}
    const delayed = pathname === '/delayed-spc.wasm';
    const file = path.resolve(docs, '.' + (delayed ? '/generated/spc_wasm.wasm' : pathname));
    if (!file.startsWith(docs + path.sep)) throw new Error('Invalid path');
    const bytes = await fs.readFile(file);
    response.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream');
    if (delayed) setTimeout(() => {if (!response.destroyed) response.end(bytes);}, 150);
    else response.end(bytes);
  } catch (error) {response.writeHead(404).end(error.message);}
});
async function playbackCase(page, rate) {
  return page.evaluate(async rate => {
    const {SpcRuntimeSynth} = await import('/js/spc_audio.js');
    const bytes = new Uint8Array(await (await fetch('/fixture.spc')).arrayBuffer());
    const context = new AudioContext({sampleRate: rate}), errors = [];
    const player = new SpcRuntimeSynth({audioContext: context, outputNode: context.destination,
      workletUrl: '/js/spc-worklet.js', wasmUrl: '/generated/spc_wasm.wasm', onError: error => errors.push(error.message)});
    let analyser, sink, detach;
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const insist = (condition, message) => {if (!condition) throw new Error(message);};
    try {
      const loaded = await player.loadSPC(bytes);
      insist(loaded.loaded && !loaded.playing && loaded.positionSeconds === 0, 'load must be paused at the SPC snapshot');
      insist(context.sampleRate === rate && player.isReady(), 'requested output sample rate / readiness');
      player.node.addEventListener('processorerror', () => errors.push('processorerror'));
      analyser = context.createAnalyser(); analyser.fftSize = 1024;
      sink = context.createGain(); sink.gain.value = 0;
      detach = player.audio.connectOutputMonitor(analyser); analyser.connect(sink); sink.connect(context.destination);
      const data = new Float32Array(1024);
      const sample = () => {
        analyser.getFloatTimeDomainData(data); let peak = 0, nonfinite = 0;
        for (const value of data) {if (!Number.isFinite(value)) nonfinite++; else peak = Math.max(peak, Math.abs(value));}
        insist(nonfinite === 0, 'SPC output must be finite'); return peak;
      };
      const monitor = async ms => {let peak = 0; const end = performance.now() + ms; do {await wait(8); peak = Math.max(peak, sample());} while (performance.now() < end); return peak;};
      const initial = await player.snapshot();
      insist(initial.ram.length === 65536 && initial.dsp.length === 128 && initial.nativeFrames === 0, 'atomic initial RAM/DSP snapshot');
      await player.play(); const peak = await monitor(180); insist(peak > .001, 'real SPC playback is silent');
      const paused = await player.pause(); await wait(60); const frozen = await player.getState();
      insist(frozen.positionSeconds === paused.positionSeconds && frozen.renderedNativeFrames === paused.renderedNativeFrames, 'pause must freeze native and output clocks');
      insist(sample() < 1e-6, 'paused graph did not settle to silence');
      const snapshot = await player.snapshot();
      insist(snapshot.nativeFrames >= snapshot.playbackNativeFrames && snapshot.nativeFrames - snapshot.playbackNativeFrames <= 130, 'native render-ahead must be bounded');
      insist(snapshot.nativeFrames > 0 && snapshot.ram.length === 65536 && snapshot.dsp.length === 128, 'running RAM/DSP snapshot');
      await player.setMuteMask(255); await player.play(); await wait(65);
      insist(sample() < 1e-6, 'muted dry voices remain audible');
      const muted = await player.getState(); insist(muted.positionSeconds > paused.positionSeconds, 'muted voices must not freeze the machine');
      await player.setMuteMask(0); const unmutedPeak = await monitor(100); insist(unmutedPeak > .001, 'unmute did not resume audio');
      player.mixer.set('snes_spc', {muted: true}); await wait(65); insist(sample() < 1e-6, 'existing mixer mute must affect output');
      player.mixer.set('snes_spc', {muted: false}); insist(await monitor(80) > .001, 'existing mixer unmute must restore output');
      const seeked = await player.seek(.25, {resume: false});
      insist(seeked.positionSeconds === .25 && !seeked.playing, 'seek uses exact native seconds');
      const afterSeek = await player.snapshot(); insist(afterSeek.nativeFrames === 8000, 'seek renders 8,000 native frames for .25 seconds');
      await player.play(); insist(await monitor(70) > .001, 'seeked playback silent');
      const abort = new AbortController(); let cancelled = false;
      try {await player.seek(2, {signal: abort.signal, onProgress() {abort.abort();}});} catch (error) {if (error.name !== 'AbortError') throw error; cancelled = true;}
      insist(cancelled, 'in-progress seek was not cancelled');
      const partial = await player.getState(); insist(!partial.playing && partial.positionSeconds === .5, 'cancel leaves a paused, accurately reported partial seek');
      const stopped = await player.stop(); insist(!stopped.playing && stopped.positionSeconds === 0, 'stop must restore the loaded snapshot');
      const reset = await player.snapshot(); insist(reset.nativeFrames === 0, 'stop native frame counter');
      insist(reset.ram.every((value, i) => value === initial.ram[i]) && reset.dsp.every((value, i) => value === initial.dsp[i]), 'stop must restore original RAM and DSP');
      await player.restart(); const restartPeak = await monitor(100); insist(restartPeak > .001, 'restart silent');
      const oldSeek = player.seek(20), stop = player.stop();
      let superseded = false; try {await oldSeek;} catch (error) {if (error.name !== 'AbortError') throw error; superseded = true;}
      await stop; insist(superseded && !(await player.getState()).playing, 'Stop must fence an older seek');
      let invalid = false; try {await player.loadSPC(new Uint8Array(16));} catch (error) {invalid = true;}
      insist(invalid, 'truncated SPC accepted');
      await player.restart(); insist(await monitor(70) > .001, 'bad input corrupted the previous file');
      const state = await player.getState();
      insist(errors.length === 0, errors.join('\n'));
      return {outputSampleRate: rate, nativeSampleRate: 32000, peak, unmutedPeak, restartPeak,
        pausedPositionSeconds: paused.positionSeconds, snapshotNativeFrames: snapshot.nativeFrames,
        renderAheadFrames: snapshot.nativeFrames - snapshot.playbackNativeFrames, finalState: state, errors};
    } finally {
      detach?.(); analyser?.disconnect(); sink?.disconnect(); await player.close();
      insist(context.state !== 'closed', 'a supplied AudioContext belongs to the host');
      await context.close();
    }
  }, rate);
}
async function closeDuringInitialization(page) {
  return page.evaluate(async () => {
    const {SpcRuntimeSynth} = await import('/js/spc_audio.js');
    let began; const fetching = new Promise(resolve => {began = resolve;});
    const player = new SpcRuntimeSynth({workletUrl: '/js/spc-worklet.js', wasmUrl: '/delayed-spc.wasm',
      fetch(url, options) {began(); return fetch(url, options);}});
    const starting = player.start().then(() => null, error => error); await fetching; const context = player.audioContext;
    await player.close(); let cancelled = false;
    const error = await starting; if (error?.name === 'AbortError') cancelled = true; else if (error) throw error;
    await new Promise(resolve => setTimeout(resolve, 180));
    if (!cancelled || player.node !== null || context.state !== 'closed') throw new Error('Closing initialization leaked the node or context');
    return {cancelled, contextClosed: context.state === 'closed', noLateNode: player.node === null};
  });
}
(async () => {
  const {createSyntheticSpc} = await import(pathToFileURL(path.join(root, 'web/spc_test_fixture.mjs')));
  fixture = createSyntheticSpc();
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const results = [];
  try {
    const engines = process.argv.includes('--chromium') ? [[chromium, 'chromium']] : process.argv.includes('--webkit') ? [[webkit, 'webkit']] : [[chromium, 'chromium'], [webkit, 'webkit']];
    for (const [engine, browserName] of engines) {
      const browser = await engine.launch({headless: true, ...(browserName === 'chromium' ? {args: ['--autoplay-policy=no-user-gesture-required']} : {})});
      try {
        const page = await browser.newPage(), errors = [], consoleErrors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {if (message.type() === 'error') consoleErrors.push(message.text());});
        await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.click('button');
        for (const rate of [44100, 48000]) {
          const result = await playbackCase(page, rate); results.push({browser: browserName, ...result});
          console.log(JSON.stringify({passed: true, browser: browserName, ...result}));
        }
        const initialization = await closeDuringInitialization(page);
        // The intentionally aborted WASM request is not an application error.
        const unexpectedConsoleErrors = consoleErrors.filter(message => !/aborted|cancelled|ERR_ABORTED/i.test(message));
        assert.deepEqual(errors, []); assert.deepEqual(unexpectedConsoleErrors, []);
        console.log(JSON.stringify({passed: true, browser: browserName, initialization}));
      } finally {await browser.close();}
    }
    await fs.writeFile(logPath, JSON.stringify({passed: true, results}, null, 2));
    console.log(JSON.stringify({passed: true, cases: results.length, logPath}));
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); server.close(); process.exitCode = 1;});
