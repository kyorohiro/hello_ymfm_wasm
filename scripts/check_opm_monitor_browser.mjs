// SPDX-License-Identifier: BSD-3-Clause
import {bankedSong} from './fixtures/oki6295_banked_vgm.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

const packageDir = process.argv[2];
const root = packageDir ? pathToFileURL(resolve(packageDir) + '/') : new URL('../docs/',import.meta.url);
const server = createServer(async (req,res) => {
  try {
    const file = new URL('.'+new URL(req.url,'http://local').pathname,root);
    if (!file.href.startsWith(root.href)) throw Error();
    const type = file.pathname.split('.').at(-1);
    res.setHeader('Content-Type',({js:'text/javascript',html:'text/html',wasm:'application/wasm',css:'text/css'})[type] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror',e => errors.push(e.message));
  // Same OP masks and routing changes as the CPS1 algorithm example.
  const commands=[];
  const reg=(r,v)=>commands.push(0x54,r,v);
  const second=()=>commands.push(0x61,0x44,0xac);
  reg(0x98,31); // OP4 attack for the captured keyboard audition.
  reg(0x20,0xc7);reg(0x68,22);reg(0x70,46);reg(8,0x40);second();
  reg(8,0x60);second();
  reg(0x20,0xd4);reg(8,0x40);second();
  reg(8,0x60);
  // A stream of TL writes during the last two seconds exercises render batching.
  for(let i=0;i<2000;i++){reg(0x60,i%128);commands.push(0x61,44,0);}
  commands.push(0x61,200,0);reg(8,0);commands.push(0x66);
  const buffer=Buffer.alloc(256+commands.length);
  buffer.write('Vgm ');buffer.writeUInt32LE(buffer.length-4,4);buffer.writeUInt32LE(0x171,8);
  buffer.writeUInt32LE(44100*5,0x18);buffer.writeUInt32LE(3579545,0x30);
  buffer.writeUInt32LE(0xcc,0x34);buffer.set(commands,256);
  await page.goto('http://127.0.0.1:'+server.address().port+(packageDir ? '/index.html' : '/vgm_analyzer/index.html'));
  await page.locator('#fileInput').setInputFiles({name:'opm-keys.vgm',mimeType:'application/octet-stream',buffer});
  await page.click('#operatorInfoTab');
  await page.click('#dockPlayTab');await page.click('#playButton');
  const view=page.locator('#chipMonitorPanels .fm-channel-detail:visible');
  async function check(algorithm,op3){
    await page.waitForFunction(([algo,key])=>{
      const view=document.querySelector('#chipMonitorPanels .fm-channel-detail');
      const rows=view?.querySelectorAll('tr');
      return view?.innerText.includes('Algorithm '+algo)&&rows[3].cells[1].textContent===key&&rows[4].cells[1].textContent==='On';
    },[algorithm,op3]);
  }
  await check(7,'Off');await check(7,'On');
  await page.click('#pauseButton');
  const buttons=page.locator('#chipMonitorPanels .fm-channels:visible');
  await buttons.getByText('CH2',{exact:true}).click();
  assert.equal(await view.locator('tr').nth(3).locator('td').nth(1).textContent(),'Off');
  await buttons.getByText('CH1',{exact:true}).click();
  await check(7,'On');
  assert.equal(await view.locator('tr').nth(3).locator('td').nth(5).textContent(),'22');
  assert.ok(await view.getByText('OP1 + OP2 + OP3 + OP4 → OUT', {exact:true}).isVisible());
  await view.getByRole('button', {name:'Audition selected CH in Instrument'}).click();
  const instrument = page.locator('#opmInfoPanel');
  assert.match(await instrument.locator('.opm-detail').innerText(), /CH1 · Captured at/);
  assert.match(await instrument.locator('.opm-voice').innerText(), /CH: 192 0 7 0 0 96 0/);
  assert.ok(await instrument.locator('.tfi-info-keyboard').isVisible());
  await page.evaluate(() => {
    const start = AudioBufferSourceNode.prototype.start;
    window.auditionPeak = 0;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer) {
        for (const sample of this.buffer.getChannelData(0)) window.auditionPeak = Math.max(window.auditionPeak, Math.abs(sample));
      }
      return start.apply(this, args);
    };
  });
  const key = instrument.locator('.key:visible').first();
  await key.hover();
  await page.mouse.down();
  try {await page.waitForFunction(() => window.auditionPeak > 0.0001);}
  finally {await page.mouse.up();}

  await page.click('#operatorInfoTab');
  await view.locator('summary').click();
  assert.ok(await view.locator('canvas').isVisible());
  await page.locator('#playbackSeek').evaluate(input=>{
    input.value=String(44100*2.5);
    for(const type of ['input','change'])input.dispatchEvent(new Event(type,{bubbles:true}));
  });
  await check(4,'Off');
  await page.click('#playButton');await check(4,'On');
  const updates=await view.evaluate(async panel=>{
    const cell=panel.querySelectorAll('tr')[1].cells[5];
    let batches=0;
    const observer=new MutationObserver(()=>batches++);
    observer.observe(cell,{childList:true});
    await new Promise(resolve=>setTimeout(resolve,700));
    observer.disconnect();return batches;
  });
  assert.ok(updates>0&&updates<=8,'TL updates in 700 ms: '+updates);
  await page.click('#playlistTab');
  const hiddenUpdates=await page.locator('#chipMonitorPanels .fm-channel-detail').evaluate(async panel=>{
    let batches=0;const observer=new MutationObserver(()=>batches++);
    observer.observe(panel,{subtree:true,childList:true,attributes:true});
    await new Promise(resolve=>setTimeout(resolve,350));
    observer.disconnect();return batches;
  });
  assert.equal(hiddenUpdates,0);
  console.log('TL repaint batches over 700 ms:',updates,'; hidden monitor batches:',hiddenUpdates);
  for (const fm of [false,true]) {
    await page.locator('#fileInput').setInputFiles({name:fm?'cps1.vgm':'msm6295.vgm',mimeType:'application/octet-stream',buffer:bankedSong(fm)});
    await page.click('#operatorInfoTab');
    await page.getByRole('tab',{name:'MSM6295',exact:true}).click();
    await page.click('#playButton');
    const panel = page.locator('#oki6295Monitor');
    await panel.getByRole('button',{name:'Voice 2 · Sample 0 · Att 2'}).waitFor();
    await page.click('#pauseButton');
    await panel.getByRole('button',{name:/Voice 2/}).click();
    await panel.locator('canvas:visible').waitFor();
    assert.match(await panel.locator('p').innerText(),/0x40400/);
    const audition = panel.locator('audio');
    assert.ok(await audition.evaluate(async a => {await a.play(); return !a.paused;}));
    await panel.getByRole('button',{name:/Voice 1/}).click();
    assert.match(await panel.locator('p').innerText(),/0x400$/);
    assert.ok(await audition.evaluate(a=>a.paused));
  }
  assert.deepEqual(errors,[]);
  console.log('YM2151 captured keyboard audio and MSM6295 banked waveform auditions passed');
} finally {await browser?.close();server.close();}
