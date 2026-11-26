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
      if (this.buffer) window.testPreviewDuration = this.buffer.duration;
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
  const opnCommands = [0x53,0xb0,0x2b,0x53,0x50,19,
    0x50,0x85,0x50,0x12,0x50,0x91,0x50,0xc3,0x50,0x20,0x50,0xe7,0x50,0xf2,
    ...Array(120).fill(0x62),0x50,0x9f,0x50,0xe1,...Array(180).fill(0x62),0x66];
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
    assert(await page.locator('#fm2612Voice').isHidden());
  }
  await openOpnMonitor();
  const psgRows = page.locator('#segaPsgChannels tbody tr');
  await play.click();
  await psgRows.first().locator('td').first().filter({hasText:'293'}).waitFor();
  await pause.click();
  const checkPsg = async (late) => {
    assert.equal(await psgRows.count(),4);
    assert.equal(await psgRows.first().evaluate(row=>row.classList.contains('is-active')),!late);
    assert.deepEqual(await psgRows.first().locator('td').allTextContents(),['293','Tone',late?'15 · MUTE':'1']);
    assert.deepEqual(await psgRows.last().locator('td').allTextContents(),[late?'32':'Tone 3 · period 515',late?'Periodic':'White','2']);
  };
  await checkPsg(false);
  async function checkMonitorMute(rowButton, dockLabel) {
    const dock = page.locator('#dockPlayPane').getByRole('button',{name:dockLabel,exact:true});
    await rowButton.click();
    assert.equal(await dock.getAttribute('aria-pressed'),'false');
    await dock.click();
    await page.waitForFunction(button=>button.ariaPressed==='true',await rowButton.elementHandle());
  }
  await checkMonitorMute(psgRows.last().getByRole('button'), 'PSG CH4 Noise');
  await movePosition(3);
  await psgRows.last().getByText('Periodic',{exact:true}).waitFor();
  await checkPsg(true);
  await movePosition(1);
  await psgRows.last().getByText('White',{exact:true}).waitFor();
  await checkPsg(false);
  console.log('PSG tone, noise, attenuation and paused forward/backward seek passed');
  await page.locator('#chipMonitorTab0').click();
  const voiceView = page.locator('#fm2612Voice');
  await voiceView.getByRole('button',{name:'CH4',exact:true}).click();
  await play.click();
  await page.waitForFunction(() => !document.querySelector('#pauseButton').disabled && document.querySelector('[data-fm-feedback]').textContent === 'Feedback 5');
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
  for (const [chip,offset,command,clock,expected] of [
    ['YM2203',0x44,0x55,4000000,[1,2,3]], ['YM2608',0x48,0x56,8000000,[1,2,3,4,5,6]],
    ['YM2610',0x4c,0x58,8000000,[2,3,5,6]], ['YM2610B',0x4c,0x58,0x80000000+8000000,[1,2,3,4,5,6]],
  ]) {
    const header = Buffer.from(opn.subarray(0,0xc8));
    header.writeUInt32LE(0,0x0c); header.writeUInt32LE(0,0x2c); header.writeUInt32LE(clock,offset);
    const opna = chip === 'YM2608';
    const percussion = opna ? 'Rhythm' : 'ADPCM-A';
    const deltaRom = opna || chip.startsWith('YM2610') ?
      [0x67,0x66,opna ? 0x81 : 0x83,8,16,0,0,0,16,0,0,0,0,0,0,...Array(4096).fill(0x17)] : [];
    const commands = [...deltaRom,command,0x27,0x40,command,0xac,0x23,command,0xa8,0x55,command,0x28,0x52,
      command,0,0x23,command,1,1,command,7,0x3e,command,8,9,
      ...(opna ? [0x56,0x11,47,0x56,0x18,0x91,0x56,0x10,3,
        0x57,1,0x40,0x57,2,4,0x57,4,9,0x57,9,0x34,0x57,10,0x12,0x57,11,200,0x57,0,0xb0] : []),
      ...(chip.startsWith('YM2610') ? [0x67,0x66,0x82,8,8,0,0,0,8,0,0,0,0,0,0,...Array(2048).fill(0x17),0x59,1,47,0x59,8,0x91,0x59,0x10,2,0x59,0x20,5,0x59,0,3,
        0x58,0x11,0x40,0x58,0x12,4,0x58,0x14,9,0x58,0x19,0x34,0x58,0x1a,0x12,0x58,0x1b,200,0x58,0x10,0x90] : []),
      ...Array(90).fill(0x62),command,0x42,56,command,6,11,command,7,0x36,
      command,11,0x34,command,12,2,command,13,14,command,8,16,
      ...(opna ? [0x56,0x10,0x81,0x57,10,0x24,0x57,0,0xb0,0x57,1,0x41,0x57,0,1] : []),
      ...(chip.startsWith('YM2610') ? [0x59,0x10,3,0x59,0,1,0x59,0x10,2,0x59,0,0x81,0x58,0x1a,0x24,0x58,0x10,0x90,0x58,0x10,1] : []),...Array(210).fill(0x62),0x66];
    const buffer = Buffer.concat([header,Buffer.from(commands)]);
    buffer.writeUInt32LE(buffer.length-4,4);
    await page.locator('#fileInput').setInputFiles({name:chip+'.vgm',mimeType:'application/octet-stream',buffer});
    await page.locator('#operatorInfoTab').click();
    await page.locator('#chipMonitorTabs').getByRole('tab',{name:chip,exact:true}).click();
    const channelButtons=voiceView.locator('[data-fm-channels] button:visible');
    assert.deepEqual(await channelButtons.allTextContents(),expected.map(n=>'CH'+n));
    const first=await channelButtons.first().boundingBox(), second=await channelButtons.nth(1).boundingBox();
    assert.equal(first.x,second.x);assert(first.y<second.y);
    const ch3=voiceView.getByRole('button',{name:'CH3',exact:true});
    await ch3.click();await play.click();
    await voiceView.locator('[data-fm-status]').getByText('CH3 mode 3-slot').waitFor();
    assert(await ch3.evaluate(el=>el.classList.contains('is-key-on')));
    const rows=voiceView.locator('tbody tr');
    assert.equal(await rows.nth(2).locator('td').last().innerText(),'853');
    const tl=rows.first().locator('td').nth(2);
    await page.waitForFunction(el=>el.textContent==='56' && el.getAnimations().length>0,await tl.elementHandle());
    const sections = page.getByRole('tablist',{name:chip+' sections',exact:true});
    assert.deepEqual(await sections.getByRole('tab').allTextContents(), chip === 'YM2203' ? ['FM','SSG'] : ['FM','SSG',percussion,'ADPCM-B']);
    assert.equal(await sections.getByRole('tab',{name:'FM',exact:true}).getAttribute('aria-selected'),'true');
    await sections.getByRole('tab',{name:'SSG',exact:true}).click();
    assert(await voiceView.isHidden());
    await pause.click();
    assert.equal(await rows.first().getByText('On',{exact:true}).count(),1);
    const ssgRows = page.locator('#ssgChannels tbody tr');
    assert.deepEqual(await ssgRows.locator('th').allTextContents(), ['CH A','CH B','CH C']);
    const channelA = ssgRows.first();
    await channelA.getByText('ENV',{exact:true}).waitFor();
    await checkMonitorMute(channelA.getByRole('button'), 'SSG A');
    assert.deepEqual(await channelA.locator('td').allTextContents(), ['291','ON','ON','ENV']);
    const shared = page.locator('#ssgShared');
    for (const text of ['NOISE PERIOD 11','ENV PERIOD 564','SHAPE 14']) {
      assert(await shared.getByText(text,{exact:true}).isVisible());
    }
    await movePosition(.5);
    await channelA.getByText('9',{exact:true}).waitFor();
    assert.deepEqual(await channelA.locator('td').allTextContents(), ['291','ON','OFF','9']);
    assert(await shared.getByText('SHAPE 0',{exact:true}).isVisible());
    await movePosition(3);
    await channelA.getByText('ENV',{exact:true}).waitFor();
    assert(await shared.getByText('SHAPE 14',{exact:true}).isVisible());
    if (opna || chip.startsWith('YM2610')) {
      const a = page.locator(opna ? '#rhythmChannels tbody tr' : '#adpcmAChannels tbody tr'), b = page.locator('#adpcmBChannels tbody tr');
      await sections.getByRole('tab',{name:percussion}).click();
      await a.first().getByText('Stop',{exact:true}).waitFor();
      assert.equal(await a.count(),6);
      await checkMonitorMute(a.nth(1).locator('th button'), opna ? 'Snare' : 'ADPCM-A CH2');
      if (opna) assert.deepEqual(await a.locator('th').allTextContents(),['Bass drum','Snare','Cymbal','Hi-hat','Tom','Rim shot']);
      assert.deepEqual(await a.first().locator('td').allTextContents(),opna ? ['Stop','17','L'] : ['Stop','0x000200','0x0005FF','17','L','Open sample']);
      assert.equal(await a.nth(1).locator('td').first().innerText(),'Start');
      assert.equal(await page.locator(opna ? '#rhythmTotalLevel' : '#adpcmTotalLevel').innerText(),'47');
      async function checkSampleJump(range, time, source = a) {
        const open = source.first().getByRole('button',{name:'Open sample'});
        if (source === a) assert(await a.last().getByRole('button',{name:'Open sample'}).isDisabled());
        await open.click();
        const row = page.locator('#sampleExplorerPanel details[open]').filter({has:page.locator('summary',{hasText:range})});
        await row.locator('summary').waitFor();
        assert(await row.locator('summary').evaluate(el=>el===document.activeElement));
        assert.match(await row.locator('option:checked').innerText(),time);
        await page.waitForFunction(canvas => canvas.dataset.occurrence === canvas.closest('details').querySelector('select').value &&
          canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some(Boolean), await row.locator('canvas').elementHandle());
        await page.evaluate(()=>{window.testPeak=0;});
        await row.getByRole('button',{name:'Preview centered (up to 10 s)'}).click();
        await page.waitForFunction(()=>window.testPeak>0);
        const duration = await page.evaluate(()=>window.testPreviewDuration);
        await page.locator('#operatorInfoTab').click();
        return duration;
      }
      if (!opna) await checkSampleJump('0x300–0x5ff',/1.500 s/);
      await sections.getByRole('tab',{name:'ADPCM-B'}).click();
      await b.getByText('Reset',{exact:true}).waitFor();
      if (opna) assert.deepEqual((await b.locator('td').allTextContents()).slice(1,3),['0x000080','0x00013F']);
      const range = opna ? '0x10–0x27' : '0x400–0x9ff';
      const highDuration = await checkSampleJump(range,/1.500 s/,b);
      await movePosition(.5);
      await b.getByText('Start',{exact:true}).waitFor();
      assert.deepEqual(await b.locator('td').allTextContents(),['Start',opna?'0x000010':'0x000400',opna?'0x000027':'0x0009FF','200','R','4660','On','Open sample']);
      const lowDuration = await checkSampleJump(range,/0.000 s/,b);
      assert(lowDuration > highDuration,chip+' lower Delta-N must play the same sample more slowly');
      await sections.getByRole('tab',{name:percussion}).click();
      await a.first().getByText('Start',{exact:true}).waitFor();
      if (!opna) await checkSampleJump('0x200–0x5ff',/0.000 s/);
      await sections.getByRole('tab',{name:percussion}).press('Home');

      assert(await ch3.isVisible());
      assert.equal(await ch3.getAttribute('aria-pressed'),'true');
      assert(await page.locator('#ssgChannels').isHidden());
    }
    console.log(chip+' SSG live settings and paused backward/forward seek passed');
    console.log(chip+' channel list, CH3 slots, key mask and live parameter highlight passed');
  }
  {
    const upload = amplitude => [0x67,0x66,0xc1,5,0,0,0,0,0x35,amplitude,amplitude,0xff];
    const commands = [...upload(0x88),0xb1,7,0xc2,0xb1,0,0xff,0xb1,6,0x35,0xb1,5,0x35,0xb1,3,8,0xb1,1,0xa4,0xb1,8,0xfb,
      ...Array(120).fill(0x62),0xb1,8,0xff,...upload(0xe0),0xb1,8,0xfb,...Array(180).fill(0x62),0x66];
    const buffer = Buffer.concat([opn.subarray(0,0xc8),Buffer.from(commands)]);
    buffer.writeUInt32LE(buffer.length-4,4); buffer.writeUInt32LE(12500000,0x6c); buffer.writeUInt32LE(0,0x0c);
    await page.locator('#fileInput').setInputFiles({name:'pcm.vgm',mimeType:'application/octet-stream',buffer});
    await page.locator('#operatorInfoTab').click();
    await page.locator('#chipMonitorTabs').getByRole('tab',{name:'RF5C164'}).click();
    await play.click();
    const rows = page.locator('#pcmChannels tbody tr');
    await rows.nth(2).getByText('0x3500',{exact:true}).first().waitFor();
    assert.equal(await rows.count(),8);
    await checkMonitorMute(rows.nth(2).locator('th button'), 'PCM 3');
    assert.deepEqual(await rows.nth(2).locator('td').allTextContents(),['ON','255','4','10','2048','0x3500','0x3500','Open sample']);
    await pause.click();
    assert(await rows.first().getByRole('button',{name:'Open sample'}).isDisabled());
    async function previewAt(seconds, occurrence) {
      await movePosition(seconds);
      await page.waitForFunction(()=>!document.querySelector('#playbackSeek').disabled);
      await rows.nth(2).getByRole('button',{name:'Open sample'}).click();
      const detail=page.locator('#sampleExplorerPanel details[open]');
      await detail.locator('summary').waitFor();
      assert.match(await detail.locator('option:checked').innerText(),occurrence);
      await page.evaluate(()=>window.testPeak=0);
      await detail.getByRole('button',{name:/Preview centered/}).click();
      await page.waitForFunction(()=>window.testPeak>0);
      const peak=await page.evaluate(()=>window.testPeak);
      await page.locator('#operatorInfoTab').click();
      return peak;
    }
    const loud=await previewAt(3,/2.000 s/);
    const quiet=await previewAt(.5,/0.000 s/);
    assert(loud > quiet*2);
    console.log('RF5C164 paused seek selects and previews distinct RAM snapshots at the same address');
  }
  {
    const header = Buffer.from(opn.subarray(0,0xc8));
    header.writeUInt32LE(0,0x0c); header.writeUInt32LE(0,0x2c);
    header.writeUInt32LE(4194304,0x80);
    const first = Array.from({length:16}, (_,i) => [0xb3,0x20+i,(i<<4)|(15-i)]).flat();
    const commands = [...first,...Array(120).fill(0x62),0xb3,0x20,0xab,...Array(180).fill(0x62),0x66];
    const buffer = Buffer.concat([header,Buffer.from(commands)]);
    buffer.writeUInt32LE(buffer.length-4,4);
    await page.locator('#fileInput').setInputFiles({name:'wave.vgm',mimeType:'application/octet-stream',buffer});
    await page.locator('#operatorInfoTab').click();
    const readout = page.locator('#gameboyWaveValues');
    await readout.waitFor();
    assert.equal((await readout.innerText()).split(' ').filter(x=>x==='·').length,32);
    await play.click();
    const checkWave = prefix => page.waitForFunction(prefix =>
      document.querySelector('#gameboyWaveValues').textContent.startsWith(prefix), prefix);
    await checkWave('0 F 1 E');
    await pause.click();
    const canvas = page.locator('#gameboyWaveCanvas');
    const firstImage = await canvas.evaluate(el => el.toDataURL());
    await movePosition(3); await checkWave('A B 1 E');
    assert.notEqual(await canvas.evaluate(el => el.toDataURL()),firstImage);
    await movePosition(.5); await checkWave('0 F 1 E');
    assert.equal(await canvas.evaluate(el => el.toDataURL()),firstImage);
    console.log('Game Boy CH3 wave RAM and Synth waveform follow paused forward and backward seeks');
  }
  for (const chip of ['YM2151','YM2164']) {
    const header = Buffer.from(opn.subarray(0,0xc8));
    header.writeUInt32LE(0,0x0c); header.writeUInt32LE(0,0x2c);
    header.writeUInt32LE(4000000+(chip==='YM2164'?0x80000000:0),0x30);
    const buffer=Buffer.concat([header,Buffer.from([0x54,0x27,0xcf,0x54,0x67,37,0x54,8,0x7f,...Array(300).fill(0x62),0x66])]);
    buffer.writeUInt32LE(buffer.length-4,4);
    await page.locator('#fileInput').setInputFiles({name:chip+'.vgm',mimeType:'application/octet-stream',buffer});
    await page.locator('#operatorInfoTab').click();
    const tab=page.locator('#chipMonitorTabs').getByRole('tab',{name:chip,exact:true});
    await tab.click();
    const panel=page.locator('#'+await tab.getAttribute('aria-controls'));
    const ch=panel.getByRole('button',{name:'CH8',exact:true});await ch.click();
    await play.click();
    await panel.getByText('ALG 7',{exact:true}).waitFor();
    assert(await ch.evaluate(el=>el.classList.contains('is-key-on')));
    assert.equal(await panel.locator('td').nth(4).innerText(),'37');
    assert(await panel.locator('[data-operator-envelope]').isVisible());
    await pause.click();
    console.log(chip+' CH8 register table and envelope passed');
  }
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
