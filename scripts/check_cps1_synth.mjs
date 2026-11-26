// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const root = new URL('../docs/',import.meta.url);
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
  await page.addInitScript(() => {
    const original = AnalyserNode.prototype.getFloatTimeDomainData;
    AnalyserNode.prototype.getFloatTimeDomainData = function(data) {
      original.call(this,data);
      window.peak = Math.max(window.peak ?? 0,...data.map(Math.abs));
    };
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/synth-cps1/index.html');
  await page.click('#power');
  await page.waitForFunction(() => document.querySelector('#power').disabled);
  await page.keyboard.down('a');
  await page.waitForFunction(() => window.peak>.001);
  await page.locator('[data-chip-control="ym2151-feedback"]').fill('6');
  await page.locator('[data-chip-control="ym2151-feedback"]').press('Tab');
  await page.waitForFunction(() => document.querySelector('[data-chip-control="ym2151-code"]').value.includes('opm.setAlgo(0, 4, 6)'));
  const level = page.getByRole('button',{name:'OP1 · M1 TL',exact:true});
  const before = Number(await level.textContent());
  await level.scrollIntoViewIfNeeded();
  const box = await level.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+20,box.y+box.height/2,{steps:4});
  await page.mouse.up();
  assert.ok(Number(await level.textContent()) > before);
  await page.keyboard.up('a');
  await page.click('[data-tab="pcm"]');
  await page.waitForTimeout(600);
  await page.evaluate(() => {window.peak=0;});
  const mute = page.getByRole('button',{name:'Mute Voice 1',exact:true});
  await mute.click();
  await page.locator('#voices button').first().click();
  await page.waitForFunction(() => document.querySelector('#busy').value==='0xF1');
  await page.waitForFunction(() => document.querySelector('#busy').value==='0xF0');
  assert.equal(await page.evaluate(() => window.peak),0);
  await mute.click();
  assert.match(await page.locator('#sampleRange').textContent(),/0x00400/);
  await page.selectOption('#sample','1');
  assert.match(await page.locator('#sampleRange').textContent(),/0x00800/);
  assert.ok(await page.locator('#sampleWave').isVisible());
  await page.locator('#voices button').first().click();
  await page.waitForFunction(() => document.querySelector('#busy').value==='0xF1');
  await page.waitForFunction(() => window.peak>.001);
  await page.waitForFunction(() => document.querySelector('#busy').value==='0xF0');
  await page.click('[data-tab="code"]');
  await page.click('#run');
  await page.waitForFunction(() => document.querySelector('#status').textContent==='Finished');
  await page.fill('#editor','while (true) {}');
  await page.click('#run'); await page.click('#stop');
  assert.equal(await page.locator('#status').textContent(),'Stopped');
  await page.click('[data-tab="pcm"]');
  await page.locator('#rom').setInputFiles({name:'test.rom',mimeType:'application/octet-stream',buffer:Buffer.alloc(2048)});
  await page.getByText('test.rom',{exact:true}).first().waitFor();
  await page.click('[data-tab="files"]');
  await page.click('#loadBank');
  assert.ok(await page.locator('#pcm').isVisible());
  assert.match(await page.locator('#sampleRange').textContent(),/Empty/);
  assert.ok(await page.locator('#sampleWave').isHidden());
  await page.click('[data-tab="files"]');
  await page.click('#saveVoice');
  const opmText = ['@:0 Browser brass','LFO: 93 34 67 2 17','CH: 192 5 6 1 3 40 128',
    ...['M1','C1','M2','C2'].map((name,i)=>name+': 31 2 3 4 5 '+(28+i)+' 0 1 0 0 0')].join('\n');
  await page.locator('#importOpm').setInputFiles({name:'voice.opm',mimeType:'text/plain',buffer:Buffer.from(opmText)});
  await page.waitForFunction(()=>document.querySelector('#fmFiles option:checked').textContent==='Browser brass');
  await page.click('[data-tab="fm"]');
  assert.equal(await page.locator('[data-chip-control="ym2151-feedback"]').inputValue(),'5');
  await page.keyboard.down('a');
  await page.waitForFunction(()=>document.querySelector('[data-chip-output="ym2151-gate"]').textContent.includes('0101'));
  await page.keyboard.up('a');
  await page.click('[data-tab="files"]');
  await page.click('#opmGlobals');
  const download = page.waitForEvent('download');
  await page.click('#exportCassette');
  const archive = await (await download).path();
  await page.click('[data-tab="pcm"]');
  await page.click('#restore');
  await page.click('[data-tab="code"]');
  await page.fill('#editor','// changed');
  await page.click('[data-tab="files"]');
  page.once('dialog',dialog => dialog.accept());
  await page.locator('#importCassette').setInputFiles({name:'test.cassette.zip',mimeType:'application/zip',buffer:await readFile(archive)});
  await page.getByText('Imported test.cassette.zip',{exact:true}).waitFor();
  assert.equal(await page.locator('#romFiles option:checked').textContent(),'test.rom');
  assert.equal(await page.locator('#fmFiles option').count(),10);
  await page.click('#openCode');
  assert.equal(await page.inputValue('#editor'),'while (true) {}');
  await page.click('[data-tab="fm"]');
  for (const width of [390,1100]) {
    await page.setViewportSize({width,height:850});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  }
  assert.deepEqual(errors,[]);
  console.log('CPS1 FM audio, held-note editing, OKI audio/status, Code, cassette round-trip and responsive layouts passed');
} finally {await browser?.close(); server.close();}
