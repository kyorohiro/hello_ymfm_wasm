// Real X68000 OKIM6258 panel, shared mono hardware stream, AudioWorklet and WASM.
// Both browsers and execution modes run by default; focused flags aid diagnosis.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium, webkit} = require('playwright');
const docs = path.resolve(__dirname, '../docs');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'};
const root = '#okim6258Panel';
const control = name => `${root} [data-chip-control="oki6258-${name}"]`;
const action = name => `${root} [data-chip-action="oki6258-${name}"]`;
const server = http.createServer(async (request,response) => {
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    let filename=path.resolve(docs,'.'+pathname);
    if(!filename.startsWith(docs+path.sep))throw Error('Invalid path');
    if((await fs.stat(filename)).isDirectory())filename=path.join(filename,'index.html');
    let body=await fs.readFile(filename);
    if(pathname.endsWith('/playground.js'))body=Buffer.from(body.toString()+'\nwindow.__oki6258Voice={runtime,megaDrive,chipTabs,operatorKeyboard,virtualFiles,setSource:value=>editorAdapter.setValue(value)};');
    response.setHeader('Content-Type',mime[path.extname(filename)]||'application/octet-stream');response.end(body);
  }catch(error){response.writeHead(404).end(error.message);}
});
function wavTone({hz=440,seconds=2,sampleRate=16000}={}) {
  const frames=Math.round(seconds*sampleRate),bytes=Buffer.alloc(44+frames*2);
  bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(sampleRate,24);bytes.writeUInt32LE(sampleRate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(frames*2,40);
  for(let index=0;index<frames;index++){const envelope=Math.min(1,index/(sampleRate*.005),(frames-1-index)/(sampleRate*.005));bytes.writeInt16LE(Math.round(Math.sin(2*Math.PI*hz*index/sampleRate)*.3*envelope*32767),44+index*2);}
  return bytes;
}
async function field(page,selector,value) {
  await page.locator(selector).evaluate((node,value)=>{
    if(node.type==='checkbox')node.checked=Boolean(value);else node.value=String(value);
    node.dispatchEvent(new Event(node.type==='range'?'input':'change',{bubbles:true}));
  },value);
}
const read=page=>page.evaluate(()=>window.__oki6258Voice.runtime.chipInspector.read('okim6258'));
async function untilState(page,source,label) {
  const deadline=Date.now()+10000;
  try {
    while(Date.now()<deadline){
      const matched=await page.evaluate(async source=>{
        const state=await window.__oki6258Voice.runtime.chipInspector.read('okim6258');
        return Boolean(new Function('state',`return (${source})`)(state));
      },source);
      if(matched)return;
      await page.waitForTimeout(25);
    }
    throw new Error(`Applied chip state did not match within 10000 ms: ${source}`);
  }catch(error){throw new Error(`${label}: ${error.message}`);}
}
async function installMeter(page) {
  await page.evaluate(()=>{
    const shared=window.__oki6258Voice,{megaDrive}=shared,context=megaDrive.audioContext,splitter=context.createChannelSplitter(2),silent=context.createGain();silent.gain.value=0;silent.connect(context.destination);
    shared.meters=[context.createAnalyser(),context.createAnalyser()];
    shared.meters.forEach((meter,index)=>{meter.fftSize=8192;splitter.connect(meter,index);meter.connect(silent);});megaDrive.audio.connectOutputMonitor(splitter);
    shared.measure=()=>shared.meters.map(meter=>{
      const values=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(values);
      const mean=values.reduce((sum,value)=>sum+value,0)/values.length,crossings=[];
      for(let index=1;index<values.length;index++)if(values[index-1]<mean&&values[index]>=mean)crossings.push(index-1+(mean-values[index-1])/(values[index]-values[index-1]));
      return {rms:Math.sqrt(values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length),peak:Math.max(...values.map(Math.abs)),finite:values.every(Number.isFinite),hz:crossings.length>2?(crossings.length-1)*context.sampleRate/(crossings.at(-1)-crossings[0]):0};
    });
  });
}
async function audible(page,label) {
  await page.waitForFunction(()=>window.__oki6258Voice.measure().some(value=>value.rms>.002),null,{timeout:5000}).catch(error=>{throw new Error(`${label}: inaudible. ${error.message}`);});
  const value=await page.evaluate(()=>window.__oki6258Voice.measure());assert(value.every(channel=>channel.finite&&channel.peak<.99),`${label}: nonfinite or clipped PCM`);return value;
}
async function silent(page,label) {
  await page.waitForTimeout(220);
  await page.waitForFunction(()=>window.__oki6258Voice.measure().every(value=>value.peak<.00003),null,{timeout:5000}).catch(error=>{throw new Error(`${label}: release tail or DC remained. ${error.message}`);});
}
async function startHold(page) {
  const node=page.locator(action('hold'));await node.scrollIntoViewIfNeeded();const rect=await node.boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
}
async function releaseOutside(page){await page.mouse.move(5,5);await page.mouse.up();}
async function keyEvent(page,type,key) {
  key??=await page.locator('#operatorKeyboardRoot .key').first().getAttribute('data-key');
  await page.evaluate(({type,key})=>document.body.dispatchEvent(new KeyboardEvent(type,{key,code:/^[a-z]$/i.test(key)?`Key${key.toUpperCase()}`:`Digit${key}`,bubbles:true,cancelable:true})),{type,key});return key;
}
async function stop(page){await page.click('#stopButton');await page.waitForFunction(()=>window.__oki6258Voice.runtime.getState().playback==='stopped');await untilState(page,'!state.playing','Stop releases the mono voice');await silent(page,'Stop');}
async function run(page,source,worker) {
  await page.evaluate(({source,worker})=>{window.__oki6258Voice.setSource(source);document.getElementById('workerExecution').checked=worker;},{source,worker});await page.click('#runButton');await page.waitForFunction(()=>window.__oki6258Voice.runtime.getState().playback==='running');
}
const sampleSettings=state=>({clock:state.clock,divider:state.divider,pan:state.pan,repeat:state.repeat,sample:state.sample});
const loadCode=`
await adpcm.setClock(8000000);
adpcm.setDivider(768);adpcm.setPan(true,false);
const pcm=Float32Array.from({length:32000},(_,index)=>Math.sin(2*Math.PI*440*index/16000)*.3);
await adpcm.loadSample({channels:[pcm],sampleRate:16000},{sampleRate:8000000/768});
liveLoop('keep-loaded-sample',async()=>{await sleep(1);});
`;
const backgroundCode=`
await adpcm.setClock(8000000);adpcm.setDivider(512);adpcm.setPan(true,true);
const pcm=Float32Array.from({length:32000},(_,index)=>Math.sin(2*Math.PI*220*index/16000)*.3);
await adpcm.loadSample({channels:[pcm],sampleRate:16000});
liveLoop('same-mono-voice',async()=>{adpcm.setDivider(1024);adpcm.setPan(true,false);adpcm.play({repeat:true});await sleep(.09);adpcm.stop();await sleep(.01);});
liveLoop('independent-opm',async()=>{opm.setNote(1,'E4');await sleep(.17);opm.setNote(1,'E5');await sleep(.13);});
`;
async function check(page,url,browserName,worker) {
  const errors=[],result={browser:browserName,worker};page.on('pageerror',error=>errors.push(error.message));console.log(JSON.stringify({...result,stage:'start'}));
  await page.goto(`${url}?mode=x68000&no-sw=1`);await page.waitForFunction(()=>window.__oki6258Voice&&window.monaco?.editor?.getEditors().length);
  assert(await page.locator('#okim6258Tab').isVisible()&&await page.locator('#ym2151Tab').isVisible(),'X68000 exposes both primary sound devices');
  assert(await page.locator('#gameboyTab').isHidden()&&await page.locator('#nesTab').isHidden(),'unrelated modes stay hidden');await page.click('#okim6258Tab');
  assert.equal(await page.evaluate(()=>window.__oki6258Voice.megaDrive.audioContext),null,'opening the panel does not open audio');assert.deepEqual(await page.evaluate(()=>window.__oki6258Voice.runtime.chipInspector.list()),[],'opening the panel does not prepare chips');
  await page.click(`${root} [data-chip-action="prepare"]`);await page.locator(control('divider')).waitFor();await untilState(page,'state.kind==="okim6258"&&state.channels.length===1','primary mono device becomes inspectable');
  assert.equal((await page.evaluate(()=>window.__oki6258Voice.runtime.chipInspector.list())).filter(entry=>entry.kind==='okim6258').length,1,'one primary OKIM6258');assert.equal(await page.evaluate(()=>window.__oki6258Voice.runtime.getState().playback),'stopped','Prepare does not run source code');assert.equal((await read(page)).sample,null,'opening and preparing do not manufacture sample memory');
  assert(await page.locator(action('hold')).isDisabled()&&await page.locator(action('keyboard')).isDisabled(),'sample audition is disabled until memory exists');await installMeter(page);

  // Code-side uploads, applied clock and pan must be visible through the shared device.
  await run(page,loadCode,worker);await untilState(page,'state.sample?.bytes>10000&&state.divider===768&&state.pan.left&&!state.pan.right','code sample and hardware settings readback');await page.click('#okim6258Tab');
  const codeState=await read(page);assert.equal(codeState.clock,8000000);assert.equal(codeState.playbackRate,8000000/768);assert(codeState.sample.waveform.length>8&&codeState.sample.waveform.length<=512&&codeState.sample.waveform.some(value=>Math.abs(value)>.01),'applied code ADPCM has a bounded decoded waveform');assert.equal(codeState.sample.frames,codeState.sample.bytes*2);assert(Math.abs(codeState.sample.durationSeconds-2)<.002,'complete code sample metadata');
  await page.waitForFunction(selector=>document.querySelector(selector)?.value==='768',control('divider'));assert(await page.locator(control('pan-left')).isChecked()&&!await page.locator(control('pan-right')).isChecked(),'UI shows applied pan');
  assert.equal(await page.locator(`${root} [data-chip-control*="volume"],${root} [data-chip-control*="midi"],${root} [data-chip-control*="frequency"]`).count(),0,'no invented hardware volume or chromatic pitch control');
  await field(page,control('repeat'),true);await startHold(page);await audible(page,'code sample Hold');await page.waitForTimeout(240);const initial=await page.evaluate(()=>window.__oki6258Voice.measure());assert(initial[0].rms>.002&&initial[1].peak<.00003,'native left-only pan');assert(Math.abs(initial[0].hz-440)<12,'uploaded PCM is decoded at the expected pitch');
  result.dividerHz=[];
  for(const divider of [512,1024,768]) {
    await field(page,control('divider'),divider);await untilState(page,`state.divider===${divider}`,'divider edit readback');await page.waitForTimeout(240);const measured=(await page.evaluate(()=>window.__oki6258Voice.measure()))[0],expected=440*(768/divider);assert(Math.abs(measured.hz-expected)<expected*.04,`divider ${divider} actual PCM pitch ${measured.hz}`);result.dividerHz.push(measured.hz);
  }
  await field(page,control('pan-left'),false);await field(page,control('pan-right'),true);await page.waitForTimeout(240);const right=await page.evaluate(()=>window.__oki6258Voice.measure());assert(right[1].rms>.002&&right[0].peak<.00003,'native right-only pan');await releaseOutside(page);await silent(page,'release outside Hold');await untilState(page,'!state.playing','Hold releases applied gate');await stop(page);

  // Load a Cassette audio asset safely. A rejected decode must keep the old sample intact.
  const fixturePath='/samples/browser-oki-tone.wav',invalidPath='/samples/browser-oki-invalid.wav';
  await page.evaluate(({path,invalid,bytes})=>{const shared=window.__oki6258Voice;shared.virtualFiles.writeBinary(path,new Uint8Array(bytes));shared.virtualFiles.writeBinary(invalid,new Uint8Array([1,2,3,4]));shared.chipTabs.refresh();},{path:fixturePath,invalid:invalidPath,bytes:Array.from(wavTone())});
  await page.click('#okim6258Tab');await field(page,control('divider'),512);await field(page,control('pan-left'),true);await field(page,control('pan-right'),true);
  await untilState(page,'state.divider===512&&state.pan.left&&state.pan.right','file-load playback settings are applied');
  await page.waitForFunction(({selector,path})=>[...document.querySelector(selector).options].some(option=>option.value===path),{selector:control('file'),path:fixturePath});await page.selectOption(control('file'),fixturePath);await page.click(action('load'));await untilState(page,`state.sample?.name===${JSON.stringify(fixturePath)}&&state.sample.source==='sample'`,'selected Cassette WAV loads');
  const loaded=await read(page);console.log(JSON.stringify({...result,stage:'file-loaded',clock:loaded.clock,divider:loaded.divider,playbackRate:loaded.playbackRate,sample:{...loaded.sample,waveform:undefined}}));assert.equal(loaded.sample.bytes,15625);assert.equal(loaded.sample.frames,31250);assert.equal(loaded.sample.sampleRate,15625);assert.equal(loaded.sample.durationSeconds,2);assert.equal(loaded.playing,false,'loading a file does not auto-play it');
  await page.selectOption(control('file'),invalidPath);await page.click(action('load'));await page.waitForFunction(({root,button})=>[...document.querySelector(root).querySelectorAll('[data-error="true"]')].some(node=>node.textContent.trim())&&!document.querySelector(button).disabled,{root,button:action('load')});assert.deepEqual((await read(page)).sample,loaded.sample,'invalid file does not replace the loaded sound');
  await field(page,control('repeat'),false);await startHold(page);await audible(page,'one-shot file Hold');await untilState(page,'!state.playing&&state.positionFrames>=state.sample.frames','one-shot stops at the encoded end');await silent(page,'one-shot end contains no DC or release tail');await releaseOutside(page);assert.deepEqual((await read(page)).sample,loaded.sample,'finishing playback keeps sample metadata');
  await page.click(action('play'));await audible(page,'bounded one-second preview');await untilState(page,'!state.playing','bounded preview releases');await silent(page,'bounded preview release');

  // Guitar keys are monophonic retriggers; different MIDI keys do not invent a pitch register.
  await field(page,control('repeat'),true);await page.click(action('keyboard'));await page.locator('#keyboardPanel').waitFor({state:'visible'});
  const keys=await page.locator('#operatorKeyboardRoot .key').evaluateAll(nodes=>nodes.slice(0,2).map(node=>node.dataset.key));assert.equal(keys.length,2);
  await keyEvent(page,'keydown',keys[0]);await audible(page,'Guitar first pad');await keyEvent(page,'keydown',keys[1]);await audible(page,'Guitar replacement pad');await keyEvent(page,'keyup',keys[0]);await page.waitForTimeout(250);const replacement=await read(page);assert(replacement.playing,'stale release cannot stop a newer pad');assert.equal(replacement.divider,512);assert.equal(replacement.clock,8000000);assert.deepEqual(replacement.sample,loaded.sample);const guitar=await page.evaluate(()=>window.__oki6258Voice.measure());assert(guitar.every(value=>Math.abs(value.hz-440)<15),'all Guitar pitches retrigger the same hardware rate');result.keyboard=guitar;await keyEvent(page,'keyup',keys[1]);await silent(page,'Guitar last release');
  await keyEvent(page,'keydown',keys[0]);await audible(page,'Guitar before Code focus');await page.click('#codeTab');await page.locator('#editorHost textarea').first().focus();await keyEvent(page,'keyup',keys[0]);await silent(page,'Code focus releases Guitar');
  await page.click('#keyboardTab');await keyEvent(page,'keydown',keys[0]);await audible(page,'Guitar before blur');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await silent(page,'window blur releases Guitar');await keyEvent(page,'keyup',keys[0]);
  await page.click('#okim6258Tab');await page.click(action('keyboard'));await keyEvent(page,'keydown',keys[0]);await audible(page,'Guitar before Stop');const beforeStop=sampleSettings(await read(page));await stop(page);await keyEvent(page,'keyup',keys[0]);assert.deepEqual(sampleSettings(await read(page)),beforeStop,'Stop retains sample, waveform, rate, pan and repeat');await page.click('#okim6258Tab');await startHold(page);await audible(page,'sample audition after Stop');await releaseOutside(page);await silent(page,'release after Stop');

  // Polls are read-only and stop when either the tab or document is hidden.
  await page.evaluate(()=>{const shared=window.__oki6258Voice,api=shared.runtime.chipInspector,read=api.read.bind(api),invoke=api.invoke.bind(api);Object.assign(shared,{reads:0,writes:0,hidden:false});api.read=(...args)=>{shared.reads++;return read(...args);};api.invoke=(...args)=>{shared.writes++;return invoke(...args);};Object.defineProperty(document,'hidden',{configurable:true,get:()=>shared.hidden});});
  await page.waitForTimeout(650);assert((await page.evaluate(()=>window.__oki6258Voice.reads))>0,'visible panel reads snapshots');assert.equal(await page.evaluate(()=>window.__oki6258Voice.writes),0,'snapshot updates never write audio commands');
  await page.evaluate(()=>{window.__oki6258Voice.hidden=true;document.dispatchEvent(new Event('visibilitychange'));});const hiddenReads=await page.evaluate(()=>window.__oki6258Voice.reads);await page.waitForTimeout(650);assert.equal(await page.evaluate(()=>window.__oki6258Voice.reads),hiddenReads,'hidden document does not poll');await page.evaluate(()=>{window.__oki6258Voice.hidden=false;document.dispatchEvent(new Event('visibilitychange'));});await page.click('#codeTab');await page.waitForTimeout(60);const hiddenTabReads=await page.evaluate(()=>window.__oki6258Voice.reads);await page.waitForTimeout(450);assert.equal(await page.evaluate(()=>window.__oki6258Voice.reads),hiddenTabReads,'hidden sound panel does not poll');

  // Background Main/Worker code cannot steal a manually held mono stream.
  await run(page,backgroundCode,worker);await untilState(page,'state.playing&&state.divider===1024','background sample starts');await page.click('#okim6258Tab');await field(page,control('repeat'),true);await startHold(page);await field(page,control('divider'),512);await field(page,control('pan-left'),false);await field(page,control('pan-right'),true);await untilState(page,'state.playing&&state.divider===512&&!state.pan.left&&state.pan.right','audition edits own the mono stream');
  const otherFrequencies=[];
  for(let index=0;index<5;index++){await page.waitForTimeout(220);const state=await read(page);assert(state.playing&&state.divider===512&&!state.pan.left&&state.pan.right,'queued code does not steal the held stream or settings');otherFrequencies.push(await page.evaluate(async()=>(await window.__oki6258Voice.runtime.chipInspector.read('ym2151')).channels[1].frequency));}
  assert(Math.max(...otherFrequencies)-Math.min(...otherFrequencies)>200,'the independent OPM channel keeps progressing');await audible(page,'held sample over background code');await releaseOutside(page);await untilState(page,'state.playing&&state.divider===1024&&state.pan.left&&!state.pan.right','code resumes on its next play');await stop(page);
  await page.click('#runButton');await page.waitForFunction(()=>window.__oki6258Voice.runtime.getState().playback==='running');await untilState(page,'state.playing&&state.divider===1024','Run works after audition and Stop');await stop(page);
  assert.equal((await page.evaluate(()=>window.__oki6258Voice.runtime.chipInspector.list())).filter(entry=>entry.kind==='okim6258').length,1,'audition created no extra OKIM6258');assert.deepEqual(errors,[],'no browser page errors');
  if(process.argv.includes('--screenshots')){await page.click('#okim6258Tab');result.screenshot=`/private/tmp/okim6258-voice-${browserName}-${worker?'worker':'main'}-success.png`;await page.screenshot({path:result.screenshot});}
  console.log(JSON.stringify({...result,stage:'passed'}));
}
(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try {
    const url=`http://127.0.0.1:${server.address().port}/playground/index.html`,engines=process.argv.includes('--chromium')?[['chromium',chromium]]:process.argv.includes('--webkit')?[['webkit',webkit]]:[['chromium',chromium],['webkit',webkit]],workers=process.argv.includes('--main')?[false]:process.argv.includes('--worker')?[true]:[false,true];
    for(const [name,type]of engines){const browser=await type.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});try{for(const worker of workers){const page=await browser.newPage({viewport:{width:1380,height:1100},serviceWorkers:'block'});page.setDefaultTimeout(20000);try{await check(page,url,name,worker);}catch(error){console.error(JSON.stringify({browser:name,worker,diagnostic:await page.evaluate(()=>({runtime:document.getElementById('runtimeState')?.textContent,status:document.getElementById('status')?.textContent,console:document.getElementById('consoleOutput')?.textContent,panel:document.getElementById('okim6258Panel')?.textContent,inspector:window.__oki6258Voice?.runtime.chipInspector.list()})).catch(()=>null)}));await page.screenshot({path:`/private/tmp/okim6258-voice-${name}-${worker?'worker':'main'}-failed.png`}).catch(()=>{});throw error;}finally{await page.close();}}}finally{await browser.close();}}
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
