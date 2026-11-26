// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {extname,resolve,join,dirname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {createScspSsfPlaybackFixture} from '../test/helpers/scsp_ssf_fixture.mjs';
import {createPsfPlaybackFixture} from '../test/helpers/spu_psf_playback_fixture.mjs';
import {buildScspSongDemo} from '../docs/synth-scsp/song_source.js';
const root = resolve(process.argv[2] || 'docs'), work = await mkdtemp(join(tmpdir(),'console-songs-'));
const server = createServer(async (req,res) => {
  try {
    const file = resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if (!file.startsWith(root+sep)) throw Error();
    const bytes = await readFile(file);
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm','.css':'text/css'})[extname(file)] || 'application/octet-stream');
    res.end(bytes);
  } catch {res.writeHead(404).end();}
});
let browser;
try {
  await new Promise((ok,fail) => server.once('error',fail).listen(0,'127.0.0.1',ok));
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage();
  page.on('pageerror',error=>console.error(error));
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination,...args) {
      if (destination === this.context.destination) {
        const meter = this.context.createAnalyser();
        connect.call(this,meter);
        window.testMeter = meter;
      }
      return connect.call(this,destination,...args);
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args) {
      for (const sample of this.buffer?.getChannelData(0) || []) window.testPeak = Math.max(window.testPeak || 0,Math.abs(sample));
      return start.apply(this,args);
    };
  });
  await page.goto('http://127.0.0.1:'+server.address().port+(process.argv[2] ? '/' : '/vgm_analyzer/')+'index.html');
  const play = page.locator('#playButton'), pause = page.locator('#pauseButton'), stop = page.locator('#stopButton');
  // Hold the browser's file read as it would be for a cloud-backed file.
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function() {
      if (this.name === 'slow.vgm') {
        File.prototype.arrayBuffer = read;
        await new Promise(resolve => {window.finishFileRead = resolve;});
      }
      return read.call(this);
    };
  });
  assert.equal(await page.getByRole('tab',{name:'Basic',exact:true}).getAttribute('aria-selected'),'true');
  assert(await page.getByRole('tab',{name:'VGM',exact:true}).isDisabled());
  const setting = page.getByRole('tab',{name:'Setting',exact:true});
  await setting.click();
  await page.locator('#settingPanel #prefetchFactorSelect').selectOption('1.5');
  await page.locator('#settingPanel #workletQueueSelect').selectOption('3');
  await page.locator('#playlistTab').click();
  assert.equal(await page.locator('#playlistPanel :is(#playButton,#playbackSeek,#playbackFade,#prefetchFactorSelect)').count(),0);
  assert(await page.locator('#dockPlayPane #playbackFade').isVisible());
  async function chooseFromBasic(name, files) {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('tabpanel',{name:'Basic'}).getByRole('button',{name,exact:true}).click(),
    ]);
    await chooser.setFiles(files);
  }
  const tabsTop = () => page.locator('#outputTabs').evaluate(el => el.getBoundingClientRect().top + window.scrollY);
  const initialTop = await tabsTop();
  await chooseFromBasic('Select files…',{name:'slow.vgm',mimeType:'application/octet-stream',buffer:Buffer.from('invalid')});
  const indicator = page.locator('#fileLoadProgress');
  await indicator.filter({hasText:'Reading slow.vgm'}).waitFor();
  assert.equal(await tabsTop(),initialTop);
  await page.evaluate(() => window.finishFileRead());
  await indicator.waitFor({state:'hidden'});
  assert.equal(await tabsTop(),initialTop);
  assert.match(await page.locator('#headerOutput').textContent(),/Failed to (decode|parse)/);
  assert(await page.locator('#playlistPanel').isVisible());
  assert(await page.locator('#parsedOutputTab').isDisabled());
  const ssf = createScspSsfPlaybackFixture(), psf = createPsfPlaybackFixture();
  const elapsed = await page.evaluate(async ({image,prefix}) => {
    const {createScspSsfEngine} = await import(prefix+'synth-scsp/scsp_ssf_engine.js');
    const ram = new Uint8Array(512*1024); ram.set(image);
    const totalSamples = 441000, start = performance.now();
    const worker = await createScspSsfEngine({ram,totalSamples});
    try {
      for (let frame=0;frame<totalSamples;frame+=2048) await worker.process(Math.min(2048,totalSamples-frame));
    } finally {worker.dispose();}
    return Math.round(performance.now()-start);
  },{image:Array.from(ssf.image),prefix:process.argv[2]?'./':'../'});
  console.log('SSF Worker startup and 10 seconds of fast-forward:',elapsed,'ms');
  const files = {'a.ssf':ssf.standalone,'b.psf':psf.standalone,'c.minissf':ssf.mini,'d.minipsf':psf.mini,
    'lib/driver.ssflib':ssf.library,'lib/driver.psflib':psf.library};
  for (const [name,bytes] of Object.entries(files)) {
    await mkdir(dirname(join(work,name)),{recursive:true});
    await writeFile(join(work,name),bytes);
  }
  await chooseFromBasic('Select folder…',work);
  const tracks = page.locator('#playlistList button');
  await tracks.nth(3).waitFor();
  await page.waitForFunction(() => !document.querySelector('#parsedOutputTab').disabled);
  assert.deepEqual(await tracks.allTextContents(),['a.ssf','b.psf','c.minissf','d.minipsf']);
  // Sample after the Analyzer's master/FX output, including renderer lookahead.
  const checkOutput = audible => page.waitForFunction(expected => {
    if (!window.testMeter) return false;
    const pcm = new Float32Array(2048);
    window.testMeter.getFloatTimeDomainData(pcm);
    return (Math.max(...pcm)-Math.min(...pcm) > .0001) === expected;
  },audible,{timeout:5000,polling:10});
  async function checkConsoleMixer(count) {
    const buttons = page.locator('#monitorToggles button');
    assert.equal(await buttons.count(),count);
    // The fixtures sound on CH1. Muting the highest physical CH first also
    // exercises SCSP slot 32 (the sign bit) and mute state before Play.
    await buttons.last().click();
    await play.click();
    await checkOutput(true);
    if (count === 32) {
      await page.waitForSelector('#monitorToggles [data-scsp-slot="0"].is-key-on',{state:'attached'});
      assert.equal(await buttons.last().getAttribute('class').then(cls => cls.includes('is-key-on')),false);
    }
    await buttons.first().click();
    await checkOutput(false);
    if (count === 32) await page.waitForSelector('#monitorToggles .is-muted.is-key-on',{state:'attached'});
    await buttons.first().click();
    await checkOutput(true);
    const effects = page.locator('#dockEffectPane');
    await page.locator('#dockEffectTab').click();
    await effects.locator('#effectEnabled').click();
    await effects.locator('#effectGain').evaluate(el => {el.value=0; el.dispatchEvent(new Event('input'));});
    await checkOutput(false);
    await effects.locator('#effectEnabled').click();
    await checkOutput(true);
    await page.locator('#dockPlayTab').click();
    await stop.click();
    if (count === 32) await page.waitForFunction(() => !document.querySelector('[data-scsp-slot].is-key-on'));
  }
  function movePosition(seconds) {
    const range = page.locator('#playbackSeek');
    return range.evaluate((input, ticks) => {
        if (input.disabled) throw Error('Position control is disabled');
        input.value = ticks;
        input.dispatchEvent(new Event('input'));
        input.dispatchEvent(new Event('change'));
      },seconds*44100);
  }
  async function checkSeek() {
    await play.click();
    await checkOutput(true);
    await pause.click();
    await play.filter({hasText:'Resume'}).waitFor();
    await movePosition(.5);
    await page.waitForFunction(() => {
      const range = document.querySelector('#playbackSeek');
      return !range.disabled && range.value === '22050' && !document.querySelector('#playButton').disabled;
    });
    await checkOutput(false);
    await play.click();
    await checkOutput(true);
    const voice = page.locator('#monitorToggles button').first();
    await voice.click();
    await checkOutput(false);
    await page.locator('#dockEffectTab').click();
    await page.locator('#effectEnabled').click();
    await page.locator('#effectGain').evaluate(el => {el.value=0; el.dispatchEvent(new Event('input'));});
    await movePosition(.1);
    await page.waitForFunction(() => {
      const range = document.querySelector('#playbackSeek');
      return !range.disabled && +range.value > 4410 && !document.querySelector('#pauseButton').disabled;
    });
    assert.equal(await voice.getAttribute('aria-pressed'),'true');
    await checkOutput(false);
    await page.locator('#dockPlayTab').click();
    await voice.click();
    await page.locator('#dockEffectTab').click();
    assert.equal(await page.locator('#effectEnabled').getAttribute('aria-pressed'),'true');
    await checkOutput(false);
    await page.locator('#effectEnabled').click();
    await checkOutput(true);
    await page.locator('#dockPlayTab').click();
    await stop.click();
  }
  async function checkWav() {
    const volume = page.locator('#dockVolumeRange');
    const level = n => volume.evaluate((el,value) => {el.value=value; el.dispatchEvent(new Event('input'));},n);
    const mutes = mode => page.evaluate(mode => {
      const buttons = () => document.querySelectorAll('#monitorToggles button');
      for (let i=0;i<buttons().length;i++) {
        const muted = mode === 'all' || (mode === 'solo' && i !== 0);
        if ((buttons()[i].getAttribute('aria-pressed') === 'true') !== muted) buttons()[i].click();
      }
    },mode);
    const save = async () => {
      await page.locator('#exportTab').click();
      await page.locator('#exportWavButton').click();
      await page.locator('#wavMaxSecondsInput').fill('1');
      const pending = page.waitForEvent('download',{timeout:10000});
      await page.locator('#wavExportDialog [value=export]').click();
      const download = await pending.catch(async error => {throw Error(await page.locator('#wavExportStatus').textContent(),{cause:error});});
      const bytes = await readFile(await download.path());
      assert.equal(bytes.toString('ascii',0,4),'RIFF');
      assert.equal(bytes.readUInt32LE(24),44100);
      assert.equal(bytes.readUInt16LE(22),2);
      assert.equal(bytes.length,44+44100*4);
      await page.locator('#playlistTab').click();
      return bytes;
    };
    await movePosition(.5);
    await play.filter({hasText:'Resume'}).waitFor();
    await level(100); await mutes('none');
    const full = await save();
    assert(full.subarray(44).some(v=>v));
    await page.locator('#dockEffectTab').click();
    await page.locator('#effectEnabled').click(); // Effect gain is zero from checkSeek.
    await mutes('solo');
    assert.deepEqual(await save(),full,'the single sounding voice is preserved and FX bypassed');
    await level(50);
    const half = await save();
    for (let i=44;i<full.length;i+=2) assert(Math.abs(2*half.readInt16LE(i)-full.readInt16LE(i))<=2);
    await mutes('all');
    assert((await save()).subarray(44).every(v=>v===0));
    assert.equal(await page.locator('#playbackSeek').inputValue(),'22050');
    assert.equal(await play.textContent(),'Resume');
    await level(100); await mutes('none'); await page.locator('#effectEnabled').click();
    await page.locator('#dockPlayTab').click();
    await stop.click();
  }
  async function playAudible() {
    await page.evaluate(()=>window.testPeak=0);
    await play.click({timeout:5000});
    await page.waitForFunction(()=>window.testPeak > 0.00001,null,{timeout:5000});
    await pause.click();
    await play.filter({hasText:'Resume'}).waitFor();
    await play.click();
    await stop.click();
  }
  for (let index=0; index<4; index++) {
    if (index) {
      await tracks.nth(index).click();
      await pause.click();
      await stop.click();
    }
    await playAudible();
    if (index < 2) await checkConsoleMixer(index === 0 ? 32 : 24);
    await checkSeek();
    await checkWav();
    console.log(await tracks.nth(index).textContent());
  }
  // A caller-selected duration bounds an untimed PSF without borrowing its playing core.
  const untimed = Buffer.from(Buffer.from(psf.standalone).toString('latin1').replace('length=0:04','unused=0:04'),'latin1');
  await page.locator('#fileInput').setInputFiles({name:'untimed.psf',mimeType:'application/octet-stream',buffer:untimed});
  await play.click();
  await checkOutput(true);
  await page.locator('#exportTab').click();
  await page.locator('#exportWavButton').click();
  assert.equal(await page.locator('#wavMaxSecondsInput').inputValue(),'120');
  await page.locator('#wavMaxSecondsInput').fill('2');
  const before = Number(await page.locator('#playbackSeek').inputValue());
  const saving = page.waitForEvent('download',{timeout:15000});
  await page.locator('#wavExportDialog [value=export]').click();
  const saved = await saving;
  await page.locator('#playlistTab').click();
  assert.equal(saved.suggestedFilename(),'untimed.wav');
  assert.equal((await readFile(await saved.path())).length,44+2*44100*4);
  await page.waitForFunction(ticks => !document.querySelector('#pauseButton').disabled &&
    +document.querySelector('#playbackSeek').value > ticks,before);
  await stop.click();
  await page.locator('#consoleFolder').setInputFiles(work);
  await tracks.nth(3).waitFor();
  // Carry active FX into the next audio context at the natural SSF and PSF ends.
  await page.locator('#dockEffectTab').click();
  await page.locator('#effectEnabled').click();
  await tracks.first().click();
  await page.waitForFunction(() => document.querySelector('#playlistList [aria-current="true"]')?.textContent === 'b.psf');
  await page.waitForFunction(() => document.querySelector('#monitorToggles')?.children.length === 24 && !document.querySelector('#pauseButton').disabled);
  assert.equal(await page.locator('#effectEnabled').getAttribute('aria-pressed'),'true');
  await checkOutput(false);
  await page.locator('#effectEnabled').click();
  await checkOutput(true);
  await page.waitForFunction(() => document.querySelector('#playlistList [aria-current="true"]')?.textContent === 'c.minissf');
  await page.locator('#dockPlayTab').click();
  await stop.click();
  await page.locator('#fileInput').setInputFiles({name:'original.vgm',mimeType:'application/octet-stream',buffer:Buffer.from(buildScspSongDemo())});
  await playAudible();
  await checkConsoleMixer(32);
  await play.click();
  await pause.click();
  for (const [seconds, keyed] of [[.2,true],[.3,false]]) {
    await movePosition(seconds);
    await page.waitForFunction(({seconds,keyed}) =>
      !document.querySelector('#playbackSeek').disabled &&
      +document.querySelector('#playbackSeek').value === Math.round(seconds*44100) &&
      document.querySelector('#monitorToggles [data-scsp-slot="0"]').classList.contains('is-key-on') === keyed,
      {seconds,keyed});
  }
  await stop.click();
  await checkSeek();
  await checkWav();
  console.log('SCSP VGM passed');
  const writes = [];
  const write = (word,value) => writes.push(0xc7,word >> 8,word & 255,value);
  for (let n=0;n<32;n++) write(n,n < 16 ? 63 : 0);
  for (const [word,value] of [[0x101,0xff],[0x102,0xa0],[0x103,6],[0x104,0xf0],[0x100,0x80]]) write(word,value);
  writes.push(0x61,0xff,0xff);
  write(0x101,0); // The second half is silent while the transport keeps playing.
  writes.push(0x61,0xff,0xff,0x66);
  const vsu = Buffer.alloc(0xc8 + writes.length);
  vsu.write('Vgm '); vsu.writeUInt32LE(vsu.length-4,4); vsu.writeUInt32LE(0x171,8); vsu.writeUInt32LE(0xc8-0x34,0x34);
  vsu.writeUInt32LE(5000000,0xc4); vsu.set(writes,0xc8);
  // Port 1 CH4, algorithm 3 / feedback 5, OP1 AR 19. Hold for five seconds.
  const opnCommands = [0x53,0xb0,0x2b,0x53,0x50,19, ...Array(300).fill(0x62),0x66];
  const opn = Buffer.concat([vsu.subarray(0,0xc8),Buffer.from(opnCommands)]);
  opn.writeUInt32LE(300*735,0x18);
  opn.writeUInt32LE(opn.length-4,4);
  opn.writeUInt32LE(0,0xc4);
  opn.writeUInt32LE(7670454,0x2c);
  opn.writeUInt32LE(3579545,0x0c);

  async function openOpnMonitor() {
    await page.locator('#fileInput').setInputFiles({name:'monitor.vgm',mimeType:'application/octet-stream',buffer:opn});
    await page.locator('#operatorInfoTab').click();
    const soundChip = page.getByRole('tabpanel',{name:'SoundChip',exact:true});
    const chips = soundChip.getByRole('tab');
    assert.equal(await page.locator('#playlistPanel .channel-toggle').count(),0);
    assert(await page.locator('#dockPlayPane').getByRole('button',{name:'PSG',exact:true}).count());
    assert.deepEqual(await chips.allTextContents(),['YM2612','Sega PSG']);
    await chips.first().click();
    assert(await soundChip.getByText('FM Channel Monitor',{exact:true}).isVisible());
    await page.keyboard.press('ArrowRight');
    assert.equal(await chips.last().getAttribute('aria-selected'),'true');
    assert(await page.locator('#psgMonitorTitle').isVisible());
    assert(await page.locator('#channelGrid').isHidden());
  }
  await openOpnMonitor();
  await page.locator('#chipMonitorTab0').click();
  const voiceView = page.locator('#fm2612Voice');
  await voiceView.getByRole('button',{name:'CH4',exact:true}).click();
  await play.click();
  await voiceView.locator('[data-fm-feedback]').filter({hasText:'Feedback 5'}).waitFor();
  await pause.click();
  assert.match(await voiceView.locator('[data-fm-routing]').innerText(),/ALGO 3/);
  assert.equal(await voiceView.locator('tbody tr').first().locator('td').nth(4).innerText(),'19');
  await voiceView.getByRole('button',{name:'CH1',exact:true}).click();
  await voiceView.getByRole('button',{name:'CH4',exact:true}).click();
  await voiceView.getByRole('button',{name:'Open in Instrument'}).click();
  const instrument = page.locator('#tfiInfoPanel');
  assert(await instrument.isVisible());
  assert.equal(await instrument.locator('.tfi-title').innerText(),'monitor_ch4.tfi');
  const [snapshot] = await Promise.all([
    page.waitForEvent('download'), instrument.getByRole('button',{name:'Download TFI'}).click(),
  ]);
  const patch = await readFile(await snapshot.path());
  assert.equal(patch.length,42);
  assert.deepEqual([patch[0],patch[1],patch[6]],[3,5,19]); // ALG, FB, OP1 AR
  await page.locator('#operatorInfoTab').click();
  await page.locator('#fileInput').setInputFiles({name:'original-vsu.vgm',mimeType:'application/octet-stream',buffer:vsu});
  await page.waitForFunction(() => document.querySelector('#parsedOutputTab').ariaSelected === 'true' && !document.querySelector('#playButton').disabled);
  for (const id of ['operatorInfoTab','noteishTab','sheetMusicTab','tfiInfoTab','sampleExplorerTab']) {
    assert.ok(await page.locator('#'+id).isDisabled(), 'VSU: '+id);
  }
  assert.equal(await page.locator('#parsedOutputTab').getAttribute('aria-selected'),'true');
  assert.ok(await page.locator('#operatorInfoPanel').isHidden());
  await page.locator('#playlistTab').click();
  await play.click();
  await page.waitForFunction(() => {
    const pcm = new Float32Array(2048);
    window.testMeter?.getFloatTimeDomainData(pcm);
    return pcm.some(value=>Math.abs(value)>0.00001);
  },null,{timeout:5000});
  await pause.click();
  await play.filter({hasText:'Resume'}).waitFor();
  await stop.click();
  await checkConsoleMixer(6);
  await checkSeek();
  await play.click();
  await checkOutput(true);
  await page.waitForFunction(() => !document.querySelector('#pauseButton').disabled && !document.querySelector('#playbackSeek').disabled);
  await movePosition(1.8);
  await page.waitForFunction(() => +document.querySelector('#playbackSeek').value >= 1.9*44100);
  await checkOutput(false);
  await movePosition(.2);
  await checkOutput(true);
  await stop.click();
  await checkWav();
  await openOpnMonitor();
  console.log('VSU VGM and OPN tab switching passed');
  await page.locator('#playlistTab').click();
  const mainPlay = page.locator('#playButton');
  for (const [path, model] of [['tone.sid','6581'],['rsid/irq.sid','6581'],['tone.sid','8580']]) {
    const buffer = await readFile(new URL('../docs/sid-player/demos/'+path,import.meta.url));
    // Exercise non-first default subtune, selection, and both model-specific WASMs.
    if (path === 'tone.sid') {
      buffer.writeUInt16BE(2,14); buffer.writeUInt16BE(2,16);
      if (model === '8580') buffer.writeUInt16BE((buffer.readUInt16BE(118)&~48)|32,118);
    }
    await page.locator('#fileInput').setInputFiles({name:'test.sid',mimeType:'application/octet-stream',buffer});
    await page.locator('#detectedChips').filter({hasText:model}).waitFor();
    if (path === 'tone.sid') {
      const subtunes = page.locator('#sidSubtune');
      assert.equal(await subtunes.inputValue(),'2');
      await subtunes.selectOption('1');
    }
    await page.evaluate(()=>window.testMeter=null);
    const checkLoading = path === 'tone.sid';
    const wasm = '**/generated/sid-analyzer/*.wasm';
    let releaseFetch;
    const released = new Promise(resolve => {releaseFetch = resolve;});
    if (checkLoading) await page.route(wasm,async route => {await released; await route.continue();});
    await mainPlay.click();
    if (checkLoading) {
      try {await page.locator('#fileLoadProgress').filter({hasText:'Loading SID audio engine'}).waitFor();}
      finally {releaseFetch();}

    }
    await page.waitForFunction(() => {
      const pcm = new Float32Array(2048);
      window.testMeter?.getFloatTimeDomainData(pcm);
      return pcm.some(value=>Math.abs(value)>0.00001);
    },null,{timeout:8000});
    if (checkLoading) await page.unroute(wasm);
    await page.locator('#fileLoadProgress').waitFor({state:'hidden'});
    if (path === 'tone.sid') {
      const checkSignal = audible => page.waitForFunction(expected => {
        const pcm = new Float32Array(2048);
        window.testMeter.getFloatTimeDomainData(pcm);
        return (Math.max(...pcm)-Math.min(...pcm) > .001) === expected;
      },audible,{timeout:5000});
      const ch1 = page.locator('#monitorToggles [aria-label="Mute SID CH1"]');
      await ch1.click();
      await checkSignal(false);
      const outputTab = page.locator('#dockOutputTab');
      const captureScope = async mode => {
        await page.locator('[data-output-mode="'+mode+'"]').click();
        return page.locator('#outputScope').evaluate(canvas => new Promise(resolve => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(canvas.toDataURL())));
        }));
      };
      await outputTab.click();
      const silentWave = await captureScope('waveform');
      const silentSpectrum = await captureScope('spectrum');
      await page.locator('#dockPlayTab').click();
      assert.equal(await page.locator('#monitorToggles [aria-label="Mute SID CH1"]').getAttribute('aria-pressed'),'true');
      await ch1.click();
      await checkSignal(true);
      await outputTab.click();
      assert.notEqual(await captureScope('waveform'),silentWave,'audible SID changes the waveform');
      assert.notEqual(await captureScope('spectrum'),silentSpectrum,'audible SID changes the spectrum');
      await page.locator('#dockEffectTab').click();
      await page.locator('#effectEnabled').click();
      await page.locator('#effectGain').evaluate(input => {input.value = '0'; input.dispatchEvent(new Event('input'));});
      await checkSignal(false);
      await page.locator('#effectEnabled').click();
      await checkSignal(true);
    }
    await page.locator('#dockPlayTab').click();
    await page.locator('#pauseButton').click();
    await mainPlay.filter({hasText:'Resume'}).click();
    await page.locator('#stopButton').click();
    console.log(model,path,'passed');
  }
  const ntsc = await readFile(new URL('../docs/sid-player/demos/tone.sid',import.meta.url));
  ntsc.writeUInt16BE((ntsc.readUInt16BE(118)&~12)|8,118);
  await page.locator('#fileInput').setInputFiles({name:'ntsc.sid',mimeType:'application/octet-stream',buffer:ntsc});
  await page.locator('#playbackError').filter({hasText:'NTSC'}).waitFor();
  assert(await mainPlay.isDisabled());
  console.log('NTSC rejection passed');
  if (process.argv.length > 3) {
    await page.locator('#fileInput').setInputFiles(process.argv.slice(3));
    if (process.argv.length === 4 && /\.sid$/i.test(process.argv[3])) {
      await page.locator('#detectedChips').filter({hasText:/6581|8580/}).waitFor();
      await mainPlay.click();
      await page.waitForFunction(() => {
        const pcm = new Float32Array(2048);
        window.testMeter?.getFloatTimeDomainData(pcm);
        return Math.max(...pcm)-Math.min(...pcm) > .001;
      },null,{timeout:15000});
      await page.locator('#stopButton').click();
      console.log('Local SID passed:',process.argv[3]);
    } else {
      await playAudible();
      console.log('Local song passed:',await tracks.first().textContent());
    }
  }
} finally {
  await browser?.close();
  server.close();
  await rm(work,{recursive:true,force:true});
}
