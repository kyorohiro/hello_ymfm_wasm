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
  const modal = page.locator('#consoleSongs'), play = modal.locator('[data-song="play"]');
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
  await page.locator('#fileInput').setInputFiles({name:'slow.vgm',mimeType:'application/octet-stream',buffer:Buffer.from('invalid')});
  const indicator = page.locator('#fileLoadProgress');
  await indicator.filter({hasText:'Reading slow.vgm'}).waitFor();
  await page.evaluate(() => window.finishFileRead());
  await indicator.waitFor({state:'hidden'});
  assert.match(await page.locator('#headerOutput').textContent(),/Failed to (decode|parse)/);
  const ssf = createScspSsfPlaybackFixture(), psf = createPsfPlaybackFixture();
  const files = {'a.ssf':ssf.standalone,'b.psf':psf.standalone,'c.minissf':ssf.mini,'d.minipsf':psf.mini,
    'lib/driver.ssflib':ssf.library,'lib/driver.psflib':psf.library};
  for (const [name,bytes] of Object.entries(files)) {
    await mkdir(dirname(join(work,name)),{recursive:true});
    await writeFile(join(work,name),bytes);
  }
  await page.locator('#consoleFolder').setInputFiles(work);
  const select = modal.locator('[data-song="tracks"]');
  await select.locator('option').nth(3).waitFor({state:'attached'});
  assert.equal(await select.locator('option').count(),4);
  // Sample after the Analyzer's master/FX output, including renderer lookahead.
  const checkOutput = audible => page.waitForFunction(expected => {
    if (!window.testMeter) return false;
    const pcm = new Float32Array(2048);
    window.testMeter.getFloatTimeDomainData(pcm);
    return (Math.max(...pcm)-Math.min(...pcm) > .0001) === expected;
  },audible,{timeout:5000,polling:10});
  async function checkConsoleMixer(count) {
    const buttons = modal.locator('[data-song="channels"] button');
    assert.equal(await buttons.count(),count);
    // The fixtures sound on CH1. Muting the highest physical CH first also
    // exercises SCSP slot 32 (the sign bit) and mute state before Play.
    await buttons.last().click();
    await play.click();
    await checkOutput(true);
    await buttons.first().click();
    await checkOutput(false);
    await buttons.first().click();
    await checkOutput(true);
    const effects = modal.locator('[data-song="effects"]');
    await effects.locator('summary').click();
    await effects.locator('#effectEnabled').click();
    await effects.locator('#effectGain').evaluate(el => {el.value=0; el.dispatchEvent(new Event('input'));});
    await checkOutput(false);
    await effects.locator('#effectEnabled').click();
    await checkOutput(true);
    await effects.locator('summary').click();
    await modal.locator('[data-song="stop"]').click();
  }
  async function playAudible() {
    await page.evaluate(()=>window.testPeak=0);
    await play.click({timeout:5000}).catch(async error => {throw new Error(await modal.innerText(),{cause:error});});
    await page.waitForFunction(()=>window.testPeak > 0.00001,null,{timeout:5000});
    await modal.locator('[data-song="pause"]').click();
    await play.filter({hasText:'Resume'}).waitFor();
    await play.click();
    await modal.locator('[data-song="stop"]').click();
  }
  for (let index=0; index<4; index++) {
    await select.selectOption({index});
    await playAudible();
    if (index < 2) await checkConsoleMixer(index === 0 ? 32 : 24);
    console.log(await select.inputValue());
  }
  await modal.getByText('Close',{exact:true}).click();
  await page.locator('#fileInput').setInputFiles({name:'original.vgm',mimeType:'application/octet-stream',buffer:Buffer.from(buildScspSongDemo())});
  await playAudible();
  await checkConsoleMixer(32);
  console.log('SCSP VGM passed');
  await modal.getByText('Close',{exact:true}).click();
  const writes = [];
  const write = (word,value) => writes.push(0xc7,word >> 8,word & 255,value);
  for (let n=0;n<32;n++) write(n,n < 16 ? 63 : 0);
  for (const [word,value] of [[0x101,0xff],[0x102,0xa0],[0x103,6],[0x104,0xf0],[0x100,0x80]]) write(word,value);
  writes.push(0x61,0xff,0xff,0x66);
  const vsu = Buffer.alloc(0xc8 + writes.length);
  vsu.write('Vgm '); vsu.writeUInt32LE(vsu.length-4,4); vsu.writeUInt32LE(0x171,8); vsu.writeUInt32LE(0xc8-0x34,0x34);
  vsu.writeUInt32LE(5000000,0xc4); vsu.set(writes,0xc8);
  await page.locator('#fileInput').setInputFiles({name:'original-vsu.vgm',mimeType:'application/octet-stream',buffer:vsu});
  await play.click();
  await page.waitForFunction(() => {
    const pcm = new Float32Array(2048);
    window.testMeter?.getFloatTimeDomainData(pcm);
    return pcm.some(value=>Math.abs(value)>0.00001);
  },null,{timeout:5000});
  await modal.locator('[data-song="pause"]').click();
  await play.filter({hasText:'Resume'}).waitFor();
  await modal.locator('[data-song="stop"]').click();
  await checkConsoleMixer(6);
  console.log('VSU VGM passed');
  await modal.getByText('Close',{exact:true}).click();
  const mainPlay = page.locator('#inlinePlayButton');
  for (const [path, model] of [['tone.sid','6581'],['rsid/irq.sid','6581'],['tone.sid','8580']]) {
    const buffer = await readFile(new URL('../docs/sid-player/demos/'+path,import.meta.url));
    // Exercise non-first default subtune, selection, and both model-specific WASMs.
    if (path === 'tone.sid') {
      buffer.writeUInt16BE(2,14); buffer.writeUInt16BE(2,16);
      if (model === '8580') buffer.writeUInt16BE((buffer.readUInt16BE(118)&~48)|32,118);
    }
    await page.locator('#fileInput').setInputFiles({name:'test.sid',mimeType:'application/octet-stream',buffer});
    await page.locator('#detectedChips').filter({hasText:model}).waitFor();
    assert.equal(await modal.isVisible(),false);
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
      const ch1 = page.locator('#inlineMonitorToggles [aria-label="Mute SID CH1"]');
      await ch1.click();
      await checkSignal(false);
      assert.equal(await page.locator('#monitorToggles [aria-label="Mute SID CH1"]').getAttribute('aria-pressed'),'true');
      await ch1.click();
      await checkSignal(true);
      await page.locator('#dockEffectTab').click();
      await page.locator('#effectEnabled').click();
      await page.locator('#effectGain').evaluate(input => {input.value = '0'; input.dispatchEvent(new Event('input'));});
      await checkSignal(false);
      await page.locator('#effectEnabled').click();
      await checkSignal(true);
    }
    await page.locator('#inlinePauseButton').click();
    await mainPlay.filter({hasText:'Resume'}).click();
    await page.locator('#inlineStopButton').click();
    console.log(model,path,'passed');
  }
  const ntsc = await readFile(new URL('../docs/sid-player/demos/tone.sid',import.meta.url));
  ntsc.writeUInt16BE((ntsc.readUInt16BE(118)&~12)|8,118);
  await page.locator('#fileInput').setInputFiles({name:'ntsc.sid',mimeType:'application/octet-stream',buffer:ntsc});
  await page.locator('#inlinePlaybackError').filter({hasText:'NTSC'}).waitFor();
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
      await page.locator('#inlineStopButton').click();
      console.log('Local SID passed:',process.argv[3]);
    } else {
      await playAudible();
      console.log('Local song passed:',await select.inputValue());
    }
  }
} finally {
  await browser?.close();
  server.close();
  await rm(work,{recursive:true,force:true});
}
