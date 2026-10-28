// Real module Worker + Game Boy APU WASM conversion/preview and sampler handoff.
// All Web Audio output is physically muted. Pass --webkit to include WebKit;
// --webkit-only runs WebKit alone and --host adds the full Playground route smoke.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {chromium, webkit} = require('playwright');

const docs = path.resolve(__dirname, '../docs');
const option=name=>{const arg=process.argv.find(value=>value.startsWith(name+'='));return arg?.slice(name.length+1);};
const images=path.resolve(option('--images')??os.tmpdir()), out=option('--out'), zip=option('--zip');
const reports=[];
const report=value=>{reports.push(value);console.log(JSON.stringify(value));};
const screenshot=name=>path.join(images,'gameboy-sample-editor-'+name+'.png');
let packagedRoot=null;
const fixture = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/playground/playground_sample_editor.css"><button id="launch">Open</button>
<script type="module">
import {createPlaygroundAudioInput} from '/playground/playground_audio_input.js';
import {createSampleInstrument} from '/js/playground_sample_instrument.js';
import {GameboySynth} from '/js/gameboysynth.js';
import {GameboyApu} from '/js/gameboyapu.js';
import moduleFactory from '/generated/gameboy_apu_wasm.js';
let context, muted, provider, abort, hold = null;
const assets = new Map(), held = [];
function summary(channels) {
  let peak = 0, finite = true, sum = 0, squares = 0, count = 0;
  for (const channel of channels) for (const value of channel) {finite &&= Number.isFinite(value); peak = Math.max(peak, Math.abs(value));sum+=value;squares+=value*value;count++;}
  const mean=sum/count;
  return {channels:channels.length, frames:channels[0]?.length, finite, peak,mean,rms:Math.sqrt(squares/count),acRms:Math.sqrt(Math.max(0,squares/count-mean*mean))};
}
window.test = {
  assets, result:null, error:null, jobs:[], requests:[], starts:[], stops:0, ended:0,
  async context() {
    if (!context) {
      context = new AudioContext({sampleRate:44100}); muted = context.createGain(); muted.gain.value = 0; muted.connect(context.destination);
      const create = context.createBufferSource.bind(context);
      context.createBufferSource = () => {
        const node = create(), start = node.start.bind(node), stop = node.stop.bind(node);
        node.start = (...args) => {test.starts.push({...summary(Array.from({length:node.buffer.numberOfChannels},(_,ch)=>node.buffer.getChannelData(ch))), rate:node.buffer.sampleRate, loop:node.loop, pcm:Array.from(node.buffer.getChannelData(0))}); return start(...args);};
        node.stop = (...args) => {test.stops++; return stop(...args);};
        node.addEventListener('ended',()=>test.ended++); return node;
      };
    }
    await context.resume(); return context;
  },
  initialize(adapter = false) {
    test.adapterCalls=0;test.adapterStops=0;test.adapterSignals=[];
    provider = createPlaygroundAudioInput({defaultTarget:'gameboy-wave',
      getAudioContext:()=>test.context(), getPreviewDestination:()=>muted,
      ...(adapter ? {playPreview:async(rendered,{signal})=>{
        test.adapterCalls++;test.adapterSignals.push(signal);test.adapterPCM=summary(rendered.channels);
        const entry={stop(){test.adapterStops++;}};
        if(test.deferAdapter)return new Promise(resolve=>test.releaseAdapter=()=>resolve(entry));return entry;
      }} : {}),
      loadAsset:async path=>assets.get(path)??null,
      saveAsset:async asset=>{assets.set(asset.path,asset);return {path:asset.path};},
      workerFactory:()=>{
        const real = new Worker('/playground/playground_sample_editor_worker.js',{type:'module'}), jobs = new Map();
        const proxy = {postMessage(data){jobs.set(data.id,data);test.requests.push({id:data.id,command:data.command,target:data.options?.target});real.postMessage(data);},terminate(){real.terminate();},onmessage:null,onerror:null};
        real.onmessage=event=>{
          const request = jobs.get(event.data.id), value = event.data.value;
          test.jobs.push({id:event.data.id,command:request.command,target:request.options?.target,error:event.data.error,
            settings:request.settings,waveform:value?.waveform?Array.from(value.waveform):null,pcm:value?.channels?summary(value.channels):null});
          const deliver=()=>proxy.onmessage?.(event);
          if(hold && request.command===hold.command && (!hold.target || request.options?.target===hold.target)) held.push(deliver); else deliver();
        };
        real.onerror=event=>proxy.onerror?.(event);return proxy;
      }
    });
  },
  begin(options={}) {test.result=null;test.error=null;abort=new AbortController();test.promise=provider(options,{signal:abort.signal}).then(value=>test.result=value,error=>{test.error=error.name+': '+error.message;});},
  abort(){abort.abort();}, stopPreview(){provider._stopPreview();},
  hold(command,target){hold={command,target};},held(){return held.length;},
  unhold(){hold=null;},
  release(){hold=null;while(held.length)held.shift()();},
  observeDisplay(){
    test.displayTransitions=[];test.displayObserver?.disconnect();
    test.displayObserver=new MutationObserver(()=>{
      const values=(document.querySelector('[data-gameboy-values]')?.textContent.match(/\\d+/g)??[]).map(Number);
      if(values.length===32)test.displayTransitions.push(values);
    });test.displayObserver.observe(document.body,{subtree:true,childList:true,characterData:true});
  },
  async instrument() {
    const chip = await GameboyApu.create({moduleFactory,sampleRate:44100});
    const writes = [], gameboy = new GameboySynth({transport:{writeRegister(offset,value){writes.push([offset,value]);chip.writeRegister(offset,value);},reset(){chip.reset();}}});
    try {
      gameboy.initialize(); writes.length=0;
      const instrument = await createSampleInstrument({pg:{gameboy},audio:test.result,chip:'gameboy'});
      const ram=writes.filter(([offset])=>offset>=32&&offset<48).slice(-16).flatMap(([,value])=>[value>>4,value&15]);
      await instrument.noteOn({id:'test',midi:60,velocity:127});
      const pcm=chip.generateStereo(8192), sounding=summary([pcm.left,pcm.right]);
      await instrument.allNotesOff();chip.generateStereo(8192);const stopped=chip.generateStereo(2048);
      return {name:instrument.name,ram,sounding,stopped:summary([stopped.left,stopped.right])};
    } finally {gameboy.dispose();chip.dispose();}
  }
};
test.initialize();document.querySelector('#launch').onclick=()=>test.begin();
</script>`;
const accessor = '\nwindow.__gameboySampleHost={runtime,megaDrive,virtualFiles,openSampleEditor,inputAudio,stopRun,changePlaygroundAudioEngine};';
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml'};
const server = http.createServer(async (request,response) => {
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(pathname==='/gameboy-sample-test.html'){response.setHeader('Content-Type','text/html');response.end(fixture);return;}
    const packaged=pathname.startsWith('/__package/');
    const root=packaged?packagedRoot:docs;
    if(!root)throw Error('No package is mounted');
    let file=path.resolve(root,'.'+(packaged?pathname.slice('/__package'.length):pathname));
    if(!file.startsWith(root+path.sep))throw Error('Invalid path');
    if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');
    let body=await fs.readFile(file);
    if(!packaged&&pathname.endsWith('/playground.js'))body=Buffer.from(body.toString()+accessor);
    response.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');response.end(body);
  } catch(error) {response.writeHead(404).end(error.message);}
});

function waveFile(variant=0) {
  const rate=16000,frames=256,bytes=Buffer.alloc(44+frames*2);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(frames*2,40);
  for(let i=0;i<frames;i++)bytes.writeInt16LE(Math.round(32767*(variant?(i<frames/3?.6:-.3):.7*Math.sin(2*Math.PI*i/frames))),44+i*2);
  return bytes;
}

function controls(page) {
  const dialog=page.locator('dialog[data-audio-input]');
  return {dialog,field:key=>dialog.locator('[data-field="'+key+'"]'),action:key=>dialog.locator('[data-action="'+key+'"]'),audio:key=>dialog.locator('[data-audio-action="'+key+'"]')};
}

async function installPhysicalMute(page) {
  await page.addInitScript(()=>{
    if(window.__sampleHostAudio)return;
    window.__sampleHostAudio={starts:[],stops:0};
    const connect=AudioNode.prototype.connect, muted=new WeakMap();
    AudioNode.prototype.connect=function(destination,...args){
      if(destination instanceof AudioDestinationNode){
        let gain=muted.get(this.context);
        if(!gain){gain=this.context.createGain();gain.gain.value=0;connect.call(gain,destination);muted.set(this.context,gain);}
        return connect.call(this,gain,...args);
      }
      return connect.call(this,destination,...args);
    };
    const start=AudioBufferSourceNode.prototype.start,stop=AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start=function(...args){
      let peak=0,finite=true;
      if(this.buffer)for(let ch=0;ch<this.buffer.numberOfChannels;ch++)for(const sample of this.buffer.getChannelData(ch)){finite&&=Number.isFinite(sample);peak=Math.max(peak,Math.abs(sample));}
      __sampleHostAudio.starts.push({peak,finite});return start.apply(this,args);
    };
    AudioBufferSourceNode.prototype.stop=function(...args){__sampleHostAudio.stops++;return stop.apply(this,args);};
  });
}

async function checkHost(page,browserName,base,errors) {
  await installPhysicalMute(page);
  await page.goto(base+'/playground/?mode=gameboy&no-sw=1');
  await page.waitForFunction(()=>window.__gameboySampleHost&&window.monaco?.editor?.getEditors().length);
  await page.locator('#startupNotice').waitFor({state:'hidden'});
  const {dialog,action,audio}=controls(page);
  const open=async()=>{
    await page.locator('#mainMenu > summary').click();await page.locator('#sampleEditorButton').click();
    await dialog.waitFor({state:'visible'});
  };
  const wave=async()=>{
    await page.waitForFunction(()=>{
      const status=document.querySelector('[data-gameboy-status]')?.textContent;
      const values=(document.querySelector('[data-gameboy-values]')?.textContent.match(/\d+/g)??[]);
      return values.length===32&&!/preparing|converting|choose/i.test(status??'');
    });
    return dialog.locator('[data-gameboy-values]').textContent().then(text=>text.match(/\d+/g).map(Number));
  };
  await open();await action('new-wave').click();const savedWave=await wave();
  const before=await page.evaluate(()=>__sampleHostAudio.starts.length);await action('preview-gameboy').click();
  await page.waitForFunction(count=>__sampleHostAudio.starts.length>count,before);
  const preview=await page.evaluate(()=>__sampleHostAudio.starts.at(-1));assert(preview.finite&&preview.peak>.0001);
  const stops=await page.evaluate(()=>__sampleHostAudio.stops);await page.evaluate(()=>__gameboySampleHost.stopRun());
  await page.waitForFunction(count=>__sampleHostAudio.stops>count,stops);
  await audio('use').click();await dialog.waitFor({state:'detached'});
  assert(await page.evaluate(()=>!!__gameboySampleHost.virtualFiles.get('/samples/sampler.sample.json')),'full Playground saves the source and edit manifest');
  await open();assert.deepEqual(await wave(),savedWave);await audio('cancel').click();
  await page.evaluate(async()=>{
    const host=__gameboySampleHost;window.__sampleHostWrites=[];
    host.megaDrive.addListener(event=>{if(event.method==='writeRegister')__sampleHostWrites.push(event.args);});
    await host.runtime.playSource("const audio=await inputAudio({asset:'/samples/sampler.sample.json',edit:false});keyboard.bind('sampler',await createSampleInstrument(audio));",{execution:'main'});
    const context=host.megaDrive.audioContext,analyser=context.createAnalyser(),silent=context.createGain();
    silent.gain.value=0;analyser.connect(silent);silent.connect(context.destination);
    window.__sampleHostMeter={analyser,silent,detach:host.megaDrive.audio.connectOutputMonitor(analyser),peak:0};
    __sampleHostMeter.timer=setInterval(()=>{const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);for(const value of samples)__sampleHostMeter.peak=Math.max(__sampleHostMeter.peak,Math.abs(value));},10);
  });
  const ram=await page.evaluate(()=>__sampleHostWrites.filter(([offset])=>offset>=32&&offset<48).slice(-16).flatMap(([,value])=>[value>>4,value&15]));
  assert.deepEqual(ram,savedWave,'full runtime sampler receives the exact comparison waveform');
  assert.equal(await page.evaluate(()=>__gameboySampleHost.runtime.getKeyboardTarget()?.name),'sampler');
  await page.locator('#keyboardTab').click();await page.locator('#keyboardPanel').waitFor({state:'visible'});
  await page.evaluate(()=>__gameboySampleHost.runtime.getKeyboardTarget().noteOn({id:'browser',midi:60,velocity:127}));
  await page.waitForFunction(()=>__sampleHostMeter.peak>.0001);
  const keyboardPeak=await page.evaluate(()=>__sampleHostMeter.peak);
  await page.evaluate(async()=>{
    await __gameboySampleHost.runtime.getKeyboardTarget().noteOff({id:'browser',midi:60});await __gameboySampleHost.stopRun();
    clearInterval(__sampleHostMeter.timer);__sampleHostMeter.detach();__sampleHostMeter.analyser.disconnect();__sampleHostMeter.silent.disconnect();
  });
  // The same-engine transition exercises the real backend invalidation, Stop,
  // project transfer and page lifecycle without requiring a Native IPC host.
  await open();await wave();const backendPreview=await page.evaluate(()=>__sampleHostAudio.starts.length);await action('preview-gameboy').click();
  await page.waitForFunction(count=>__sampleHostAudio.starts.length>count,backendPreview);
  await Promise.all([
    page.waitForURL(url=>url.searchParams.get('audioEngine')==='webaudio'||url.searchParams.has('modeProject')),
    page.evaluate(()=>{void __gameboySampleHost.changePlaygroundAudioEngine('webaudio');})
  ]);
  await page.waitForFunction(()=>window.__gameboySampleHost&&window.monaco?.editor?.getEditors().length);
  await page.locator('#startupNotice').waitFor({state:'hidden'});
  assert.equal(await dialog.count(),0,'backend reload leaves no old preview dialog');
  assert.deepEqual(errors,[]);
  report({browser:browserName,fullPlayground:true,saveReopen:true,samplerExactWave:true,keyboardPeak,stopPreview:true,backendChange:true,physicallyMuted:true,passed:true});
}

async function checkPackaged(page,browserName,base,errors) {
  await installPhysicalMute(page);
  const requested=[],failed=[];
  const requestListener=request=>requested.push(request.url());
  const responseListener=response=>{if(response.url().startsWith(base+'/__package/')&&!response.ok())failed.push({url:response.url(),status:response.status()});};
  page.context().on('request',requestListener);page.on('response',responseListener);
  try {
    await page.goto(base+'/__package/index.html?mode=gameboy&no-sw=1');
    await page.locator('#startupNotice').waitFor({state:'hidden'});
    await page.waitForFunction(()=>window.monaco?.editor?.getEditors().length);
    assert.equal(await page.evaluate(()=>typeof window.__gameboySampleHost),'undefined','the bundled smoke uses the public UI without appended accessors');
    const {dialog,action,audio}=controls(page);
    const open=async()=>{await page.locator('#mainMenu > summary').click();await page.locator('#sampleEditorButton').click();await dialog.waitFor({state:'visible'});};
    const wave=async()=>{
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.waitForFunction(()=>document.querySelector('[data-gameboy-values]')?.textContent.match(/\d+/g)?.length===32&&!document.querySelector('[data-action="preview-gameboy"]').disabled);
      return dialog.locator('[data-gameboy-values]').textContent().then(text=>text.match(/\d+/g).map(Number));
    };
    await open();await action('new-wave').click();await wave();await action('zoom').click();
    const bounds=await dialog.locator('[data-wave]').boundingBox();
    await page.mouse.move(bounds.x+bounds.width*.2,bounds.y+bounds.height*.2);await page.mouse.down();
    await page.mouse.move(bounds.x+bounds.width*.7,bounds.y+bounds.height*.8,{steps:8});await page.mouse.up();
    const values=await wave(),before=await page.evaluate(()=>__sampleHostAudio.starts.length);
    await action('preview-gameboy').click();await page.waitForFunction(count=>__sampleHostAudio.starts.length>count,before);
    const preview=await page.evaluate(()=>__sampleHostAudio.starts.at(-1));assert(preview.finite&&preview.peak>.0001,'the packaged actual Worker and WASM produce audible PCM');
    const stops=await page.evaluate(()=>__sampleHostAudio.stops);await action('silence-gameboy').click();
    await page.waitForFunction(count=>__sampleHostAudio.stops>count,stops);
    await page.setViewportSize({width:390,height:844});await dialog.locator('[data-gameboy-conversion]').scrollIntoViewIfNeeded();
    assert((await dialog.evaluate(node=>node.scrollWidth-node.clientWidth))<=1,'packaged editor fits the compact viewport');
    await page.screenshot({path:screenshot(browserName+'-packaged-compact')});
    await audio('use').click();await dialog.waitFor({state:'detached'});
    await page.setViewportSize({width:1180,height:980});await open();assert.deepEqual(await wave(),values,'package save and reopen retain the exact comparison');
    await audio('cancel').click();
    const required=['playground_sample_editor_worker.js','js/playground_sample_gameboy_preview.js','generated/gameboy_apu_wasm.wasm'];
    for(const asset of required)assert(requested.some(url=>new URL(url).pathname==='/__package/'+asset),'package actually loaded '+asset);
    const sourceFallback=requested.filter(url=>url.startsWith(base+'/')&&!url.startsWith(base+'/__package/')&&/\.(js|wasm)(\?|$)/.test(url));
    assert.deepEqual(sourceFallback,[],'package has no source-tree module fallback');assert.deepEqual(failed,[]);assert.deepEqual(errors,[]);
    report({browser:browserName,packagedZip:path.resolve(zip),publicUI:true,actualWorker:true,actualApuPreview:preview.peak,stop:true,saveReopen:true,compact:true,sourceFallback:false,passed:true});
  } catch(error) {await page.screenshot({path:screenshot(browserName+'-packaged-failure')}).catch(()=>{});throw error;}
  finally {page.context().off('request',requestListener);page.off('response',responseListener);}
}

async function check(browserName,type,base) {
  const browser=await type.launch({headless:true,...(browserName==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}:{})});
  const page=await browser.newPage({viewport:{width:1180,height:980}}), errors=[];
  page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  const {dialog,field,action,audio}=controls(page);
  const begin=async options=>{await page.evaluate(options=>test.begin(options),options);await dialog.waitFor({state:'visible'});};
  const change=async(key,value)=>{await field(key).fill(String(value));await field(key).dispatchEvent('change');};
  const upload=async variant=>{await dialog.locator('[data-audio-file]').setInputFiles({name:'one-cycle-'+variant+'.wav',mimeType:'audio/wav',buffer:waveFile(variant)});await page.waitForFunction(()=>!document.querySelector('[data-audio-action="use"]').disabled);};
  const wave=async()=>dialog.locator('[data-gameboy-values]').textContent().then(value=>(value.match(/\d+/g)??[]).map(Number));
  const currentWave=async()=>{
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.waitForFunction(()=>{
      const displayed=(document.querySelector('[data-gameboy-values]')?.textContent.match(/\d+/g)??[]).map(Number);
      const job=test.jobs.filter(job=>job.command==='gameboy-wave').at(-1);
      const requested=test.requests.filter(job=>job.command==='gameboy-wave').at(-1);
      return job?.id===requested?.id&&displayed.length===32&&JSON.stringify(displayed)===JSON.stringify(job?.waveform);
    });
    return wave();
  };
  const settled=async()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  try {
    await page.goto(base+'/gameboy-sample-test.html');await page.waitForFunction(()=>window.test);
    await page.locator('#launch').click();await dialog.waitFor({state:'visible'});
    await upload(0);
    await change('fadeInSeconds',0);await change('fadeOutSeconds',0);
    const initial=await currentWave();assert.equal(initial.length,32);assert(initial.every(value=>Number.isInteger(value)&&value>=0&&value<=15));
    assert.equal(await dialog.locator('[data-gameboy-conversion]').isVisible(),true);
    assert.equal(await dialog.locator('[data-gameboy-source]').isVisible(),true);
    assert.equal(await dialog.locator('[data-gameboy-wave]').isVisible(),true);
    assert.equal(await field('rate').isDisabled(),true,'Game Boy comparison accompanies the fixed-rate converter');
    await dialog.locator('[data-audio-file]').setInputFiles({name:'broken.wav',mimeType:'audio/wav',buffer:Buffer.from('invalid WAV source')});
    await page.waitForFunction(()=>document.querySelector('[data-audio-input-status]').dataset.error==='true');
    assert.deepEqual(await currentWave(),initial,'failed file decoding restores the previous valid comparison');
    assert.equal(await action('preview-gameboy').isDisabled(),false,'failed file decoding leaves the valid converted preview usable');

    await change('gainDb',-12);const quieter=await currentWave();assert.notDeepEqual(quieter,initial,'gain edits update wave RAM');
    await action('undo').click();assert.deepEqual(await currentWave(),initial,'Undo restores the converted wave');
    await action('redo').click();assert.deepEqual(await currentWave(),quieter,'Redo restores the converted wave');
    await action('undo').click();await currentWave();

    await page.evaluate(()=>test.hold('gameboy-wave'));await change('gainDb',-18);
    await page.waitForFunction(()=>test.held()>0);
    const staleWave=await page.evaluate(()=>test.jobs.filter(job=>job.command==='gameboy-wave').at(-1).waveform);
    await change('gainDb',3);await settled();assert.deepEqual(await wave(),[],'changing an edit clears a comparison that is no longer current');
    await page.evaluate(()=>{test.observeDisplay();test.release();});const current=await currentWave();
    assert.notDeepEqual(current,staleWave);
    assert(!(await page.evaluate(stale=>test.displayTransitions.some(value=>JSON.stringify(value)===JSON.stringify(stale)),staleWave)),'late comparison replies cannot flash the retired edit');
    await change('gainDb',0);await currentWave();

    await page.evaluate(()=>test.hold('gameboy-wave'));await change('gainDb',-24);
    await page.waitForFunction(()=>test.held()>0);const retiredSourceWave=await page.evaluate(()=>test.jobs.filter(job=>job.command==='gameboy-wave').at(-1).waveform);
    await upload(1);await change('fadeInSeconds',0);await change('fadeOutSeconds',0);
    await page.evaluate(()=>{test.observeDisplay();test.release();});const replacement=await currentWave();
    assert.notDeepEqual(replacement,retiredSourceWave);
    assert(!(await page.evaluate(stale=>test.displayTransitions.some(value=>JSON.stringify(value)===JSON.stringify(stale)),retiredSourceWave)),'a reply from the previous source cannot flash over its replacement');

    await action('new-wave').click();await page.waitForFunction(()=>!document.querySelector('[data-audio-action="use"]').disabled);
    const drawnBefore=await currentWave();await action('zoom').click();
    const bounds=await dialog.locator('[data-wave]').boundingBox();
    await page.mouse.move(bounds.x+bounds.width*.1,bounds.y+bounds.height*.15);await page.mouse.down();
    await page.mouse.move(bounds.x+bounds.width*.8,bounds.y+bounds.height*.85,{steps:12});await page.mouse.up();
    const drawn=await currentWave();assert.notDeepEqual(drawn,drawnBefore,'drawn edits update converted values');
    await action('undo').click();assert.deepEqual(await currentWave(),drawnBefore);
    await action('redo').click();assert.deepEqual(await currentWave(),drawn);

    const previewStart=await page.evaluate(()=>test.starts.length);
    await action('preview-gameboy').click();await page.waitForFunction(count=>test.starts.length>count,previewStart);
    const preview=await page.evaluate(()=>test.starts.at(-1));
    assert(preview.finite&&preview.peak>.0001,'converted preview contains finite audible PCM from the Game Boy APU');
    assert.equal(preview.channels,2);assert(preview.frames/preview.rate>.1&&preview.frames/preview.rate<=2,'chip preview stays bounded');
    const previewJob=await page.evaluate(()=>test.jobs.filter(job=>job.command==='gameboy-preview').at(-1));
    assert.deepEqual(previewJob.waveform,drawn,'chip preview uses exactly the displayed wave RAM');
    assert(previewJob.pcm.finite&&previewJob.pcm.peak>.0001);
    const stops=await page.evaluate(()=>test.stops);await action('silence').click();
    await page.waitForFunction(count=>test.stops>count,stops);

    for(const [reason,cancel] of [['stop',async()=>action('silence').click()],['edit',async()=>change('gainDb',-6)],['target',async()=>field('target').selectOption('rf5c164')]]) {
      const before=await page.evaluate(()=>test.starts.length);
      await page.evaluate(()=>test.hold('gameboy-preview'));await action('preview-gameboy').click();
      await page.waitForFunction(()=>test.held()>0);await cancel();await page.evaluate(()=>test.release());await settled();
      assert.equal(await page.evaluate(()=>test.starts.length),before,reason+' cancels a prepared chip preview before playback');
      if(reason==='target'){
        assert.equal(await dialog.locator('[data-gameboy-conversion]').isVisible(),false,'comparison hides for another target');
        await field('target').selectOption('gameboy-wave');
      }
      await currentWave();
    }
    await change('gainDb',0);const savedWave=await currentWave();
    await page.setViewportSize({width:390,height:844});
    await dialog.locator('[data-gameboy-conversion]').scrollIntoViewIfNeeded();
    const compact=await dialog.boundingBox();assert(compact.x>=0&&compact.width<=390,'comparison editor fits a compact viewport');
    const dialogOverflow=await dialog.evaluate(node=>node.scrollWidth-node.clientWidth);
    assert(dialogOverflow<=1,'full editor has no horizontal scrolling: '+dialogOverflow+'px');
    const comparisonLayout=await dialog.locator('[data-gameboy-conversion]').evaluate(node=>{
      const edge=node.getBoundingClientRect().right;
      return {overflow:node.scrollWidth-node.clientWidth,canvasOverflow:Math.max(...Array.from(node.querySelectorAll('canvas'),canvas=>canvas.getBoundingClientRect().right-edge))};
    });
    assert(comparisonLayout.overflow<=1&&comparisonLayout.canvasOverflow<=0,'comparison and its canvases fit without horizontal scrolling');
    await page.screenshot({path:screenshot(browserName+'-compact')});
    await audio('use').click();await dialog.waitFor({state:'detached'});await page.waitForFunction(()=>test.result!==null);
    assert.deepEqual(await page.evaluate(()=>Array.from(test.result.waveform)),savedWave,'Use audio matches every displayed wave sample');
    assert((await page.evaluate(()=>test.assets.get('/samples/sampler.sample.json').settings.drawStrokes.length))>0,'saved source keeps drawn edits');
    const instrument=await page.evaluate(()=>test.instrument());
    assert.deepEqual(instrument.ram,savedWave,'createSampleInstrument uploads the displayed waveform into real wave RAM');
    assert(instrument.sounding.finite&&instrument.sounding.peak>.0001);
    assert(instrument.stopped.finite&&instrument.stopped.peak<instrument.sounding.peak*.001&&instrument.stopped.acRms<instrument.sounding.acRms*.001,'allNotesOff settles to a quiet APU tail');
    await page.evaluate(()=>test.begin({asset:'/samples/sampler.sample.json',edit:false}));await page.waitForFunction(()=>test.result!==null);
    assert.equal(await dialog.count(),0);assert.deepEqual(await page.evaluate(()=>Array.from(test.result.waveform)),savedWave,'saved rerun retains exactly the displayed waveform');
    await begin({asset:'/samples/sampler.sample.json'});assert.deepEqual(await currentWave(),savedWave,'reopening the saved source reproduces the comparison');

    await page.evaluate(()=>test.hold('gameboy-preview'));await action('preview-gameboy').click();await page.waitForFunction(()=>test.held()>0);
    const cancelledStarts=await page.evaluate(()=>test.starts.length);await audio('cancel').click();await page.evaluate(()=>test.release());await settled();
    assert.equal(await page.evaluate(()=>test.starts.length),cancelledStarts,'closing the editor cancels late converted audio');
    await page.setViewportSize({width:1180,height:980});
    await page.evaluate(()=>test.initialize(true));await begin({asset:'/samples/sampler.sample.json'});await currentWave();
    await page.evaluate(()=>test.deferAdapter=true);await action('preview-gameboy').click();await page.waitForFunction(()=>test.releaseAdapter);
    await page.evaluate(()=>{test.stopPreview();test.releaseAdapter();test.deferAdapter=false;});
    await page.waitForFunction(()=>test.adapterStops===1);
    assert.equal(await page.evaluate(()=>test.adapterSignals[0].aborted),true,'backend Stop aborts a pending injected preview');
    assert(await page.evaluate(()=>test.adapterPCM.finite&&test.adapterPCM.peak>.0001),'the Native adapter receives actual Game Boy APU PCM');
    await action('preview-gameboy').click();await page.waitForFunction(()=>test.adapterCalls===2);
    await page.evaluate(()=>test.abort());await dialog.waitFor({state:'detached'});await page.waitForFunction(()=>test.adapterStops===2);
    assert.match(await page.evaluate(()=>test.error),/^AbortError/,'backend/editor invalidation aborts the active session');
    assert.deepEqual(errors,[]);
    report({browser:browserName,comparison32:true,decodeFailureRecovery:true,editUndoRedo:true,draw:true,newSource:true,staleComparison:true,realApuPreview:preview.peak,stalePreview:true,saveReopen:true,samplerRam:true,noteOn:instrument.sounding,noteOff:instrument.stopped,nativePCM:true,nativePendingStop:true,compact:true,dialogOverflow,passed:true});
    if(process.argv.includes('--host'))await checkHost(page,browserName,base,errors);
    if(packagedRoot)await checkPackaged(page,browserName,base,errors);
  } catch(error) {
    console.error({browser:browserName,errors,status:await dialog.textContent().catch(()=>null)});
    await page.screenshot({path:screenshot(browserName+'-failure')}).catch(()=>{});throw error;
  } finally {await browser.close();}
}

(async()=>{
  await fs.mkdir(images,{recursive:true});
  if(zip){packagedRoot=await fs.mkdtemp(path.join(os.tmpdir(),'gameboy-sample-package-'));await promisify(execFile)('unzip',['-q',path.resolve(zip),'-d',packagedRoot]);}
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let passed=false;
  try {
    const base='http://127.0.0.1:'+server.address().port;
    if(!process.argv.includes('--webkit-only'))await check('chromium',chromium,base);
    if(process.argv.includes('--webkit')||process.argv.includes('--webkit-only'))await check('webkit',webkit,base);
    passed=true;
  } finally {
    await new Promise(resolve=>server.close(resolve));
    if(out){await fs.mkdir(path.dirname(path.resolve(out)),{recursive:true});await fs.writeFile(path.resolve(out),JSON.stringify({passed,reports},null,2)+'\n');}
    if(packagedRoot)await fs.rm(packagedRoot,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
