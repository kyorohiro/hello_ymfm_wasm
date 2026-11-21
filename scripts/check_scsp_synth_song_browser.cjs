// Browser verification of the public SCSP song controls and their shared Master.
// Every destination edge is intercepted at gain zero before app initialization.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {tmpdir} = require('node:os');
const {pathToFileURL} = require('node:url');
const {createHash} = require('node:crypto');
const {gzipSync} = require('node:zlib');
const {chromium, webkit} = require('playwright');
const repo = path.resolve(__dirname, '..');
const config = {root:path.join(repo, 'docs'), entry:'/synth-scsp/index.html', engines:'chromium,webkit',
  out:path.join(tmpdir(), 'scsp-synth-song-browser.json'), screenshots:path.join(tmpdir(), 'scsp-synth-song-browser')};
for (const arg of process.argv.slice(2)) {
  const match = /^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);
  assert(match, 'Unknown argument ' + arg); config[match[1]] = match[2];
}
config.root = path.resolve(config.root);
const engines = config.engines.split(',');
assert(engines.length && engines.every(name => ['chromium','webkit'].includes(name)));
assert(config.entry.startsWith('/') && !/[?#]/.test(config.entry));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const missing = [], external = [], blockedMonaco = [], results = [];
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm',
  '.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml','.png':'image/png'};
async function until(predicate, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {if (await predicate()) return; await wait(25);}
  throw new Error('Timeout waiting for ' + label);
}

function installSilentAudit() {
  const connect = AudioNode.prototype.connect, Context = window.AudioContext ?? window.webkitAudioContext;
  const Worklet = window.AudioWorkletNode, contexts = [], worklets = [], meters = [], buffers = [];
  window.AudioContext = class extends Context {
    constructor(...args) {super(...args); contexts.push(this);}
    createBuffer(...args) {const buffer = super.createBuffer(...args); buffers.push({frames:buffer.length, rate:buffer.sampleRate}); return buffer;}
  };
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet {
    constructor(context, name, ...args) {super(context, name, ...args); worklets.push({name, node:this});}
  };
  AudioNode.prototype.connect = function(destination, ...args) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...args);
    const analyser = this.context.createAnalyser(), mute = this.context.createGain();
    analyser.fftSize = 2048; mute.gain.value = 0;
    connect.call(this, analyser, ...args); connect.call(analyser, mute); connect.call(mute, destination);
    meters.push({source:this, analyser, mute}); return destination;
  };
  function output() {
    const values = meters.map(({analyser}) => {
      const pcm = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(pcm);
      let square = 0, peak = 0;
      for (const value of pcm) {square += value * value; peak = Math.max(peak, Math.abs(value));}
      return {rms:Math.sqrt(square / pcm.length), peak, finite:pcm.every(Number.isFinite)};
    }).sort((first, second) => second.rms - first.rms);
    return {...(values[0] ?? {rms:0, peak:0, finite:true}), muted:meters.every(({mute}) => mute.gain.value === 0)};
  }
  let sequence = 0;
  function read() {
    const node = worklets.findLast(item => item.name === 'tetorica-scsp-synth')?.node;
    if (!node) return Promise.resolve(null);
    const id = --sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SCSP audit read timed out')), 5000);
      const receive = ({data}) => {
        if (data?.id !== id) return;
        clearTimeout(timer); node.port.removeEventListener('message', receive);
        data.error ? reject(new Error(data.error)) : resolve(data.value);
      };
      node.port.addEventListener('message', receive); node.port.start(); node.port.postMessage({id, method:'read', args:[]});
    });
  }
  window.__scspSongAudit = {output, read, graph:() => ({contexts:contexts.length,
    worklets:worklets.map(({name}) => name), destinationEdges:meters.length,
    muted:meters.every(({mute}) => mute.gain.value === 0), sourceBuffers:buffers.length,
    maxBufferFrames:Math.max(0, ...buffers.map(buffer => buffer.frames)), bufferRates:[...new Set(buffers.map(buffer => buffer.rate))]})};
}

