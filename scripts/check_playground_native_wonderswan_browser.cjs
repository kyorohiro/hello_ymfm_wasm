// Full Playground UI and real Main/Worker clients; only Tauri RPC is mocked.
// Native rendering/parity is verified by the independent C++/Rust tests.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const rootOption=process.argv.find(value=>value.startsWith('--root='));
const docs=rootOption?path.resolve(rootOption.slice(7)):path.resolve(__dirname,'../docs');
const entry=rootOption?'/index.html':'/playground/index.html';
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml'};
const accessor='\nwindow.__nativeWs={runtime,megaDrive,selectedMode,setSource:value=>editorAdapter.setValue(value)};';
const server=http.createServer(async(request,response)=>{try{const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);let filename=path.resolve(docs,'.'+pathname);if(!filename.startsWith(docs+path.sep))throw Error('Invalid path');if((await fs.stat(filename)).isDirectory())filename=path.join(filename,'index.html');let body=await fs.readFile(filename);if(pathname.endsWith('/playground.js'))body=Buffer.from(body.toString()+accessor);response.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');response.end(body);}catch(error){response.writeHead(404).end(error.message);}});

async function mock() {
  const {WonderSwanVoiceInspector}=await import('../web/playground_wonderswan_inspector.js');
  const calls=[],rack=new Map();let session=0,mode='genesis',primary,began=performance.now();
  const source=clock=>({clock,held:new Map(),inspector:new WonderSwanVoiceInspector({clock:()=>clock,sampleRate:48000}),initialized:false});
  const status=()=>({session,mode,sampleRate:48000,frame:Math.floor((performance.now()-began)*48),running:true,ymClock:7670454,psgClock:3579545,wonderswanClock:primary?.clock??3072000});
  const image=s=>({clock:s.clock,registers:[...s.inspector.registers],authoredRegisters:[...s.inspector.registers],memory:[...s.inspector.memory],initialized:s.initialized,held:[...s.held.keys()],pendingCommands:[],sourceMuteMask:0,...status()});
  function apply(s,m,bypass=false) {
    const i=s.inspector;
    if(m.method==='batch'){if(m.action==='off'&&s.held.get(m.channel)!==m.voice)return;for(const command of m.commands)apply(s,command,true);if(m.action==='on')s.held.set(m.channel,m.voice);else if(m.action==='off')s.held.delete(m.channel);}
    else if(m.method==='reset'){if(!s.held.size||bypass){i.reset();s.initialized=false;}}
    else if(m.method==='write'){if(m.address===0x90){let mask=m.controlMask??255;if(!bypass)for(const ch of s.held.keys())mask&=~((1<<ch)|[0,32,64,128][ch]);i.observeWrite(m.address,(i.registers[16]&~mask)|(m.value&mask));}else if(bypass||m.channel===undefined||!s.held.has(m.channel))i.observeWrite(m.address,m.value);s.initialized=true;}
    else if(m.method==='memory')i.observeMemory(m.address,m.value);
    else if(m.method==='key-off'){if(bypass||!s.held.has(m.channel))i.registers[16]&=~(1<<m.channel);}
    else if(m.method==='clock'){if(s.held.size)throw Error('Release the manually held WonderSwan voices before changing the clock');s.clock=m.hz;}
    else if(m.method==='mix')s.mix={volume:m.volume,pan:m.pan};
    else if(m.method==='stop-voices')for(let ch=0;ch<4;ch++)if(!s.held.has(ch))i.registers[16]&=~(1<<ch);
  }
  return {calls,rack,status,commands:()=>calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]),async invoke(command,args={}){
    calls.push({command,args});
    if(command==='native_genesis_start'){session++;mode=args.mode??'genesis';began=performance.now();primary=source(args.clock??3072000);rack.clear();}
    const match=/^native_genesis_extra_wonderswan_(create|dispose|status)$/.exec(command);
    if(match){if(match[1]==='create')rack.set(args.instance,source(args.clock??3072000));if(match[1]==='dispose'){rack.delete(args.instance);return true;}return{wonderswan:image(rack.get(args.instance)),...status()};}
    if(command==='native_genesis_wonderswan_status')return image(primary);
    if(command==='native_genesis_commands'){for(const c of args.commands)if(['wonderswan','extra-wonderswan'].includes(c.type)){const s=c.type==='wonderswan'?primary:rack.get(c.instance);if(c.message.method==='clock'&&s.held.size)throw Error('Release the manually held WonderSwan voices before changing the clock');}for(const c of args.commands)if(c.type==='wonderswan')apply(primary,c.message);else if(c.type==='extra-wonderswan')apply(rack.get(c.instance),c.message);}
    if(command==='native_genesis_monitor')return null;
    if(command==='native_genesis_stop'||command==='native_genesis_shutdown'){rack.clear();if(primary){primary.held.clear();primary.inspector.registers[16]&=240;}}
    return status();
  }};
}
async function until(test,label){const end=Date.now()+12000;while(!await test()){if(Date.now()>end)throw Error(label+' timed out');await new Promise(resolve=>setTimeout(resolve,15));}}
async function check(type,name,base) {
  const browser=await type.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});
  try {
    const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),native=await mock(),errors=[],failed=[];
    await page.exposeBinding('__nativeWsInvoke',(_event,command,args)=>native.invoke(command,args));
    await page.addInitScript(()=>{
      window.__TAURI_INTERNALS__={invoke:(command,args)=>window.__nativeWsInvoke(command,args)};
      window.__wsAudioNodes=[];
      for(const name of ['AudioContext','webkitAudioContext','AudioWorkletNode'])if(window[name])window[name]=new Proxy(window[name],{construct(){window.__wsAudioNodes.push(name);throw Error('Native WonderSwan created '+name);}});
    });
    await page.route('**/vs/loader*.js',route=>route.abort());page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)failed.push(response.url());});page.setDefaultTimeout(20000);
    const ready=async(mode)=>{await page.goto(base+`?mode=${mode}&audioEngine=native&no-sw=1`);await page.waitForFunction(()=>window.__nativeWs);await page.locator('#startupNotice').waitFor({state:'hidden'});};
    const read=id=>page.evaluate(id=>window.__nativeWs.runtime.chipInspector.read(id),id);
    const run=async(code,execution)=>{await page.evaluate(({code,execution})=>window.__nativeWs.runtime.playSource(code,{execution}),{code,execution});await page.waitForFunction(()=>document.getElementById('consoleOutput').textContent.includes('ws-ready'));};
    const stop=()=>page.evaluate(()=>window.__nativeWs.runtime.stopWithFade());
    await ready('wonderswan');assert.equal(native.calls.filter(c=>c.command==='native_genesis_start').length,0);
    const ids=await page.locator('#playgroundMode option').evaluateAll(options=>options.map(option=>option.value));assert(ids.includes('wonderswan'));assert(!ids.includes('atari-st'));
    assert.equal(await page.evaluate(()=>window.__nativeWs.megaDrive.capabilities.backend),'native-genesis');
    for(const execution of ['main','worker']){
      await run(`const a=await useSoundChip('wonderswan');if(a.id!=='wonderswan'||a.dispose)throw Error('Not borrowed');a.noteOn(0,'C4');log('ws-ready');`,execution);
      await until(async()=>{const s=await read('wonderswan');return s.channels[0].active;},'primary gates');
      await page.click('#wonderswanTab');await page.locator('#wonderswanPanel [data-chip-control="ws-frequency"]').waitFor();
      await page.locator('#wonderswanPanel [data-chip-channel="2"]').click();
      await page.locator('#wonderswanPanel [data-chip-control="ws-pan-left"]').evaluate(node=>{node.value='4';node.dispatchEvent(new Event('change',{bubbles:true}));});
      await until(async()=> (await read('wonderswan')).channels[2].pan.left===4,'Native pan editor');
      await page.locator('#wonderswanPanel [data-chip-action="ws-wave-square"]').click();
      await until(async()=> (await read('wonderswan')).channels[2].waveform[0]===15,'Native wave editor');
      const first=native.commands().length;await page.locator('#wonderswanPanel [data-chip-action="ws-keyboard"]').click();await page.locator('#wonderswanTab').focus();await page.keyboard.down('z');
      try{await until(()=>native.commands().slice(first).some(c=>c.type==='wonderswan'&&c.message.action==='on'&&c.message.channel===2),'Operator Keyboard on');}finally{await page.keyboard.up('z');}
      await until(()=>native.commands().slice(first).some(c=>c.type==='wonderswan'&&c.message.action==='off'&&c.message.channel===2),'Operator Keyboard off');
      await stop();assert(!(await read('wonderswan')).channels.some(c=>c.active));
    }
    await ready('genesis');
    for(const execution of ['main','worker']){
      await run(`const a=await createSoundChip('wonderswan',{id:'ws-ui'});a.initialize();a.noteOn(3,'A4');log('ws-ready');`,execution);
      await page.click('#consoleTab');await page.locator('#wonderswanTab').waitFor({state:'visible'});await page.click('#wonderswanTab');
      await page.selectOption('#wonderswanPanel [data-chip-control="instance"]','ws-ui');await page.locator('#wonderswanPanel [data-chip-channel="3"]').click();
      const first=native.commands().length;await page.locator('#wonderswanPanel [data-chip-action="ws-keyboard"]').click();await page.locator('#wonderswanTab').focus();await page.keyboard.down('z');
      try{await until(()=>native.commands().slice(first).some(c=>c.type==='extra-wonderswan'&&c.message.action==='on'&&c.message.channel===3),'additional Operator Keyboard on');}finally{await page.keyboard.up('z');}
      await until(()=>native.commands().slice(first).some(c=>c.type==='extra-wonderswan'&&c.message.action==='off'&&c.message.channel===3),'additional Operator Keyboard off');
      assert.equal((await read('ws-ui')).channels.length,4);await stop();assert.equal(native.rack.size,0);assert.equal(await page.locator('#wonderswanTab').isVisible(),false);
    }
    assert.deepEqual(await page.evaluate(()=>window.__wsAudioNodes),[]);assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
    await page.evaluate(()=>window.__nativeWs.runtime.finalize());await context.close();
    console.log(JSON.stringify({browser:name,primary:true,additional:true,main:true,worker:true,modeFilter:true,waveEditor:true,operatorKeyboard:true,stop:true,audioNodes:0,nativeRpc:'mocked',passed:true}));
  }finally{await browser.close();}
}
(async()=>{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});try{const base=`http://127.0.0.1:${server.address().port}${entry}`;for(const[name,type]of process.argv.includes('--chromium')?[['chromium',chromium]]:process.argv.includes('--webkit')?[['webkit',webkit]]:[['chromium',chromium],['webkit',webkit]])await check(type,name,base);}finally{await new Promise(resolve=>server.close(resolve));}})().catch(error=>{console.error(error);process.exitCode=1;});
