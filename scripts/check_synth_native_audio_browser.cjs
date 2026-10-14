// Real Web Audio / WASM / Worklet, with the Rust command boundary simulated.
// Rust's device and ring tests separately exercise the native half.
const http = require('node:http'), fs = require('node:fs/promises'), path = require('node:path');
const assert = require('node:assert/strict');
const {chromium, webkit} = require('playwright');
const root = path.resolve(__dirname, '..');
const desktop = path.join(root, 'w/tetorica-fm2612-synth-tauri/desktop');
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = pathname === '/synth/desktop-audio-worklet.js'
      ? path.join(desktop, 'audio-worklet.js') : path.resolve(root, 'docs', '.' + pathname);
    if (!file.startsWith(path.join(root, 'docs') + '/') && file !== path.join(desktop, 'audio-worklet.js')) throw Error('Invalid path');
    let body = await fs.readFile(file);
    if (pathname === '/synth/synth.js') {
      // Origin admission is separately covered by the desktop unit tests. Use
      // a real localhost origin here so Worklet imports are ordinary requests.
      const adapter = (await fs.readFile(path.join(desktop,'audio-interface.js'), 'utf8'))
        .replace("location.hostname === 'tauri.localhost'", "location.hostname === '127.0.0.1'");
      body = Buffer.from(body.toString() + '\nwindow.__synthNativeTest={audio:()=>audioContext,mega:()=>megaSynth,loopBus:()=>loopOutputBus,looper:()=>looper};\n' + adapter);
    }
    response.setHeader('Content-Type', {'.js':'text/javascript','.wasm':'application/wasm','.html':'text/html'}[path.extname(file)] || 'application/octet-stream');
    response.end(body);
  } catch (error) { response.statusCode = 404; response.end(String(error)); }
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [name, type] of [['chromium',chromium],['webkit',webkit]]) {
      const browser = await type.launch({headless:true});
      try {
        const page = await browser.newPage();
        await page.exposeFunction('__nativeWait', milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds)));
        const errors = [];
        page.on('pageerror', error => {errors.push(error.message); console.error(error.message);});
        page.on('console', message => {if (message.type()==='error') console.error(message.text());});
        await page.addInitScript(() => {
          const test = window.__nativeMock = {starts:0, stops:0, writes:0, packets:[], capacity:4, error:null, maxQueued:0};
          let current = null;
          window.__TAURI_INTERNALS__ = {invoke: async (command, args, options) => {
            if (command === 'audio_devices') return [{id:'test',name:'Test output',isDefault:true}];
            if (command === 'audio_start') {
              const session = String(++test.starts);
              current = {session, queue:[], time:performance.now(), received:0, consumed:0};
              test.packets = [];
              return {session,frames:512,sampleRate:48000,inputSampleRate:args.sampleRate,credits:4};
            }
            if (command === 'audio_write') {
              if (!current || options?.headers?.['x-synth-audio-session'] !== current.session) throw Error('Stale session');
              if (!(args instanceof ArrayBuffer) || args.byteLength !== 4096) throw Error('Not binary stereo PCM');
              if (current.queue.length >= test.capacity) throw Error('Queue overflow');
              const pcm = new Float32Array(args);
              if (![...pcm].every(Number.isFinite)) throw Error('Non-finite PCM');
              current.queue.push(pcm); current.received += 512; test.writes++;
              test.maxQueued = Math.max(test.maxQueued, current.queue.length);
              test.packets.push({mean:pcm.reduce((sum,value)=>sum+value,0)/pcm.length,peak:Math.max(...pcm)});
              if (test.packets.length > 300) test.packets.shift();
              return null;
            }
            if (command === 'audio_poll') {
              if (!current || current.session !== args.session) throw Error('Stale poll');
              const polled=current, deadline=performance.now()+100;
              let credits=0;
              do {
                if (current!==polled) throw Error('Stale poll');
                const now=performance.now();
                const available=Math.floor((now-current.time)*48000/1000/512);
                current.time+=available*512/48000*1000;
                credits=Math.min(available,current.queue.length);
                current.queue.splice(0,credits);current.consumed+=credits*512;
                if (credits||test.error||now>=deadline) break;
                await window.__nativeWait(4);
              } while (true);
              return {credits,error:test.error,queuedFrames:current.queue.length*512,receivedFrames:current.received,consumedFrames:current.consumed,underruns:0};
            }
            if (command === 'audio_stop') {
              if (!args?.session || current?.session === args.session) {current=null;test.stops++;}
              return null;
            }
            throw Error(`Unexpected native command: ${command}`);
          }};
        });
        await page.goto(origin+'/synth/index.html');
        await page.waitForSelector('#desktop-audio-output', {state:'attached'});
        const openAudioMenu = async () => {
          if (!await page.locator('#synthMenu').evaluate(menu => menu.open)) await page.locator('#synthMenuButton').click();
          if (!await page.locator('#desktop-audio-output').evaluate(menu => menu.open)) await page.locator('#desktop-audio-output summary').click();
        };
        await page.locator('#keyboard .key').first().click();
        await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Audio ready'));
        await openAudioMenu();
        assert.equal(await page.locator('#desktop-audio-output').evaluate(output => output.closest('#synthMenuAudio')?.id), 'synthMenuAudio');
        await page.locator('#desktop-audio-mode').selectOption('native');
        await page.waitForFunction(() => !document.getElementById('desktop-audio-mode').disabled);
        assert.equal(await page.locator('#synthMenu').evaluate(menu => menu.open), true, 'Audio settings remain open after selecting an output');
        assert.match(await page.locator('#desktop-audio-status').textContent(), /^Native →/);
        await page.waitForFunction(() => window.__nativeMock.writes > 4);
        await page.screenshot({path:`/private/tmp/synth-native-menu-${name}.png`});
        assert.equal(await page.evaluate(()=>document.activeElement?.id), '');
        await page.evaluate(async () => {
          const context=window.__synthNativeTest.audio(), signal=context.createConstantSource();
          signal.offset.value=.04;signal.connect(window.__synthNativeTest.mega().audio.masterInputNode);signal.start();
          const loop=context.createConstantSource();loop.offset.value=.025;loop.connect(window.__synthNativeTest.loopBus());loop.start();
          const meter=context.createAnalyser();meter.fftSize=1024;
          (await window.tetoricaSynthAudio.ensureReady()).output.connect(meter);
          window.__nativeSignals={signal,loop,meter};
          const input=document.getElementById('masterVolumeRange');input.value='250';input.dispatchEvent(new Event('input',{bubbles:true}));
        });
        await page.waitForFunction(() => window.__nativeMock.packets.slice(-3).every(packet=>Math.abs(packet.mean-.125)<.005));
        const mix = await page.evaluate(()=>{
          const data=new Float32Array(1024);window.__nativeSignals.meter.getFloatTimeDomainData(data);
          return data.reduce((sum,value)=>sum+value,0)/data.length;
        });
        assert(Math.abs(mix-.125)<.005, `${name}: final mix ${mix}`);
        // Both visualisers remain alive after routing to the native sink.
        await page.locator('#synthMenuButton').click();
        for (const mode of ['waveform','spectrum','envelope']) await page.locator(`[data-visual-mode=${mode}]`).click();
        await page.evaluate(()=>{const input=document.getElementById('masterVolumeRange');input.value='0';input.dispatchEvent(new Event('input',{bubbles:true}));window.__nativeSignals.loop.offset.value=0;});
        await page.waitForFunction(()=>window.__nativeMock.packets.slice(-3).every(packet=>Math.abs(packet.mean)<.0001));
        // Keyboard input and both performance wheels continue to reach the chip.
        await page.keyboard.down('a');
        await page.waitForFunction(()=>document.querySelector('#keyboard .key[data-key="a"]')?.classList.contains('is-active'));
        await page.keyboard.up('a');
        await page.locator('#visualModulationWheel').press('End');
        assert((await page.evaluate(()=>window.__synthNativeTest.mega().fm.getState())).channels.every(channel=>channel.pms===7));
        await page.locator('#visualModulationWheel').press('Home');
        await page.locator('#looperStartButton').click();
        await page.waitForFunction(()=>window.__synthNativeTest.looper()?.running);
        await page.locator('#looperRecordButton').click();
        await page.waitForFunction(()=>window.__synthNativeTest.looper().recording);
        await page.keyboard.down('a');
        await page.waitForFunction(()=>document.querySelector('#keyboard .key[data-key="a"]')?.classList.contains('is-active'));
        await page.waitForTimeout(600);await page.keyboard.up('a');
        await page.locator('#looperRecordButton').click();
        await page.waitForFunction(()=>window.__synthNativeTest.looper().units.length>0);
        const unitCount=await page.evaluate(()=>window.__synthNativeTest.looper().units.length);
        await openAudioMenu();
        await page.locator('#desktop-audio-mode').selectOption('web');
        await page.waitForFunction(()=>document.getElementById('desktop-audio-status').textContent==='Web Audio output');
        assert.equal(await page.evaluate(()=>window.__synthNativeTest.looper().running), false);
        assert.equal(await page.evaluate(()=>window.__synthNativeTest.looper().units.length), unitCount);
        const stoppedWrites=await page.evaluate(()=>window.__nativeMock.writes);
        await page.waitForTimeout(150);
        assert.equal(await page.evaluate(()=>window.__nativeMock.writes), stoppedWrites);
        await page.evaluate(()=>{
          const mega=window.__synthNativeTest.mega();mega.startRecord();mega.fm.noteOn(0,'A4');mega.fm.noteOff(0);
        });
        await page.locator('#desktop-audio-mode').selectOption('native');
        await page.waitForFunction(()=>window.__nativeMock.starts===2 && !document.getElementById('desktop-audio-mode').disabled);
        assert.equal(await page.evaluate(()=>window.__synthNativeTest.mega().isRecording()), false);
        assert((await page.evaluate(()=>window.__synthNativeTest.mega().exportRecording().commands.length))>=2);
        await page.waitForFunction(minimum=>window.__nativeMock.writes>minimum, stoppedWrites+4);
        // Background WebViews throttle JS timers. Native consumption responses
        // must keep credits flowing even when those timers cannot run at all.
        const beforeTimerFreeze=await page.evaluate(()=>{
          window.__originalSetTimeout=window.setTimeout;
          window.setTimeout=()=>0;
          return window.__nativeMock.writes;
        });
        await page.waitForTimeout(250);
        const afterTimerFreeze=await page.evaluate(()=>{
          window.setTimeout=window.__originalSetTimeout;
          return window.__nativeMock.writes;
        });
        assert(afterTimerFreeze>beforeTimerFreeze+8,'PCM transfer continues without WebView timers');
        await page.evaluate(()=>window.__nativeMock.error='Device disconnected');
        await page.waitForFunction(()=>document.getElementById('desktop-audio-mode').value==='web');
        assert.match(await page.locator('#desktop-audio-status').textContent(), /Device disconnected/);
        const stats=await page.evaluate(()=>({starts:window.__nativeMock.starts,stops:window.__nativeMock.stops,writes:window.__nativeMock.writes,maxQueued:window.__nativeMock.maxQueued}));
        assert(stats.maxQueued<=4);assert.deepEqual(errors,[]);
        await page.evaluate(()=>{for(const source of [window.__nativeSignals.signal,window.__nativeSignals.loop]){source.stop();source.disconnect();}});
        console.log(JSON.stringify({browser:name,passed:true,finalMix:mix,...stats}));
        await page.close();
      } finally {await browser.close();}
    }
  } finally {await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