async function installCoreAudit(page) {
  await page.evaluate(async () => {
    const {Scsp} = await import('/js/scsp.js'), create = Scsp.create;
    const cores = [];
    Scsp.create = async function(...args) {
      const core = await create.apply(this, args), row = {core, writes:0, uploads:0, uploadedBytes:0, maxRamEnd:0,
        frames:0, peak:0, finite:true, closed:false, heapBytes:core.module.HEAPU8.byteLength};
      cores.push(row);
      const write = core.write.bind(core), load = core.loadRam.bind(core), render = core.renderInto.bind(core), dispose = core.dispose.bind(core);
      core.write = (...values) => {row.writes++; return write(...values);};
      core.loadRam = (bytes, address = 0) => {
        row.uploads++; row.uploadedBytes += bytes.length; row.maxRamEnd = Math.max(row.maxRamEnd, address + bytes.length); return load(bytes, address);
      };
      core.renderInto = (left, right, frames, offset = 0) => {
        render(left, right, frames, offset); row.frames += frames;
        for (let index = offset; index < offset + frames; index++) {
          row.finite &&= Number.isFinite(left[index]) && Number.isFinite(right[index]);
          row.peak = Math.max(row.peak, Math.abs(left[index]), Math.abs(right[index]));
        }
      };
      core.dispose = () => {row.closed = true; dispose();}; return core;
    };
    window.__scspSongCores = {read:() => cores.map(({core,...row}) => row),
      ram:() => {const row = cores.findLast(item => !item.closed); return row ? [...row.core.readRam(0x1000,128)] : null;}};
  });
}
const view = page => page.evaluate(() => ({status:document.getElementById('status').textContent,
  song:document.getElementById('scspSongStatus').textContent, selected:document.getElementById('scspSongSelect').value,
  position:Number(document.getElementById('scspSongSeek').value), pause:document.getElementById('scspSongPause').textContent,
  playDisabled:document.getElementById('scspSongPlay').disabled, stopDisabled:document.getElementById('scspSongStop').disabled,
  code:document.getElementById('synthCodeState').textContent, codeError:document.getElementById('synthCodeError').textContent,
  files:document.getElementById('scspFilesSelected').textContent}));
const cores = page => page.evaluate(() => __scspSongCores.read());
async function pcm(page, audible = true) {
  let value;
  await until(async () => {
    value = await page.evaluate(() => __scspSongAudit.output());
    return value.muted && value.finite && (audible ? value.rms > .0001 : value.peak < 1e-7);
  }, audible ? 'finite final-Master audio' : 'final-Master silence');
  return value;
}
async function seek(page, seconds) {
  await page.locator('#scspSongSeek').evaluate((input, value) => {input.value = String(value); input.dispatchEvent(new Event('change',{bubbles:true}));}, seconds);
  await until(() => view(page).then(state => !state.song.startsWith('Seeking') && Math.abs(state.position - seconds) < .04), 'seek position ' + seconds);
}
async function files(page) {
  if (await page.locator('#scspFilesPanel').isHidden()) await page.click('#scspFilesToggle');
  await until(() => page.locator('#scspFileNewButton').isEnabled(), 'Files ready');
}
async function selectFile(page, filePath) {
  await files(page);
  const entry = page.locator('#scspFilesTree button.file-entry');
  const selected = entry.locator(`xpath=self::*[@data-file-path="${filePath}"]`);
  await selected.click();
  await until(() => view(page).then(state => state.files === filePath), 'Files selection ' + filePath);
}
async function importSong(page, name, bytes) {
  await importThroughMenu(page,'#loadVgm',{name, mimeType:'application/octet-stream', buffer:Buffer.from(bytes)});
  await until(() => page.locator('#scspSongSelect option').evaluateAll((options, value) => options.some(option => option.value === value), '/vgm/' + name), 'import ' + name);
}
async function importThroughMenu(page, selector, input) {
  await page.click('#synthMenuButton');
  const chooser = page.waitForEvent('filechooser');
  await page.click(selector);
  await (await chooser).setFiles(input);
}
async function exportSelected(page) {
  await page.click('#synthMenuButton');
  const downloaded = page.waitForEvent('download'); await page.click('#scspFileExportButton');
  return fs.readFile(await (await downloaded).path());
}

