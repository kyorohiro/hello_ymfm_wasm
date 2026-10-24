// Public npm payload -> real WASM/AudioWorklet output. No physical audio output.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {chromium, webkit} = require('playwright');

const argumentsList = process.argv.slice(2);
if (argumentsList.includes('--help')) {
  console.log('Usage: node scripts/check_soundchip_mixer_presets_browser.cjs [--webkit] [--root=dist/fm2612]');
  process.exit(0);
}
for (const argument of argumentsList) {
  if (argument !== '--webkit' && !argument.startsWith('--root=')) throw new Error(`Unknown argument: ${argument}`);
}
const packageRoot = path.resolve(__dirname, '..', argumentsList.find(value => value.startsWith('--root='))?.slice(7) ?? 'dist/fm2612');
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>SoundChipMixer preset test</title><button id="start">Test muted audio</button>');
      return;
    }
    if (pathname === '/favicon.ico') {response.writeHead(204).end(); return;}
    const filename = path.resolve(packageRoot, '.' + pathname);
    if (!filename.startsWith(packageRoot + path.sep)) throw new Error('Invalid package path');
    response.setHeader('Content-Type', filename.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
    response.end(await fs.readFile(filename));
  } catch (error) {
    response.writeHead(404).end(error.message);
  }
});

async function checkBrowser(name, browserType, origin) {
  const browser = await browserType.launch({headless: true,
    args: name === 'chromium' ? ['--autoplay-policy=no-user-gesture-required'] : []});
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(90_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.evaluate(() => {
      document.getElementById('start').onclick = () => {
        window.__presetCheck = (async () => {
          const context = new AudioContext({sampleRate: 48_000});
          await context.resume();
          const captureSource = `
            class PresetCapture extends AudioWorkletProcessor {
              constructor() {
                super(); this.capture = null;
                this.port.onmessage = ({data}) => {
                  this.capture = {id:data.id, frames:data.frames, count:0,
                    channels:[0,1].map(() => ({sum:0,square:0,min:Infinity,max:-Infinity,peak:0,nonFinite:0}))};
                };
              }
              process(inputs, outputs) {
                for (const output of outputs) for (const channel of output) channel.fill(0);
                const capture = this.capture, input = inputs[0];
                if (!capture || !input?.[0]) return true;
                const count = Math.min(input[0].length, capture.frames - capture.count);
                for (let channel = 0; channel < 2; channel++) {
                  const stats = capture.channels[channel], samples = input[channel] ?? input[0];
                  for (let frame = 0; frame < count; frame++) {
                    const value = samples[frame];
                    if (!Number.isFinite(value)) {stats.nonFinite++; continue;}
                    stats.sum += value; stats.square += value * value;
                    stats.min = Math.min(stats.min, value); stats.max = Math.max(stats.max, value);
                    stats.peak = Math.max(stats.peak, Math.abs(value));
                  }
                }
                capture.count += count;
                if (capture.count === capture.frames) {
                  this.port.postMessage({id:capture.id, frames:capture.count,
                    channels:capture.channels.map(stats => ({
                      peak:stats.peak, nonFinite:stats.nonFinite,
                      amplitude:(stats.max-stats.min)/2,
                      rms:Math.sqrt(stats.square/capture.count),
                      acRms:Math.sqrt(Math.max(0,stats.square/capture.count-(stats.sum/capture.count)**2)),
                    }))});
                  this.capture = null;
                }
                return true;
              }
            }
            registerProcessor('soundchip-preset-capture', PresetCapture);
          `;
          const moduleUrl = URL.createObjectURL(new Blob([captureSource], {type:'text/javascript'}));
          try {await context.audioWorklet.addModule(moduleUrl);}
          finally {URL.revokeObjectURL(moduleUrl);}
          const recorder = new AudioWorkletNode(context, 'soundchip-preset-capture', {
            numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[2],
          });
          const mute = context.createGain(); mute.gain.value = 0;
          recorder.connect(mute); mute.connect(context.destination);
          const {
            createSoundChip, SoundChipMixer, SOUNDCHIP_MIXER_PRESETS,
          } = await import('/soundchip.js');
          const presetEntry = await import('/soundchip_mixer_presets.js');
          if (presetEntry.SOUNDCHIP_MIXER_PRESETS !== SOUNDCHIP_MIXER_PRESETS) throw new Error('Root and subpath exports differ');
          const expectedPsgGains = {segapsg:.455420,ay8910:1.100331,nes:1.514209};
          for (const [kind,expected] of Object.entries(expectedPsgGains)) {
            const actual = SOUNDCHIP_MIXER_PRESETS.calibrated.factoryDefaults.kinds.find(item => item.name === kind)?.volume;
            if (actual !== expected) throw new Error(`${kind}: stale public calibrated gain ${actual}, expected ${expected}`);
          }
          const {YM2612Synth, YM2612DirectTransport, YM2612WorkletTransport} = await import('/ym2612synth.js');
          const {FM_PRESETS} = await import('/megasynth-fm-presets.js');
          const {SegaPSGSynth} = await import('/segapsgsynth.js');
          const {AY8910Synth} = await import('/ay8910synth.js');
          const {NesApuSynth,NesApuWorkletTransport} = await import('/nesapusynth.js');
          const {GameboySynth} = await import('/gameboysynth.js');
          const {OPLSynth, OPL_PRESETS} = await import('/opl_synth.js');
          const {SegaPSGWorkletTransport, AY8910WorkletTransport, GameboyWorkletTransport, OPLWorkletTransport} = await import('/chip_worklet_transport.js');
          const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
          const require = (condition, message) => {if (!condition) throw new Error(message);};
          const closeEnough = (actual, expected, message, relative = .006) => {
            require(Number.isFinite(actual) && Math.abs(actual-expected) <= Math.max(1e-7, Math.abs(expected)*relative),
              `${message}: actual ${actual}, expected ${expected}`);
          };
          let captureId = 0;
          const capture = () => new Promise((resolve, reject) => {
            const id = ++captureId;
            const timer = setTimeout(() => {recorder.port.onmessage=null; reject(new Error('PCM capture timed out'));}, 8_000);
            recorder.port.onmessage = ({data}) => {
              if (data.id !== id) return;
              clearTimeout(timer); recorder.port.onmessage=null; resolve(data);
            };
            recorder.port.postMessage({id, frames:8_192});
          });
          const measure = async label => {
            // The Mixer ramps over 5 ms. Also allow the held source to settle.
            await wait(160);
            const data = await capture();
            for (const channel of data.channels) {
              require(channel.nonFinite === 0, `${label}: non-finite PCM`);
              require(channel.acRms > .0001 && channel.peak < 1, `${label}: silent or overrange PCM ${JSON.stringify(data)}`);
            }
            return data;
          };
          const configure = (name, chip) => {
            let transport;
            if (name === 'ym2612') {
              transport = new YM2612WorkletTransport(chip);
              const fm = new YM2612Synth({transport}); fm.setPreset(0, FM_PRESETS.sine); fm.noteOn(0, 'A4');
            } else if (name === 'segapsg') {
              transport = new SegaPSGWorkletTransport(chip);
              const psg = new SegaPSGSynth({transport}); psg.allNotesOff(); psg.tone(0,{frequency:440,attenuation:0});
            } else if (name === 'gameboy') {
              transport = new GameboyWorkletTransport(chip);
              const gb = new GameboySynth({transport}); gb.initialize();
              gb.pulse.setVoice(0,{duty:.5,volume:15,envelope:{direction:'down',period:0}}); gb.pulse.noteOn(0,'A4');
            } else if (name === 'ay8910') {
              transport = new AY8910WorkletTransport(chip);
              const ay = new AY8910Synth({transport}); ay.initialize(); ay.tone(0,{frequency:440,volume:15,envelope:false});
            } else if (name === 'nes') {
              transport = new NesApuWorkletTransport(chip);
              const nes = new NesApuSynth({transport});
              nes.pulse.setVoice(0,{duty:.5,volume:15,sweep:{enabled:false,period:0,shift:0}}); nes.pulse.noteOn(0,'A4');
            } else {
              transport = new OPLWorkletTransport(chip);
              const opl = new OPLSynth({chip:name,transport}); opl.initialize(); opl.setPreset(0,OPL_PRESETS.sine); opl.noteOn(0,'A4');
            }
            return transport;
          };
          const renderRaw = async () => {
            const chip = await createSoundChip('ym2612');
            try {
              const fm = new YM2612Synth({transport:new YM2612DirectTransport(chip)});
              fm.setPreset(0,FM_PRESETS.sine); fm.noteOn(0,'A4');
              return chip.generateStereo(8_192);
            } finally {chip.dispose();}
          };
          const rawBefore = await renderRaw();
          const results = [];
          try {
            for (const name of ['ym2612','segapsg','ay8910','nes','gameboy','ym3812']) {
              const mixer = new SoundChipMixer(SOUNDCHIP_MIXER_PRESETS.calibrated);
              const factor = SOUNDCHIP_MIXER_PRESETS.calibrated.factoryDefaults.kinds.find(kind => kind.name === name).volume;
              const sentinel = 'unrelated';
              const releaseSentinel = mixer.register(sentinel, 'other', () => {});
              mixer.set(sentinel,{volume:.37});
              let chip, transport, item;
              try {
                chip = await createSoundChip(name,{execution:'worklet',audioContext:context,outputNode:recorder,mixer,id:`preset-${name}`});
                require(mixer.list().length === 2, `${name}: source not registered`);
                closeEnough(mixer.get(chip.id).volume,factor,`${name}: initial calibration`,0);
                await chip.start(); transport = configure(name,chip); await transport.flush();
                mixer.set(chip.id,{volume:1}); const unity = await measure(`${name}/unity`);
                mixer.reset(chip.id); const calibrated = await measure(`${name}/calibrated`);
                mixer.set(chip.id,{volume:.5}); const overridden = await measure(`${name}/override`);
                closeEnough(mixer.get(chip.id).volume,.5,`${name}: explicit override value`,0);
                for (let channel=0;channel<2;channel++) {
                  closeEnough(calibrated.channels[channel].amplitude/unity.channels[channel].amplitude,factor,`${name}: calibrated ratio`);
                  closeEnough(overridden.channels[channel].amplitude/unity.channels[channel].amplitude,.5,`${name}: absolute override ratio`);
                  if (['segapsg','ay8910','nes'].includes(name)) {
                    closeEnough(calibrated.channels[channel].acRms/unity.channels[channel].acRms,factor,`${name}: calibrated AC RMS ratio`,.02);
                    closeEnough(overridden.channels[channel].acRms/unity.channels[channel].acRms,.5,`${name}: absolute override AC RMS ratio`,.02);
                  }
                }
                item = {name,factor,unity,calibrated,overridden};
              } finally {
                transport?.dispose(); await chip?.dispose();
                require(mixer.list().length===1 && mixer.list()[0].id===sentinel,`${name}: dispose changed another route or leaked its own`);
                closeEnough(mixer.get(sentinel).volume,.37,`${name}: unrelated settings changed`,0);
                releaseSentinel(); require(mixer.list().length===0,`${name}: sentinel cleanup failed`);
              }
              let legacy, legacyTransport;
              try {
                legacy = await createSoundChip(name,{execution:'worklet',audioContext:context,outputNode:recorder});
                const expected = name==='gameboy' ? .28 : 1;
                closeEnough(legacy.mixer.get(legacy.id).volume,expected,`${name}: omitted mixer legacy default`,0);
                await legacy.start(); legacyTransport=configure(name,legacy); await legacyTransport.flush();
                const pcm = await measure(`${name}/legacy`);
                for (let channel=0;channel<2;channel++) {
                  closeEnough(pcm.channels[channel].amplitude/item.unity.channels[channel].amplitude,expected,`${name}: legacy output ratio`);
                }
                item.legacy = {volume:expected,pcm};
              } finally {
                legacyTransport?.dispose(); await legacy?.dispose();
                require(!legacy || legacy.mixer.list().length===0,`${name}: implicit mixer leaked route`);
              }
              results.push(item);
            }
            const rawAfter = await renderRaw();
            let maximumDifference=0,rawPeak=0;
            for (const channel of ['left','right']) {
              for (let index=0;index<rawBefore[channel].length;index++) {
                const before=rawBefore[channel][index],after=rawAfter[channel][index];
                require(Number.isFinite(before)&&Number.isFinite(after),'Non-finite raw PCM');
                maximumDifference=Math.max(maximumDifference,Math.abs(before-after)); rawPeak=Math.max(rawPeak,Math.abs(before));
              }
            }
            require(rawPeak>.001 && maximumDifference===0,`Raw PCM changed: ${maximumDifference}`);
            return {sampleRate:context.sampleRate,results,raw:{maximumDifference,peak:rawPeak}};
          } finally {
            recorder.disconnect(); mute.disconnect(); recorder.port.close(); await context.close();
          }
        })();
      };
    });
    await page.click('#start');
    const result = await page.evaluate(() => window.__presetCheck);
    assert.deepEqual(errors, [], `${name}: browser errors`);
    assert.equal(result.results.length, 6);
    assert.equal(result.raw.maximumDifference, 0);
    console.log(JSON.stringify({browser:name,passed:true,...result}));
  } finally {
    await browser.close();
  }
}

(async () => {
  await fs.access(path.join(packageRoot,'soundchip_mixer_presets.js'));
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}/`;
    await checkBrowser('chromium',chromium,origin);
    if (argumentsList.includes('--webkit')) await checkBrowser('webkit',webkit,origin);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); server.close(); process.exitCode=1;});
