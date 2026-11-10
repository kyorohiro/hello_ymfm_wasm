// Installed-style common SID factory -> real WASM / AudioWorklet, no listening.
// Every destination is intercepted at gain zero before package code loads.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{tmpdir}=require('node:os'),{chromium,webkit}=require('playwright');
const config={root:path.resolve(__dirname,'../dist/fm2612'),prefix:'',engines:'chromium,webkit',out:path.join(tmpdir(),'sid-common-factory-browser.json')};
for(const arg of process.argv.slice(2)){const match=/^--(root|prefix|engines|out)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]]=match[2];}
assert(!config.prefix||/^\/[A-Za-z0-9/_-]+$/.test(config.prefix));
config.root=path.resolve(config.root);const engines=config.engines.split(',');assert(engines.every(name=>['chromium','webkit'].includes(name)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),assets=new Map(),missing=[],blocked=[],results=[];
const server=http.createServer(async(request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(pathname==='/'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Silent SID factory check</title><button id="check">Check</button>');return;}
    if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    const filename=path.resolve(config.root,'.'+pathname);assert(filename.startsWith(config.root+path.sep));
    const bytes=await fs.readFile(filename),name=path.relative(config.root,filename).split(path.sep).join('/'),record={bytes:bytes.length,sha256:hash(bytes)};
    if(assets.has(name))assert.deepEqual(assets.get(name),record,'Asset changed during check');assets.set(name,record);
    response.setHeader('Content-Type',filename.endsWith('.wasm')?'application/wasm':'text/javascript');response.end(bytes);
  }catch(error){missing.push({url:request.url,error:error.message});response.writeHead(404).end(error.message);}
});
function installMute(){
  const Context=window.AudioContext??window.webkitAudioContext,connect=AudioNode.prototype.connect,gates=[],contexts=[];
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const gate=this.context.createGain();gate.gain.value=0;gates.push(gate);
    connect.call(this,gate,...args);connect.call(gate,destination);return destination;
  };
  window.__factoryAudioAudit=()=>({contexts:contexts.length,closed:contexts.filter(context=>context.state==='closed').length,
    destinationConnections:gates.length,physicalOutputMuted:gates.every(gate=>gate.gain.value===0)});
}
async function check(browser,name,origin){
  const page=await browser.newPage({serviceWorkers:'block'}),errors=[],consoleErrors=[];
  page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.stack??error.message));
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin||['data:','blob:'].includes(url.protocol))return route.continue();blocked.push(url.href);return route.abort();});
  await page.addInitScript(installMute);
  try{
    await page.goto(origin);
    await page.evaluate(prefix=>{
      document.getElementById('check').onclick=()=>{window.__factoryCheck=(async()=>{
        const require=(condition,label)=>{if(!condition)throw Error(label);},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
        const rejects=async(task,pattern)=>{let error;try{await task();}catch(value){error=value;}require(error&&pattern.test(error.message),'Expected rejection '+pattern+', got '+error);};
        const {createSoundChip,SoundChipMixer}=await import(prefix+'/soundchip.js'),{SidSynth}=await import(prefix+'/sidsynth.js');
        const direct=[];
        for(const model of ['6581','8580']){
          const core=await createSoundChip('sid',{model,sampleRate:48000}),synth=new SidSynth({core});
          try{
            require(core.model===model&&core.sampleRate===48000,'Direct SID metadata');
            synth.initialize();synth.setVoice(0,{waveform:'saw',attack:0,decay:0,sustain:15,release:0});synth.noteOn(0,'A4');
            const pcm=core.render(4800);require(pcm.every(Number.isFinite)&&pcm.some(value=>Math.abs(value)>.001),'Direct numeric SID PCM');
            direct.push({model,id:core.id,frames:pcm.length,peak:Math.max(...pcm.map(Math.abs))});
          }finally{synth.dispose();core.dispose();}
        }
        require(__factoryAudioAudit().contexts===0,'Direct factory never creates an AudioContext');
        for(const options of [{model:'6580'},{model:'8580',clock:1022727},{clock:0},{sampleRate:1}])
          await rejects(()=>createSoundChip('sid',{...options,execution:'worklet'}),/SID|model|clock|sample|rate|PAL/i);
        const cancelled=new AbortController();cancelled.abort();await rejects(()=>createSoundChip('sid',{execution:'worklet',signal:cancelled.signal}),/abort|cancel/i);
        require(__factoryAudioAudit().contexts===0,'Invalid SID options and prior cancellation allocate no AudioContext');
        const context=new AudioContext({sampleRate:48000}),mixer=new SoundChipMixer(),worklets=[];
        await context.resume();
        const captureSource=`class Capture extends AudioWorkletProcessor{
          constructor(){super();this.capture=null;this.port.onmessage=({data})=>this.capture={id:data.id,frames:8192,count:0,sum:0,peak:0,stereoError:0,finite:true};}
          process(inputs,outputs){for(const output of outputs)for(const channel of output)channel.fill(0);const x=inputs[0],c=this.capture;if(!c)return true;
            const count=Math.min(outputs[0][0].length,c.frames-c.count);for(let i=0;i<count;i++){const l=x?.[0]?.[i]??0,r=x?.[1]?.[i]??l;c.sum+=l*l;c.peak=Math.max(c.peak,Math.abs(l));c.stereoError=Math.max(c.stereoError,Math.abs(l-r));c.finite&&=Number.isFinite(l)&&Number.isFinite(r);}c.count+=count;
            if(c.count===c.frames){this.port.postMessage({id:c.id,rms:Math.sqrt(c.sum/c.count),peak:c.peak,stereoError:c.stereoError,finite:c.finite});this.capture=null;}return true;}}
          registerProcessor('sid-factory-capture',Capture);`;
        const url=URL.createObjectURL(new Blob([captureSource],{type:'text/javascript'}));try{await context.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
        const capture=new AudioWorkletNode(context,'sid-factory-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});capture.connect(context.destination);
        let sequence=0;
        const measure=()=>new Promise((resolve,reject)=>{
          const id=++sequence,timer=setTimeout(()=>reject(Error('SID capture timeout')),8000);
          capture.port.onmessage=({data})=>{if(data.id===id){clearTimeout(timer);resolve(data);}};capture.port.postMessage({id});
        });
        try{
          for(const model of ['6581','8580']){
            const chip=await createSoundChip('sid',{execution:'worklet',model,audioContext:context,outputNode:capture,mixer,id:'sid-'+model,gain:.25});
            try{
              require(chip.name==='sid'&&chip.model===model&&chip.clock===985248&&chip.sampleRate()===context.sampleRate,'Worklet SID metadata');
              await rejects(()=>createSoundChip('sid',{execution:'worklet',model,audioContext:context,mixer,id:chip.id}),/already/);
              const frequency=Math.round(440*16777216/985248);
              for(const [register,value]of [[0,frequency&255],[1,frequency>>8],[5,0],[6,0xf0],[4,0x21],[24,8]])await chip.request('writeRegister',[register,value]);
              const state=await chip.request('getState');require(state.model===model&&state.registers[4]===0x21,'Worklet applied register state');
              const hardware=await chip.request('readRegister',[27]);require(Number.isInteger(hardware)&&hardware>=0&&hardware<=255,'Worklet hardware read');
              await rejects(()=>chip.request('writeRegister',[32,1]),/register|SID/i);
              await chip.start();await wait(80);const full=await measure();require(full.finite&&full.rms>.001&&full.stereoError===0,'Actual mono SID duplicated to stereo');
              mixer.set(chip.id,{volume:.5});await wait(40);const half=await measure();require(Math.abs(half.rms/full.rms-.5)<.015,'Mixer applied exactly once '+JSON.stringify({model,full,half,ratio:half.rms/full.rms}));
              await chip.stop();await wait(30);const stopped=await measure();require(stopped.peak===0,'Worklet stop disconnects output');
              await chip.start();await wait(30);const resumed=await measure();require(resumed.rms>.0001,'Worklet can resume');
              const port=chip.createTransportPort();
              const remote=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Remote SID read timeout')),5000);port.onmessage=({data})=>{if(data.id==='read'){clearTimeout(timer);data.error?reject(Error(data.error)):resolve(data.value);}};port.start();port.postMessage({id:'read',method:'getState'});});port.close();
              require(remote.model===model,'Attached MessagePort uses the same SID');
              worklets.push({model,id:chip.id,full,half,stopped,resumed});
            }finally{await chip.dispose();}
            require(context.state==='running','Disposing SID preserves caller-owned AudioContext');
          }
          const fm=await createSoundChip('ym2612',{execution:'worklet',audioContext:context,outputNode:capture,mixer});
          try{await fm.request('writeRegister',[0x22,0]);await fm.start();await fm.stop();}finally{await fm.dispose();}
          require(context.state==='running','Existing YM2612 endpoint lifecycle still works');
        }finally{capture.disconnect();capture.port.close();await context.close();}
        const audit=__factoryAudioAudit();require(audit.physicalOutputMuted,'All physical outputs are muted');
        return{direct,worklets,invalidBeforeAudio:true,ym2612Regression:true,audit};
      })();};
    },config.prefix);
    await page.locator('#check').click();const result=await page.evaluate(()=>window.__factoryCheck);
    assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);return{browser:name,passed:true,...result};
  }finally{await page.close();}
}
(async()=>{
  let failure;
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const origin='http://127.0.0.1:'+server.address().port;
    for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}: {})});
      try{results.push(await check(browser,name,origin));console.log('PASS '+name+': common SID direct/Worklet factory');}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(blocked,[]);
  }catch(error){failure=error;}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  await fs.writeFile(config.out,JSON.stringify({passed:!failure,root:config.root,prefix:config.prefix,physicalOutputMuted:true,listeningPerformed:false,results,missing,blocked,assets:Object.fromEntries(assets),error:failure?.stack},null,2)+'\n');
  console.log((failure?'FAIL':'PASS')+' receipt '+config.out);if(failure)throw failure;
})().catch(error=>{console.error(error);process.exitCode=1;});
