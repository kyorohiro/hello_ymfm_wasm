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
  const ssf = createScspSsfPlaybackFixture(), psf = createPsfPlaybackFixture();
  const files = {'a.ssf':ssf.standalone,'b.psf':psf.standalone,'c.minissf':ssf.mini,'d.minipsf':psf.mini,
    'lib/driver.ssflib':ssf.library,'lib/driver.psflib':psf.library};
  for (const [name,bytes] of Object.entries(files)) {
    await mkdir(dirname(join(work,name)),{recursive:true});
    await writeFile(join(work,name),bytes);
  }
  await page.locator('#consoleFolder').setInputFiles(work);
  const select = modal.locator('select');
  await select.locator('option').nth(3).waitFor({state:'attached'});
  assert.equal(await select.locator('option').count(),4);
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
    console.log(await select.inputValue());
  }
  await modal.getByText('Close',{exact:true}).click();
  await page.locator('#fileInput').setInputFiles({name:'original.vgm',mimeType:'application/octet-stream',buffer:Buffer.from(buildScspSongDemo())});
  await playAudible();
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
  console.log('VSU VGM passed');
  if (process.argv.length > 3) {
    await modal.getByText('Close',{exact:true}).click();
    await page.locator('#fileInput').setInputFiles(process.argv.slice(3));
    await playAudible();
    console.log('Local song passed:',await select.inputValue());
  }
} finally {
  await browser?.close();
  server.close();
  await rm(work,{recursive:true,force:true});
}
