// Real X68000 UI, shared primary YM2151, AudioWorklet and WASM.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium, webkit} = require('playwright');
const docs = path.resolve(__dirname, '../docs');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'};
const root = '#ym2151Panel';
const control = name => `${root} [data-chip-control="ym2151-${name}"]`;
const action = name => `${root} [data-chip-action="ym2151-${name}"]`;
const channel = index => `${root} [data-chip-channel="${index}"]`;
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let filename = path.resolve(docs, '.' + pathname);
    if (!filename.startsWith(docs + path.sep)) throw Error('Invalid path');
    if ((await fs.stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
    let body = await fs.readFile(filename);
    if (pathname.endsWith('/playground.js')) body = Buffer.from(body.toString() + '\nwindow.__ym2151Voice={runtime,megaDrive,chipTabs,operatorKeyboard,setSource:value=>editorAdapter.setValue(value)};');
    response.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream'); response.end(body);
  } catch (error) {response.writeHead(404).end(error.message);}
});
async function field(page, selector, value) {
  await page.locator(selector).evaluate((node, value) => {
    if (node.type === 'checkbox') node.checked = Boolean(value); else node.value = String(value);
    node.dispatchEvent(new Event(node.type === 'range' ? 'input' : 'change', {bubbles:true}));
  }, value);
}
const read = page => page.evaluate(() => window.__ym2151Voice.runtime.chipInspector.read('ym2151'));
const invoke = (page, method, args=[]) => page.evaluate(({method,args}) => window.__ym2151Voice.runtime.chipInspector.invoke('ym2151',method,args), {method,args});
async function untilState(page, source, label) {
  const deadline = Date.now() + 10000;
  try {
    while (Date.now() < deadline) {
      const matched = await page.evaluate(async source => {
        const state = await window.__ym2151Voice.runtime.chipInspector.read('ym2151');
        return Boolean(new Function('state', `return (${source})`)(state));
      }, source);
      if (matched) return;
      await page.waitForTimeout(25);
    }
    throw new Error(`Applied chip state did not match within 10000 ms: ${source}`);
  } catch (error) {throw new Error(`${label}: ${error.message}`);}
}
async function installMeter(page) {
  await page.evaluate(() => {
    const shared = window.__ym2151Voice, {megaDrive} = shared, context = megaDrive.audioContext;
    const splitter = context.createChannelSplitter(2), silent = context.createGain(); silent.gain.value = 0; silent.connect(context.destination);
    shared.meters = [context.createAnalyser(), context.createAnalyser()];
    shared.meters.forEach((meter,index) => {meter.fftSize = 8192; splitter.connect(meter,index); meter.connect(silent);});
    megaDrive.audio.connectOutputMonitor(splitter);
    shared.measure = (includeSpectrum=false) => shared.meters.map(meter => {
      const values = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(values);
      const mean = values.reduce((sum,value) => sum+value,0)/values.length, crossings=[];
      for(let i=1;i<values.length;i++) if(values[i-1]<mean && values[i]>=mean) crossings.push(i-1+(mean-values[i-1])/(values[i]-values[i-1]));
      const hz=crossings.length>2?(crossings.length-1)*context.sampleRate/(crossings.at(-1)-crossings[0]):0;
      const harmonic = includeSpectrum ? Array.from({length:12},(_,index)=>{
        const frequency=(index+1)*440, omega=2*Math.PI*frequency/context.sampleRate; let real=0,imaginary=0;
        for(let i=0;i<values.length;i++){const sample=(values[i]-mean)*(.5-.5*Math.cos(2*Math.PI*i/(values.length-1)));real+=sample*Math.cos(omega*i);imaginary-=sample*Math.sin(omega*i);}
        return (real*real+imaginary*imaginary)/(values.length*values.length);
      }) : [];
      return {rms:Math.sqrt(values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length),peak:Math.max(...values.map(Math.abs)),finite:values.every(Number.isFinite),hz,harmonic};
    });
  });
}
async function audible(page,label) {
  await page.waitForFunction(()=>window.__ym2151Voice.measure().some(value=>value.rms>.0002),null,{timeout:5000}).catch(error=>{throw new Error(`${label}: inaudible. ${error.message}`);});
  const values=await page.evaluate(()=>window.__ym2151Voice.measure()); assert(values.every(value=>value.finite&&value.peak<1),`${label}: nonfinite or clipped PCM`);return values;
}
async function silent(page,label) {
  await page.waitForTimeout(220);
  await page.waitForFunction(()=>window.__ym2151Voice.measure().every(value=>value.rms<.00003),null,{timeout:5000}).catch(error=>{throw new Error(`${label}: audio stayed active. ${error.message}`);});
}
async function startHold(page) {
  const node=page.locator(action('hold'));await node.scrollIntoViewIfNeeded();const rect=await node.boundingBox();
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
}
async function releaseOutside(page){await page.mouse.move(5,5);await page.mouse.up();}
async function keyEvent(page,type,key) {
  key??=await page.locator('#operatorKeyboardRoot .key').first().getAttribute('data-key');
  await page.evaluate(({type,key})=>document.body.dispatchEvent(new KeyboardEvent(type,{key,code:`Key${key.toUpperCase()}`,bubbles:true,cancelable:true})),{type,key});return key;
}
async function stop(page){await page.click('#stopButton');await page.waitForFunction(()=>window.__ym2151Voice.runtime.getState().playback==='stopped');await silent(page,'Stop');}
const voiceSettings = voice => ({keyCode:voice.keyCode,keyFraction:voice.keyFraction,algorithm:voice.algorithm,feedback:voice.feedback,pan:voice.pan,ams:voice.ams,pms:voice.pms,operators:voice.operators});
const program = `
opm.reset();
for(const channel of [0,1]) {
  opm.setAlgo(channel,7);opm.setPan(channel,true,true);
  for(let operator=0;operator<4;operator++) opm.setOperator(channel,operator,{mul:1,tl:127,ar:31,d1r:0,d2r:0,d1l:0,rr:15});
}
opm.setOperator(0,3,{tl:32});
liveLoop('same-channel',async()=>{opm.setNote(0,'C4');opm.keyOn(0,8);await sleep(.09);opm.keyOff(0);await sleep(.01);});
liveLoop('other-channel',async()=>{opm.setNote(1,'E4');opm.keyOn(1,8);await sleep(.17);opm.setNote(1,'E5');opm.keyOn(1,8);await sleep(.13);});
`;
async function check(page,url,browserName,worker) {
  const errors=[],results={browser:browserName,worker};page.on('pageerror',error=>errors.push(error.message));
  console.log(JSON.stringify({...results,stage:'start'}));
  await page.goto(`${url}?mode=x68000&no-sw=1`);await page.waitForFunction(()=>window.__ym2151Voice&&window.monaco?.editor?.getEditors().length);
  assert(await page.locator('#ym2151Tab').isVisible(),'X68000 exposes its YM2151 tab');
  assert(await page.locator('#gameboyTab').isHidden()&&await page.locator('#nesTab').isHidden(),'mode filters unrelated chip tabs');
  await page.click('#ym2151Tab');
  assert.equal(await page.evaluate(()=>window.__ym2151Voice.megaDrive.audioContext),null,'opening the tab did not open audio');
  assert.deepEqual(await page.evaluate(()=>window.__ym2151Voice.runtime.chipInspector.list()),[],'opening the tab did not prepare chips');
  await page.click(`${root} [data-chip-action="prepare"]`);await page.locator(control('frequency')).waitFor();
  await untilState(page,'state.channels.length===8&&state.channels.every(channel=>channel.operators.length===4)','8 channels and 4 operators');
  const chipList=await page.evaluate(()=>window.__ym2151Voice.runtime.chipInspector.list());
  assert.equal(chipList.filter(entry=>entry.kind==='ym2151').length,1,'one shared primary YM2151');
  assert.equal(await page.evaluate(()=>window.__ym2151Voice.runtime.getState().playback),'stopped','Prepare did not run the program');
  await page.click(action('basic'));await untilState(page,'state.channels[0].algorithm===7&&state.channels[0].operators[3].tl===32','explicit basic voice loads');
  await installMeter(page);
  await field(page,control('frequency'),440);await untilState(page,'Math.abs(state.channels[0].frequency-440)<3','frequency partial edit');
  const focused=page.locator(control('frequency'));await focused.focus();await focused.fill('345.678');await page.waitForTimeout(420);assert.equal(await focused.inputValue(),'345.678','polling preserves a focused edit');await field(page,control('frequency'),440);await page.locator('#ym2151Tab').focus();
  await field(page,control('algorithm'),7);await field(page,control('feedback'),0);await field(page,control('pan-left'),true);await field(page,control('pan-right'),true);await field(page,control('audition-midi'),69);
  // Preserve sibling bitfields, operators and channels through a partial edit.
  await field(page,control('op-0-dt1'),5);await field(page,control('op-0-mul'),3);
  await untilState(page,'state.channels[0].operators[0].dt1===5&&state.channels[0].operators[0].mul===3','packed operator fields preserve siblings');
  const beforePartial=await read(page);await field(page,control('op-0-tl'),44);await untilState(page,'state.channels[0].operators[0].tl===44','operator level readback');
  const partial=await read(page);assert.deepEqual(partial.channels[1],beforePartial.channels[1],'partial edit leaves another channel unchanged');assert.deepEqual(partial.channels[0].operators[1],beforePartial.channels[0].operators[1],'partial edit leaves another operator unchanged');
  await field(page,control('ams'),2);await field(page,control('pms'),5);
  await field(page,control('lfo-frequency'),22);await field(page,control('lfo-am-depth'),50);await field(page,control('lfo-pm-depth'),60);await field(page,control('lfo-waveform'),2);
  await field(page,control('noise-enabled'),true);await field(page,control('noise-frequency'),19);
  await untilState(page,'state.channels[0].ams===2&&state.channels[0].pms===5&&state.lfo.frequency===22&&state.lfo.amDepth===50&&state.lfo.pmDepth===60&&state.lfo.waveform===2&&state.noise.enabled&&state.noise.frequency===19','global controls and independent depth latches');
  await field(page,control('ams'),0);await field(page,control('pms'),0);await field(page,control('noise-enabled'),false);
  // Every logical operator maps to the correct hardware slot and sounds at its edited ratio.
  results.operatorHz=[];
  for(let op=0;op<4;op++) {
    for(let index=0;index<4;index++) {
      for(const [name,value] of Object.entries({dt1:0,dt2:0,mul:op===index?op+1:1,tl:op===index?32:127,ks:0,ar:31,d1r:0,d2r:0,d1l:0,rr:op===3?0:15,am:false})) await field(page,control(`op-${index}-${name}`),value);
    }
    await untilState(page,`state.channels[0].operators[${op}].mul===${op+1}&&state.channels[0].operators[${op}].tl===32`,'logical operator edit');
    const state=await read(page),offset=[0,16,8,24][op];assert.equal(state.registers[0x40+offset]&15,op+1,`logical OP${op} hardware slot`);
    await startHold(page);await audible(page,`logical OP${op} Hold`);await page.waitForTimeout(240);const measurement=await page.evaluate(()=>window.__ym2151Voice.measure());
    assert(Math.abs(measurement[0].hz-440*(op+1))<440*(op+1)*.025,`logical OP${op} physical pitch ${measurement[0].hz}`);results.operatorHz.push(measurement[0].hz);
    await releaseOutside(page);await silent(page,`logical OP${op} release outside`);
  }
  // Native stereo routing and FM algorithms alter the actual chip PCM.
  for(let op=0;op<4;op++){await field(page,control(`op-${op}-mul`),op===3?1:2);await field(page,control(`op-${op}-tl`),op===3?32:45);}
  await field(page,control('pan-left'),true);await field(page,control('pan-right'),false);await startHold(page);await audible(page,'left pan');await page.waitForTimeout(240);
  const left=await page.evaluate(()=>window.__ym2151Voice.measure());assert(left[0].rms>.0002&&left[1].rms<.00003,'left pan routes native output');
  await field(page,control('pan-left'),false);await field(page,control('pan-right'),true);await page.waitForTimeout(240);const right=await page.evaluate(()=>window.__ym2151Voice.measure());assert(right[1].rms>.0002&&right[0].rms<.00003,'right pan routes native output');
  await field(page,control('pan-left'),true);await field(page,control('algorithm'),0);await page.waitForTimeout(240);const serial=(await page.evaluate(()=>window.__ym2151Voice.measure(true)))[0];
  await field(page,control('algorithm'),7);await page.waitForTimeout(240);const parallel=(await page.evaluate(()=>window.__ym2151Voice.measure(true)))[0];
  const normalized=value=>{const total=value.harmonic.reduce((sum,value)=>sum+value,0);return value.harmonic.map(value=>value/(total||1));};
  const spectrumDifference=normalized(serial).reduce((sum,value,index)=>sum+Math.abs(value-normalized(parallel)[index]),0);
  assert(spectrumDifference>.05||Math.abs(serial.rms-parallel.rms)>.003,'algorithm changes the actual FM PCM');results.algorithmDifference=spectrumDifference;
  await releaseOutside(page);await silent(page,'algorithm release');
  // All eight channels are inspectable, with per-channel patch and raw pitch edits.
  await page.click(channel(7));await field(page,control('frequency'),330);await field(page,control('feedback'),6);await untilState(page,'Math.abs(state.channels[7].frequency-330)<3&&state.channels[7].feedback===6','CH8 edit');
  await field(page,control('key-fraction'),17);await untilState(page,'state.channels[7].keyFraction===17','raw key-fraction edit');await page.click(channel(0));
  // Observing snapshots must never schedule a sound or invoke a mutating command.
  await page.evaluate(()=>{const api=window.__ym2151Voice.runtime.chipInspector;const read=api.read.bind(api),invoke=api.invoke.bind(api);Object.assign(window.__ym2151Voice,{reads:0,writes:0,hidden:false});api.read=(...args)=>{window.__ym2151Voice.reads++;return read(...args);};api.invoke=(...args)=>{window.__ym2151Voice.writes++;return invoke(...args);};Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__ym2151Voice.hidden});});
  await page.waitForTimeout(650);assert((await page.evaluate(()=>window.__ym2151Voice.reads))>0,'visible chip polls read snapshots');assert.equal(await page.evaluate(()=>window.__ym2151Voice.writes),0,'polling does not write audio');
  await page.evaluate(()=>{window.__ym2151Voice.hidden=true;document.dispatchEvent(new Event('visibilitychange'));});const hiddenReads=await page.evaluate(()=>window.__ym2151Voice.reads);await page.waitForTimeout(650);assert.equal(await page.evaluate(()=>window.__ym2151Voice.reads),hiddenReads,'hidden document does not poll');
  await page.evaluate(()=>{window.__ym2151Voice.hidden=false;document.dispatchEvent(new Event('visibilitychange'));});await page.click('#codeTab');await page.waitForTimeout(60);const hiddenTabReads=await page.evaluate(()=>window.__ym2151Voice.reads);await page.waitForTimeout(450);assert.equal(await page.evaluate(()=>window.__ym2151Voice.reads),hiddenTabReads,'hidden chip tab does not poll');
  await page.click('#ym2151Tab');await page.click(action('keyboard'));await page.locator('#keyboardPanel').waitFor({state:'visible'});
  let key=await keyEvent(page,'keydown');results.keyboard=await audible(page,'Guitar computer key');await keyEvent(page,'keyup',key);await silent(page,'Guitar keyup');
  key=await keyEvent(page,'keydown');await audible(page,'Guitar before Code focus');await page.click('#codeTab');await page.locator('#editorHost textarea').first().focus();await keyEvent(page,'keyup',key);await silent(page,'Code focus releases Guitar');
  await page.click('#keyboardTab');key=await keyEvent(page,'keydown');await audible(page,'Guitar before blur');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await silent(page,'window blur releases Guitar');await keyEvent(page,'keyup',key);
  await page.click('#ym2151Tab');await page.click(action('keyboard'));key=await keyEvent(page,'keydown');await audible(page,'Guitar before Stop');const patchBeforeStop=voiceSettings((await read(page)).channels[0]);await stop(page);await keyEvent(page,'keyup',key);
  assert.deepEqual(voiceSettings((await read(page)).channels[0]),patchBeforeStop,'Stop preserves the edited patch and pitch');
  await page.click('#ym2151Tab');await startHold(page);await audible(page,'audition after Stop');await releaseOutside(page);await silent(page,'release after Stop');
  await page.evaluate(({source,worker})=>{window.__ym2151Voice.setSource(source);document.getElementById('workerExecution').checked=worker;},{source:program,worker});await page.click('#runButton');await page.waitForFunction(()=>window.__ym2151Voice.runtime.getState().playback==='running');
  await page.click('#ym2151Tab');await page.locator(action('hold')).waitFor();await field(page,control('audition-midi'),69);await startHold(page);
  await untilState(page,'Math.abs(state.channels[0].frequency-440)<3&&state.channels[0].active','audition retunes a code-owned channel');
  const otherFrequencies=[];
  for(let index=0;index<5;index++){await page.waitForTimeout(220);const state=await read(page);assert(Math.abs(state.channels[0].frequency-440)<3&&state.channels[0].active,'queued program does not steal a held audition');otherFrequencies.push(state.channels[1].frequency);}
  assert(Math.max(...otherFrequencies)-Math.min(...otherFrequencies)>200,'another channel keeps progressing while audition owns CH1');
  await field(page,control('op-3-tl'),38);await untilState(page,'state.channels[0].operators[3].tl===38','patch remains editable during a held audition');await audible(page,'audition over background code');
  await releaseOutside(page);await untilState(page,'Math.abs(state.channels[0].frequency-261.6256)<3&&state.channels[0].active','program resumes on its next note');await stop(page);
  await page.click('#runButton');await page.waitForFunction(()=>window.__ym2151Voice.runtime.getState().playback==='running');await untilState(page,'state.channels[0].active&&Math.abs(state.channels[0].frequency-261.6256)<3','Run works after audition and Stop');await stop(page);
  assert.equal((await page.evaluate(()=>window.__ym2151Voice.runtime.chipInspector.list())).filter(entry=>entry.kind==='ym2151').length,1,'audition did not create another YM2151');assert.deepEqual(errors,[],'no browser page errors');
  if(process.argv.includes('--screenshots')){await page.click('#ym2151Tab');results.screenshot=`/private/tmp/ym2151-voice-${browserName}-${worker?'worker':'main'}-success.png`;await page.screenshot({path:results.screenshot});}
  console.log(JSON.stringify({...results,stage:'passed'}));
}
(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try {
    const url=`http://127.0.0.1:${server.address().port}/playground/index.html`,engines=process.argv.includes('--chromium')?[['chromium',chromium]]:process.argv.includes('--webkit')?[['webkit',webkit]]:[['chromium',chromium],['webkit',webkit]],workers=process.argv.includes('--main')?[false]:process.argv.includes('--worker')?[true]:[false,true];
    for(const [name,type] of engines){const browser=await type.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});try{for(const worker of workers){const page=await browser.newPage({viewport:{width:1380,height:1100},serviceWorkers:'block'});page.setDefaultTimeout(20000);try{await check(page,url,name,worker);}catch(error){console.error(JSON.stringify({browser:name,worker,diagnostic:await page.evaluate(()=>({runtime:document.getElementById('runtimeState')?.textContent,status:document.getElementById('status')?.textContent,console:document.getElementById('consoleOutput')?.textContent,panel:document.getElementById('ym2151Panel')?.textContent,inspector:window.__ym2151Voice?.runtime.chipInspector.list()})).catch(()=>null)}));await page.screenshot({path:`/private/tmp/ym2151-voice-${name}-${worker?'worker':'main'}-failed.png`}).catch(()=>{});throw error;}finally{await page.close();}}}finally{await browser.close();}}
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
