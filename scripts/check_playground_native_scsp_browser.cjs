// Full Playground UI and real Main/Worker clients; only Tauri RPC is mocked.
// Native rendering/parity is verified by the independent C++/Rust tests.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const rootOption=process.argv.find(value=>value.startsWith('--root='));
const docs=rootOption?path.resolve(rootOption.slice(7)):path.resolve(__dirname,'../docs');
const entry=rootOption?'/index.html':'/playground/index.html';
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml'};
const accessor='\nwindow.__nativeScsp={runtime,megaDrive,selectedMode,setSource:value=>editorAdapter.setValue(value)};';
const server=http.createServer(async(request,response)=>{try{const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);let filename=path.resolve(docs,'.'+pathname);if(!filename.startsWith(docs+path.sep))throw Error('Invalid path');if((await fs.stat(filename)).isDirectory())filename=path.join(filename,'index.html');let body=await fs.readFile(filename);if(pathname.endsWith('/playground.js'))body=Buffer.from(body.toString()+accessor);response.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');response.end(body);}catch(error){response.writeHead(404).end(error.message);}});

async function mock() {
 const calls=[],rack=new Map();let session=0,mode='scsp',primary,began=performance.now(),revision=0;
 const source=()=>({registers:Array(513).fill(0),held:new Map(),enabled:0,ram:new Uint8Array(524288)});
 const status=()=>({session,mode,sampleRate:48000,frame:Math.floor((performance.now()-began)*48),running:true,ymClock:7670454,psgClock:3579545});
 const image=s=>({...status(),registers:s.registers,nativeFrames:0,enabled:s.enabled>>>0,held:[...s.held.keys()],pendingCommands:[],revision:++revision});
 function apply(s,m) {
  if(m.method==='batch'){const held=s.held.get(m.channel);if(held!==undefined&&(!m.audition||m.action!=='on'&&held!==m.voice))return;for(const c of m.commands)s.registers[c.register/2]=(s.registers[c.register/2]&~(c.mask??65535))|(c.value&(c.mask??65535));if(m.action==='on'){s.enabled|=2**m.channel;if(m.audition)s.held.set(m.channel,m.voice);}else if(m.action==='off'){s.enabled&=~(2**m.channel);s.held.delete(m.channel);}}
  else if(m.method==='reset'||m.method==='stop-voices'){s.registers.fill(0);s.registers[512]=0x020f;s.enabled=0;s.held.clear();if(m.clearRam)s.ram.fill(0);}
  else if(m.method==='load-memory')s.ram.set(m.data,m.address);
 }
 return {calls,rack,status,commands:()=>calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]),async invoke(command,args={}){
  calls.push({command,args});if(command==='native_genesis_start'){session++;mode=args.mode??'genesis';began=performance.now();primary=source();rack.clear();}
  const match=/^native_genesis_extra_scsp_(create|dispose|status)$/.exec(command);
  if(match){if(match[1]==='create')rack.set(args.instance,source());if(match[1]==='dispose'){rack.delete(args.instance);return true;}return{scsp:image(rack.get(args.instance)),...status(),revision:++revision};}
  if(command==='native_genesis_scsp_status')return image(primary);
  if(command==='native_genesis_commands')for(const c of args.commands)if(c.type==='scsp')apply(primary,c.message);else if(c.type==='extra-scsp')apply(rack.get(c.instance),c.message);
  if(command==='native_genesis_stop'||command==='native_genesis_shutdown'){rack.clear();if(primary)apply(primary,{method:'stop-voices'});}
  if(command==='native_genesis_monitor')return null;return status();
 }};
}
async function until(test,label){const end=Date.now()+12000;while(!await test()){if(Date.now()>end)throw Error(label+' timed out');await new Promise(resolve=>setTimeout(resolve,15));}}
async function check(type,name,base) {
  const browser=await type.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});
  try {
    const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),native=await mock(),errors=[],failed=[];
    await page.exposeBinding('__nativeScspInvoke',(_event,command,args)=>native.invoke(command,args));
    await page.addInitScript(()=>{
      window.__TAURI_INTERNALS__={invoke:(command,args)=>window.__nativeScspInvoke(command,args)};
      window.__scspAudioNodes=[];
      for(const name of ['AudioContext','webkitAudioContext','AudioWorkletNode'])if(window[name])window[name]=new Proxy(window[name],{construct(){window.__scspAudioNodes.push(name);throw Error('Native SCSP created '+name);}});
    });
    await page.route('**/vs/loader*.js',route=>route.abort());page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)failed.push(response.url());});page.setDefaultTimeout(20000);
    const ready=async(mode)=>{await page.goto(base+`?mode=${mode}&audioEngine=native&no-sw=1`);await page.waitForFunction(()=>window.__nativeScsp);await page.locator('#startupNotice').waitFor({state:'hidden'});};
    const read=id=>page.evaluate(id=>window.__nativeScsp.runtime.chipInspector.read(id),id);
    const run=async(code,execution)=>{await page.evaluate(({code,execution})=>window.__nativeScsp.runtime.playSource(code,{execution}),{code,execution});await page.waitForFunction(()=>document.getElementById('consoleOutput').textContent.includes('ws-ready'));};
    const stop=()=>page.evaluate(()=>window.__nativeScsp.runtime.stopWithFade());
    await ready('scsp');assert.equal(native.calls.filter(c=>c.command==='native_genesis_start').length,0);
    const ids=await page.locator('#playgroundMode option').evaluateAll(options=>options.map(option=>option.value));assert(ids.includes('scsp'));assert(!ids.includes('atari-st'));
    assert.equal(await page.evaluate(()=>window.__nativeScsp.megaDrive.capabilities.backend),'native-genesis');
    for(const execution of ['main','worker']){
      await run(`const a=await useSoundChip('scsp');if(a.id!=='scsp'||a.dispose)throw Error('Not borrowed');a.noteOn(31,'C4');log('ws-ready');`,execution);
      await until(async()=> (await read('scsp')).slots[31].gate,'primary slot 32');
      await page.click('#scspTab');await page.locator('#scspPanel [data-scsp-slot="31"]').click();
      await stop();assert(!(await read('scsp')).slots.some(c=>c.gate));
      await page.click('#scspPanel [data-chip-action="scsp-square"]');await page.click('#scspPanel [data-chip-action="scsp-apply"]');
      await until(async()=> (await read('scsp')).slots[31].sample.editorOwned,'Native PCM editor');
      await page.selectOption('#scspPanel [data-chip-control="scsp-lfo-frequencyCode"]','20');
      await page.selectOption('#scspPanel [data-chip-control="scsp-lfo-pitchDepth"]','3');
      await page.selectOption('#scspPanel [data-chip-control="scsp-lfo-amplitudeDepth"]','4');
      await until(async()=> (await read('scsp')).slots[31].lfo.amplitudeDepth===4,'Native LFO editor');
      const first=native.commands().length,hold=page.locator('#scspPanel [data-chip-action="scsp-hold"]');await hold.scrollIntoViewIfNeeded();const box=await hold.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
      try{await until(()=>native.commands().slice(first).some(c=>c.type==='scsp'&&c.message.action==='on'&&c.message.channel===31),'Hold on');}finally{await page.mouse.up();}
      await until(()=>native.commands().slice(first).some(c=>c.type==='scsp'&&c.message.action==='off'&&c.message.channel===31),'Hold off');
      if(!await page.locator('#keyboardTab').isVisible())await page.locator('.dock-toggle').click();await page.locator('#keyboardTab').click();await page.locator('#operatorKeyboardRoot button').filter({hasText:/^Guitar$/}).click();
      const key=await page.locator('#operatorKeyboardRoot .key').first().getAttribute('data-key'),beforeKey=native.commands().length;await page.keyboard.down(key);try{await until(()=>native.commands().slice(beforeKey).some(c=>c.type==='scsp'&&c.message.audition&&c.message.action==='on'),'PC Keyboard on');}finally{await page.keyboard.up(key);}
      await until(()=>native.commands().slice(beforeKey).some(c=>c.type==='scsp'&&c.message.audition&&c.message.action==='off'),'PC Keyboard off');
    }
    await ready('scsp');
    for(const execution of ['main','worker']){
      await run(`const a=await useSoundChip('scsp');const wave=await a.loadPCM(new Int16Array([0,8192,0,-8192]),{rootNote:69,loopStartSamples:0,modulationDepth:12});a.setPreset(0,{sample:wave,directLevel:0});a.setPreset(1,{sample:wave,modulation:{depth:9,xOffset:63,yOffset:63}});a.noteOn(0,57);a.noteOn(1,69);log('ws-ready');`,execution);
      await until(async()=> (await read('scsp')).slots[1].gate,'FM carrier');
      await page.click('#scspTab');await page.click('#scspPanel [data-scsp-slot="1"]');
      const depth=page.locator('#scspPanel [data-chip-control="scsp-modulation-depth"]');await depth.fill('10');await depth.dispatchEvent('change');
      await until(async()=> (await read('scsp')).slots[1].modulation.depth===10,'Native FM live UI');
      assert.equal((await read('scsp')).slots[0].directLevel,0);
      assert(native.commands().some(c=>c.type==='scsp'&&c.message.commands?.some(op=>op.register===46&&(op.value>>12)===10)));
      await stop();
    }
    await ready('genesis');
    for(const execution of ['main','worker']){
      await run(`const a=await createSoundChip('scsp',{id:'scsp-ui'});const wave=await a.loadPCM(new Int8Array([0,64,0,-64]),{rootNote:69,loopStartSamples:0,modulationDepth:12});a.setPreset(31,{sample:wave,modulation:{depth:9,xOffset:63,yOffset:63}});a.setModulation(31,{depth:8});a.noteOn(31,'A4');log('ws-ready');`,execution);
      await until(async()=> (await read('scsp-ui')).slots[31].gate,'additional slot 32');assert.equal((await read('scsp-ui')).slots[31].modulation.depth,8);
      await stop();assert.equal(native.rack.size,0);
    }
    assert.deepEqual(await page.evaluate(()=>window.__scspAudioNodes),[]);assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
    await page.evaluate(()=>window.__nativeScsp.runtime.finalize());await context.close();
    console.log(JSON.stringify({browser:name,primary:true,additional:true,main:true,worker:true,modeFilter:true,waveEditor:true,lfo:true,slotModulation:true,operatorKeyboard:true,stop:true,audioNodes:0,nativeRpc:'mocked',passed:true}));
  }finally{await browser.close();}
}
(async()=>{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});try{const base=`http://127.0.0.1:${server.address().port}${entry}`;for(const[name,type]of process.argv.includes('--chromium')?[['chromium',chromium]]:process.argv.includes('--webkit')?[['webkit',webkit]]:[['chromium',chromium],['webkit',webkit]])await check(type,name,base);}finally{await new Promise(resolve=>server.close(resolve));}})().catch(error=>{console.error(error);process.exitCode=1;});
