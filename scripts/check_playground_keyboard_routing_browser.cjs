// Actual Keyboard Chip/CH selectors, real Worklets/WASM and Main/Worker code.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium,webkit} = require('playwright');
const docs = path.resolve(__dirname,'../docs');
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'};
const accessor = '\nwindow.__keyboardRoutingTest={runtime,megaDrive,keyboardRouting,operatorKeyboard,setSource:value=>editorAdapter.setValue(value)};';
const server = http.createServer(async(request,response)=>{
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    let filename=path.resolve(docs,'.'+pathname);
    if(!filename.startsWith(docs+path.sep))throw Error('Invalid path');
    if((await fs.stat(filename)).isDirectory())filename=path.join(filename,'index.html');
    let body=await fs.readFile(filename);
    if(pathname.endsWith('/playground.js'))body=Buffer.from(body.toString()+accessor);
    response.setHeader('Content-Type',mime[path.extname(filename)]||'application/octet-stream');response.end(body);
  }catch(error){response.writeHead(404).end(error.message);}
});
const chipSelector='#playgroundKeyboardChip', channelSelector='#playgroundKeyboardTargetChannel';
const routeState=page=>page.evaluate(()=>window.__keyboardRoutingTest.keyboardRouting.getState());
const snapshot=(page,id)=>page.evaluate(id=>window.__keyboardRoutingTest.runtime.chipInspector.read(id),id);
let runSequence=0;
async function runSource(page,source,worker){
  const marker=`KEYBOARD_ROUTING_READY_${++runSequence}`;
  await page.selectOption('#runFileSelect','/index.js');
  await page.evaluate(({source,worker,marker})=>{
    window.__keyboardRoutingTest.setSource(source+`\nliveLoop('routing-keep',async()=>{await sleep(1);});\nconsole.log(${JSON.stringify(marker)});`);
    document.getElementById('workerExecution').checked=worker;
  },{source,worker,marker});
  await page.click('#runButton');
  await page.waitForFunction(marker=>document.getElementById('consoleOutput').textContent.includes(marker),marker);
  const lead=worker?await page.evaluate(()=>window.__keyboardRoutingTest.runtime.getTiming().workerLookaheadSeconds*1000):0;
  await page.waitForTimeout(lead+120);
}
async function untilSnapshot(page,id,predicate,label){
  const deadline=Date.now()+8000;
  while(Date.now()<deadline){
    // RPC predicates run in Node's polling loop: waitForFunction(async ...) does
    // not await them and can accept a Promise instead of the applied snapshot.
    const value=await snapshot(page,id);
    if(predicate(value))return value;
    await page.waitForTimeout(25);
  }
  throw Error(`${label}: ${JSON.stringify(await snapshot(page,id))}`);
}
async function instrument(page){
  await page.evaluate(()=>{
    const test=window.__keyboardRoutingTest,api=test.runtime.chipInspector,original=api.invoke.bind(api);
    test.commands=[];test.commandErrors=[];
    api.invoke=(id,method,args=[])=>{
      test.commands.push({id,method,args:structuredClone(args)});
      return original(id,method,args).catch(error=>{if(error.name!=='AbortError')test.commandErrors.push({id,method,error:error.message});throw error;});
    };
    const context=test.megaDrive.audioContext,split=context.createChannelSplitter(2),silent=context.createGain();
    silent.gain.value=0;silent.connect(context.destination);
    test.meters=[context.createAnalyser(),context.createAnalyser()];
    test.meters.forEach((meter,index)=>{meter.fftSize=8192;split.connect(meter,index);meter.connect(silent);});
    test.megaDrive.audio.connectOutputMonitor(split);
    test.measure=()=>test.meters.map(meter=>{
      const pcm=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(pcm);
      const mean=pcm.reduce((sum,value)=>sum+value,0)/pcm.length,crossings=[];
      for(let i=1;i<pcm.length;i++)if(pcm[i-1]<mean&&pcm[i]>=mean)crossings.push(i-1+(mean-pcm[i-1])/(pcm[i]-pcm[i-1]));
      return {rms:Math.sqrt(pcm.reduce((sum,value)=>sum+(value-mean)**2,0)/pcm.length),peak:Math.max(...pcm.map(Math.abs)),finite:pcm.every(Number.isFinite),hz:crossings.length>2?(crossings.length-1)*context.sampleRate/(crossings.at(-1)-crossings[0]):0};
    });
  });
}
async function selectRoute(page,id,channel,{idle=false}={}){
  const before=await page.evaluate(()=>window.__keyboardRoutingTest.commands.length);
  await page.selectOption(chipSelector,`chip:${id}`);
  await page.selectOption(channelSelector,String(channel));
  const selected=await routeState(page);
  assert.equal(selected.chipId,`chip:${id}`);assert.equal(selected.channelId,String(channel));
  await page.waitForTimeout(60);
  if(idle)assert.equal(await page.evaluate(()=>window.__keyboardRoutingTest.commands.length),before,'idle selector changes must not send audio commands');
}
async function key(page,type,key='a'){
  await page.evaluate(({type,key})=>document.body.dispatchEvent(new KeyboardEvent(type,{key,code:`Key${key.toUpperCase()}`,bubbles:true,cancelable:true})),{type,key});
}
async function audible(page,label,{side,hz,threshold=.0002}={}){
  await page.waitForFunction(({side,hz,threshold})=>{
    const values=window.__keyboardRoutingTest.measure(),audible=side===undefined?values:values.filter((_value,index)=>index===side);
    return audible.some(value=>value.rms>threshold&&(hz===undefined||Math.abs(value.hz/hz-1)<.05));
  },{side,hz,threshold},{timeout:8000}).catch(error=>{throw Error(`${label}: expected PCM absent (${error.message})`);});
  const values=await page.evaluate(()=>window.__keyboardRoutingTest.measure());
  assert(values.every(value=>value.finite&&value.peak<.99),`${label}: invalid/clipped PCM`);
  if(side!==undefined)assert(values[side].rms>values[1-side].rms*10,`${label}: wrong physical channel pan ${JSON.stringify(values)}`);
  return values;
}
async function silent(page,label){
  await page.waitForTimeout(200);
  await page.waitForFunction(()=>window.__keyboardRoutingTest.measure().every(value=>value.rms<.00004),null,{timeout:7000}).catch(error=>{throw Error(`${label}: audio remained (${error.message})`);});
}
async function pressedMidi(page){return page.evaluate(()=>window.__keyboardRoutingTest.commands.findLast(command=>command.method==='auditionOn').args[1]);}
const hzFor=midi=>440*2**((midi-69)/12);
const commonFm=`fm.setPreset(CH1,FM_PRESETS.sine);`;
const sources={
  genesis:`${commonFm}
fm.setPreset(CH2,{...FM_PRESETS.sine,operators:FM_PRESETS.sine.operators.map(operator=>({...operator,multi:2}))});
fm.setPan(CH1,true,false);fm.setPan(CH2,false,true);
psg.tone(1,{frequency:440,attenuation:9});psg.off(1);
psg.noise({type:'white',rate:'medium',attenuation:9});psg.noiseOff();
const extra=await createSoundChip('ym2612',{id:'keyboard-extra-opn'});
extra.setPreset(0,FM_PRESETS.sine);extra.setPreset(5,FM_PRESETS.sine);extra.setPan(0,true,true);extra.setPan(5,false,true);
const gb=await createSoundChip('gameboy',{id:'keyboard-extra-gb'});gb.initialize();
gb.pulse.setVoice(1,{duty:0.5,volume:9,envelope:{direction:'down',period:0}});
keyboard.bind('Routing custom',{noteOn:event=>extra.noteOn(0,event.midi),noteOff:()=>extra.keyOff(0),allNotesOff:()=>extra.keyOff(0)});`,
  pc98:`${commonFm}
ssg.setMixer(1,{tone:true,noise:false});ssg.setVolume(1,9);ssg.keyOff(1);
rhythm.setVolume(48);rhythm.setVoice('bassDrum',{volume:24,left:true,right:true});`,
  'pc98-26':`${commonFm}ssg.setMixer(2,{tone:true,noise:false});ssg.setVolume(2,9);ssg.keyOff(2);`,
  'neogeo-b':`fm.setPreset(CH6,FM_PRESETS.sine);fm.setPan(CH6,false,true);`,
  gameboy:`gameboy.wave.stopAndSetWaveform(Array.from({length:32},(_,i)=>Math.round(7.5+7.5*Math.sin(i*Math.PI/16))));gameboy.wave.setLevel(0.5);
gameboy.noise.setVoice({volume:9,envelope:{direction:'down',period:0},divisor:3,shift:4,width:15});`,
  nes:`nes.fds.setWave(Array.from({length:64},(_,i)=>Math.round(31.5+30*Math.sin(i*Math.PI/32))));nes.fds.setVolume(28);
nes.fds.setModulation({table:Array(32).fill(0),rate:0,depth:0,bias:0,enabled:false});`,
  'pc-engine':`pce.setWaveform(5,Array.from({length:32},(_,i)=>Math.round(15.5+15.5*Math.sin(i*Math.PI/16))));pce.setVolume(5,24);pce.setPan(5,0,15);pce.setMasterVolume(15,15);pce.setNoise(5,{enabled:false,frequency:16});`,
  snes:`const brrSample=await snes.loadBRR(new Uint8Array([0xc3,0x13,0x57,0x75,0x31,0xfd,0xb9,0x9b,0xdf]),{baseFrequencyHz:2000,loopStartSamples:0});
snes.setPreset(1,{sample:brrSample,adsr1:0x8f,adsr2:0xe0,gain:127,volumeLeft:0,volumeRight:80});`,
  'mega-cd':`${commonFm}
const pcm=await useSoundChip('rf5c164'),wave=new Uint8Array(129);
for(let i=0;i<128;i++){const value=Math.sin(i*Math.PI/64);wave[i]=Math.round(Math.abs(value)*100)|(value>=0?128:0);}wave[128]=255;
await pcm.loadMemory(wave);await pcm.setChannel(7,{start:0,loopStart:0,step:2048,volume:80,pan:{left:15,right:0}});`,
  'genesis-full':commonFm,
};
async function verifyVoice(page,{endpoint,channel,predicate,side,pitched=true,label,after}={}){
  await selectRoute(page,endpoint,channel,{idle:true});
  await key(page,'keydown');
  if(predicate)await untilSnapshot(page,endpoint,predicate,label);
  const midi=await pressedMidi(page),pcm=await audible(page,label,{side,hz:pitched?hzFor(midi):undefined});
  if(after)await after(await snapshot(page,endpoint),midi);
  await key(page,'keyup');await silent(page,`${label} keyup`);
  return {endpoint,channel,midi,hz:pcm.map(value=>value.hz)};
}
async function checkGenesis(page,result){
  await page.waitForFunction(()=>window.__keyboardRoutingTest.keyboardRouting.getState().chips.some(chip=>chip.endpointId==='keyboard-extra-opn'));
  const state=await routeState(page);
  assert(state.chips.some(chip=>chip.id==='instrument:script'),'script bindings remain an explicit selectable instrument');
  assert.equal(state.chips.filter(chip=>chip.kind==='ym2612').length,2,'primary and independent same-kind instances have separate choices');
  result.voices.push(await verifyVoice(page,{endpoint:'ym2612',channel:'fm:0',predicate:s=>s.held.includes('fm:0'),side:0,label:'primary FM CH1'}));
  await selectRoute(page,'ym2612','fm:1',{idle:true});await key(page,'keydown','a');
  await untilSnapshot(page,'ym2612',s=>s.held.includes('fm:1'),'primary CH2 lease');
  result.ch2=await audible(page,'primary FM CH2 distinct multiplier/pan',{side:1,hz:hzFor(await pressedMidi(page))*2});
  await key(page,'keydown','s');await key(page,'keyup','a');
  await untilSnapshot(page,'ym2612',s=>s.held.includes('fm:1'),'stale keyboard release preserves replacement');
  await audible(page,'CH2 replacement survives old keyup',{side:1,hz:hzFor(await pressedMidi(page))*2});
  await key(page,'keyup','s');await silent(page,'CH2 last release');
  result.voices.push(await verifyVoice(page,{endpoint:'segapsg',channel:1,predicate:s=>s.channels[1].active&&!s.channels[0].active,label:'PSG Tone 2'}));
  result.voices.push(await verifyVoice(page,{endpoint:'segapsg',channel:3,predicate:s=>s.noise.active,pitched:false,label:'PSG Noise'}));
  result.voices.push(await verifyVoice(page,{endpoint:'keyboard-extra-opn',channel:'fm:5',predicate:s=>s.held.includes('fm:5'),side:1,label:'independent YM2612 CH6'}));
  result.voices.push(await verifyVoice(page,{endpoint:'keyboard-extra-gb',channel:1,predicate:s=>s.channels[1].active&&!s.channels[0].active,label:'independent Game Boy Pulse 2'}));
  await page.selectOption(chipSelector,'instrument:script');await key(page,'keydown');await audible(page,'explicit script target');await key(page,'keyup');await silent(page,'script target release');
  await selectRoute(page,'ym2612','fm:0',{idle:true});await page.evaluate(()=>window.__keyboardRoutingTest.keyboardRouting.refresh());
  assert.equal((await routeState(page)).chipId,'chip:ym2612','metadata refresh preserves explicit hardware choice over script binding');
  await selectRoute(page,'keyboard-extra-opn','fm:5',{idle:true});await key(page,'keydown');await audible(page,'extra chip before Stop',{side:1});
  await page.click('#stopButton');await silent(page,'Stop clears held keyboard and code voices');await key(page,'keyup');
  await page.waitForFunction(()=>!window.__keyboardRoutingTest.keyboardRouting.getState().chips.some(chip=>chip.endpointId==='keyboard-extra-opn'));
  assert(!await page.locator(`${chipSelector} option[value="chip:keyboard-extra-opn"]`).count(),'disposed instance is removed from choices');
  await selectRoute(page,'ym2612','fm:0',{idle:true});await key(page,'keydown');await audible(page,'primary audition works after Stop',{side:0});await key(page,'keyup');await silent(page,'after Stop keyup');
}
async function check(page,url,browser,worker,mode){
  const errors=[],failed=[],result={browser,worker,mode,voices:[]};
  page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)failed.push({url:response.url(),status:response.status()});});
  console.log(JSON.stringify({...result,stage:'start'}));
  await page.goto(`${url}?mode=${mode}&no-sw=1`);
  await page.waitForFunction(()=>window.__keyboardRoutingTest&&window.monaco?.editor?.getEditors().length);
  await page.locator('#startupNotice').waitFor({state:'hidden'});await page.click('#keyboardTab');
  assert(await page.locator(chipSelector).isVisible()&&await page.locator(channelSelector).isVisible(),'Keyboard always shows Chip and CH');
  assert.equal(await page.evaluate(()=>window.__keyboardRoutingTest.megaDrive.audioContext),null,'opening selectors does not start audio');
  assert.deepEqual(await page.evaluate(()=>window.__keyboardRoutingTest.runtime.chipInspector.list()),[],'selectors do not create fake instances');
  await runSource(page,sources[mode],worker);await page.click('#keyboardTab');await instrument(page);await silent(page,'configuration does not play');
  if(mode==='genesis')await checkGenesis(page,result);
  if(mode==='pc98'){
    result.voices.push(await verifyVoice(page,{endpoint:'ym2608',channel:'ssg:1',predicate:s=>s.held.includes('ssg:1'),label:'YM2608 SSG 2'}));
    result.voices.push(await verifyVoice(page,{endpoint:'ym2608',channel:'rhythm:0',predicate:s=>s.held.includes('rhythm:0'),pitched:false,label:'YM2608 Bass drum'}));
  }
  if(mode==='pc98-26')result.voices.push(await verifyVoice(page,{endpoint:'ym2203',channel:'ssg:2',predicate:s=>s.held.includes('ssg:2'),label:'YM2203 SSG 3'}));
  if(mode==='neogeo-b')result.voices.push(await verifyVoice(page,{endpoint:'ym2610b',channel:'fm:5',predicate:s=>s.held.includes('fm:5'),side:1,label:'YM2610B FM CH6'}));
  if(mode==='gameboy'){
    result.voices.push(await verifyVoice(page,{endpoint:'gameboy',channel:2,predicate:s=>s.channels[2].active&&!s.channels[0].active,label:'Game Boy Wave'}));
    result.voices.push(await verifyVoice(page,{endpoint:'gameboy',channel:3,predicate:s=>s.channels[3].active,pitched:false,label:'Game Boy Noise'}));
  }
  if(mode==='nes')result.voices.push(await verifyVoice(page,{endpoint:'nes',channel:5,predicate:s=>s.fds.active&&!s.channels[0].active,label:'NES FDS'}));
  if(mode==='pc-engine')result.voices.push(await verifyVoice(page,{endpoint:'huc6280',channel:5,predicate:s=>s.channels[5].active&&!s.channels[0].active,side:1,label:'PC Engine CH6'}));
  if(mode==='snes')result.voices.push(await verifyVoice(page,{endpoint:'snes',channel:1,predicate:s=>s.channels[1].active&&!s.channels[0].active,side:1,label:'SNES Voice 2'}));
  if(mode==='mega-cd'){
    const before=await snapshot(page,'rf5c164');
    result.voices.push(await verifyVoice(page,{endpoint:'rf5c164',channel:7,predicate:s=>s.channels[7].active&&!s.channels[0].active,side:0,pitched:false,label:'RF5C164 PCM 8',after:(s,midi)=>assert.equal(s.channels[7].step,Math.round(2048*2**((midi-60)/12)))}));
    assert.equal((await snapshot(page,'rf5c164')).memoryRevision,before.memoryRevision,'Keyboard does not replace loaded PCM');
  }
  if(mode==='genesis-full'){
    const before=await page.evaluate(()=>window.__keyboardRoutingTest.commands.length);await page.selectOption(chipSelector,'chip:pwm');
    assert(await page.locator(channelSelector).isDisabled(),'PWM has no fabricated pitched channel');
    assert.match(await page.locator('#playgroundKeyboardHint').textContent(),/timed sample stream|no independent pitched/i);
    await key(page,'keydown');await key(page,'keyup');await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>window.__keyboardRoutingTest.commands.length),before,'unsupported PWM selection/keys never send audio commands');await silent(page,'unsupported PWM');
  }
  await page.click('#stopButton');await silent(page,'final Stop');
  assert.deepEqual(await page.evaluate(()=>window.__keyboardRoutingTest.commandErrors),[],'all audition RPCs succeeded');
  assert.deepEqual(errors,[],'no page errors');assert.deepEqual(failed,[],'all runtime resources loaded');
  if(process.argv.includes('--screenshots'))await page.screenshot({path:`/private/tmp/keyboard-routing-${mode}-${browser}-${worker?'worker':'main'}-success.png`});
  console.log(JSON.stringify({...result,pass:true}));
}
async function main(){
  const modesArgument=process.argv.find(argument=>argument.startsWith('--modes='));
  const modes=modesArgument?modesArgument.slice(8).split(','):['genesis','pc98','pc98-26','neogeo-b','gameboy','nes','pc-engine','snes','mega-cd','genesis-full'];
  for(const mode of modes)assert(sources[mode],`Unsupported --modes value: ${mode}`);
  const browsers=process.argv.includes('--chromium')?[['chromium',chromium]]:process.argv.includes('--webkit')?[['webkit',webkit]]:[['chromium',chromium],['webkit',webkit]];
  const workers=process.argv.includes('--main')?[false]:process.argv.includes('--worker')?[true]:[false,true];
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const url=`http://127.0.0.1:${server.address().port}/playground/index.html`;
    for(const[name,type]of browsers){
      const browser=await type.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});
      try{for(const worker of workers)for(const mode of modes){
        const page=await browser.newPage({viewport:{width:1420,height:1100},serviceWorkers:'block'});page.setDefaultTimeout(25000);
        try{await check(page,url,name,worker,mode);}
        catch(error){
          console.error(JSON.stringify({browser:name,worker,mode,diagnostic:await page.evaluate(()=>({status:document.getElementById('status')?.textContent,console:document.getElementById('consoleOutput')?.textContent,routes:window.__keyboardRoutingTest?.keyboardRouting.getState(),endpoints:window.__keyboardRoutingTest?.runtime.chipInspector.list(),commands:window.__keyboardRoutingTest?.commands,commandErrors:window.__keyboardRoutingTest?.commandErrors,pcm:window.__keyboardRoutingTest?.measure?.()})).catch(()=>null)}));
          await page.screenshot({path:`/private/tmp/keyboard-routing-${mode}-${name}-${worker?'worker':'main'}-failed.png`}).catch(()=>{});throw error;
        }finally{await page.close();}
      }}finally{await browser.close();}
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
