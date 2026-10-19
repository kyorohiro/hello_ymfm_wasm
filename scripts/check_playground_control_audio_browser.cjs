// Self-host the real Playground and drag FM controls during sustained CH3 audio.
// Run Chromium by default; --webkit includes WebKit, --webkit-only skips Chromium.
// Focus a case with --modes=pc98 --executions=worker.
// Checks state/register scope and finite continuous PCM, not the sound of algorithms.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium,webkit} = require('playwright');

const docs = path.resolve(__dirname,'../docs');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml'};
const accessor = '\nwindow.__controlRegression={runtime,megaDrive,operatorTab,getEditorValue,setEditorValue,runCode};window.__readControlCodeState=()=>{const synth=megaDrive.fm;return(synth.fm??synth).getState();};';
const server = http.createServer(async (request,response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    let file = path.resolve(docs,'.'+pathname);
    if (!file.startsWith(docs+path.sep)) throw Error('Invalid path');
    if ((await fs.stat(file)).isDirectory()) file = path.join(file,'index.html');
    let body = await fs.readFile(file);
    if (pathname.endsWith('/playground.js')) body = Buffer.from(body.toString()+accessor);
    if (pathname.endsWith('/playground_worker_chip.js')) body = Buffer.from(body.toString().replace(' const sectionNames=',
      ' globalThis.__readControlCodeState=()=>raw.getState();\n const sectionNames='));
    response.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');
    response.end(body);
  } catch (error) {response.writeHead(404).end(String(error));}
});

const captureSource = `class ControlAudioCapture extends AudioWorkletProcessor {
  constructor(){super();this.reset();this.active=false;this.port.onmessage=({data})=>{
    if(data.op==='reset'){this.reset();this.active=true;this.port.postMessage({op:'reset'});}
    if(data.op==='dispose')this.dead=true;
    if(data.op==='report')this.port.postMessage({op:'report',frames:this.frames,invalid:this.invalid,peak:this.peak,maxQuietFrames:this.maxQuietFrames,frameGaps:this.frameGaps});
  };}
  reset(){this.frames=0;this.invalid=0;this.peak=0;this.quietFrames=0;this.maxQuietFrames=0;this.nextFrame=null;this.frameGaps=0;}
  process(inputs){if(this.dead)return false;const channels=inputs[0];if(!this.active||!channels?.[0])return true;
    if(this.nextFrame!==null&&this.nextFrame!==currentFrame)this.frameGaps++;
    const frames=channels[0].length;this.nextFrame=currentFrame+frames;this.frames+=frames;
    let peak=0;for(const channel of channels)for(const value of channel){if(!Number.isFinite(value))this.invalid++;else peak=Math.max(peak,Math.abs(value));}
    this.peak=Math.max(this.peak,peak);this.quietFrames=peak<1e-7?this.quietFrames+frames:0;this.maxQuietFrames=Math.max(this.maxQuietFrames,this.quietFrames);
    return true;
  }
}registerProcessor('tetorica-control-audio-capture',ControlAudioCapture);`;

const source = `const preset = {...FM_PRESETS['one-op-basic'],operators:FM_PRESETS['one-op-basic'].operators.map(op=>({...op}))};
preset.operators[3]={...preset.operators[3],tl:32,ar:31,d1r:0,d2r:0,sl:0,rr:15};
fm.setPreset(CH3,preset);
fm.setPan(CH3,true,true,0,0);
fm.setLfo(false,0);
fm.setChannel3SpecialMode(true);
for(let op=0;op<4;op++)fm.setChannel3SpecialFrequency(op,4,450+op*100);
fm.noteOn(CH3,4,750);
console.log('CONTROL_AUDIO_READY');
liveLoop('control-state-observer',async()=>{
  const state=globalThis.__readControlCodeState();
  console.log('CONTROL_STATE '+JSON.stringify({channel:state.channels[CH3],modeRegister:state.modeRegister}));
  await sleep(.08);
});`;

const common = label => `#operatorTabCommonControls .param-value[aria-label="${label}"]`;
const tl = '#operatorTabOperatorControls .operator-row:nth-child(4) .param-value[aria-label="TL"]';

async function ready(page) {
  await page.waitForFunction(() => window.__controlRegression && window.monaco?.editor?.getEditors().length);
  await page.locator('#startupNotice').waitFor({state:'hidden'});
  await page.evaluate(async () => {
    const model = monaco.editor.getEditors()[0].getModel();
    const factory = await monaco.languages.typescript.getJavaScriptWorker();
    await (await factory(model.uri)).getSemanticDiagnostics(model.uri.toString());
  });
}

async function coreState(page) {
  return page.evaluate(() => {
    const synth=window.__controlRegression.megaDrive.fm,core=synth.fm??synth;
    return core.getState();
  });
}