async function check(browser, name, origin, fixture) {
  const page = await browser.newPage({acceptDownloads:true, viewport:{width:1250,height:1000}});
  page.setDefaultTimeout(20000);
  const errors = [], checks = [], measurements = {};
  let stage = 'load';
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') {
      if (/monaco|jsdelivr/.test(url.href)) blockedMonaco.push(url.href); else external.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  await page.addInitScript(installSilentAudit);
  try {
    await page.goto(origin + config.entry);
    await until(() => page.locator('#scspFilesPanel').getAttribute('aria-busy').then(value => value === 'false'), 'initial Files restore');
    await installCoreAudit(page);
    stage = 'silent demo';
    await page.click('#scspSongDemo'); await until(() => page.locator('#scspSongPlay').isEnabled(), 'demo ready');
    assert.equal((await page.evaluate(() => __scspSongAudit.graph())).contexts,0); assert.equal((await cores(page)).length,0);
    checks.push('Demo preparation creates no audio context or native playback core');
    stage = 'demo playback and Master';
    await page.click('#scspSongPlay'); await until(() => view(page).then(state => state.song.startsWith('Playing')), 'demo playing');
    measurements.demo = await pcm(page);
    assert.equal((await page.evaluate(() => __scspSongAudit.graph())).contexts,1);
    assert.deepEqual(await page.evaluate(() => __scspSongCores.ram()), [...fixture.bytes.subarray(267,395)]);
    await page.locator('#volume').evaluate(input => {input.value = '0'; input.dispatchEvent(new Event('input',{bubbles:true}));});
    measurements.zeroMaster = await pcm(page,false);
    await page.locator('#volume').evaluate(input => {input.value = '.6'; input.dispatchEvent(new Event('input',{bubbles:true}));});
    measurements.restoredMaster = await pcm(page);
    checks.push('Native E0 RAM and C5 writes reach the single final Master through a muted destination');
    stage = 'Pause Resume and seek';
    await page.click('#scspSongPause'); await until(() => view(page).then(state => state.pause === 'Resume'), 'Pause'); await pcm(page,false);
    const paused = await view(page), frozen = (await cores(page)).at(-1).frames; await wait(120);
    assert.equal((await view(page)).position,paused.position); assert.equal((await cores(page)).at(-1).frames,frozen);
    await seek(page,.7); assert((await cores(page)).slice(0,-1).every(core => core.closed));
    await page.click('#scspSongPause'); await pcm(page);
    await page.click('#scspSongStop'); await pcm(page,false); assert((await cores(page)).every(core => core.closed));
    checks.push('Pause retains native state, Resume consumes preserved PCM, seek rebuilds state, Stop releases every core');
    stage = 'VGM and VGZ Files imports';
    await importSong(page,'original.vgm',fixture.bytes);
    await until(() => view(page).then(state => state.selected === '/vgm/original.vgm' && !state.playDisabled), 'VGM selection');
    await selectFile(page,'/vgm/original.vgm'); assert.deepEqual(await exportSelected(page),Buffer.from(fixture.bytes));
    await importSong(page,'original.vgz',fixture.gzip);
    await until(() => view(page).then(state => state.selected === '/vgm/original.vgz' && !state.playDisabled), 'VGZ selection');
    await selectFile(page,'/vgm/original.vgz'); assert.deepEqual(await exportSelected(page),fixture.gzip);
    checks.push('Menu imports VGM and VGZ into /vgm and Files exports their exact original bytes');
    stage = 'invalid replacement';
    await page.click('#scspSongPlay'); await pcm(page);
    await importSong(page,'unsupported.vgm',fixture.unsupported);
    await until(() => view(page).then(state => state.status.includes('unsupported chip')), 'unsupported file error');
    assert.equal((await view(page)).selected,'/vgm/original.vgz'); assert((await view(page)).song.startsWith('Playing'));
    await pcm(page);
    checks.push('An unsupported replacement preserves the previous playing source');
    stage = 'Code excludes song';
    await selectFile(page,'/index.js'); await page.click('#synthInputCodeTab');
    await page.locator('#synthCodeEditor').waitFor({state:'visible'});
    await page.locator('#synthCodeEditor').fill("const scsp = await useSoundChip('scsp');\nliveLoop('audit', async () => { await scsp.noteOn(CH1, 'C4'); await beat(8); await scsp.noteOff(CH1); });\n");
    await page.click('#synthCodeRunButton');
    await until(() => view(page).then(state => /Playing|Running/i.test(state.code)), 'Code running');
    assert((await cores(page)).every(core => core.closed)); assert(!(await view(page)).song.startsWith('Playing'));
    await pcm(page);
    stage = 'song excludes Code';
    await page.click('#scspSongPlay'); await until(() => view(page).then(state => state.song.startsWith('Playing') && !/Playing|Running/i.test(state.code)), 'song replaces Code');
    await pcm(page); assert.equal((await page.evaluate(() => __scspSongAudit.graph())).contexts,1);
    checks.push('Code Run stops reference playback and reference Play stops Code while sharing one AudioContext');
    stage = 'independent authored keyboard';
    await page.click('#scspSongPause'); await pcm(page,false);
    const frozenSong = (await cores(page)).at(-1); await page.click('#synthInputKeyboardTab');
    await page.locator('#keyboard .key[data-key="z"]').hover(); await page.mouse.down(); await pcm(page);
    assert.equal((await cores(page)).at(-1).frames,frozenSong.frames);
    await page.mouse.up(); await pcm(page,false);
    checks.push('The authored keyboard can audition during paused reference playback while the song core stays frozen');
    stage = 'natural end';
    await seek(page,1.9); await page.click('#scspSongPause');
    await until(() => view(page).then(state => state.song.startsWith('Ended')), 'natural end',10000); await pcm(page,false);
    assert((await cores(page)).every(core => core.closed));
    const nativeCores = await cores(page), playbackGraph = await page.evaluate(() => __scspSongAudit.graph());
    assert(nativeCores.every(core => core.finite && core.maxRamEnd <= 524288 && core.frames <= 105840 && core.closed));
    assert(nativeCores.some(core => core.peak > .01 && core.uploadedBytes === 128 && core.writes > 0));
    assert.deepEqual(playbackGraph.bufferRates,[44100]); assert.equal(playbackGraph.maxBufferFrames,256);
    assert.equal(playbackGraph.contexts,1); assert.equal(playbackGraph.destinationEdges,1); assert(playbackGraph.muted);
    stage = 'Files persistence';
    await wait(250); await page.reload();
    await until(() => page.locator('#scspFilesPanel').getAttribute('aria-busy').then(value => value === 'false'), 'restored Files');
    assert.equal((await page.evaluate(() => __scspSongAudit.graph())).contexts,0);
    await selectFile(page,'/vgm/original.vgz'); assert.deepEqual(await exportSelected(page),fixture.gzip);
    await selectFile(page,'/vgm/original.vgm'); assert.deepEqual(await exportSelected(page),Buffer.from(fixture.bytes));
    checks.push('Reload restores both original recordings without starting audio');
    const graphAfterReload = await page.evaluate(() => __scspSongAudit.graph());

    stage = 'standalone SSF';
    const workers = [];
    page.on('worker', worker => {if (new URL(worker.url()).pathname.endsWith('/scsp_ssf_worker.js')) workers.push(worker);});
    await importThroughMenu(page,'#loadSsfFiles',{
      name:'original.ssf', mimeType:'application/octet-stream', buffer:Buffer.from(fixture.ssf.standalone),
    });
    await until(() => view(page).then(state => state.selected === '/ssf/original.ssf' && !state.playDisabled), 'SSF selection');
    assert.equal((await page.evaluate(() => __scspSongAudit.graph())).contexts,0);
    assert.equal(workers.length,0);
    await page.click('#scspSongPlay');
    await until(() => view(page).then(state => /^Playing.*\bSSF\b/.test(state.song)), 'SSF playback');
    measurements.ssf = await pcm(page);
    assert.equal(workers.length,1);
    await page.click('#scspSongStop'); await pcm(page,false);
    checks.push('Selecting SSF stays silent until the isolated WASM Worker starts');

    stage = 'MiniSSF folder, Pause and Resume';
    await importThroughMenu(page,'#loadSsfFolder',fixture.ssfFolder);
    await until(() => view(page).then(state => state.selected.endsWith('/track.minissf') && !state.playDisabled), 'MiniSSF folder selection');
    const miniPath = (await view(page)).selected;
    assert(miniPath.startsWith('/ssf/'));
    assert.equal(await page.locator('#scspSongSelect option').evaluateAll(options => options.some(option => /\.ssflib$/i.test(option.value))),false);
    await page.click('#scspSongPlay');
    await until(() => view(page).then(state => /^Playing.*MiniSSF/.test(state.song)), 'MiniSSF playback');
    measurements.miniSsf = await pcm(page);
    await page.click('#scspSongPause'); await pcm(page,false);
    const pausedMini = await view(page); assert.equal(pausedMini.pause,'Resume');
    await wait(140); assert.equal((await view(page)).position,pausedMini.position);
    const pausedWorkers = workers.length;
    await page.click('#scspSongPause'); await pcm(page);
    assert.equal(workers.length,pausedWorkers);
    await page.click('#scspSongPause'); await pcm(page,false);
    checks.push('Folder import resolves MiniSSF libraries, Pause freezes the playhead and Resume retains its Worker');

    stage = 'missing SSFLib preserves the paused song';
    await importThroughMenu(page,'#loadSsfFiles',{
      name:'missing-library.minissf', mimeType:'application/octet-stream', buffer:Buffer.from(fixture.ssf.mini),
    });
    await until(() => view(page).then(state => /missing SSFLib/i.test(state.status)), 'missing library error');
    const preserved = await view(page);
    assert.equal(preserved.selected,miniPath); assert.equal(preserved.pause,'Resume');
    await page.click('#scspSongStop'); await pcm(page,false);
    assert((await view(page)).stopDisabled);
    assert.equal((await page.evaluate(() => __scspSongAudit.graph())).contexts,1);
    checks.push('A missing SSFLib leaves the paused song available and Stop silences it');

    assert.deepEqual(errors,[]);
    return {browser:name,passed:true,checks,measurements,physicalOutputMuted:true,listeningPerformed:false,
      nativeCores,playbackGraph,graphAfterReload};
  } catch (error) {
    await fs.mkdir(config.screenshots,{recursive:true});
    await page.screenshot({path:path.join(config.screenshots,name + '-failure.png'),fullPage:true}).catch(() => {});
    error.receipt = {browser:name,passed:false,stage,error:error.stack,checks,measurements,errors,
      view:await view(page).catch(() => null),graph:await page.evaluate(() => __scspSongAudit.graph()).catch(() => null),cores:await cores(page).catch(() => null)};
    throw error;
  } finally {await page.close();}
}

