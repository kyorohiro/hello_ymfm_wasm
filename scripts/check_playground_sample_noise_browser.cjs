// Serve docs on port 8093. Optional args: URL, chromium|webkit, seconds, output Hz.
// Records the output after sample mixing, reverb and master gain. Repeated Run
// and main-thread stalls must not interrupt sample voices already rendering.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const playwright = require('playwright');

const url = process.argv[2] || 'http://127.0.0.1:8093/playground/index.html';
const browserName = process.argv[3] || 'chromium';
const seconds = Number(process.argv[4] || 30);
const outputSampleRate = process.argv[5] ? Number(process.argv[5]) : undefined;
assert(['chromium', 'webkit'].includes(browserName), 'Choose chromium or webkit');
assert(Number.isFinite(seconds) && seconds >= 5 && seconds <= 120, 'Capture 5–120 seconds');
if (outputSampleRate !== undefined) assert(Number.isInteger(outputSampleRate) && outputSampleRate >= 8000 && outputSampleRate <= 384000);

const captureModule = `class SampleNoiseCapture extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.frames=0; this.ended=false;
    this.capacity=Math.ceil(sampleRate*(options.processorOptions.seconds+3));
    this.data=[new Float32Array(this.capacity),new Float32Array(this.capacity)];
    this.port.onmessage=({data})=>{
      if(data!=='end'||this.ended)return;
      this.ended=true;
      this.port.postMessage({frames:this.frames,rate:sampleRate,
        left:this.data[0].subarray(0,this.frames),right:this.data[1].subarray(0,this.frames)});
    };
  }
  process(inputs) {
    if(this.ended)return false;
    const source=inputs[0];
    if(source?.[0]) {
      const n=Math.min(source[0].length,this.capacity-this.frames);
      for(let ch=0;ch<2;ch++)this.data[ch].set((source[ch]??source[0]).subarray(0,n),this.frames);
      this.frames+=n;
    }
    return true;
  }
}
registerProcessor('sample-noise-capture',SampleNoiseCapture);`;

(async () => {
  const browser = await playwright[browserName].launch({headless: true,
    ...(browserName === 'chromium' ? {args: ['--autoplay-policy=no-user-gesture-required']} : {})});
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/playground.js?*', async route => {
      const response = await route.fetch(); let body = await response.text();
      if (outputSampleRate !== undefined) {
        const original = 'const megaDrive = createTetoricaSynth(synthOptions);';
        assert(body.includes(original), 'Playground synth initialization changed');
        body = body.replace(original, `synthOptions.outputSampleRate=${outputSampleRate};${original}`);
      }
      await route.fulfill({response, body: body + '\nwindow.__sampleNoiseTest={runtime,megaDrive};'});
    });
    await page.goto(url);
    await page.waitForFunction(() => window.__sampleNoiseTest && window.monaco?.editor?.getEditors().length);
    // WebKit needs a user gesture before opening the output device.
    await page.click('#runButton'); await page.waitForTimeout(300);
    await page.evaluate(() => window.__sampleNoiseTest.runtime.stop());
    let source = await fs.readFile(path.join(__dirname, '../docs/playground/examples/basic/ambient-choir-sample.js'), 'utf8');
    // Preload once through the real browser decoder, then retain the exact FX
    // and loop behavior. Fixed rate/pan sequences keep amplitude checks stable.
    source = 'let noiseVoiceCount=0;\n' + source.replace(/await sample.load\([\s\S]*?\);/, '')
      .replace('choose([0.5, 1 / 3, 3 / 5])', '[0.5, 1 / 3, 3 / 5][noiseVoiceCount++ % 3]')
      .replace('rrange(-1, 1)', 'Math.sin(noiseVoiceCount * 1.25)');
    const results = [];
    for (const execution of ['main', 'worker']) {
      const result = await page.evaluate(async ({source, execution, seconds, captureModule}) => {
        const {runtime, megaDrive} = window.__sampleNoiseTest;
        await runtime.ensureReady(); const context = megaDrive.audioContext;
        const sampleUrl = new URL('./samples/sonic-pi/ambi_choir.flac', location.href).href;
        await megaDrive.sample.load('sonic-pi/ambi-choir', sampleUrl);
        if (!window.__sampleNoiseCaptureLoaded) {
          const moduleUrl = URL.createObjectURL(new Blob([captureModule], {type: 'text/javascript'}));
          try {await context.audioWorklet.addModule(moduleUrl);} finally {URL.revokeObjectURL(moduleUrl);}
          window.__sampleNoiseCaptureLoaded = true;
        }
        const tap = new AudioWorkletNode(context, 'sample-noise-capture', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: {seconds}});
        const detach = megaDrive.audio.connectOutputMonitor(tap); tap.connect(context.destination);
        const captured = new Promise(resolve => {tap.port.onmessage = ({data}) => resolve(data);});
        const started = performance.now(); let timer;
        try {
          await runtime.playSource(source, {execution});
          // Ordinary editing/UI work delays JavaScript without stopping voices
          // in the AudioWorklet. Also apply the same source twice while playing.
          timer = setInterval(() => {const end = performance.now() + 40; while (performance.now() < end) {}}, 500);
          for (let run = 0; run < 3; run++) {
            const target = started + (run + 1) * seconds * 1000 / 3;
            await new Promise(resolve => setTimeout(resolve, Math.max(0, target - performance.now())));
            if (run < 2) await runtime.playSource(source, {execution});
          }
          tap.port.postMessage('end'); const data = await captured;
          const result = {execution, sampleRate: context.sampleRate, frames: data.frames,
            audioSeconds: data.frames / data.rate, wallSeconds: (performance.now() - started) / 1000,
            peak: 0, rms: 0, outsideUnit: 0, maxDelta: 0, largeJumps: 0, silentRunFrames: 0};
          let energy = 0;
          for (const channel of [data.left, data.right]) for (let i = 1; i < channel.length; i++) {
            const value = channel[i], delta = Math.abs(value - channel[i - 1]);
            energy += value * value; result.peak = Math.max(result.peak, Math.abs(value));
            if (Math.abs(value) > 1) result.outsideUnit++;
            result.maxDelta = Math.max(result.maxDelta, delta); if (delta > .1) result.largeJumps++;
          }
          // After voices overlap, a complete zero render quantum indicates a
          // dropout. Exclude startup and the asynchronous capture end boundary.
          let silent = 0;
          for (let i = Math.round(data.rate * 2); i < data.frames - 128; i++) {
            silent = data.left[i] === 0 && data.right[i] === 0 ? silent + 1 : 0;
            result.silentRunFrames = Math.max(result.silentRunFrames, silent);
          }
          result.rms = Math.sqrt(energy / Math.max(1, data.frames * 2)); return result;
        } finally {
          clearInterval(timer); detach(); tap.disconnect(); tap.port.close(); await runtime.stop();
        }
      }, {source, execution, seconds, captureModule});
      assert(result.audioSeconds >= seconds - .5, JSON.stringify(result));
      assert(result.peak > .05 && result.rms > .005, 'Playback must be audible: ' + JSON.stringify(result));
      assert.equal(result.outsideUnit, 0, 'Unexpected output clipping: ' + JSON.stringify(result));
      assert.equal(result.largeJumps, 0, 'Unexpected waveform discontinuity: ' + JSON.stringify(result));
      assert(result.silentRunFrames < 128, 'Unexpected silent render quantum: ' + JSON.stringify(result));
      results.push(result);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({passed: true, browser: browserName, results}));
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
