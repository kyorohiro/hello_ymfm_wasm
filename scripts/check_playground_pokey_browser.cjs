// Real Playground POKEY/dual-POKEY, Main/Worker, Keyboard, Mixer and extra chips.
// A capture Worklet observes stereo PCM before a permanently muted physical sink.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');
const config={docs:path.resolve(__dirname,'../docs'),out:'/private/tmp/pokey-playground-browser.json',engines:[]};
for(let i=2;i<process.argv.length;i++){
  const arg=process.argv[i];
  if(arg==='--chromium'||arg==='--webkit')config.engines.push(arg.slice(2));
  else if(arg==='--docs-dir')config.docs=path.resolve(process.argv[++i]);
  else if(arg==='--out')config.out=path.resolve(process.argv[++i]);
  else throw Error('Usage: check_playground_pokey_browser.cjs [--chromium] [--webkit] [--docs-dir PATH] [--out REPORT.json]');
}
if(!config.engines.length)config.engines=['chromium','webkit'];
const served=new Map(),results=[],sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.ico':'image/x-icon'};
const accessor='\nwindow.__pokeyCheck={runtime,megaDrive,selectedMode,virtualFiles,editorAdapter,setBottomTab};';
const probeSource = `
class PokeyStereoCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.capture = null;
    this.port.onmessage = ({data}) => {
      const frames = data.frames ?? 8192;
      this.capture = {id:data.id,index:0,left:new Float32Array(frames),right:new Float32Array(frames)};
    };
  }
  process(inputs,outputs) {
    for (const output of outputs[0]) output.fill(0);
    const input = inputs[0], capture = this.capture;
    if (!capture || input.length < 2) return true;
    const count = Math.min(input[0].length,capture.left.length-capture.index);
    capture.left.set(input[0].subarray(0,count),capture.index);
    capture.right.set(input[1].subarray(0,count),capture.index);
    capture.index += count;
    if (capture.index === capture.left.length) {
      this.capture = null;
      this.port.postMessage({id:capture.id,left:capture.left,right:capture.right},
        [capture.left.buffer,capture.right.buffer]);
    }
    return true;
  }
}
registerProcessor('pokey-stereo-capture',PokeyStereoCapture);
`;
const server=http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/__pokey_probe.js'){res.writeHead(200,{'Content-Type':'text/javascript'}).end(probeSource);return;}
    if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    let file=path.resolve(config.docs,'.'+pathname);if(file!==config.docs&&!file.startsWith(config.docs+path.sep))throw Error('Invalid path');
    if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');
    const original=await fs.readFile(file),name=path.relative(config.docs,file),hash=sha(original);
    if(served.has(name)&&served.get(name).sha256!==hash)throw Error('Runtime source changed during browser check: '+name);
    served.set(name,{bytes:original.length,sha256:hash});
    const body=pathname.endsWith('/playground.js')?Buffer.concat([original,Buffer.from(accessor)]):original;
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(body);
  }catch(error){res.writeHead(404).end(error.message);}
});
async function installCapture(page) {
  await page.evaluate(async () => {
    const state = window.__pokeyCheck, context = state.megaDrive.audioContext;
    await context.audioWorklet.addModule(new URL('/__pokey_probe.js',location.href));
    const node = new AudioWorkletNode(context,'pokey-stereo-capture',{
      numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,
      channelCountMode:'explicit',channelInterpretation:'discrete',
    });
    const silent = context.createGain(); silent.gain.value = 0;
    node.connect(silent); silent.connect(context.destination);
    state.megaDrive.audio.connectOutputMonitor(node);
    let sequence = 0;
    const pending = new Map();
    node.port.onmessage = ({data}) => {
      const waiter = pending.get(data.id); if (!waiter) return;
      pending.delete(data.id); clearTimeout(waiter.timer);
      const channels = [data.left,data.right].map(values => {
        const mean = values.reduce((sum,value) => sum + value,0) / values.length;
        let square = 0,peak = 0,stepPeak = 0,finite = true; const crossings = [];
        for (let i = 0; i < values.length; i++) {
          const value = values[i]; square += (value-mean)**2; peak = Math.max(peak,Math.abs(value));
          if (i) stepPeak = Math.max(stepPeak,Math.abs(value-values[i-1]));
          finite = finite && Number.isFinite(value);
          if (i && values[i-1] < mean && value >= mean) crossings.push(i-1+(mean-values[i-1])/(value-values[i-1]));
        }
        return {mean,rms:Math.sqrt(square/values.length),peak,stepPeak,finite,
          hz:crossings.length>2?(crossings.length-1)*context.sampleRate/(crossings.at(-1)-crossings[0]):0};
      });
      let difference = 0;
      for (let i = 0; i < data.left.length; i++) difference = Math.max(difference,Math.abs(data.left[i]-data.right[i]));
      waiter.resolve({channels,difference,frames:data.left.length,sampleRate:context.sampleRate});
    };
    state.capture = frames => new Promise((resolve,reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {pending.delete(id); reject(Error('PCM capture timed out'));},5000);
      pending.set(id,{resolve,timer}); node.port.postMessage({id,frames});
    });
  });
}
const capture = (page,frames) => page.evaluate(frames => window.__pokeyCheck.capture(frames),frames);

