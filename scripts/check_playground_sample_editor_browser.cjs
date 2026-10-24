// Real module Worker, Web Audio decode/preview and non-destructive asset roundtrip.
// Microphone tests use a generated MediaStream; no physical device is accessed.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium,webkit} = require('playwright');
const docs = path.resolve(__dirname,'../docs');
const fixture = `<!doctype html><link rel="stylesheet" href="/playground/playground_sample_editor.css"><button id="launch">Open</button>
<script type="module">
import {createPlaygroundAudioInput} from '/playground/playground_audio_input.js';
import {decodeSampleWav} from '/js/playground_sample_edit.js';
let context, provider, abort, heldPitch, heldRender, delayPitch = false, delayRender = false;
const assets = new Map();
window.test = {
  assets, result:null, error:null, captures:0, stopped:0,
  async context() {if(!context){context=new AudioContext();const create=context.createBufferSource.bind(context);context.createBufferSource=()=>{const node=create();test.previewNode=node;return node;};} await context.resume(); return context;},
  initialize(target='rf5c164',native=false) {
    test.nativePreviews=0;test.nativeStops=0;test.nativeContextCalls=0;test.nativeDecode=0;
    provider = createPlaygroundAudioInput({defaultTarget:target,
      getAudioContext:()=>{if(native){test.nativeContextCalls++;throw Error('Native must not request live AudioContext');}return test.context();},
      ...(native?{decodeAudio:async bytes=>{test.nativeDecode++;return decodeSampleWav(bytes);},playPreview:async(rendered,{signal})=>{
        test.nativePreviews++;test.nativePreviewSignal=signal;const result={stop(){test.nativeStops++;}};
        if(test.deferPreview)return new Promise(resolve=>test.releasePreview=()=>resolve(result));return result;
      }}:{}),
      loadAsset:async path=>assets.get(path)??null,
      saveAsset:async asset=>{assets.set(asset.path,asset);return {path:asset.path};},
      mediaDevices:{getUserMedia:async()=>{
        test.captures++; const ctx=await test.context(), oscillator=ctx.createOscillator(), dest=ctx.createMediaStreamDestination();
        oscillator.connect(dest); oscillator.start(); const stream=dest.stream, tracks=stream.getTracks();
        // WebKit may return a fresh JS wrapper per getTracks() call.
        Object.defineProperty(stream,'getTracks',{value:()=>tracks});
        for(const track of tracks){const stop=track.stop.bind(track);let ended=false;track.stop=()=>{if(!ended){ended=true;test.stopped++;oscillator.stop();}stop();};}
        if(test.deferMic)return new Promise(resolve=>{test.releaseMic=()=>resolve(stream);});return stream;
      }},
      workerFactory:()=>{
        const real=new Worker('/playground/playground_sample_editor_worker.js',{type:'module'}), commands=new Map();
        const proxy={postMessage(data){commands.set(data.id,data.command);real.postMessage(data);},terminate(){real.terminate();},onmessage:null,onerror:null};
        real.onmessage=event=>{if(delayPitch&&commands.get(event.data.id)==='pitch')heldPitch=()=>proxy.onmessage?.(event);else if(delayRender&&commands.get(event.data.id)==='render')heldRender=()=>proxy.onmessage?.(event);else proxy.onmessage?.(event);};
        real.onerror=event=>proxy.onerror?.(event);return proxy;
      }
    });
  },
  begin(options={}) {test.result=null;test.error=null;abort=new AbortController();test.promise=provider(options,{signal:abort.signal}).then(value=>test.result=value,error=>{test.error=error.name+': '+error.message;});},
  abort(){abort.abort();},
  holdPitch(){delayPitch=true;},
  releasePitch(){delayPitch=false;heldPitch?.();heldPitch=null;},
  hasPitch(){return !!heldPitch;},
  stopPreview(){provider._stopPreview();},
  holdRender(){delayRender=true;},releaseRender(){delayRender=false;heldRender?.();heldRender=null;},hasRender(){return !!heldRender;},
  async saved(){const a=assets.get('/samples/sampler.sample.json');const original=await decodeSampleWav(a.wav);return {settings:a.settings,frames:original.channels[0].length,rate:original.sampleRate,name:a.name};}
};
test.initialize();document.querySelector('#launch').onclick=()=>test.begin();
</script>`;
const mime={'.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.html':'text/html','.json':'application/json'};
const server=http.createServer(async(req,res)=>{try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname==='/sample-test.html'){res.setHeader('Content-Type','text/html');res.end(fixture);return;}
  const file=path.resolve(docs,'.'+pathname);if(!file.startsWith(docs+path.sep))throw Error('path');
  res.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');res.end(await fs.readFile(file));
}catch(error){res.writeHead(404).end(error.message);}});
function waveFile(seconds=8,stereo=false){
  const rate=16000,frames=rate*seconds,channels=stereo?2:1,b=Buffer.alloc(44+frames*2*channels);
  b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(channels,22);
  b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2*channels,28);b.writeUInt16LE(2*channels,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(frames*2*channels,40);
  for(let i=0;i<frames;i++){const value=Math.round(.25*Math.sin(2*Math.PI*440*i/rate)*32767);b.writeInt16LE(value,44+i*2*channels);if(stereo)b.writeInt16LE(-value,46+i*2*channels);}return b;
}
async function check(name,type,base){
  const browser=await type.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}:{})});
  const page=await browser.newPage({viewport:{width:1180,height:980}}), errors=[];
  page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  const dialog=page.locator('dialog[data-audio-input]'), field=key=>dialog.locator(`[data-field="${key}"]`), action=key=>dialog.locator(`[data-action="${key}"]`), audio=key=>dialog.locator(`[data-audio-action="${key}"]`);
  const begin=async options=>{await page.evaluate(options=>test.begin(options),options);await dialog.waitFor({state:'visible'});};
  const change=async(key,value)=>{await field(key).fill(String(value));await field(key).dispatchEvent('change');};
  const upload=async()=>{await dialog.locator('[data-audio-file]').setInputFiles({name:'A4-eight-seconds.wav',mimeType:'audio/wav',buffer:waveFile()});await audio('use').filter({visible:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('[data-audio-action="use"]').disabled);};
  try{
    await page.goto(base+'/sample-test.html');await page.waitForFunction(()=>window.test);
    await page.locator('#launch').click();await dialog.waitFor({state:'visible'});await upload();
    assert.equal(Number(await field('endFrame').inputValue()),3,'initial selection is bounded, full source is retained');
    const selection=await dialog.locator('canvas').boundingBox();
    await page.mouse.move(selection.x+selection.width*.7,selection.y+80);await page.mouse.down();
    await page.mouse.move(selection.x+selection.width*.5,selection.y+80);await page.mouse.move(selection.x+selection.width*.6,selection.y+80);await page.mouse.up();
    assert(Math.abs(Number(await field('startFrame').inputValue())-4.8)<.03,'leftward drag remains anchored after reversing direction');
    assert(Math.abs(Number(await field('endFrame').inputValue())-5.6)<.03);
    await change('startFrame',1);await change('endFrame',2);await change('gainDb',6);
    await action('undo').click();assert.equal(Number(await field('gainDb').inputValue()),0);
    await action('redo').click();assert.equal(Number(await field('gainDb').inputValue()),6);
    await change('loopStartFrame',1);await change('loopEndFrame',2);
    await field('loopEnabled').check();await field('loopEnabled').dispatchEvent('change');await action('zoom').click();
    const marker=await dialog.locator('canvas').boundingBox();
    await page.mouse.move(marker.x+1,marker.y+marker.height*26/220);await page.mouse.down();await page.mouse.move(marker.x+marker.width*.25,marker.y+marker.height*26/220);await page.mouse.up();
    assert.equal(Number(await field('startFrame').inputValue()),1,'loop label moves the loop instead of the coincident selection marker');
    assert(Math.abs(Number(await field('loopStartFrame').inputValue())-1.25)<.02);
    await field('loopEnabled').uncheck();await field('loopEnabled').dispatchEvent('change');await action('full').click();
    await change('fadeInSeconds',7);await change('fadeOutSeconds',9);
    await action('pitch').click();await page.waitForFunction(()=>!document.querySelector('[data-action="apply-pitch"]').disabled);
    assert.match(await dialog.locator('[data-pitch]').textContent(),/A4.*440/);
    await action('apply-pitch').click();assert.equal(await field('rootMidi').inputValue(),'69');
    await action('normalize').click();await page.waitForFunction(()=>Number(document.querySelector('[data-field="gainDb"]').value)>10);
    await action('preview').click();await page.waitForFunction(()=>document.querySelector('[data-audio-input-status]').textContent.includes('Preview · peak'));
    await action('silence').click();await page.screenshot({path:`/private/tmp/sample-editor-${name}.png`});
    await audio('use').click();await dialog.waitFor({state:'detached'});await page.waitForFunction(()=>test.result!==null);
    const result=await page.evaluate(()=>({frames:test.result.channels[0].length,rate:test.result.sampleRate,rootMidi:test.result.rootMidi,peak:test.result.peakBeforeClip}));
    assert.equal(result.frames,16000);assert.equal(result.rate,16000);assert.equal(result.rootMidi,69);assert(result.peak<=.951);
    const saved=await page.evaluate(()=>test.saved());assert.equal(saved.frames,saved.rate*8,'original full eight-second PCM roundtrips');
    assert.equal(saved.settings.startFrame,saved.rate);assert.equal(saved.settings.endFrame,saved.rate*2);
    await page.evaluate(()=>test.begin({asset:'/samples/sampler.sample.json',edit:false}));await page.waitForFunction(()=>test.result!==null);
    assert.equal(await dialog.count(),0,'saved sampler runs without an input dialog');
    await begin({asset:'/samples/sampler.sample.json'});assert.equal(Number(await field('startFrame').inputValue()),1);
    await page.evaluate(()=>test.holdPitch());await action('pitch').click();await page.waitForFunction(()=>test.hasPitch());
    await change('endFrame',2.5);await page.evaluate(()=>test.releasePitch());assert.equal(await action('apply-pitch').isDisabled(),true,'stale pitch does not overwrite a new selection');
    await change('endFrame',8);await audio('use').click();await page.waitForFunction(()=>document.querySelector('[data-audio-input-status]').dataset.error==='true');
    assert.match(await dialog.locator('[data-audio-input-status]').textContent(),/65504|capacity|frames/i);assert.equal(await dialog.isVisible(),true,'over-capacity input is not truncated');
    await audio('cancel').click();await dialog.waitFor({state:'detached'});
    await page.evaluate(()=>test.initialize('gameboy-wave'));await begin();await action('new-wave').click();await page.waitForFunction(()=>!document.querySelector('[data-audio-action="use"]').disabled);
    await action('zoom').click();const box=await dialog.locator('canvas').boundingBox();
    await page.mouse.move(box.x+box.width*.2,box.y+box.height*.3);await page.mouse.down();await page.mouse.move(box.x+box.width*.5,box.y+box.height*.8,{steps:8});await page.mouse.up();
    await audio('use').click();await dialog.waitFor({state:'detached'});await page.waitForFunction(()=>test.result!==null);
    const wave=await page.evaluate(()=>Array.from(test.result.waveform));assert.equal(wave.length,32);assert(wave.every(x=>x>=0&&x<=15));
    assert((await page.evaluate(()=>test.saved())).settings.drawStrokes.length>0,'hand drawing is preserved in the asset');
    await begin();await audio('record').click();await audio('stop').waitFor({state:'visible'});
    assert.equal(await field('gainDb').isDisabled(),true,'editing cannot invalidate an active recording');
    await page.waitForTimeout(350);await audio('stop').click();await page.waitForFunction(()=>!document.querySelector('[data-audio-action="use"]').disabled);
    await audio('cancel').click();await page.waitForFunction(()=>test.captures===test.stopped);
    await page.evaluate(()=>test.deferMic=true);await begin();await audio('record').click();await page.waitForFunction(()=>test.releaseMic);
    await audio('cancel').click();await page.evaluate(()=>test.releaseMic());await page.waitForFunction(()=>test.captures===test.stopped);
    await begin();await page.evaluate(()=>test.abort());await dialog.waitFor({state:'detached'});assert.match(await page.evaluate(()=>test.error),/^AbortError/);
    await page.setViewportSize({width:390,height:844});await begin({asset:'/samples/sampler.sample.json'});
    const bounds=await dialog.boundingBox();assert(bounds.x>=0&&bounds.width<=390,'editor fits a narrow viewport');await audio('cancel').click();
    await page.setViewportSize({width:1180,height:980});await page.evaluate(()=>test.initialize('rf5c164'));await begin();await action('new-wave').click();await page.waitForFunction(()=>!document.querySelector('[data-audio-action="use"]').disabled);
    await field('target').selectOption('gameboy-wave');assert(await field('rate').isDisabled(),'Game Boy has a fixed 32-point wave');
    await audio('use').click();await dialog.waitFor({state:'detached'});
    await page.evaluate(()=>test.begin({asset:'/samples/sampler.sample.json',edit:false}));await page.waitForFunction(()=>test.result!==null);assert.equal(await page.evaluate(()=>test.result.target),'gameboy-wave','manual target survives rerun within the mode family');
    await begin({asset:'/samples/sampler.sample.json',target:'adpcm-b'});assert.equal(await field('target').inputValue(),'adpcm-b','chip editor can select ADPCM even when the saved asset or mode defaults to another converter');
    await audio('cancel').click();await dialog.waitFor({state:'detached'});
    await page.evaluate(()=>{test.initialize('adpcm-b');test.begin({asset:'/samples/sampler.sample.json',edit:false});});await page.waitForFunction(()=>test.result!==null);assert.equal(await page.evaluate(()=>test.result.target),'adpcm-b','a different mode uses its own target for the same source');
    await begin();await dialog.locator('[data-audio-file]').setInputFiles({name:'stereo.wav',mimeType:'audio/wav',buffer:waveFile(1,true)});await page.waitForFunction(()=>!document.querySelector('[data-audio-action="use"]').disabled);
    await action('preview-original').click();await page.waitForFunction(()=>document.querySelector('[data-audio-input-status]').textContent.includes('Preview · peak'));
    assert.equal(await page.evaluate(()=>test.previewNode.buffer.numberOfChannels),2,'original preview preserves stereo');await action('silence').click();await audio('cancel').click();
    await page.evaluate(()=>test.initialize('adpcm-b',true));await begin();await dialog.locator('[data-audio-file]').setInputFiles({name:'native.wav',mimeType:'audio/wav',buffer:waveFile(1)});await page.waitForFunction(()=>!document.querySelector('[data-audio-action="use"]').disabled);
    assert.equal(await page.evaluate(()=>test.nativeDecode),1);assert.equal(await page.evaluate(()=>test.nativeContextCalls),0);
    await page.evaluate(()=>test.holdRender());await action('preview').click();await page.waitForFunction(()=>test.hasRender());await page.evaluate(()=>{test.stopPreview();test.releaseRender();});await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>test.nativePreviews),0,'Stop while Worker prepares a preview prevents later Native upload');
    await page.evaluate(()=>test.deferPreview=true);await action('preview').click();await page.waitForFunction(()=>test.releasePreview);await page.evaluate(()=>{test.stopPreview();test.releasePreview();test.deferPreview=false;});await page.waitForFunction(()=>test.nativeStops===1);assert.equal(await page.evaluate(()=>test.nativePreviewSignal.aborted),true,'Stop aborts an accepted adapter request');
    await action('preview').click();await page.waitForFunction(()=>test.nativePreviews===2&&document.querySelector('[data-audio-input-status]').textContent.includes('Preview · peak'));await action('silence').click();await page.waitForFunction(()=>test.nativeStops===2);await audio('cancel').click();assert.equal(await page.evaluate(()=>test.nativeContextCalls),0);
    assert.deepEqual(errors,[]);console.log(JSON.stringify({browser:name,file:true,range:true,undo:true,pitch:true,staleAnalysis:true,preview:true,originalRoundtrip:true,capacity:true,draw:true,gameboy32:true,recording:true,latePermission:true,abort:true,narrow:true,nativeInjection:true,nativePreparedStop:true,nativePendingStop:true}));
  }catch(error){console.error({browser:name,errors,status:await dialog.textContent().catch(()=>null)});await page.screenshot({path:`/private/tmp/sample-editor-${name}-failure.png`}).catch(()=>{});throw error;}
  finally{await browser.close();}
}
(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{const base=`http://127.0.0.1:${server.address().port}`;
  if(!process.argv.includes('--webkit-only'))await check('chromium',chromium,base);
  if(process.argv.includes('--webkit')||process.argv.includes('--webkit-only'))await check('webkit',webkit,base);
}finally{await new Promise(resolve=>server.close(resolve));}})().catch(error=>{console.error(error);process.exitCode=1;});
