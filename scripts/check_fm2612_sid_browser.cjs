// Real npm tarball, installed offline in a temporary project. The HTTP server
// serves only that installed package and this fixture; no docs/source fallback.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {execFileSync}=require('node:child_process'),{tmpdir}=require('node:os'),{createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');
const workspace=path.resolve(__dirname,'..'),options={package:path.join(workspace,'dist/fm2612'),out:path.join(tmpdir(),'fm2612-sid-installed-browser.json'),tarball:null,chromiumOnly:false};
for(let i=2;i<process.argv.length;i++){
 const key=process.argv[i];if(key==='--chromium-only'){options.chromiumOnly=true;continue;}
 assert(['--package','--out','--tarball'].includes(key),'Unknown option '+key);const value=process.argv[++i];assert(value&&!value.startsWith('--'),'Missing '+key);options[key.slice(2)]=path.resolve(value);
}
const prefix='/nested/consumer/node_modules/tetorica-fm2612/',sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function bounded(promise,label){
 let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),35000);})]);}
 finally{clearTimeout(timer);}
}
function instrument(){
 const audit=window.__sidNpm={contexts:[],workers:[],sinks:[],processorErrors:[]};
 const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,WorkerClass=window.Worker,connect=AudioNode.prototype.connect;
 window.AudioContext=class extends Context{constructor(...args){super(...args);audit.contexts.push(this);}};
 if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
 window.Worker=class extends WorkerClass{constructor(url,...args){super(url,...args);audit.workers.push(String(url));}};
 window.AudioWorkletNode=class extends Worklet{constructor(...args){super(...args);this.addEventListener('processorerror',()=>audit.processorErrors.push(args[1]));}};
 AudioNode.prototype.connect=function(destination,...args){
  if(destination!==this.context.destination)return connect.call(this,destination,...args);
  const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
  connect.call(this,analyser);connect.call(analyser,mute);connect.call(mute,destination);audit.sinks.push({context:this.context,analyser,mute});return destination;
 };
 audit.sample=()=>audit.sinks.filter(sink=>sink.context.state!=='closed').map(({analyser,mute,context})=>{const pcm=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(pcm);let minimum=Infinity,maximum=-Infinity,crossings=0;for(let i=0;i<pcm.length;i++){minimum=Math.min(minimum,pcm[i]);maximum=Math.max(maximum,pcm[i]);if(i&&(pcm[i-1]<0)!==(pcm[i]<0))crossings++;}return {peak:Math.max(Math.abs(minimum),Math.abs(maximum)),span:maximum-minimum,crossings,finite:pcm.every(Number.isFinite),muted:mute.gain.value===0,sampleRate:context.sampleRate};});
}
(async()=>{
 const scratch=await fs.mkdtemp(path.join(tmpdir(),'fm2612-sid-browser-'));let server;
 try{
  const {assertSidPackageFiles}=await import('./check_fm2612_sid_package.mjs');
  let tarball=options.tarball;
  if(!tarball){const packed=JSON.parse(execFileSync('npm',['pack','--json','--pack-destination',scratch],{cwd:options.package,encoding:'utf8'}))[0];assertSidPackageFiles(new Set(packed.files.map(file=>file.path)));tarball=path.join(scratch,packed.filename);}
  const consumer=path.join(scratch,'consumer');await fs.mkdir(consumer);await fs.writeFile(path.join(consumer,'package.json'),'{"type":"module","private":true}\n');
  execFileSync('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund',tarball],{cwd:consumer,stdio:'inherit'});
  const installed=path.join(consumer,'node_modules/tetorica-fm2612'),manifest=JSON.parse(await fs.readFile(path.join(installed,'package.json'),'utf8'));
  const served=new Map(),badRequests=[];
  server=http.createServer(async(req,res)=>{
   try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/'){res.writeHead(200,{'content-type':'text/html'}).end('<button id="run">Check installed SID</button>');return;}
    if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    assert(pathname.startsWith(prefix),'Only the installed package is available');const relative=pathname.slice(prefix.length),file=path.resolve(installed,relative);assert(file.startsWith(installed+path.sep));
    const bytes=await fs.readFile(file);served.set(relative,{bytes:bytes.length,sha256:sha(bytes)});
    res.writeHead(200,{'content-type':path.extname(file)==='.wasm'?'application/wasm':path.extname(file)==='.json'?'application/json':'text/javascript','cache-control':'no-store'}).end(bytes);
   }catch(error){badRequests.push({path:req.url,error:error.message});res.writeHead(404).end(error.message);}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port,results=[];
  for(const[name,engine]of(options.chromiumOnly?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]])){
   const browser=await engine.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});
   try{
    const page=await browser.newPage();page.setDefaultTimeout(30000);const errors=[],failed=[],external=[],consoleErrors=[];
    let step='startup';const evaluate=page.evaluate.bind(page);page.evaluate=(...args)=>bounded(evaluate(...args),name+'/'+step);
    page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)failed.push(response.url());});
    page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
    page.on('request',request=>{const url=new URL(request.url());if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol))external.push(url.href);});
    await page.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin||['data:','blob:'].includes(url.protocol)?route.continue():route.abort();});
    await page.addInitScript(instrument);await page.goto(origin);
    for(const model of ['6581','8580']){
     step=model+'/direct';
     console.log(`CHECK ${name}/${model}: direct core default module-relative WASM URL in installed npm package`);
     const direct=await page.evaluate(async({prefix,model})=>{
      const {SidCore}=await import(prefix+'sid.js'),{Sid8580Core}=await import(prefix+'sid8580.js'),{SidSynth}=await import(prefix+'sidsynth.js');
      const core=await(model==='8580'?Sid8580Core:SidCore).create({sampleRate:48000}),synth=new SidSynth({core});
      try{synth.initialize();synth.setVoice(0,{waveform:'saw',attack:0,decay:0,sustain:12});synth.noteOn(0,'A4');const pcm=core.render(8192),steady=pcm.subarray(4096);let minimum=Infinity,maximum=-Infinity,crossings=0;for(let i=0;i<steady.length;i++){minimum=Math.min(minimum,steady[i]);maximum=Math.max(maximum,steady[i]);if(i&&(steady[i-1]<0)!==(steady[i]<0))crossings++;}return {model:core.model,finite:pcm.every(Number.isFinite),peak:Math.max(Math.abs(minimum),Math.abs(maximum)),span:maximum-minimum,crossings};}
      finally{synth.dispose();core.dispose();}
     },{prefix,model});assert.equal(direct.model,model);assert(direct.finite&&direct.peak>.00001&&direct.span>.0001&&direct.crossings>2);results.push({browser:name,kind:'direct-default-assets',...direct});
     for(const execution of ['main','worker']){
      step=model+'/'+execution+'/prepare';
      console.log(`CHECK ${name}/${model}/${execution}: installed Playground runtime, default Worklet/Worker URLs, real muted PCM and Stop`);
      await page.evaluate(async({prefix,model,execution})=>{
       const {createPlaygroundRuntime}=await import(prefix+'playground_runtime.js');const logs=[],statuses=[];
       const runtime=createPlaygroundRuntime({chip:'sid',execution,onLog:line=>logs.push(line),onStatus:line=>statuses.push(line)});window.__runtimeCheck={runtime,logs,statuses};
       // WebKit must create/resume audio from the trusted gesture itself;
       // importing the fixture first avoids losing activation to module fetch.
       document.querySelector('#run').onclick=()=>{
        const select=model==='8580'?"await createSoundChip('sid',{id:'npm-sid-8580',model:'8580'})":"sid";
        window.__sidNpmStart=(async()=>{await runtime.initialize();await runtime.playSource("const voice="+select+";voice.initialize();voice.setVoice(0,{waveform:'saw',attack:0,decay:0,sustain:12,release:0});voice.noteOn(0,'A4');await sleep(0.25);log('SID_NPM_READY',JSON.stringify(await voice.getState()));",{execution});})();
        window.__sidNpmStart.catch(()=>{});
       };
      },{prefix,model,execution});
      step=model+'/'+execution+'/start';await page.click('#run');await page.evaluate(()=>window.__sidNpmStart);
      await page.waitForFunction(model=>window.__runtimeCheck.logs.some(line=>line.includes('SID_NPM_READY')&&line.includes(model)),model);
      await page.waitForFunction(()=>__sidNpm.sample().some(value=>value.finite&&value.muted&&value.peak>.00001&&value.span>.0001&&value.crossings>2));
      step=model+'/'+execution+'/observe';
      const observation=await page.evaluate(async model=>{
       const inspector=__runtimeCheck.runtime.chipInspector;
       const target=inspector.list().find(endpoint=>endpoint.kind==='sid'&&(model==='8580'?endpoint.id!=='sid':endpoint.id==='sid'));
       if(!target)throw Error('Missing applied SID endpoint '+model);
       return {id:target.id,state:await inspector.read(target.id),audio:__sidNpm.sample()};
      },model);
      assert(observation.audio.length&&observation.audio.every(value=>value.finite&&value.muted));
      assert.equal(observation.state.model,model);assert(observation.state.registers[4]&1);
      step=model+'/'+execution+'/stop';await page.evaluate(()=>__runtimeCheck.runtime.stop());await page.waitForFunction(()=>__sidNpm.sample().every(value=>value.finite&&value.muted&&value.peak<1e-8));
      const stopped=await page.evaluate(async id=>{const inspector=__runtimeCheck.runtime.chipInspector;return inspector.list().some(endpoint=>endpoint.id===id)?await inspector.read(id):null;},observation.id);
      if(stopped)assert.equal(stopped.registers[4]&1,0);else assert.equal(model,'8580','The primary endpoint remains available until finalize');
      step=model+'/'+execution+'/finalize';await page.evaluate(()=>__runtimeCheck.runtime.finalize());await page.waitForFunction(()=>__sidNpm.contexts.every(context=>context.state==='closed'));
      results.push({browser:name,model,execution,kind:'playground-main-worker',audio:observation.audio,stopSilence:true,closed:true});
     }
    }
    assert(await page.evaluate(()=>__sidNpm.workers.some(url=>url.includes('/playground_logic_worker.js'))));
    assert.deepEqual(await page.evaluate(()=>__sidNpm.processorErrors),[]);assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(external,[]);await page.close();
   }finally{await browser.close();}
  }
  for(const file of ['sid.js','sid8580.js','sidsynth.js','sid_waveforms.js','playground_sid_audio.js','playground_sid_worklet.js','playground_logic_worker.js','generated/sid/sid.wasm','generated/sid8580-machine/sid8580-endpoint.wasm'])assert(served.has(file),'Used installed asset '+file);
  assert.deepEqual(badRequests,[]);
  const report={schemaVersion:1,passed:true,isolatedInstalledNpmTarball:true,physicalOutputMuted:true,listeningPerformed:false,package:{name:manifest.name,version:manifest.version,tarballSha256:sha(await fs.readFile(tarball))},results,sources:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))};
  await fs.mkdir(path.dirname(options.out),{recursive:true});await fs.writeFile(options.out,JSON.stringify(report,null,2)+'\n');console.log('PASS installed npm SID browser: '+options.out);
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await fs.rm(scratch,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