async function drag(page,selector,value,max) {
  const control=page.locator(selector);await control.scrollIntoViewIfNeeded();
  const start=Number(await control.textContent()),box=await control.boundingBox();
  assert(box,`control is visible: ${selector}`);
  const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+(value-start)*160/max,y,{steps:16});await page.mouse.up();
  await page.waitForFunction(({selector,value})=>document.querySelector(selector).textContent===String(value),{selector,value});
}

function stableFields(state) {
  const channel=state.channels[2];
  return {modeRegister:state.modeRegister,lfo:state.lfo,left:channel.left,right:channel.right,block:channel.block,fnum:channel.fnum,
    specialFrequencies:channel.specialFrequencies,otherChannels:state.channels.filter((_,index)=>index!==2),
    operators:channel.operators.map((operator,index)=>index===3?{...operator,tl:'edited'}:operator)};
}

async function checkCase(page,browser,mode,execution) {
  const pfx=`${browser}/${mode}/${execution}`;
  await page.evaluate(({source,execution})=>{
    document.getElementById('workerExecution').checked=execution==='worker';
    window.__controlRegression.setEditorValue(source);
  },{source,execution});
  await page.click('#runButton');
  await page.waitForFunction(()=>document.getElementById('consoleOutput').textContent.includes('CONTROL_AUDIO_READY'));
  const lead=execution==='worker'?await page.evaluate(()=>window.__controlRegression.runtime.getTiming().workerLookaheadSeconds*1000):0;
  await page.waitForTimeout(lead+180);
  await page.click('#operatorTabButton');await page.selectOption('#operatorTabChannelSelect','2');
  const before=await coreState(page);
  assert.equal(before.channels[2].fnum,750,`${pfx}: actual CH3 pitch initialized`);
  assert.equal(before.channels[2].ams,0);assert.equal(before.channels[2].pms,0);
  assert(before.modeRegister&64,`${pfx}: actual CH3 special mode initialized`);
  await page.evaluate(async captureSource=>{
    const test=window.__controlRegression,context=test.megaDrive.audioContext;
    if(!context.__controlCaptureLoaded){
      const url=URL.createObjectURL(new Blob([captureSource],{type:'text/javascript'}));
      try{await context.audioWorklet.addModule(url);context.__controlCaptureLoaded=true;}finally{URL.revokeObjectURL(url);}
    }
    const capture=new AudioWorkletNode(context,'tetorica-control-audio-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
    const state=window.__controlAudio={capture,writes:[],sampleRate:context.sampleRate,report:null};
    state.detach=test.megaDrive.audio.connectOutputMonitor(capture);capture.connect(context.destination);
    capture.onprocessorerror=()=>{state.processorError=true;};
    const core=test.megaDrive.fm.fm??test.megaDrive.fm,transport=core.transport,write=transport.write,writeBatch=transport.writeBatch;
    state.restore=()=>{transport.write=write;if(writeBatch)transport.writeBatch=writeBatch;};
    transport.write=(port,register,value)=>{if(!state.inWriteBatch)state.writes.push([port,register,value]);return write.call(transport,port,register,value);};
    if(writeBatch)transport.writeBatch=commands=>{
      for(const {port,register,value} of commands)state.writes.push([port,register,value]);
      state.inWriteBatch=true;try{return writeBatch.call(transport,commands);}finally{state.inWriteBatch=false;}
    };
    await new Promise(resolve=>{capture.port.onmessage=({data})=>{if(data.op==='reset')resolve();};capture.port.postMessage({op:'reset'});});
  },captureSource);

  const changes=[
    ['ALGO',0,7,0xb2],['ALGO',7,7,0xb2],['ALGO',3,7,0xb2],['ALGO',7,7,0xb2],
    ['FB',7,7,0xb2],['FB',0,7,0xb2],['FB',5,7,0xb2],['FB',2,7,0xb2],
    ['AMS',3,3,0xb6],['AMS',0,3,0xb6],['AMS',2,3,0xb6],
    ['PMS',7,7,0xb6],['PMS',0,7,0xb6],['PMS',4,7,0xb6],
    ['TL',48,127,0x4e],['TL',24,127,0x4e],['TL',32,127,0x4e],
  ];
  let writes=0;
  const expected={algorithm:7,feedback:0,ams:0,pms:0,tl:32};
  for(const [label,value,max,register] of changes){
    await page.evaluate(()=>{window.__controlAudio.writes=[];});
    await drag(page,label==='TL'?tl:common(label),value,max);
    const state=await coreState(page),scope=await page.evaluate(()=>window.__controlAudio.writes);
    assert.deepEqual(stableFields(state),stableFields(before),`${pfx}: ${label} preserves pitch, special mode, other channels/operators`);
    const key={ALGO:'algorithm',FB:'feedback',AMS:'ams',PMS:'pms'}[label];
    expected[key??'tl']=value;
    assert.equal(label==='TL'?state.channels[2].operators[3].tl:state.channels[2][key],value,`${pfx}: ${label} reaches code state`);
    const selected=state.channels[2];
    assert.deepEqual({algorithm:selected.algorithm,feedback:selected.feedback,ams:selected.ams,pms:selected.pms,tl:selected.operators[3].tl},expected,`${pfx}: ${label} preserves previous control edits`);
    assert(scope.length>0,`${pfx}: ${label} emits real chip writes`);
    assert(scope.every(([port,address])=>port===0&&address===register),`${pfx}: ${label} must not resend unrelated/pitch/key registers: ${JSON.stringify(scope)}`);
    writes+=scope.length;
    await page.waitForFunction(expected=>{
      const lines=document.getElementById('consoleOutput').textContent.split('\n').filter(line=>line.startsWith('CONTROL_STATE '));
      if(!lines.length)return false;
      const {channel}=JSON.parse(lines.at(-1).slice('CONTROL_STATE '.length));
      return channel.algorithm===expected.algorithm&&channel.feedback===expected.feedback&&channel.ams===expected.ams&&channel.pms===expected.pms&&channel.operators[3].tl===expected.tl;
    },expected,{timeout:2000});
  }
  const latest=await coreState(page);
  await page.waitForFunction(()=>{
    const lines=document.getElementById('consoleOutput').textContent.split('\n').filter(line=>line.startsWith('CONTROL_STATE '));
    if(!lines.length)return false;
    const {channel}=JSON.parse(lines.at(-1).slice('CONTROL_STATE '.length));
    return channel.algorithm===7&&channel.feedback===2&&channel.ams===2&&channel.pms===4&&channel.operators[3].tl===32;
  });
  const observed=await page.evaluate(()=>{
    const lines=document.getElementById('consoleOutput').textContent.split('\n').filter(line=>line.startsWith('CONTROL_STATE '));
    return JSON.parse(lines.at(-1).slice('CONTROL_STATE '.length));
  });
  assert.deepEqual(observed.channel,latest.channels[2],`${pfx}: running ${execution} code sees current UI state`);
  assert.equal(observed.modeRegister,latest.modeRegister);
  const stats=await page.evaluate(async()=>{
    const state=window.__controlAudio;
    const report=await new Promise(resolve=>{state.capture.port.onmessage=({data})=>{if(data.op==='report')resolve(data);};state.capture.port.postMessage({op:'report'});});
    return {...report,sampleRate:state.sampleRate,processorError:Boolean(state.processorError),playback:window.__controlRegression.runtime.getState().playback};
  });
  assert.equal(stats.invalid,0,`${pfx}: all captured audio samples are finite`);
  assert.equal(stats.frameGaps,0,`${pfx}: capture runs on continuous output frames`);
  assert.equal(stats.processorError,false,`${pfx}: audio processor remains usable`);
  assert(stats.frames>stats.sampleRate*.1&&stats.peak>.0001,`${pfx}: real audio was captured`);
  assert(stats.maxQuietFrames<stats.sampleRate*.1,`${pfx}: held FM must not stop for 100 ms during control edits`);
  assert.equal(stats.playback,'running',`${pfx}: live code keeps running`);
  await page.evaluate(async()=>{
    const state=window.__controlAudio;state.restore();state.capture.port.postMessage({op:'dispose'});state.detach();state.capture.disconnect();state.capture.port.close();
    await window.__controlRegression.runtime.stopWithFade();
  });
  console.log(JSON.stringify({browser,mode,execution,changes:changes.length,writes,stats,passed:true}));
}

async function checkBrowser(name,type,base){
  const browser=await type.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1360,height:1000}});
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(error.message));
  try{
    const modes=process.argv.find(arg=>arg.startsWith('--modes='))?.slice('--modes='.length).split(',')??['genesis','pc98'];
    const executions=process.argv.find(arg=>arg.startsWith('--executions='))?.slice('--executions='.length).split(',')??['main','worker'];
    for(const mode of modes){
      await page.goto(`${base}?mode=${mode}&no-sw=1`);await ready(page);
      for(const execution of executions)await checkCase(page,name,mode,execution);
    }
    assert.deepEqual(errors,[],`${name}: page errors`);
  }catch(error){
    console.error(JSON.stringify({browser:name,url:page.url(),errors,status:await page.locator('#status').textContent().catch(()=>null),console:await page.locator('#consoleOutput').textContent().then(text=>text.slice(-4096)).catch(()=>null)}));
    throw error;
  }finally{await context.close();await browser.close();}
}

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const base=`http://127.0.0.1:${server.address().port}/playground/index.html`;
    if(!process.argv.includes('--webkit-only'))await checkBrowser('chromium',chromium,base);
    if(process.argv.includes('--webkit')||process.argv.includes('--webkit-only'))await checkBrowser('webkit',webkit,base);
    console.log(JSON.stringify({passed:true,scope:'CH3 control state, targeted writes, finite PCM and continued playback; algorithm waveform changes and OS-device underruns are not classified as glitches'}));
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
