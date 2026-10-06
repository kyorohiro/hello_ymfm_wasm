// Verify that an application can move its Synth/Transport into its own Worker.
const {chromium} = require('playwright');
const http = require('node:http'), fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../w/tetorica-fm2612-examples/dist/vendor/tetorica-fm2612');
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://local').pathname;
    if (pathname === '/') {res.setHeader('Content-Type', 'text/html'); res.end('<p>Transport Worker test</p>'); return;}
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
    res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
    res.end(await fs.readFile(file));
  } catch (error) {res.writeHead(404).end(error.message);}
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
  try {
    const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.evaluate(async () => {
      const {createSoundChip} = await import('/soundchip.js');
      const results = [];
      for (const name of ['ym2612', 'ym2608']) {
        const chip = await createSoundChip(name, {execution: 'worklet'});
        const context = chip.audioContext;
        const analyser = context.createAnalyser(); analyser.fftSize = 512; chip.node.connect(analyser);
        const silent = context.createGain(); silent.gain.value = 0; analyser.connect(silent); silent.connect(context.destination);
        const type = name === 'ym2612' ? 'YM2612' : 'YM2608';
        const extra = name === 'ym2608' ? `await fm.adpcm.loadMemory(new Uint8Array(128), 0);` : '';
        const code = `import {${type}Synth, ${type}WorkletTransport} from '${location.origin}/${name}synth.js';
          import {FM_PRESETS} from '${location.origin}/megasynth-fm-presets.js';
          self.onmessage = async ({data: port}) => {
            try {
              const transport = new ${type}WorkletTransport(port);
              const fm = new ${type}Synth({transport});
              ${extra}
              fm.setPreset(0, FM_PRESETS.sine); fm.noteOn(0, 4, 553);
              self.postMessage('playing');
              await new Promise(resolve => setTimeout(resolve, 350));
              fm.noteOff(0); transport.dispose(); port.close(); self.postMessage('done');
            } catch (error) {self.postMessage({error: error.message});}
          };`;
        const url = URL.createObjectURL(new Blob([code], {type: 'text/javascript'}));
        const worker = new Worker(url, {type: 'module'});
        try {
          let peak = 0; const data = new Float32Array(512);
          const timer = setInterval(() => {analyser.getFloatTimeDomainData(data); for (const v of data) peak = Math.max(peak, Math.abs(v));}, 5);
          try {
            await chip.start();
            const done = new Promise((resolve, reject) => {
              worker.onmessage = ({data}) => {if (data?.error) reject(new Error(data.error)); if (data === 'done') resolve();};
              worker.onerror = error => reject(new Error(error.message));
            });
            const port = chip.createTransportPort(); worker.postMessage(port, [port]);
            await done; results.push({name, peak});
          } finally {clearInterval(timer);}
        } finally {
          worker.terminate(); URL.revokeObjectURL(url); await chip.dispose();
          analyser.disconnect(); silent.disconnect();
        }
        if (context.state !== 'closed') throw new Error('Context leaked');
      }
      return results;
    });
    assert.deepEqual(errors, []); for (const item of result) assert.ok(item.peak > .01, item.name + ' silent');
    console.log('PASS application Worker Synth -> WorkletTransport MessagePort -> chip Worklet; YM2608 memory ACK returns to Worker; Main closes context');
  } finally {await browser.close(); await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); server.close(); process.exitCode = 1;});
