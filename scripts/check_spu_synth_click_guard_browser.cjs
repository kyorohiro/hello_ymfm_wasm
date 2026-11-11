// SPU Synth software click guard: real Worklet PCM, headless and silent.
// The destination is intercepted before application code runs. A 44.1 kHz
// test context makes raw-key captures comparable at the same native phase.
// node scripts/check_spu_synth_click_guard_browser.cjs --root=docs --entry=/synth-spu/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const config={root:path.resolve(__dirname,'../docs'),entry:'/synth-spu/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'spu-synth-click-guard-browser.json'),screenshots:path.join(tmpdir(),'spu-synth-click-guard-browser')};
for(const arg of process.argv.slice(2)){const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]]=match[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const served=new Map(),missing=[],external=[],httpErrors=[],blockedMonaco=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
async function until(predicate,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await wait(30);}throw Error('Timeout: '+label);}

function installAudit(){
  const BaseContext=window.AudioContext??window.webkitAudioContext,BaseNode=window.AudioWorkletNode;
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
  const contexts=[],nodes=[],meters=[],commands=[],captureMutes=[],owners=new WeakMap();let serial=0,capture=null;
  window.AudioContext=class extends BaseContext{constructor(options={}){super({...options,sampleRate:44100});contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends BaseNode{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});owners.set(this.port,context);}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({source:this,analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(data,...args){
    if(data?.method){commands.push({method:data.method,args:data.args});if(commands.length>10000)commands.shift();}
    if(capture&&data?.method==='code'&&[0].includes(data.args?.[2]?.[0])){
      const method=data.args[1],context=owners.get(this);
      if(['noteOn','keyOn'].includes(method))capture.on.push(Math.round(context.currentTime*context.sampleRate));
      if(['noteOff','keyOff'].includes(method))capture.off.push(Math.round(context.currentTime*context.sampleRate));
    }
    if(capture&&data?.method==='instrumentNoteOn')capture.on.push(Math.round(owners.get(this).currentTime*owners.get(this).sampleRate));
    if(capture&&data?.method==='instrumentNoteOff')capture.off.push(Math.round(owners.get(this).currentTime*owners.get(this).sampleRate));
    return post.call(this,data,...args);
  };
  const muted=()=>meters.every(item=>item.mute.gain.value===0)&&captureMutes.every(item=>item.gain.value===0);
  const source=()=>meters.find(item=>item.source.context.state!=='closed')?.source;
  async function read(){
    const node=nodes.find(item=>item.name==='tetorica-spu-synth')?.node;if(!node)throw Error('SPU Worklet missing');const id=--serial;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('SPU read timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method:'inspect',args:[]});});
  }
  async function begin(){
    if(capture)throw Error('Capture already active');const input=source();if(!input)throw Error('No post-Master output');
    const name='spu-guard-capture-'+Math.abs(--serial),url=URL.createObjectURL(new Blob([
      `class Capture extends AudioWorkletProcessor{process(inputs){if(inputs[0]?.[0])this.port.postMessage({frame:currentFrame,values:inputs[0][0].slice()});return true;}}registerProcessor('${name}',Capture);`
    ],{type:'text/javascript'}));
    try{await input.context.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
    const node=new AudioWorkletNode(input.context,name,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]}),mute=input.context.createGain();mute.gain.value=0;captureMutes.push(mute);
    const item=capture={input,node,mute,blocks:[],on:[],off:[]};node.port.onmessage=({data})=>{if(item.blocks.length<1024)item.blocks.push(data);};
    connect.call(input,node);connect.call(node,mute);connect.call(mute,input.context.destination);
  }
  function finish(){
    const item=capture;capture=null;if(!item||!item.off.length)throw Error('Gate capture has no Off');
    item.input.disconnect(item.node);item.node.disconnect();item.mute.disconnect();item.node.port.close();
    const blocks=item.blocks.sort((a,b)=>a.frame-b.frame),rate=item.input.context.sampleRate;if(blocks.length<20)throw Error('Gate capture too short');
    const first=blocks[0].frame,last=blocks.at(-1),values=new Float32Array(last.frame+last.values.length-first);let expected=first;
    for(const block of blocks){if(block.frame!==expected)throw Error('Capture discontinuity');values.set(block.values,block.frame-first);expected+=block.values.length;}
    const mark=item.off.at(-1)-first,start=item.on.at(-1)===undefined?0:item.on.at(-1)-first;
    let peak=0,regularJump=0,releaseJump=0,tailPeak=0,lastNonzero=null;
    for(let i=Math.max(1,mark-Math.round(.08*rate));i<values.length;i++){
      const level=Math.abs(values[i]),jump=Math.abs(values[i]-values[i-1]);
      if(i<mark-384){peak=Math.max(peak,level);regularJump=Math.max(regularJump,jump);}
      if(i>=mark-384&&i<mark+.025*rate)releaseJump=Math.max(releaseJump,jump);
      if(i>mark+.04*rate)tailPeak=Math.max(tailPeak,level);if(level>1e-8)lastNonzero=first+i;
    }
    let onset=Math.max(0,start-384);while(onset<values.length&&Math.abs(values[onset])<=1e-8)onset++;
    return{sampleRate:rate,frames:values.length,peak,regularJump,releaseJump,normalizedJump:releaseJump/peak,tailPeak,
      lastNonzeroAfterOffMs:lastNonzero===null?null:1000*(lastNonzero-item.off.at(-1))/rate,
      prefix:Array.from(values.subarray(onset,onset+2048)),onMarks:item.on.length,offMarks:item.off.length,muted:muted()};
  }
  window.__spuGuardAudit={read,begin,finish,commands:()=>commands.slice(),drain:()=>commands.splice(0),
    graph:()=>({contexts:contexts.length,editorWorklets:nodes.filter(item=>item.name==='tetorica-spu-synth').length,sampleRates:contexts.map(item=>item.sampleRate),destinationConnections:meters.length,muted:muted()})};
}
async function snapshot(page){return page.evaluate(()=>__spuGuardAudit.read());}
async function source(page,code){await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});await page.locator('#synthCodeEditor').fill(code);}
async function run(page){await page.locator('#synthCodeRunButton').click();await until(async()=>{const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);return /Running/.test(await page.locator('#synthCodeState').textContent());},'Code running');}
async function stop(page){await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(text=>/Stopped|Idle/.test(text)),'Code stopped');await wait(70);}
async function guard(page,value){if(value)await page.locator('#spuClickGuard').check();else await page.locator('#spuClickGuard').uncheck();
  await until(async()=>Boolean((await snapshot(page)).clickGuard)===value,'guard '+value);}
