#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Actual AudioWorklet tests. All physical destinations end in gain=0.
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {resolve,extname,dirname,sep} from 'node:path';
import {createSid8580MachineFixture} from '../test/helpers/sid8580_machine_fixtures.mjs';
import {createPsidVbiMachineFixture} from '../test/helpers/psid_vbi_machine_fixtures.mjs';
const options={root:resolve('docs'),out:resolve('docs/issues/sid8580_machine_browser_01.json')},argv=process.argv.slice(2);
for(let i=0;i<argv.length;i++){assert(['--root','--out'].includes(argv[i])&&argv[i+1]);options[argv[i].slice(2)]=resolve(argv[++i]);}
const report={format:'tetorica-sid8580-machine-worklet-browser',version:1,passed:false,
  researchOnly:true,productionAdopted:false,physicalOutputMuted:true,listeningPerformed:false,
  input:'Original authored PAL8580 programs only; no game music or firmware dump',inputs:{},results:[]};
const digest=bytes=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
for(const path of ['sid8580-lab/index.html','sid8580-lab/lab.css',...['core','parser','psid_structure','audio','processor','player','preflight'].map(n=>`sid8580-lab/${n}.js`),
  'js/sid_rsid.js','sid-player/roms.js',...['sid8580-endpoint.wasm','sid8580-machine.wasm','sid8580-machine-build.json'].map(n=>`generated/sid8580-machine/${n}`)])
  report.inputs['docs/'+path]=digest(await readFile(resolve(options.root,path)));
