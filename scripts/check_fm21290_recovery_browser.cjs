// SPDX-License-Identifier: BSD-3-Clause
// Reload the real project and exercise the portable fallback when IndexedDB is unavailable.
const path=require('node:path'),fs=require('node:fs'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const server=http.createServer((req,res)=>{
   const root=path.resolve(__dirname,'../docs');
   const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
   if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
   if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
   res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream');
   fs.createReadStream(file).pipe(res);
 });
 await new Promise((ok,fail)=>server.listen(0,'127.0.0.1',ok).on('error',fail));
 let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage();page.setDefaultTimeout(5000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/synth-fm21290/index.html');
  const ready=()=>page.waitForSelector('main:not([inert])');
  const saved=()=>page.waitForFunction(()=>document.querySelector('#draftStatus').textContent==='Saved locally');
  await ready();
  await page.click('#tab-chipPanel');await page.selectOption('#bank','3');
  const algorithm=page.getByRole('button',{name:'Algorithm',exact:true});
  const initialAlgorithm=Number(await algorithm.textContent());
  const route=await page.locator('#ops').textContent();
  await page.getByRole('button',{name:'Decrease Algorithm'}).click();
  assert.equal(Number(await algorithm.textContent()),initialAlgorithm-1);
  assert.notEqual(await page.locator('#ops').textContent(),route);
  await algorithm.press('ArrowRight');assert.equal(await page.locator('#ops').textContent(),route);
  const feedback=page.getByRole('button',{name:'Feedback',exact:true});
  const initialFeedback=Number(await feedback.textContent());
  await feedback.scrollIntoViewIfNeeded();const fb=await feedback.boundingBox();
  await page.mouse.move(fb.x+fb.width/2,fb.y+fb.height/2);await page.mouse.down();
  await page.mouse.move(fb.x+fb.width/2+80,fb.y+fb.height/2,{steps:5});await page.mouse.up();
  assert(Number(await feedback.textContent())>initialFeedback);
  assert.equal(await page.locator('#ops').textContent(),'OP1 + OP2 + OP3 + OP4 + OP5 + OP6');
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    const gap=await page.locator('#ops').evaluate(node=>node.nextElementSibling.getBoundingClientRect().top-node.getBoundingClientRect().bottom);
    assert(gap>=0 && gap<=8);
  }
  await page.setViewportSize({width:1440,height:900});
  const sync=page.getByRole('button',{name:'Oscillator key sync'});
  const initialSync=await sync.getAttribute('aria-pressed');await sync.focus();await page.keyboard.press('Space');
  assert.notEqual(await sync.getAttribute('aria-pressed'),initialSync);
  const value=page.getByRole('button',{name:'OP6 Output',exact:true});
  await page.getByRole('button',{name:'Increase OP6 Output'}).click();
  const before=Number(await value.textContent());
  await page.getByRole('button',{name:'Decrease OP6 Output'}).click();
  assert.equal(Number(await value.textContent()),before-1);
  const box=await value.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();await page.mouse.move(box.x+box.width/2+40,box.y+box.height/2,{steps:8});await page.mouse.up();
  const level=Number(await value.textContent());
  assert(level>before);assert.equal(await page.locator('#ops [data-op="6"]').getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'Envelope',exact:true}).click();
  await page.getByText('Pitch envelope & LFO',{exact:true}).click();
  const pitch=page.getByRole('button',{name:'Pitch envelope R1',exact:true});
  const initialPitch=Number(await pitch.textContent());
  await pitch.press(initialPitch===99?'ArrowLeft':'ArrowRight');
  assert.equal(Number(await pitch.textContent()),initialPitch+(initialPitch===99?-1:1));
  const waveform=page.getByRole('button',{name:'LFO Waveform',exact:true});
  for(let i=0;i<5;i++)await page.getByRole('button',{name:'Increase LFO Waveform'}).click();
  assert.equal(await waveform.textContent(),'Sample & hold');
  const keySync=page.getByRole('button',{name:'LFO key sync'});
  const oldSync=await keySync.getAttribute('aria-pressed');await keySync.click();
  assert.notEqual(await keySync.getAttribute('aria-pressed'),oldSync);
  const widths={};
  for(const width of [1440,940,768,390,320]){
    await page.setViewportSize({width,height:900});
    const octaveSize=await page.locator('#octaveControl .param-control').boundingBox();
    assert(octaveSize.height<=24,'Compact octave height at '+width+'px');
    if(width<=390)assert(octaveSize.width<=70);
    const values=page.locator('#operatorTable table:visible .param-value');
    assert.equal(await values.count(),48);
    widths[width]=[octaveSize.width,(await values.first().boundingBox()).width];
    assert(await values.evaluateAll(nodes=>nodes.every(node=>{
      const rect=node.getBoundingClientRect();
      return rect.width>0 && rect.left>=0 && rect.right<=innerWidth && node.scrollWidth<=node.clientWidth+1;
    })), 'Envelope values must fit at '+width+'px');
    assert(await page.locator('#operatorTable').evaluate(n=>n.scrollWidth<=n.clientWidth+1));
  }
  assert(widths[1440].every((value,i)=>value>widths[390][i]),'Wide panels expand both octave and envelope values');
  await page.getByRole('button',{name:'OP6 L4',exact:true}).press('ArrowLeft');
  await page.setViewportSize({width:1440,height:900});
  const l3=page.getByRole('button',{name:'OP6 L3',exact:true});
  const savedLevel=Number(await l3.textContent());
  await l3.press(savedLevel===99?'ArrowLeft':'ArrowRight');
  assert.equal(Number(await l3.textContent()),savedLevel+(savedLevel===99?-1:1));
  assert.match(await page.innerText('#opEnvelopes output'),new RegExp('OP6 · R3 .*L3 '+await l3.textContent()+'$'));
  await page.getByRole('button',{name:'Oscillator',exact:true}).click();
  assert.equal(await page.locator('#opEnvelopes svg').count(),1);
  const lines=page.locator('#opEnvelopes polyline');
  assert.equal(await lines.count(),6);
  assert.equal(await lines.evaluateAll(nodes=>new Set(nodes.map(node=>getComputedStyle(node).stroke)).size),6);
  await page.getByRole('button',{name:'Select OP5 envelope'}).click();
  assert.equal(await page.getByRole('button',{name:/^OP5 stage/}).count(),4);
  assert.equal(await page.locator('#operatorGroups [aria-pressed=true]').innerText(),'Envelope');
  assert.equal(await page.locator('#operatorTable table:visible .selected-op th').innerText(),'OP5');
  assert.equal(await page.locator('#ops [aria-pressed=true]').first().innerText(),'OP5');
  await page.getByRole('button',{name:'Select OP6 envelope'}).click();
  const handle=page.getByRole('button',{name:/^OP6 stage 3,/});
  const rate=page.getByRole('button',{name:'OP6 R3',exact:true});
  const initialRate=Number(await rate.textContent()),initialLevel=Number(await l3.textContent());
  const other=await page.getByRole('button',{name:'OP5 L3',exact:true}).textContent();
  await handle.scrollIntoViewIfNeeded();
  const point=await handle.boundingBox(),x=point.x+point.width/2,y=point.y+point.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+(initialRate>49?10:-10),y+(initialLevel>49?10:-10),{steps:5});
  await page.mouse.up();
  assert.notEqual(Number(await rate.textContent()),initialRate);
  const editedLevel=Number(await l3.textContent());assert.notEqual(editedLevel,initialLevel);
  assert.equal(await page.getByRole('button',{name:'OP5 L3',exact:true}).textContent(),other);
  await handle.press(editedLevel===99?'ArrowDown':'ArrowUp');
  const finalLevel=editedLevel+(editedLevel===99?-1:1);
  assert.equal(Number(await l3.textContent()),finalLevel);
  await page.getByRole('button',{name:'Oscillator',exact:true}).click();
  await page.fill('#name','LOCAL VOX');await page.locator('#name').press('Tab');
  const track=[0,144,60,95,0,145,67,100,0x83,0,128,60,0,0,129,67,0,0,255,47,0];
  await page.click('#synthMenuButton');
  const [midiChooser]=await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:'MIDI…',exact:true}).click()]);
  assert((await midiChooser.element().getAttribute('accept')).includes('.mid'));
  await midiChooser.setFiles({name:'duet.mid',mimeType:'audio/midi',buffer:Buffer.from(
    [77,84,104,100,0,0,0,6,0,0,0,1,0,96,77,84,114,107,0,0,0,track.length,...track])});
  // Exercise saved MIDI regions from earlier projects with the playback UI hidden.
  await page.waitForFunction(()=>document.querySelector('#part').options.length===2);
  await page.locator('#part').evaluate(select=>{select.selectedIndex=1;select.dispatchEvent(new Event('change'));});
  const part=await page.inputValue('#part');
  await page.evaluate(()=>{
    document.querySelector('#midiFrom').value='0.25';document.querySelector('#midiUntil').value='1.5';
    document.querySelector('#midiLoop').checked=true;
  });
  await page.click('#showNewFile');await page.fill('#newPath','/sets/recovery.js');await page.click('#newFile');
  const code="throw Error('Restored Code must wait for Run')";
  await page.fill('#code',code);await saved();
  await page.reload();await ready();
  assert.equal(await page.innerText('#draftStatus'),'Local project restored');
  await page.click('#tab-chipPanel');assert.equal(Number(await value.textContent()),level);
  assert.match(await handle.getAttribute('aria-label'),new RegExp('level '+finalLevel+'$'));
  assert.equal(await page.inputValue('#bank'),'3');assert.equal(await page.inputValue('#name'),'LOCAL VOX');
  assert.equal(await page.innerText('#activeFile'),'/sets/recovery.js');assert.equal(await page.inputValue('#code'),code);
  assert.equal(await page.inputValue('#part'),part);assert.equal(await page.inputValue('#midiFrom'),'0.25');
  assert.equal(await page.inputValue('#midiUntil'),'1.5');assert.ok(await page.isChecked('#midiLoop'));
  assert.equal(await page.locator('#channels [data-state=idle]').count(),16);assert.equal(await page.innerText('#status'),'');
  assert.equal(await page.locator('button[data-file-path="/songs/duet.mid"]').count(),1);
  await page.fill('#code','// immediate reload');await page.reload();await ready();
  assert.equal(await page.inputValue('#code'),'// immediate reload');
  await page.waitForFunction(()=>['Saved locally','Local project restored'].includes(document.querySelector('#draftStatus').textContent));
  await page.evaluate(()=>sessionStorage.setItem('tetorica-fm21290-pending','{'));
  await page.reload();await ready();
  assert.match(await page.innerText('#draftStatus'),/Restored last IndexedDB save/);
  assert.equal(await page.inputValue('#code'),'// immediate reload');
  // Storage denial keeps the editor and portable export usable.
  await page.addInitScript(()=>Object.defineProperty(window,'indexedDB',{value:null}));
  await page.reload();await ready();
  assert.match(await page.innerText('#draftStatus'),/Local recovery unavailable/);
  await page.click('#codeView');await page.fill('#code','// offline');const download=page.waitForEvent('download');await page.click('#synthMenuButton');await page.click('#saveSession');
  assert.equal((await download).suggestedFilename(),'FM21290.cassette.zip');
  assert.deepEqual(errors,[]);console.log('IndexedDB reload, selected MIDI region, editor, bank and unavailable-store export passed');
 } finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