const read=(page,id='pokey')=>page.evaluate(id=>window.__pokeyCheck.runtime.chipInspector.read(id),id);
async function until(page,test,label,id='pokey'){
  const deadline=Date.now()+7000;let state;
  while(Date.now()<deadline){state=await read(page,id);if(test(state))return state;await page.waitForTimeout(30);}
  throw Error(label+': '+JSON.stringify(state));
}
async function runSource(page,source,execution='main'){
  console.log(`  Run ${execution}: ${source.split('\n').find(line=>line.trim())?.slice(0,90)}`);
  await page.evaluate(({source,execution})=>{document.getElementById('workerExecution').checked=execution==='worker';return window.__pokeyCheck.runtime.playSource(source,{execution});},{source,execution});
}
async function audible(page,label,{hz,mono=false,side}={}){
  const valid=pcm=>pcm.channels.every((ch,index)=>ch.finite&&ch.peak<.99&&
    (side!==undefined&&index!==side?ch.peak<.0001:ch.rms>.0002)&&
    (hz===undefined||side!==undefined&&index!==side||Math.abs(ch.hz-hz)<1));
  let pcm;for(let i=0;i<8;i++){pcm=await capture(page);if(valid(pcm))break;}
  assert(valid(pcm),label+': '+JSON.stringify(pcm));if(mono)assert(pcm.difference<1e-7,label+': mono center');return pcm;
}
async function silent(page,label){let pcm;for(let i=0;i<8;i++){pcm=await capture(page);if(pcm.channels.every(ch=>ch.peak<.0001))return pcm;}throw Error(label+': '+JSON.stringify(pcm));}
async function stop(page,ids=['pokey']){
  await page.click('#stopButton');await page.waitForFunction(()=>window.__pokeyCheck.runtime.getState().playback==='stopped');
  for(const id of ids)await until(page,state=>state.channels.every(ch=>!ch.active),'Stop releases '+id,id);
  return silent(page,'Stop');
}
async function mutePhysicalOutput(page){
  await page.evaluate(()=>{const audio=window.__pokeyCheck.megaDrive.audio,ensure=audio.ensureRouting.bind(audio);audio.ensureRouting=context=>{
    if(!audio.outputNode){const sink=context.createGain();sink.gain.value=0;sink.connect(context.destination);audio.outputNode=sink;}
    return ensure(context);
  };});
}
async function mix(page,id,settings){await page.evaluate(({id,settings})=>window.__pokeyCheck.megaDrive.mixer.set(id,settings),{id,settings});}
async function readyPage(browser,base,mode){
  const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1600,height:1100}});page.setDefaultTimeout(20000);
  const errors=[],missing=[];page.on('pageerror',error=>{errors.push(error.message);console.error('PAGE ERROR '+mode+': '+error.message);});page.on('response',response=>{if(response.status()===404){missing.push(response.url());console.error('HTTP 404 '+response.url());}});
  console.log('OPEN '+mode);await page.goto(base+`?mode=${mode}&no-sw=1`);await page.waitForFunction(()=>window.__pokeyCheck&&window.monaco?.editor?.getEditors().length);await page.locator('#startupNotice').waitFor({state:'hidden'});await mutePhysicalOutput(page);
  return {page,errors,missing};
}
async function keyboard(page,ids){
  await page.evaluate(()=>window.__pokeyCheck.setBottomTab('keyboard'));
  await page.locator('#operatorKeyboardRoot button').filter({hasText:/^Ukulele$/}).click();const results=[];
  for(const id of ids){
    await page.selectOption('#playgroundKeyboardChip','chip:'+id);await page.selectOption('#playgroundKeyboardTargetChannel','3');
    assert.deepEqual(await page.locator('#playgroundKeyboardTargetChannel option').evaluateAll(nodes=>nodes.map(node=>node.value)),['0','1','2','3']);
    const key=await page.locator('#operatorKeyboardRoot .key').evaluateAll(nodes=>nodes.find(node=>node.querySelector('span')?.textContent==='A4')?.dataset.key);assert(key,'Ukulele keyboard exposes A4');
    await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.down(key);
    try{
      const state=await until(page,state=>state.channels[3].active,'Keyboard selected '+id+' CH4',id);assert(state.channels.slice(0,3).every(ch=>!ch.active));
      for(const sibling of ids.filter(other=>other!==id))assert((await read(page,sibling)).channels.every(ch=>!ch.active),'Keyboard selects one chip');
      const pcm=await audible(page,'Keyboard '+id,{hz:state.channels[3].frequency,mono:true});results.push({id,channel:3,hz:pcm.channels[0].hz});
    }finally{await page.keyboard.up(key);}
    await until(page,state=>!state.channels[3].active,'Keyboard keyup '+id,id);await silent(page,'Keyboard keyup');
  }
  return results;
}
async function checkMode(browser,base,browserName,mode){
  const {page,errors,missing}=await readyPage(browser,base,mode),dual=mode==='pokey-dual',ids=dual?['pokey','pokey:2']:['pokey'],clock=dual?1789773:1789790;
  try{
    console.log(`CHECK ${browserName}: ${mode}`);assert.equal(await page.locator('#playgroundMode').inputValue(),mode);assert.equal(await page.evaluate(()=>window.__pokeyCheck.megaDrive.audioContext),null,'mode opening is lazy');
    const programs=await page.evaluate(async mode=>{const {MODE_DEFAULT_CODES,MODE_EXAMPLE_FILES}=await import(new URL('./playground_examples.js',location.href));return {starter:MODE_DEFAULT_CODES[mode],examples:MODE_EXAMPLE_FILES[mode],editor:window.__pokeyCheck.editorAdapter.getValue()};},mode);
    assert.equal(programs.editor,programs.starter);assert.equal(programs.examples.length,2);
    await page.click('#runButton');await page.waitForFunction(()=>window.__pokeyCheck.megaDrive.isReady());await installCapture(page);
    const starter=await audible(page,'starter '+mode);await stop(page,ids);
    const primary=await page.evaluate(()=>({chips:window.__pokeyCheck.runtime.chipInspector.list().map(entry=>[entry.id,entry.kind]),strips:window.__pokeyCheck.megaDrive.mixer.list().map(entry=>entry.id),fm:window.__pokeyCheck.megaDrive.capabilities.fmChannels}));
    assert.deepEqual(primary.chips,ids.map(id=>[id,'pokey']));assert.deepEqual(primary.strips,ids);assert.equal(primary.fm,0);for(const id of ids)assert.equal((await read(page,id)).clock,clock);
    const executions=[];
    for(const execution of ['main','worker']){
      await runSource(page,programs.starter,execution);const starterPcm=await audible(page,execution+' starter');await stop(page,ids);
      const globals=dual?'[pokey,pokey2]':'[pokey]';
      await runSource(page,`if(typeof fm!=='undefined'||typeof play!=='undefined')throw Error('Unexpected implicit FM');
        const borrowed=await useSoundChip('pokey');if(borrowed.id!=='pokey'||borrowed.dispose||borrowed.clock!==${clock})throw Error('Wrong borrowed POKEY');
        const chips=${globals};for(const chip of chips){chip.allNotesOff();for(let ch=0;ch<4;ch++){chip.setVolume(ch,8);chip.setDistortion(ch,5);}}
        liveLoop('steady-pokey',async()=>{pokey.noteOn(0,'A4');${dual?"pokey2.noteOn(0,'A5');":''}await sleep(60);});`,execution);
      const first=await until(page,state=>state.channels[0].active,execution+' steady POKEY');const firstHz=first.channels[0].frequency;
      assert.deepEqual(await page.evaluate(()=>window.__pokeyCheck.runtime.chipInspector.list().map(entry=>entry.id)),ids,'borrowed primary does not allocate');
      if(dual)await mix(page,'pokey:2',{muted:true});const baseline=await audible(page,'primary baseline',{hz:firstHz,mono:true});
      await mix(page,'pokey',{volume:.5});const half=await audible(page,'Mixer volume half',{hz:firstHz,mono:true});assert(Math.abs(half.channels[0].rms/baseline.channels[0].rms-.5)<.02,'Mixer volume applied once');
      await mix(page,'pokey',{volume:1,pan:-1});const left=await audible(page,'primary left pan',{hz:firstHz,side:0});await mix(page,'pokey',{muted:true});await silent(page,'individual Mixer mute');
      let second=null;
      if(dual){await mix(page,'pokey:2',{muted:false,pan:1});const state=await read(page,'pokey:2');second=await audible(page,'second POKEY independent right pan',{hz:state.channels[0].frequency,side:1});await mix(page,'pokey:2',{pan:0});}
      await mix(page,'pokey',{muted:false,pan:0});await stop(page,ids);const keys=await keyboard(page,ids);
      await runSource(page,"console.log('POKEY_STOP_RERUN');",execution);await silent(page,'Stop followed by empty rerun');await stop(page,ids);
      executions.push({execution,starter:starterPcm,baseline,half,left,second,keyboard:keys,stopRerunSilent:true});
    }
    assert.deepEqual(errors,[],'browser runtime errors');assert.deepEqual(missing,[],'missing runtime assets');
    return {browser:browserName,mode,clock,primary,starter,executions,physicalOutputMuted:true};
  }finally{await page.close();}
}