for(const name of ['vbi.sid','cia.sid','irq.sid','provenance.json'])report.inputs['docs/sid8580-lab/demos/'+name]=digest(await readFile(resolve(options.root,'sid8580-lab/demos',name)));
report.inputs['scripts/check_sid8580_machine_browser.mjs']=digest(await readFile(new URL(import.meta.url)));
report.inputs['test/helpers/sid8580_machine_fixtures.mjs']=digest(await readFile(new URL('../test/helpers/sid8580_machine_fixtures.mjs',import.meta.url)));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.sid':'application/octet-stream','.md':'text/plain'};
const server=createServer(async(req,res)=>{
  try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(options.root,'.'+pathname);
    if(!file.startsWith(options.root+sep)||(await stat(file)).isDirectory()){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
function instrument(){
  const audit=window.__sid8580Audit={contexts:[],worklets:[],sinks:[],messages:[],nextId:0};
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode;
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
  window.AudioContext=class extends Context{constructor(...args){super(...args);audit.contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  const methods=new WeakMap();
  window.AudioWorkletNode=class extends Worklet{constructor(...args){super(...args);audit.worklets.push(this);
    let proto=this.port,descriptor;while(proto&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(proto,'onmessage');proto=Object.getPrototypeOf(proto);}
    if(!descriptor?.set)throw new Error('Browser audit cannot hold a Worklet reply');
    let listener=null;const nativeSetter=descriptor.set;
    Object.defineProperty(this.port,'onmessage',{configurable:true,get(){return listener;},set(value){listener=value;
      nativeSetter.call(this,value?function(event){const method=methods.get(this)?.get(event.data?.id);
        if(audit.holdNextReply&&audit.holdNextReply===method){audit.holdNextReply=null;audit.releaseReply=()=>{audit.releaseReply=null;value.call(this,event);};return;}
        value.call(this,event);}:null);
    }});
  }};
  MessagePort.prototype.postMessage=function(data,...args){if(data?.method){audit.messages.push({method:data.method,id:data.id});
    if(!methods.has(this))methods.set(this,new Map());methods.get(this).set(data.id,data.method);}return post.call(this,data,...args);};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination===this.context.destination){const analyser=this.context.createAnalyser(),mute=this.context.createGain();
      analyser.fftSize=4096;mute.gain.value=0;connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);
      audit.sinks.push({context:this.context,analyser,mute});return destination;}
    return connect.call(this,destination,...args);
  };
  audit.command=(method='read',args=[])=>new Promise((resolve,reject)=>{
    const node=audit.worklets.findLast(n=>n.context.state!=='closed');if(!node)return reject(new Error('No running research Worklet'));
    const id=--audit.nextId,timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(new Error('Worklet audit timeout'));},6000);
    function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(new Error(data.error)):resolve(data.value);}
    node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args});
  });
  audit.sample=()=>{const sink=audit.sinks.findLast(s=>s.context.state==='running'),pcm=new Float32Array(4096);
    if(sink)sink.analyser.getFloatTimeDomainData(pcm);let sum=0,peak=0;for(const x of pcm){sum+=x*x;peak=Math.max(peak,Math.abs(x));}
    return {rms:Math.sqrt(sum/pcm.length),peak,finite:pcm.every(Number.isFinite),muted:audit.sinks.every(s=>s.mute.gain.value===0),runningContexts:audit.contexts.filter(c=>c.state==='running').length};};
}
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin=`http://127.0.0.1:${server.address().port}`;
try{
  for(const [engine,type]of [['chromium',chromium],['webkit',webkit]]){
    const browser=await type.launch({headless:true}),checks=[],errors=[],measurements={};let hold=null,release=null;
    try{
      const page=await browser.newPage({viewport:{width:1080,height:1000}});page.setDefaultTimeout(20000);
      page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(instrument);
      await page.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol))return route.abort();
        if(hold&&url.pathname.endsWith(hold)){hold=null;await new Promise(resolve=>{release=resolve;});return route.continue().catch(()=>{});}
        return route.continue();
      });
      const check=name=>{checks.push(name);console.log(`${engine}: ${name}`);};
      const ready=()=>page.waitForFunction(()=>document.querySelector('#status').dataset.state==='ready'&&!document.querySelector('#play').disabled);
      const state=()=>page.evaluate(()=>__sid8580Audit.command());
      const sample=()=>page.evaluate(()=>__sid8580Audit.sample());
      const sound=()=>page.waitForFunction(()=>{const s=__sid8580Audit.sample();return s.finite&&s.muted&&s.rms>1e-5&&s.runningContexts===1;});
      const silent=()=>page.waitForFunction(()=>{const s=__sid8580Audit.sample();return s.finite&&s.muted&&s.peak<1e-8&&s.runningContexts===0;});
      const play=async()=>{await page.locator('#play').click();await page.waitForFunction(()=>document.querySelector('#status').dataset.state==='playing');await sound();
        const s=await state();assert.equal(s.model,8580);assert.equal(s.bridge,'direct-wasm-function-imports');assert.equal(s.perCycleJavaScriptCallbacks,0);
        assert(s.linkedSidFunctions.includes('sid8e_tick'));assert(s.playing&&s.positionFrames>0);return s;};
      const stop=async()=>{await page.locator('#stop').click();await silent();};
      const demo=async name=>{await page.locator('#demo').selectOption(name);await page.locator('#loadDemo').click();await ready();};
      const file=async(bytes,name)=>page.locator('#sidFile').setInputFiles({name,mimeType:'application/octet-stream',buffer:Buffer.from(bytes)});
      await page.goto(origin+'/sid8580-lab/index.html');
      check('readable research page preflights actual C64 without opening audio');
      assert.match(await page.title(),/8580 Research/);assert.equal(await page.evaluate(()=>__sid8580Audit.contexts.length),0);
      await demo('vbi');assert.equal(await page.evaluate(()=>__sid8580Audit.contexts.length),0);assert.match(await page.locator('#target').textContent(),/Running: PAL \/ 8580/);
      const source=await page.evaluate(async()=>await(await fetch('./core.js')).text());assert(source.split('\n').length>70);

      check('VBI plays in a real Worklet; measured output remains physically muted');
      let s=await play();await page.waitForTimeout(700);s=await state();assert(s.playCalls>0&&s.irqCount>0);assert.equal(s.hostDcHz,12);
      assert.deepEqual(s.profiles,{resonance:false,cutoff:false});assert(s.worklet.blocks>20);assert(s.worklet.meanRenderMs<s.worklet.quantumBudgetMs);
      measurements.vbi={state:s,output:await sample()};

      check('Stop closes audio and Play reloads the subtune');
      await stop();await play();await sound();
      for(const name of ['cia','irq']){check(`${name} executes its real C64 interrupt path through Worklet`);await demo(name);s=await play();
        await page.waitForTimeout(180);s=await state();assert(s.irqCount>0);
        if(name==='cia'){assert.equal(s.timing,'cia');assert.equal(s.subtune,2);assert(s.playCalls>s.cycles/19656*2,'CIA timer cadence must exceed frame-driven playback');}
        else{assert.equal(s.format,'RSID');assert.equal(s.timing,'c64-irq');assert.equal(s.playCalls,0);}
        measurements[name]={state:s,output:await sample()};}

      check('failed CPU/POT and parser candidates retain the previous playing machine');
      const late=createPsidVbiMachineFixture({fault:'late-rom'}).bytes.slice();new DataView(late.buffer).setUint16(118,0x24);
      for(const [bytes,name]of [[createSid8580MachineFixture('pot-x').bytes,'unsupported-pot.sid'],[late,'late-init-rom.sid'],[new Uint8Array([1,2,3]),'bad.sid']]){
        const before=await state();await file(bytes,name);await page.waitForFunction(()=>document.querySelector('#status').dataset.state==='error');
        assert.match(await page.locator('#status').textContent(),/Current sound kept/);await sound();const after=await state();
        assert(after.playing&&after.cycles>before.cycles);assert.equal(after.format,before.format);assert.equal(after.timing,before.timing);
      }
      const rpcFailure=await page.evaluate(async bytes=>{
        const before=await __sid8580Audit.command();let failed=false;
        try{await __sid8580Audit.command('load',[new Uint8Array(bytes),{clock:'pal',model:'8580'}]);}catch{failed=true;}
        return {before,after:await __sid8580Audit.command(),failed};
      },[...createSid8580MachineFixture('pot-y').bytes]);
      assert(rpcFailure.failed&&rpcFailure.after.playing);assert.equal(rpcFailure.before.format,rpcFailure.after.format);await sound();
      measurements.failedWorkletLoad={lastLoadMs:rpcFailure.after.worklet.lastLoadMs,keptPlaying:true};

      check('actual Worklet SID read drives the CPU RAM and subsequent SID write');
      const causal=createSid8580MachineFixture('bus-aged');await file(causal.bytes,'bus-aged.sid');await ready();await play();
      const reads=await page.evaluate(()=>__sid8580Audit.command('readSidReads'));
      assert(reads.reads.some(r=>r.register===0&&r.value===0xa5&&r.cycle>30000&&r.error===0));
      assert.equal(await page.evaluate(()=>__sid8580Audit.command('readRam',[0x330])),0xa5);
      const writes=await page.evaluate(()=>__sid8580Audit.command('readTrace'));
      const r=reads.reads.find(r=>r.register===0&&r.value===0xa5);assert(writes.writes.some(w=>w.register===0&&w.value===r.value&&w.cycle+1===r.cycle+4));
      measurements.causal={reads:reads.reads,ram:0xa5};

      check('unknown hints require explicit selection and retain both declarations');
      const unknown=createSid8580MachineFixture('psid-vbi').bytes.slice();new DataView(unknown.buffer).setUint16(118,0x3c);
      await file(unknown,'either-model.sid');await page.waitForFunction(()=>document.querySelector('#status').dataset.state==='error');
      await page.locator('#clock').selectOption('pal');await page.waitForFunction(()=>document.querySelector('#status').dataset.state==='error');
      await page.locator('#model').selectOption('8580');await ready();s=await play();assert.equal(s.declaredClock,'any');assert.equal(s.declaredModel,'any');
      assert.deepEqual(s.selection,{clock:'explicit',model:'explicit'});

      check('both independent research profiles reach the real Worklet');
      await page.locator('#resonance').check();await page.locator('#cutoff').check();
      const filtered=createSid8580MachineFixture('bus-immediate',{filter:true});await file(filtered.bytes,'filter-profiles.sid');await ready();s=await play();
      assert.deepEqual(s.profiles,{resonance:true,cutoff:true});assert.equal(s.profileBits,3);await page.waitForTimeout(450);
      measurements.profiles={state:await state(),output:await sample()};

      check('Stop cancels held startup; stale Play never becomes audible');
      await stop();const starts=await page.evaluate(()=>__sid8580Audit.messages.filter(m=>m.method==='start').length);
      hold='/generated/sid8580-machine/sid8580-machine.wasm';await page.locator('#play').click();
      for(let i=0;!release&&i<100;i++)await page.waitForTimeout(20);assert(release,'Startup reached the held WASM request');
      await page.locator('#stop').click();release();release=null;await silent();await page.waitForTimeout(150);
      assert.equal(await page.evaluate(()=>__sid8580Audit.messages.filter(m=>m.method==='start').length),starts);
      assert.equal(await page.locator('#status').getAttribute('data-state'),'stopped');

      check('Stop retires a started engine even while its Start acknowledgement is held');
      await page.evaluate(()=>{__sid8580Audit.holdNextReply='start';});await page.locator('#play').click();
      await page.waitForFunction(()=>!!__sid8580Audit.releaseReply);await sound();
      assert.equal(await page.locator('#status').getAttribute('data-state'),'loading');
      await page.waitForTimeout(150);const quiet=(await sample()).rms;
      await page.locator('#volume').evaluate(input=>{input.value='125';input.dispatchEvent(new Event('input',{bubbles:true}));});
      await page.waitForTimeout(150);const louder=(await sample()).rms;
      assert(louder>quiet*1.8&&louder<quiet*3.5,'Master changes must reach the pending started engine');
      await page.locator('#stop').click();await silent();await page.evaluate(()=>__sid8580Audit.releaseReply());
      await page.waitForTimeout(120);await silent();assert.equal(await page.locator('#status').getAttribute('data-state'),'stopped');
      await page.locator('#volume').evaluate(input=>{input.value='50';input.dispatchEvent(new Event('input',{bubbles:true}));});

      check('Stop cancels a held demo selection without replacing the sound');
      const title=await page.locator('#title').textContent();hold='/sid8580-lab/demos/cia.sid';
      await page.locator('#demo').selectOption('cia');await page.locator('#loadDemo').click();
      for(let i=0;!release&&i<100;i++)await page.waitForTimeout(20);assert(release);
      await page.locator('#stop').click();release();release=null;await page.waitForTimeout(150);await silent();
      assert.equal(await page.locator('#title').textContent(),title);assert.equal(await page.locator('#status').getAttribute('data-state'),'stopped');

      check('fresh Play still works after cancelled loads and all old contexts retire');
      await play();await sound();assert.equal((await sample()).runningContexts,1);await stop();
      await page.setViewportSize({width:390,height:844});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Research controls must fit a narrow viewport');
      assert.deepEqual(errors,[]);assert(checks.length>=13);
      report.results.push({engine,version:browser.version(),passed:true,checks,measurements,errors});
    }finally{release?.();await browser.close();}
  }
  assert.equal(report.results.length,2);report.passed=true;await mkdir(dirname(options.out),{recursive:true});await writeFile(options.out,JSON.stringify(report,null,2)+'\n');
}finally{await new Promise(resolve=>server.close(resolve));}