const server = http.createServer(async (request,response) => {
  try {
    const pathname = new URL(request.url,'http://localhost').pathname;
    if (pathname === '/favicon.ico') {response.writeHead(204).end(); return;}
    const filename = path.resolve(config.root,'.' + decodeURIComponent(pathname)); assert(filename.startsWith(config.root + path.sep));
    const bytes = await fs.readFile(filename); response.setHeader('Content-Type',mime[path.extname(filename)] ?? 'application/octet-stream'); response.end(bytes);
  } catch (error) {missing.push({url:request.url,error:error.message}); response.writeHead(404).end();}
});
(async () => {
  const {buildScspSongDemo} = await import(pathToFileURL(path.join(repo,'docs/synth-scsp/song_source.js')).href);
  const {createScspSsfPlaybackFixture} = await import(pathToFileURL(path.join(repo,'test/helpers/scsp_ssf_fixture.mjs')).href);
  const bytes = buildScspSongDemo(), unsupported = bytes.slice(); new DataView(unsupported.buffer).setUint32(0x2c,7670454,true);
  const ssf = createScspSsfPlaybackFixture();
  const ssfFolder = await fs.mkdtemp(path.join(tmpdir(),'scsp-ssf-browser-'));
  const fixture = {bytes,gzip:gzipSync(bytes),unsupported,ssf,ssfFolder};
  await fs.mkdir(path.join(ssfFolder,'lib'));
  await Promise.all([
    fs.writeFile(path.join(ssfFolder,'track.minissf'),ssf.mini),
    fs.writeFile(path.join(ssfFolder,'lib','driver.ssflib'),ssf.library),
  ]);
  await new Promise((resolve,reject) => {server.once('error',reject); server.listen(0,'127.0.0.1',resolve);});
  const origin = 'http://127.0.0.1:' + server.address().port;
  let failure = null;
  try {
    for (const name of engines) {
      const browser = await ({chromium,webkit})[name].launch({headless:true,...(name === 'chromium' ? {args:['--mute-audio']} : {})});
      try {results.push(await check(browser,name,origin,fixture));}
      catch (error) {results.push(error.receipt ?? {browser:name,passed:false,error:error.stack}); throw error;}
      finally {await browser.close();}
    }
    assert.deepEqual(missing,[]); assert.deepEqual(external,[]);
  } catch (error) {failure = error;}
  finally {
    server.closeIdleConnections?.(); server.closeAllConnections?.();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await fs.rm(ssfFolder,{recursive:true,force:true});
  }
  const receipt = {schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,
    fixture:{vgmBytes:bytes.length,vgmSha256:hash(bytes),vgzBytes:fixture.gzip.length,vgzSha256:hash(fixture.gzip)},
    results,missing,external,expectedBlockedMonaco:blockedMonaco,...(failure ? {error:failure.stack} : {})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true}); await fs.writeFile(config.out,JSON.stringify(receipt,null,2) + '\n');
  if (failure) throw failure;
  console.log('PASS receipt ' + config.out);
})().catch(error => {console.error(error); process.exitCode = 1;});