async function checkExtras(browser,base,browserName){
  const executions=[];
  for(const execution of ['main','worker']){
    const {page,errors,missing}=await readyPage(browser,base,'genesis');
    try{
      console.log(`CHECK ${browserName}: Genesis two additional POKEYs (${execution})`);
      await runSource(page,`const a=await createSoundChip('pokey',{id:'pokey:extra-a'});
        const b=await createSoundChip('pokey',{id:'pokey:extra-b',clock:1789773});
        for(const chip of [a,b]){chip.initialize();chip.setVolume(0,8);chip.noteOn(0,'A4');}
        liveLoop('extra-voices',async()=>{await sleep(60);});
        liveLoop('dispose-first',async()=>{await sleep(1.5);await a.dispose();await sleep(60);});`,execution);
      await page.waitForFunction(()=>window.__pokeyCheck.megaDrive.isReady());await installCapture(page);
      await until(page,state=>state?.channels[0].active,'extra A active','pokey:extra-a');await until(page,state=>state?.channels[0].active,'extra B active','pokey:extra-b');
      const initial=await audible(page,'two additional POKEYs');
      await page.waitForFunction(()=>!window.__pokeyCheck.runtime.chipInspector.list().some(entry=>entry.id==='pokey:extra-a'));
      const survivor=await read(page,'pokey:extra-b');assert(survivor.channels[0].active);assert.equal(survivor.clock,1789773);const pcm=await audible(page,'second POKEY survives first disposal',{hz:survivor.channels[0].frequency,mono:true});
      const strips=await page.evaluate(()=>window.__pokeyCheck.megaDrive.mixer.list().filter(entry=>entry.connected).map(entry=>entry.id));assert(strips.includes('pokey:extra-b'));assert(!strips.includes('pokey:extra-a'));
      await mix(page,'pokey:extra-b',{muted:true});await silent(page,'surviving extra Mixer mute');await mix(page,'pokey:extra-b',{muted:false});await audible(page,'surviving extra unmute');await stop(page,[]);
      assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);executions.push({execution,initial,survivor:pcm,independentDisposal:true,independentMixer:true,stopped:true});
    }finally{await page.close();}
  }
  return {browser:browserName,additionalInGenesis:executions,physicalOutputMuted:true};
}

(async()=>{
  try{
    const nested=await fs.stat(path.join(config.docs,'playground/index.html')).then(()=>true,()=>false);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const base=`http://127.0.0.1:${server.address().port}/${nested?'playground/':''}index.html`;
    for(const name of [...new Set(config.engines)]){
      const browser=await ({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});
      try{for(const mode of ['pokey','pokey-dual'])results.push(await checkMode(browser,base,name,mode));results.push(await checkExtras(browser,base,name));}finally{await browser.close();}
    }
    const report={schemaVersion:1,passed:true,docsDirectory:config.docs,physicalOutputMuted:true,results,sources:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),checkerSha256:sha(await fs.readFile(__filename))};await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(`PASS POKEY Playground: ${results.length} browser/mode routes; ${served.size} hashed runtime assets; ${config.out}`);
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