const settings=`const ps1=await useSoundChip('ps1');
await ps1.setPreset(CH1,{volumeLeft:.75,volumeRight:.75,reverb:false});
await ps1.setEnvelope(CH1,{attackRate:0,attackExponential:false,decayRate:0,sustainLevel:15,sustainRate:127,sustainDecrease:false,sustainExponential:false,releaseRate:0,releaseExponential:false});
await ps1.setReverb({preset:'off'});globalThis.__guardPs1=ps1;
`;
async function gateCase(page,{enabled,raw=false,hold=.56}){
  // Let the separate Code transport opening fade settle before measuring a
  // voice attack. It is intentionally independent of this per-voice guard.
  await guard(page,enabled);const code=settings+`await sleep(.03);\n`+(raw?`await ps1.setNote(CH1,'E3');await ps1.keyOn(CH1);`:`await ps1.noteOn(CH1,'E3');`)+
    `\nawait sleep(${hold});\n`+(raw?`await ps1.keyOff(CH1);`:`await ps1.noteOff(CH1);`)+`\nlog('gate-finished');`;
  await source(page,code);await page.evaluate(()=>__spuGuardAudit.begin());await run(page);await wait(100);
  const pcm=await page.evaluate(()=>__spuGuardAudit.finish());assert(pcm.muted&&pcm.peak>.0001&&Number.isFinite(pcm.normalizedJump));
  assert(pcm.tailPeak<1e-7,'fast release is silent after 40 ms');
  const state=await snapshot(page);assert.equal(state.channels[0].adsr2&31,0,'guard never changes the authored release register');
  await stop(page);return pcm;
}
const compact=pcm=>{const{prefix,...result}=pcm;return result;};
async function check(browser,name,origin){
  const page=await browser.newPage({viewport:{width:1240,height:1050},serviceWorkers:'block'}),errors=[],consoleErrors=[],expectedConsole=[],checks=[],measurements={};let stage='startup';
  page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.stack??error.message));
  page.on('console',message=>{if(message.type()!=='error')return;const value=message.text(),url=message.location().url;
    if(/cdnjs\.cloudflare\.com/.test(value+' '+url)||/^Failed to load resource/.test(value)&&blockedMonaco.length)expectedConsole.push(value);else consoleErrors.push(value);});
  page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installAudit);const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  try{
    await page.goto(origin+config.entry);await until(()=>page.locator('#spuFileImportButton').isEnabled(),'Files restore complete');
    step('Software click guard defaults to On without acquiring audio, and startup uses the chosen setting');
    assert(await page.locator('#spuClickGuard').isChecked());assert.match(await page.locator('#spuClickGuard').evaluate(input=>input.closest('label').textContent),/Software/);
    assert.equal((await page.evaluate(()=>__spuGuardAudit.graph())).contexts,0);
    await page.locator('#spuClickGuard').uncheck();assert.equal((await page.evaluate(()=>__spuGuardAudit.graph())).contexts,0,'idle preference does not create audio');
    await page.locator('#startAudio').click();await until(()=>page.locator('#startAudio').textContent().then(text=>/ready/i.test(text)),'audio ready');
    assert.equal((await snapshot(page)).clickGuard,false);assert.deepEqual((await page.evaluate(()=>__spuGuardAudit.graph())).sampleRates,[44100]);

    step('High-level noteOff reduces the real Sine release step while preserving fast ADSR and independent per-voice output');
    const raw=[],smooth=[];
    for(const hold of [.56,.567,.573])raw.push(await gateCase(page,{enabled:false,hold}));
    for(const hold of [.56,.567,.573])smooth.push(await gateCase(page,{enabled:true,hold}));
    const rawMaximum=Math.max(...raw.map(p=>p.normalizedJump)),smoothMaximum=Math.max(...smooth.map(p=>p.normalizedJump));
    assert(rawMaximum>.3,'at least one raw release samples a nonzero Sine phase: '+rawMaximum);
    assert(smoothMaximum<.2,'native per-voice ramp has a bounded release step: '+smoothMaximum);
    assert(rawMaximum>3*smoothMaximum,'guard reduces the worst release discontinuity');
    measurements.release={off:raw.map(compact),on:smooth.map(compact),rawMaximum,smoothMaximum};

    step('Raw setNote / keyOn / keyOff retain identical sample-phase PCM with the software guard On or Off');
    const rawOff=await gateCase(page,{enabled:false,raw:true}),rawOn=await gateCase(page,{enabled:true,raw:true});
    assert.equal(rawOff.prefix.length,2048);assert.equal(rawOn.prefix.length,2048);
    const maximumDifference=Math.max(...rawOff.prefix.map((value,index)=>Math.abs(value-rawOn.prefix[index])));
    assert(maximumDifference<1e-7,'raw prefix is bit-identical: '+maximumDifference);
    measurements.rawKeys={off:compact(rawOff),on:compact(rawOn),prefixFrames:rawOff.prefix.length,maximumDifference};

    step('Toggling the guard during a held Code note preserves its session, ADSR, sample bank and gate');
    await guard(page,true);await source(page,settings+`await ps1.noteOn(CH1,'E3');log('holding');`);await run(page);await wait(70);
    const before=await snapshot(page),graph=await page.evaluate(()=>__spuGuardAudit.graph());await page.evaluate(()=>__spuGuardAudit.drain());
    await guard(page,false);const after=await snapshot(page),commands=await page.evaluate(()=>__spuGuardAudit.commands());
    assert(after.channels[0].gate);assert.equal(after.channels[0].adsr1,before.channels[0].adsr1);assert.equal(after.channels[0].adsr2,before.channels[0].adsr2);
    assert.deepEqual(after.samples,before.samples);assert.equal(after.nextAddress,before.nextAddress);
    assert(!commands.some(value=>['stop','beginCode'].includes(value.method)),'preference does not restart Code');
    assert.deepEqual(await page.evaluate(()=>__spuGuardAudit.graph()),graph);
    await page.evaluate(()=>__guardPs1.noteOff(0));assert.match(await page.locator('#synthCodeState').textContent(),/Running/);
    await stop(page);assert.equal((await snapshot(page)).clickGuard,false,'Stop preserves the chosen preference');
    await page.locator('#synthInputKeyboardTab').click();await page.locator('#resetPreset').click();
    await until(()=>page.locator('#audioStatus').textContent().then(text=>/reset/i.test(text)),'instrument reset');
    assert.equal((await snapshot(page)).clickGuard,false,'instrument reset is separate from software preference');

    step('The checkbox remains usable in Code and Keyboard at desktop and narrow widths');
    await fs.mkdir(config.screenshots,{recursive:true});
    for(const width of [1240,390]){await page.setViewportSize({width,height:1050});
      for(const mode of ['Code','Keyboard']){await page.locator('#synthInput'+mode+'Tab').click();
        await until(()=>page.locator('#synthInputSection').getAttribute('data-input-mode').then(value=>value===mode.toLowerCase()),'settled input mode '+mode);
        assert(await page.locator('#spuClickGuard').isVisible());assert(await page.locator('#spuClickGuard').isEnabled());
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page overflow '+width+' '+mode);}
      await page.screenshot({path:path.join(config.screenshots,`${name}-spu-click-guard-${width}.png`),fullPage:true});}
    const finalGraph=await page.evaluate(()=>__spuGuardAudit.graph());assert(finalGraph.muted);assert.equal(finalGraph.contexts,1);assert.equal(finalGraph.editorWorklets,1);
    assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);measurements.graph=finalGraph;
    return{browser:name,passed:true,checks,measurements,errors,consoleErrors,expectedFallbackConsole:expectedConsole};
  }catch(error){let diagnostic;try{diagnostic=await page.evaluate(async()=>({state:await __spuGuardAudit.read(),commands:__spuGuardAudit.commands().slice(-20),graph:__spuGuardAudit.graph(),error:document.getElementById('synthCodeError')?.textContent}));}catch{}
    error.receipt={browser:name,passed:false,stage,error:error.stack,checks,measurements,diagnostic,errors,consoleErrors};throw error;
  }finally{await page.close();}
}
const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),metadata={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),metadata,'Source changed during check');served.set(key,metadata);res.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');res.end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{let failure;
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port;
    for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
      try{results.push(await check(browser,name,origin));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);
  }catch(error){failure=error;}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results,missing,external,httpErrors,expectedBlockedMonaco:blockedMonaco,
    assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack}:{})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
