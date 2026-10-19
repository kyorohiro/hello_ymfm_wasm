// Real PC Engine voice UI, shared primary HuC6280, AudioWorklet and WASM.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium, webkit} = require('playwright');
const docs = path.resolve(__dirname, '../docs');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'};
const root = '#huc6280Panel';
const control = name => `${root} [data-chip-control="pce-${name}"]`;
const action = name => `${root} [data-chip-action="pce-${name}"]`;
const channel = index => `${root} [data-chip-channel="${index}"]`;
const server = http.createServer(async (request,response) => {
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    let filename=path.resolve(docs,'.'+pathname);
    if(!filename.startsWith(docs+path.sep))throw Error('Invalid path');
    if((await fs.stat(filename)).isDirectory())filename=path.join(filename,'index.html');
    let body=await fs.readFile(filename);
    if(pathname.endsWith('/playground.js'))body=Buffer.from(body.toString()+'\nwindow.__huc6280Voice={runtime,megaDrive,chipTabs,operatorKeyboard,setSource:value=>editorAdapter.setValue(value)};');
    response.setHeader('Content-Type',mime[path.extname(filename)]||'application/octet-stream');response.end(body);
  }catch(error){response.writeHead(404).end(error.message);}
});
async function field(page,selector,value) {
  await page.locator(selector).evaluate((node,value)=>{
    if(node.type==='checkbox')node.checked=Boolean(value);else node.value=String(value);
    node.dispatchEvent(new Event(node.type==='range'?'input':'change',{bubbles:true}));
  },value);
}
const read=page=>page.evaluate(()=>window.__huc6280Voice.runtime.chipInspector.read('huc6280'));
// Playwright predicates must be synchronous. Await the asynchronous admin read
// in Node instead of treating a pending Promise as a matched chip state.
async function untilState(page,source,label) {
  const deadline=Date.now()+10000;
  try {
    while(Date.now()<deadline){
      const matched=await page.evaluate(async source=>{
        const state=await window.__huc6280Voice.runtime.chipInspector.read('huc6280');
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
    const shared=window.__huc6280Voice,{megaDrive}=shared,context=megaDrive.audioContext,splitter=context.createChannelSplitter(2),silent=context.createGain();silent.gain.value=0;silent.connect(context.destination);
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
  await page.waitForFunction(()=>window.__huc6280Voice.measure().some(value=>value.rms>.0002),null,{timeout:5000}).catch(error=>{throw new Error(`${label}: inaudible. ${error.message}`);});
  const value=await page.evaluate(()=>window.__huc6280Voice.measure());assert(value.every(channel=>channel.finite&&channel.peak<.99),`${label}: nonfinite or clipped PCM`);return value;
}
async function silent(page,label) {
  await page.waitForTimeout(220);
  await page.waitForFunction(()=>window.__huc6280Voice.measure().every(value=>value.peak<.00003),null,{timeout:5000}).catch(error=>{throw new Error(`${label}: release tail or DC remained. ${error.message}`);});
}
async function startHold(page) {
  const node=page.locator(action('hold'));await node.scrollIntoViewIfNeeded();const rect=await node.boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
}
async function releaseOutside(page){await page.mouse.move(5,5);await page.mouse.up();}
async function keyEvent(page,type,key) {
  key??=await page.locator('#operatorKeyboardRoot .key').first().getAttribute('data-key');
  await page.evaluate(({type,key})=>document.body.dispatchEvent(new KeyboardEvent(type,{key,code:/^[a-z]$/i.test(key)?`Key${key.toUpperCase()}`:`Digit${key}`,bubbles:true,cancelable:true})),{type,key});return key;
}
async function stop(page){await page.click('#stopButton');await page.waitForFunction(()=>window.__huc6280Voice.runtime.getState().playback==='stopped');await untilState(page,'state.channels.every(channel=>!channel.active)','Stop releases all six channels');await silent(page,'Stop');}
const voiceSettings=voice=>({dda:voice.dda,ddaValue:voice.ddaValue,volume:voice.volume,pan:voice.pan,period:voice.period,waveform:voice.waveform,waveformKnown:voice.waveformKnown,noise:voice.noise});
const settings=state=>({clock:state.clock,masterVolume:state.masterVolume,lfo:state.lfo,channels:state.channels.map(voiceSettings)});
const program=`
const sine=Array.from({length:32},(_,index)=>Math.round(15.5+15.5*Math.sin(index*Math.PI/16)));
pce.setWaveform(0,sine);pce.setVolume(0,26);pce.setPan(0,15,15);pce.setMasterVolume(15,15);
pce.setWaveform(1,sine);pce.setPan(1,0,0);pce.setVolume(1,0);
liveLoop('selected-channel',async()=>{pce.setVolume(0,26);pce.noteOn(0,'C4');await sleep(.09);pce.keyOff(0);await sleep(.01);});
liveLoop('other-channel-latch',async()=>{
  pce.setNote(1,'E4');pce.setVolume(1,9);pce.setPan(1,0,0);await sleep(.17);
  pce.setNote(1,'E5');pce.setVolume(1,15);pce.setPan(1,0,0);await sleep(.13);
});
`;
async function check(page,url,browserName,worker) {
  const errors=[],result={browser:browserName,worker};page.on('pageerror',error=>errors.push(error.message));console.log(JSON.stringify({...result,stage:'start'}));
  await page.goto(`${url}?mode=pc-engine&no-sw=1`);await page.waitForFunction(()=>window.__huc6280Voice&&window.monaco?.editor?.getEditors().length);
  assert(await page.locator('#huc6280Tab').isVisible(),'PC Engine exposes its HuC6280 tab');assert(await page.locator('#gameboyTab').isHidden()&&await page.locator('#nesTab').isHidden()&&await page.locator('#ym2151Tab').isHidden(),'mode hides unrelated chips');await page.click('#huc6280Tab');
  assert.equal(await page.evaluate(()=>window.__huc6280Voice.megaDrive.audioContext),null,'opening the panel does not open audio');assert.deepEqual(await page.evaluate(()=>window.__huc6280Voice.runtime.chipInspector.list()),[],'opening the panel does not prepare chips');
  await page.click(`${root} [data-chip-action="prepare"]`);await page.locator(control('frequency')).waitFor();await untilState(page,'state.kind==="huc6280"&&state.channels.length===6&&state.channels.every(channel=>channel.waveform.length===32)','six native 32-sample voices');
  assert.equal((await page.evaluate(()=>window.__huc6280Voice.runtime.chipInspector.list())).filter(entry=>entry.kind==='huc6280').length,1,'one shared primary HuC6280');assert.equal(await page.evaluate(()=>window.__huc6280Voice.runtime.getState().playback),'stopped','Prepare does not run code');await installMeter(page);
  await field(page,control('frequency'),440);await untilState(page,'Math.abs(state.channels[0].frequency-440)<3','frequency partial edit');
  const focused=page.locator(control('frequency'));await focused.focus();await focused.fill('345.678');await page.waitForTimeout(420);assert.equal(await focused.inputValue(),'345.678','polling preserves focused input');await field(page,control('frequency'),440);await page.locator('#huc6280Tab').focus();
  await field(page,control('note'),'C5');await untilState(page,'Math.abs(state.channels[0].frequency-523.251)<4','note-name edit');await field(page,control('period'),0);await untilState(page,'state.channels[0].period===0&&Math.abs(state.channels[0].frequency-state.clock/(32*4096))<.001','raw period zero means 4096');
  await field(page,control('master-left'),15);await field(page,control('master-right'),15);
  result.channelHz=[];
  for(let selected=0;selected<6;selected++) {
    await page.click(channel(selected));await page.click(action('wave-sine'));await field(page,control('volume'),26);await field(page,control('pan-left'),15);await field(page,control('pan-right'),15);if(selected>=4)await field(page,control('noise-enabled'),false);await field(page,control('audition-midi'),69+selected);
    const expected=440*2**(selected/12);await startHold(page);await untilState(page,`state.channels[${selected}].active&&Math.abs(state.channels[${selected}].frequency-${expected})<4`,'channel Hold MIDI pitch');await audible(page,`CH${selected+1} waveform`);await page.waitForTimeout(240);const pcm=await page.evaluate(()=>window.__huc6280Voice.measure());assert(pcm.every(value=>Math.abs(value.hz-expected)<expected*.025),`CH${selected+1} physical waveform pitch`);result.channelHz.push(pcm[0].hz);await releaseOutside(page);await silent(page,`CH${selected+1} release outside`);
  }

  // Level and both layers of stereo balance must affect the native PCM immediately.
  await page.click(channel(0));await field(page,control('audition-midi'),69);await field(page,control('volume'),31);await startHold(page);await audible(page,'full channel volume');await page.waitForTimeout(240);const full=(await page.evaluate(()=>window.__huc6280Voice.measure()))[0].rms;
  await field(page,control('volume'),15);await untilState(page,'state.channels[0].volume===15','volume readback');await page.waitForTimeout(240);const low=(await page.evaluate(()=>window.__huc6280Voice.measure()))[0].rms;assert(low>0&&low<full*.5,'channel attenuation reduces the actual PCM');result.volumeRatio=low/full;await field(page,control('volume'),26);
  await field(page,control('pan-left'),15);await field(page,control('pan-right'),0);await untilState(page,'state.channels[0].pan.left===15&&state.channels[0].pan.right===0','partial pan preserves sibling balance');await page.waitForTimeout(240);const left=await page.evaluate(()=>window.__huc6280Voice.measure());assert(left[0].rms>.0002&&left[1].peak<.00003,'channel left-only native output');
  await field(page,control('pan-left'),0);await field(page,control('pan-right'),15);await page.waitForTimeout(240);const right=await page.evaluate(()=>window.__huc6280Voice.measure());assert(right[1].rms>.0002&&right[0].peak<.00003,'channel right-only native output');
  await field(page,control('pan-left'),15);await field(page,control('master-left'),0);await field(page,control('master-right'),0);await untilState(page,'state.masterVolume.left===0&&state.masterVolume.right===0&&state.channels[0].active','master balance applied without releasing the gate');await silent(page,'global master mute');await field(page,control('master-left'),15);await field(page,control('master-right'),15);await audible(page,'master restore');await releaseOutside(page);await silent(page,'volume test release');

  // A drawn stroke commits one complete five-bit waveform, leaving other voices intact.
  const beforeDraw=await read(page);await page.evaluate(()=>{const shared=window.__huc6280Voice,api=shared.runtime.chipInspector,invoke=api.invoke.bind(api);shared.waveWrites=0;api.invoke=(id,method,args)=>{if(method==='setWaveform')shared.waveWrites++;return invoke(id,method,args);};});
  const canvas=page.locator(control('waveform'));await canvas.scrollIntoViewIfNeeded();const rect=await canvas.boundingBox();await page.mouse.move(rect.x+2,rect.y+rect.height-.5);await page.mouse.down();await page.mouse.move(rect.x+rect.width-3,rect.y+.5,{steps:16});assert.equal(await page.evaluate(()=>window.__huc6280Voice.waveWrites),0,'dragging only edits the local waveform draft');await page.mouse.up();await untilState(page,'state.channels[0].waveformKnown&&state.channels[0].waveform[0]===0&&state.channels[0].waveform[31]===31','32-point five-bit drawing reaches Wave RAM');assert.equal(await page.evaluate(()=>window.__huc6280Voice.waveWrites),1,'one completed drag sends one wave upload');const drawn=await read(page);assert.deepEqual(drawn.channels.slice(1).map(voiceSettings),beforeDraw.channels.slice(1).map(voiceSettings),'drawing does not touch other channels');assert(drawn.channels[0].waveform.every(value=>Number.isInteger(value)&&value>=0&&value<=31));
  await field(page,control('wave-index'),7);await field(page,control('wave-value'),4);await untilState(page,'state.channels[0].waveform[7]===4','single Wave RAM value edit');await page.click(action('wave-sine'));

  // DDA is inspectable without offering a constant-DC audition as a musical note.
  await page.click(channel(3));const ddaWave=(await read(page)).channels[3].waveform;await field(page,control('dda'),true);await field(page,control('dda-value'),22);await untilState(page,'state.channels[3].dda&&state.channels[3].ddaValue===22','DDA configuration readback');await page.waitForFunction(({hold,keyboard})=>document.querySelector(hold)?.disabled&&document.querySelector(keyboard)?.disabled,{hold:action('hold'),keyboard:action('keyboard')});assert(await page.locator(action('play')).isDisabled(),'DDA one-second preview is disabled');assert.deepEqual((await read(page)).channels[3].waveform,ddaWave,'direct DAC edits do not overwrite Wave RAM');await silent(page,'configuring inactive DDA does not emit DC');

  for(const selected of [4,5]) {
    await page.click(channel(selected));await field(page,control('noise-enabled'),true);await field(page,control('noise-frequency'),selected===4?11:23);await untilState(page,`state.channels[${selected}].noise.enabled&&state.channels[${selected}].noise.frequency===${selected===4?11:23}`,'native noise register edit');await page.waitForFunction(selector=>document.querySelector(selector)?.disabled,control('frequency'));const priorPeriod=(await read(page)).channels[selected].period;await startHold(page);result[`noise${selected}`]=await audible(page,`CH${selected+1} native noise`);assert.equal((await read(page)).channels[selected].period,priorPeriod,'noise audition keeps the configured wavetable timer');await releaseOutside(page);await silent(page,'noise release');await field(page,control('noise-enabled'),false);
  }
  await field(page,control('lfo-frequency'),27);await field(page,control('lfo-depth'),2);await field(page,control('lfo-reset'),true);await untilState(page,'state.lfo.frequency===27&&state.lfo.depth===2&&state.lfo.reset','global LFO registers');await field(page,control('lfo-reset'),false);await untilState(page,'state.lfo.frequency===27&&state.lfo.depth===2&&!state.lfo.reset','partial LFO edit preserves the other fields');await field(page,control('lfo-depth'),0);

  await page.click(channel(0));await page.click(action('keyboard'));await page.locator('#keyboardPanel').waitFor({state:'visible'});const keys=await page.locator('#operatorKeyboardRoot .key').evaluateAll(nodes=>nodes.slice(0,2).map(node=>node.dataset.key));assert.equal(keys.length,2);
  await keyEvent(page,'keydown',keys[0]);await audible(page,'Guitar first key');const firstPitch=(await read(page)).channels[0].frequency;await keyEvent(page,'keydown',keys[1]);await audible(page,'Guitar replacement key');await keyEvent(page,'keyup',keys[0]);await page.waitForTimeout(250);const replacement=(await read(page)).channels[0];assert(replacement.active&&Math.abs(replacement.frequency-firstPitch)>5,'an old Guitar release does not stop or retune the replacement');result.keyboard=await page.evaluate(()=>window.__huc6280Voice.measure());await keyEvent(page,'keyup',keys[1]);await silent(page,'Guitar final release');
  await keyEvent(page,'keydown',keys[0]);await audible(page,'Guitar before Code focus');await page.click('#codeTab');await page.locator('#editorHost textarea').first().focus();await keyEvent(page,'keyup',keys[0]);await silent(page,'Code focus releases Guitar');await page.click('#keyboardTab');await keyEvent(page,'keydown',keys[0]);await audible(page,'Guitar before blur');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await silent(page,'window blur releases Guitar');await keyEvent(page,'keyup',keys[0]);
  await page.click('#huc6280Tab');await page.click(action('keyboard'));await keyEvent(page,'keydown',keys[0]);await audible(page,'Guitar before Stop');const beforeStop=settings(await read(page));await stop(page);await keyEvent(page,'keyup',keys[0]);assert.deepEqual(settings(await read(page)),beforeStop,'Stop retains Wave RAM, pitches, volume, DDA, noise and globals');await page.click('#huc6280Tab');await startHold(page);await audible(page,'audition after Stop');await releaseOutside(page);await silent(page,'release after Stop');

  await page.evaluate(()=>{const shared=window.__huc6280Voice,api=shared.runtime.chipInspector,read=api.read.bind(api),invoke=api.invoke.bind(api);Object.assign(shared,{reads:0,writes:0,hidden:false});api.read=(...args)=>{shared.reads++;return read(...args);};api.invoke=(...args)=>{shared.writes++;return invoke(...args);};Object.defineProperty(document,'hidden',{configurable:true,get:()=>shared.hidden});});await page.waitForTimeout(650);assert((await page.evaluate(()=>window.__huc6280Voice.reads))>0,'visible panel reads applied snapshots');assert.equal(await page.evaluate(()=>window.__huc6280Voice.writes),0,'view polling never writes audio');await page.evaluate(()=>{window.__huc6280Voice.hidden=true;document.dispatchEvent(new Event('visibilitychange'));});const hiddenReads=await page.evaluate(()=>window.__huc6280Voice.reads);await page.waitForTimeout(650);assert.equal(await page.evaluate(()=>window.__huc6280Voice.reads),hiddenReads,'hidden document does not poll');await page.evaluate(()=>{window.__huc6280Voice.hidden=false;document.dispatchEvent(new Event('visibilitychange'));});await page.click('#codeTab');await page.waitForTimeout(60);const hiddenTabReads=await page.evaluate(()=>window.__huc6280Voice.reads);await page.waitForTimeout(450);assert.equal(await page.evaluate(()=>window.__huc6280Voice.reads),hiddenTabReads,'hidden voice tab does not poll');

  // The script's cached channel selector must not redirect its CH2 writes to
  // the manually held CH1, including when Worker commands were already queued.
  await page.evaluate(({source,worker})=>{window.__huc6280Voice.setSource(source);document.getElementById('workerExecution').checked=worker;},{source:program,worker});await page.click('#runButton');await page.waitForFunction(()=>window.__huc6280Voice.runtime.getState().playback==='running');await untilState(page,'state.channels[0].active&&Math.abs(state.channels[0].frequency-261.6256)<3','background code starts');await page.click('#huc6280Tab');await page.click(channel(0));await field(page,control('audition-midi'),69);await startHold(page);await field(page,control('volume'),23);await untilState(page,'state.channels[0].active&&Math.abs(state.channels[0].frequency-440)<3&&state.channels[0].volume===23','manual audition owns the selected channel');
  const otherFrequencies=[];for(let index=0;index<5;index++){await page.waitForTimeout(220);const state=await read(page);assert(state.channels[0].active&&Math.abs(state.channels[0].frequency-440)<3&&state.channels[0].volume===23&&state.channels[0].pan.left===15&&state.channels[0].pan.right===15,'queued writes and the global selector do not steal the held voice');assert(state.channels[1].pan.left===0&&state.channels[1].pan.right===0,'other-channel balance stays on CH2');otherFrequencies.push(state.channels[1].frequency);}assert(Math.max(...otherFrequencies)-Math.min(...otherFrequencies)>200,'another channel keeps progressing while CH1 is held');await audible(page,'held audition over background code');await releaseOutside(page);await untilState(page,'state.channels[0].active&&Math.abs(state.channels[0].frequency-261.6256)<3','code resumes on its next note');await stop(page);
  await page.click('#runButton');await page.waitForFunction(()=>window.__huc6280Voice.runtime.getState().playback==='running');await untilState(page,'state.channels[0].active&&Math.abs(state.channels[0].frequency-261.6256)<3','Run works after manual audition and Stop');await stop(page);assert.equal((await page.evaluate(()=>window.__huc6280Voice.runtime.chipInspector.list())).filter(entry=>entry.kind==='huc6280').length,1,'audition creates no additional HuC6280');assert.deepEqual(errors,[],'no browser page errors');
  if(process.argv.includes('--screenshots')){await page.click('#huc6280Tab');result.screenshot=`/private/tmp/huc6280-voice-${browserName}-${worker?'worker':'main'}-success.png`;await page.screenshot({path:result.screenshot});}console.log(JSON.stringify({...result,stage:'passed'}));
}
(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try {
    const url=`http://127.0.0.1:${server.address().port}/playground/index.html`,engines=process.argv.includes('--chromium')?[['chromium',chromium]]:process.argv.includes('--webkit')?[['webkit',webkit]]:[['chromium',chromium],['webkit',webkit]],workers=process.argv.includes('--main')?[false]:process.argv.includes('--worker')?[true]:[false,true];
    for(const [name,type]of engines){const browser=await type.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});try{for(const worker of workers){const page=await browser.newPage({viewport:{width:1380,height:1100},serviceWorkers:'block'});page.setDefaultTimeout(20000);try{await check(page,url,name,worker);}catch(error){console.error(JSON.stringify({browser:name,worker,diagnostic:await page.evaluate(()=>({runtime:document.getElementById('runtimeState')?.textContent,status:document.getElementById('status')?.textContent,console:document.getElementById('consoleOutput')?.textContent,panel:document.getElementById('huc6280Panel')?.textContent,inspector:window.__huc6280Voice?.runtime.chipInspector.list()})).catch(()=>null)}));await page.screenshot({path:`/private/tmp/huc6280-voice-${name}-${worker?'worker':'main'}-failed.png`}).catch(()=>{});throw error;}finally{await page.close();}}}finally{await browser.close();}}
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
