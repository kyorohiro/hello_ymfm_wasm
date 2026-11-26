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
  assert.deepEqual(errors,[]);
  console.log('CPS1 FM audio, held-note editing, OKI audio/status, Code Run and Stop passed');
} finally {await browser?.close(); server.close();}
