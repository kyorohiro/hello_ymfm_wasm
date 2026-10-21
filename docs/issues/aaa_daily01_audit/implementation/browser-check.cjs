// Correctness diagnostic: current docs runtime versus the pinned pre-implementation source.
// Run from repository root: node /path/to/browser-check.cjs [root] [output-directory]
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const root = path.resolve(process.argv[2]??process.cwd());
const outDirectory=path.resolve(process.argv[3]??require('node:os').tmpdir()+'/tetorica-daily01-p1');
const baselineCommit='05342b77b089962a6f13c0a473e88d1cf16ec5f3';
const docs = path.join(root,'docs');
const {chromium,webkit} = require('node:module').createRequire(path.join(root,'package.json'))('playwright');
const baseline = Object.fromEntries(['huc6280audioengine.js','custom_fx.js'].map(name=>[name,execFileSync('git',['show',baselineCommit+':web/'+name],{cwd:root,encoding:'utf8'})]));
const hucInstrumentation = `
const __verifyReceive = Processor.prototype.receive;
Processor.prototype.receive = function(data,port=this.port) {
  if(data.type!=='verify-capture')return __verifyReceive.call(this,data,port);
  this.chip.reset();this.chip.setMasterVolume(data.volume);this.controls.fill(0);this.selectedChannel=0;
  const w=(r,v)=>this.write(r,v);
  const wave=ch=>{w(1,255);w(0,ch);w(4,64);w(4,0);for(let i=0;i<32;i++)w(6,i<16?31:0);w(2,254+ch*13);w(3,0);w(5,ch===1?240:255);w(4,159);};
  wave(0);wave(1);wave(4);
  if(data.mode==='noise')w(7,0x9e);
  if(data.mode==='lfo'){w(8,1);w(9,2);}
  this.__capture={left:new Float32Array(2048),right:new Float32Array(2048),offset:0,id:data.id};
};
const __verifyProcess = Processor.prototype.process;
Processor.prototype.process = function(inputs,outputs) {
  const capture=this.__capture;
  if(!capture){for(const ch of outputs[0])ch.fill(0);return true;}
  const keep=__verifyProcess.call(this,inputs,outputs);
  const n=Math.min(outputs[0][0].length,capture.left.length-capture.offset);
  for(let i=0;i<n;i++){capture.left[capture.offset+i]=outputs[0][0][i];capture.right[capture.offset+i]=outputs[0][1][i];}
  capture.offset+=n;
  if(capture.offset===capture.left.length){this.__capture=null;this.port.postMessage({verify:true,id:capture.id,left:capture.left,right:capture.right},[capture.left.buffer,capture.right.buffer]);}
  return keep;
};
`;
const served=new Set();
const server = http.createServer(async(req,res)=>{
 try {
  const pathname = new URL(req.url,'http://localhost').pathname;served.add(pathname);
  if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<p>Audio correctness check</p>');return;}
  let filename,source;
  if(pathname.startsWith('/baseline/')) {
   const name=path.basename(pathname);
   if(name in baseline)source=baseline[name];
   else if(name==='native_fx_engine.js')source=(await fs.readFile(path.join(docs,'js',name),'utf8')).replace(/'\.\/custom_fx\.js(?:\?[^']*)?'/g,"'/baseline/custom_fx.js'");
   else if(name==='native-fx-worklet.js')source=(await fs.readFile(path.join(docs,'js',name),'utf8')).replace(/'\.\/native_fx_engine\.js(?:\?[^']*)?'/g,"'/baseline/native_fx_engine.js'").replace("registerProcessor('tetorica-native-fx'","registerProcessor('tetorica-native-fx-before'");
   else if(name==='playground_huc6280_worklet.js')source=(await fs.readFile(path.join(docs,'js',name),'utf8')).replace(/'\.\/huc6280audioengine\.js(?:\?[^']*)?'/g,"'/baseline/huc6280audioengine.js'").replace("registerProcessor('tetorica-huc6280', Processor);",hucInstrumentation+"registerProcessor('tetorica-huc6280-before', Processor);");
   else {filename=path.join(docs,'js',name);source=await fs.readFile(filename);}
   if(typeof source==='string')source=source.replaceAll("from './","from '/js/");
  }else{
   filename=path.resolve(docs,'.'+pathname);assert(filename.startsWith(docs+path.sep));source=await fs.readFile(filename);
   if(pathname==='/js/playground_huc6280_worklet.js')source=source.toString().replace("registerProcessor('tetorica-huc6280', Processor);",hucInstrumentation+"registerProcessor('tetorica-huc6280', Processor);");
  }
  res.setHeader('Content-Type',pathname.endsWith('.wasm')?'application/wasm':'text/javascript');res.end(source);
 }catch(error){res.statusCode=404;res.end(String(error));}
});
const sha=values=>createHash('sha256').update(Float32Array.from(values)).digest('hex');
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const results=[];
 try {
  for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){served.clear();
   const browser=await engine.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}:{})});
   try {
    const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.evaluate(()=>document.body.addEventListener('click',()=>{window.__verifyAudio=new AudioContext({sampleRate:48000});window.__verifyAudio.resume();},{once:true}));await page.click('body');
    const result=await page.evaluate(async()=>{
     const equal=(a,b,label)=>{if(a.length!==b.length)throw Error(label+' length differs');for(let i=0;i<a.length;i++)if(!Object.is(a[i],b[i]))throw Error(label+' differs at '+i+': '+a[i]+' vs '+b[i]);};
     const {default:factory}=await import('/generated/huc6280_wasm.js');
     const oldEngine=(await import('/baseline/huc6280audioengine.js')).Huc6280AudioEngine,newEngine=(await import('/js/huc6280audioengine.js')).Huc6280AudioEngine;
     const bytes=await(await fetch('/generated/huc6280_wasm.wasm')).arrayBuffer();
     const wave=(e,ch)=>{const w=(r,v)=>e.writeHuc6280(r,v);w(1,255);w(0,ch);w(4,64);w(4,0);for(let i=0;i<32;i++)w(6,i<16?31:0);w(2,254+ch*13);w(3,0);w(5,ch===1?240:255);w(4,159);};
     const wrapper=[];
     for(const volume of [0,.7,1,3.8])for(const mode of ['wave','noise','lfo']){
      const engines=await Promise.all([oldEngine,newEngine].map(C=>C.create({moduleFactory:()=>factory({wasmBinary:bytes}),clock:3579545,outputSampleRate:48000,masterVolume:volume})));
      try{
       for(const e of engines){wave(e,0);wave(e,1);wave(e,4);if(mode==='noise')e.writeHuc6280(7,0x9e);if(mode==='lfo'){e.writeHuc6280(8,1);e.writeHuc6280(9,2);}}
       let samples=0,nonzero=0;
       for(const frames of [0,1,127,128,257,4096,31,256]){
        const [a,b]=engines.map(e=>e.processFrames(frames));equal(a.left,b.left,'wrapper left');equal(a.right,b.right,'wrapper right');
        for(const side of [b.left,b.right])for(const sample of side){if(!Number.isFinite(sample))throw Error('wrapper nonfinite');if(sample)nonzero++;}
        samples+=frames;
       }
       const retained=engines[1].processFrames(128),left=retained.left.slice(),right=retained.right.slice();engines[1].processFrames(4096);equal(retained.left,left,'retained left');equal(retained.right,right,'retained right');
       if(retained.left.buffer===retained.right.buffer||retained.left.buffer===engines[1].module.HEAPF32.buffer)throw Error('PCM ownership changed');
       if(volume>0&&nonzero===0)throw Error('wrapper became silent');wrapper.push({volume,mode,frames:samples,nonzero});
      }finally{engines.forEach(e=>e.dispose());}
     }
     // Capture actual production HuC processor output independently of startup phases.
     const context=window.__verifyAudio;await context.resume();await context.audioWorklet.addModule('/baseline/playground_huc6280_worklet.js');await context.audioWorklet.addModule('/js/playground_huc6280_worklet.js');
     const nodes=['tetorica-huc6280-before','tetorica-huc6280'].map(kind=>new AudioWorkletNode(context,kind,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{wasmBinary:bytes,clock:3579545}}));
     const ready=nodes.map(node=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('HuC ready timeout')),5000);node.port.onmessage=({data})=>{if(data.ready){clearTimeout(timeout);resolve();}else if(data.error){clearTimeout(timeout);reject(Error(data.error));}};}));
     const silent=context.createGain();silent.gain.value=0;silent.connect(context.destination);nodes.forEach(node=>node.connect(silent));await Promise.all(ready);
     const worklet=[];
     try{
      for(const volume of [0,.7,1,3.8])for(const mode of ['wave','noise','lfo']){
       const captures=await Promise.all(nodes.map((node,id)=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('HuC Worklet capture timeout')),5000);node.port.onmessage=({data})=>{if(data.verify){clearTimeout(timeout);resolve(data);}else if(data.error){clearTimeout(timeout);reject(Error(data.error));}};node.port.postMessage({type:'verify-capture',id,volume,mode});})));
       equal(captures[0].left,captures[1].left,'Worklet left');equal(captures[0].right,captures[1].right,'Worklet right');
       const channels=[captures[1].left,captures[1].right];if(channels.some(ch=>!ch.every(Number.isFinite)))throw Error('HuC Worklet nonfinite');
       worklet.push({volume,mode,left:[...channels[0]],right:[...channels[1]]});
      }
     }finally{nodes.forEach(node=>{node.disconnect();node.port.close();});await context.close();}
     const gain=`function(input,output){for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=input[ch][i]*.5;}`;
     const fixtures=[
      {name:'gain',source:gain,half:false,errors:0,left:.25,right:.125},
      {name:'NaN',source:`function(input,output){output[0][0]=NaN;}`,half:true,errors:1,left:.25,right:.125},
      {name:'Infinity',source:`function(input,output){output[1][127]=Infinity;}`,half:true,errors:1,left:.25,right:.125},
      {name:'negative-Infinity',source:`function(input,output){output[1][127]=-Infinity;}`,half:true,errors:1,left:.25,right:.125},
      {name:'short-channel',source:`function(input,output){output[0]=Float32Array.of(.1);}`,half:true,errors:1,left:.25,right:.125},
      {name:'frozen-list',source:`function(input,output){output.length=0;Object.freeze(output);}`,half:true,errors:1,left:.25,right:.125},
      {name:'valid-replacement',source:`function(input,output){for(let ch=0;ch<input.length;ch++)output[ch]=Float32Array.from(input[ch],v=>v*.5);}`,half:true,errors:0,left:.125,right:.0625},
     ];
     const fx=[],module=await WebAssembly.compile(await(await fetch('/js/native_audio_effect.wasm')).arrayBuffer());
     for(const fixture of fixtures){
      const outputs=[];
      for(const before of [true,false]){
       const ctx=new OfflineAudioContext(2,4096,48000);await ctx.audioWorklet.addModule(before?'/baseline/native-fx-worklet.js':'/js/native-fx-worklet.js');
       const initialCommands=[{op:'live-fx',action:'register',name:fixture.name,source:fixture.source,context:{}}];if(fixture.half)initialCommands.push({op:'live-fx',action:'register',name:'after',source:gain,context:{}});
       const node=new AudioWorkletNode(ctx,before?'tetorica-native-fx-before':'tetorica-native-fx',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{module,initialCommands}}),messages=[];node.port.onmessage=({data})=>{if(data.error)messages.push(data.error);};
       const buffer=ctx.createBuffer(2,4096,48000);buffer.getChannelData(0).fill(.5);buffer.getChannelData(1).fill(.25);const src=ctx.createBufferSource();src.buffer=buffer;src.connect(node);node.connect(ctx.destination);src.start(0);
       const rendered=await ctx.startRendering();await new Promise(resolve=>setTimeout(resolve,20));
       const out=[rendered.getChannelData(0).slice(),rendered.getChannelData(1).slice()];
       for(let ch=0;ch<2;ch++)for(let i=0;i<out[ch].length;i++)if(out[ch][i]!==[fixture.left,fixture.right][ch])throw Error(fixture.name+' wrong sample '+ch+':'+i+'='+out[ch][i]);
       if(messages.length!==fixture.errors)throw Error(fixture.name+' expected '+fixture.errors+' errors; got '+messages.length);
       node.disconnect();node.port.close();outputs.push(out);
      }
      equal(outputs[0][0],outputs[1][0],fixture.name+' baseline left');equal(outputs[0][1],outputs[1][1],fixture.name+' baseline right');fx.push({name:fixture.name,frames:4096,errors:fixture.errors,left:fixture.left,right:fixture.right});
     }
     return {wrapper,worklet,fx};
    });
    assert.deepEqual(errors,[]);for(const file of ['huc6280audioengine.js','custom_fx.js','native_fx_engine.js'])assert(served.has('/baseline/'+file),'baseline import was exercised: '+file);
    for(const entry of result.worklet){entry.leftHash=sha(entry.left);entry.rightHash=sha(entry.right);entry.nonzero=entry.left.filter(x=>x!==0).length;entry.frames=entry.left.length;delete entry.left;delete entry.right;}
    const summary={browser:name,passed:true,...result,errors};results.push(summary);console.log(JSON.stringify(summary));await page.close();
   }finally{await browser.close();}
  }
  await fs.mkdir(outDirectory,{recursive:true});
  await fs.writeFile(path.join(outDirectory,'browser-results.json'),JSON.stringify({date:new Date().toISOString(),baselineHead:baselineCommit,currentHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),results},null,2));
 }finally{server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
