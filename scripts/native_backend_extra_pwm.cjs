// Real Main / logic Worker / register editor; only Native IPC is mocked.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {extraChipCount}=require('./native_backend_extra_limits.cjs');
const olderKinds=['segapsg','ym2612','ym2203','ym2608','ym2610','ym2151','ym2413','ay8910','ym3526','ym3812','y8950','ymf262','rf5c164','okim6258','gameboy','nes','huc6280','dx7'];

function installExtraPwmMock(native){
  const invoke=native.invoke.bind(native);native.extraPwm=new Map();
  async function fresh(){
    const {PWM32X}=await import('../web/pwm32x.js');
    return {chip:new PWM32X({sampleRate:48000,clock:23011361,outputMode:'duty',gain:1}),queue:[],order:0,lastSchedule:null,mix:{volume:1,pan:0}};
  }
  function advance(s){const frame=native.status().frame;while(s.queue[0]?.frame<=frame){const op=s.queue.shift();s.chip.writeRegister(op.register,op.value);}}
  const snapshot=s=>{advance(s);return{sampleRate:48000,frame:native.status().frame,revision:native.calls.length,pwm:{
    model:'mame',outputMode:'duty',clock:s.chip.clock,sampleRate:48000,currentFrame:native.status().frame,
    queuedWrites:s.queue.length,registers:Array.from({length:5},(_,i)=>s.chip.read(i)),lastSchedule:s.lastSchedule,pendingCommands:[],
  }};};
  const same=(entry,message,command)=>message.group!==undefined?entry.group===message.group:command.owner!==undefined?entry.performance===command.performance&&entry.owner===command.owner:true;
  function apply(s,m,c){
    advance(s);
    if(m.method==='write')s.chip.writeRegister(m.register,m.value);
    else if(m.method==='clock')s.chip.clock=m.hz;
    else if(m.method==='mix')s.mix={volume:m.volume,pan:m.pan};
    else if(m.method==='schedule-writes'){
      assert(Array.isArray(m.entries)&&m.entries.length+s.queue.length<=1000000);
      const baseFrame=Math.max(native.status().frame,m.baseFrame??0);
      for(const e of m.entries){assert(Number.isSafeInteger(e.frame)&&e.frame>=0&&Number.isInteger(e.register)&&e.register>=0&&e.register<=4&&Number.isInteger(e.value)&&e.value>=0&&e.value<=65535);s.queue.push({...e,frame:baseFrame+e.frame,order:++s.order,group:m.group,performance:c.performance,owner:c.owner});}
      s.queue.sort((a,b)=>a.frame-b.frame||a.order-b.order);s.lastSchedule={id:m.id,baseFrame,error:null};advance(s);
    }else if(m.method==='clear-schedule')s.queue=s.queue.filter(e=>!same(e,m,c));
    else if(m.method==='reset'){s.queue=s.queue.filter(e=>!same(e,m,c));s.chip.reset();}
    else if(m.method==='stop-voices'){
      s.queue=s.queue.filter(e=>!same(e,m,c));
      // No output device is rendered by this mock. Actual tagged FIFO/latch
      // cancellation, timer continuity and PCM are covered in C++/Rust tests.
      if(m.group===undefined&&c.owner===undefined){s.chip.leftFifo=[];s.chip.rightFifo=[];s.chip.left=s.chip.right=null;}
    }else if(m.method==='cancel-main-owner')s.queue=s.queue.filter(e=>e.group!==m.targetGroup);
    else assert.equal(m.method,'barrier','Unknown additional PWM operation '+m.method);
  }
  native.invoke=async(command,args={})=>{
    const match=/^native_genesis_extra_pwm_(create|status|dispose)$/.exec(command);
    if(match){
      native.calls.push({command,args});assert.equal(args.session,native.current?.session);assert(Number.isSafeInteger(args.instance)&&args.instance>0);
      const map=native.extraPwm;
      if(match[1]==='create'){assert(extraChipCount(native)<16);assert(!map.has(args.instance));const s=await fresh();map.set(args.instance,s);return snapshot(s);}
      if(match[1]==='dispose'){map.get(args.instance)?.chip.dispose();map.delete(args.instance);return null;}
      const s=map.get(args.instance);assert(s);return snapshot(s);
    }
    if(command==='native_genesis_commands')for(const c of args.commands)if(c.type==='extra-pwm'){const s=native.extraPwm.get(c.instance);assert(s);apply(s,c.message,c);}
    if(command==='native_genesis_performance'&&['cancel-owner','stop'].includes(args.op))for(const s of native.extraPwm.values())s.queue=s.queue.filter(e=>e.performance!==args.performance||args.op==='cancel-owner'&&e.owner!==args.owner);
    const value=await invoke(command,args);
    if(['native_genesis_start','native_genesis_stop','native_genesis_shutdown'].includes(command)){for(const s of native.extraPwm.values())s.chip.dispose();native.extraPwm.clear();}return value;
  };
}
const program=`
  const a=await createSoundChip('pwm',{id:'pwm-a'}),b=await createSoundChip('pwm',{id:'pwm-b'});
  await a.writeRegister(0,0x0105);await a.writeRegister(1,520);await b.write(0,0x020a);await b.write(1,1024);
  await a.setClock(22000000);await b.setClock(24000000);
  const base=await a.scheduleWrites([{frame:480000,register:2,value:130},{frame:480024,register:3,value:390}]);
  const next=await b.scheduleWrites([{frame:480000,register:4,value:256}]);
  if(!Number.isSafeInteger(base)||!Number.isSafeInteger(next)||await a.read(99)!==65535)throw Error('Invalid PWM reservation/read contract');
  for(const kind of ${JSON.stringify(olderKinds.filter(k=>!['gameboy','nes','huc6280','dx7'].includes(k)))})await createSoundChip(kind,{id:'base-'+kind});
  await mixer.set(a.id,{volume:.4,pan:-.3});await mixer.set(b.id,{volume:.7,pan:.2});
  liveLoop('pwm-feed',async()=>{await a.scheduleWrites([{frame:0,register:4,value:260},{frame:24,register:4,value:300}]);await beat(.1);});
  log('pwm-ready');
`;
async function runExtraPwm({page,native,artifacts,name,until,assertNoLiveAudio,changeMode}){
  const all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]),phases=[];
  const stop=async()=>{await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());await until(()=>extraChipCount(native)===0,'Additional PWM and mixed rack retire');};
  const number=async(control,value)=>page.locator(`#pwmPanel [data-chip-control="pwm-${control}"]`).evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('change',{bubbles:true}));},value);
  for(const execution of ['main','worker']){
    const before=all().length;await page.evaluate(({program,execution})=>window.__nativeBackendTest.runtime.playSource(program,{execution}),{program,execution});
    await until(()=>extraChipCount(native)===16&&native.extraPwm.size===2&&all().slice(before).some(c=>c.type==='extra-pwm'&&c.message.method==='mix'&&c.message.volume===.7),'Independent PWM and mixed sixteen-slot rack');
    const states=[...native.extraPwm.values()],snapshot=await page.evaluate(async()=>({a:await window.__nativeBackendTest.runtime.chipInspector.read('pwm-a'),b:await window.__nativeBackendTest.runtime.chipInspector.read('pwm-b'),mixer:window.__nativeBackendTest.runtime.megaDrive.mixer.list().filter(c=>c.connected),audio:window.__audioConstructions}));
    assert.deepEqual(snapshot.audio,{contexts:0,offline:0,worklets:[]});assert.equal(snapshot.mixer.length,18);
    assert.equal(snapshot.a.clock,22000000);assert.equal(snapshot.b.clock,24000000);assert.equal(snapshot.a.control,0x0105);assert.equal(snapshot.b.control,0x020a);assert.equal(snapshot.a.cycle,520);assert.equal(snapshot.b.cycle,1024);assert.equal(snapshot.a.outputMode,'duty');assert(snapshot.a.queuedWrites>=2);assert.equal(snapshot.b.queuedWrites,1);
    if(execution==='worker')await until(()=>all().slice(before).some(c=>c.type==='extra-pwm'&&c.message.method==='schedule-writes'&&c.performance&&c.owner&&c.message.baseFrame>0),'Worker PWM reservation retains clock/owner');
    await page.click('#consoleTab');await page.locator('#pwmTab').waitFor({state:'visible'});await page.click('#pwmTab');await page.selectOption('#pwmPanel [data-chip-control="instance"]','pwm-a');
    await number('cycle',640);await until(()=>states[0].chip.read(1)===640,'PWM cycle editor');assert.equal(states[1].chip.read(1),1024);
    await page.selectOption('#pwmPanel [data-chip-control="pwm-left-route"]','2');await until(()=>(states[0].chip.read(0)&3)===2,'PWM left routing editor');assert.equal(states[1].chip.read(0),0x020a);
    await page.selectOption('#pwmPanel [data-chip-control="pwm-right-route"]','0');await until(()=>(states[0].chip.read(0)&15)===2,'PWM right routing editor');
    const details=page.locator('#pwmPanel details');await details.evaluate(node=>{node.open=true;});await number('control',0x0305);await until(()=>states[0].chip.read(0)===0x0305,'PWM raw control editor');assert.equal(states[1].chip.read(0),0x020a);
    await page.selectOption('#pwmPanel [data-chip-control="instance"]','pwm-b');await number('cycle',900);await until(()=>states[1].chip.read(1)===900,'Other PWM instance editor');assert.equal(states[0].chip.read(1),640);
    await page.selectOption('#pwmPanel [data-chip-control="instance"]','pwm-a');
    const view=await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('pwm-a'));assert.equal(view.control,0x0305);assert.equal(view.cycle,640);assert.equal(view.model,'mame');
    const consoleText=await page.locator('#consoleOutput').innerText();assert.match(consoleText,/pwm-ready/);assert.doesNotMatch(consoleText,/\b(?:Error|TypeError|RangeError|ReferenceError):/,'No caught playback error in real Console');
    await page.screenshot({path:path.join(artifacts,`${name}-extra-pwm-${execution}.png`)});phases.push({execution,a:snapshot.a,b:snapshot.b});await stop();await page.locator('#pwmTab').waitFor({state:'hidden'});
  }
  // Nineteen supported kinds across two legal sixteen-slot combinations.
  for(const [execution,omit]of [['main',['gameboy','nes','huc6280']],['worker',['segapsg','ym2612','dx7']]]){
    await page.evaluate(({execution,kinds})=>window.__nativeBackendTest.runtime.playSource(`const p=await createSoundChip('pwm',{id:'full-pwm'});await p.write(0,0x105);await p.write(1,520);for(const kind of ${JSON.stringify(kinds)})await createSoundChip(kind,{id:'kind-'+kind});log('nineteen-kinds-covered');`,{execution}),{execution,kinds:olderKinds.filter(k=>!omit.includes(k))});
    await until(()=>extraChipCount(native)===16&&native.extraPwm.size===1,'Nineteen kinds in legal mixed racks');await stop();
  }
  for(const execution of ['main','worker']){
    const before=native.calls.length;
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`const old=await createSoundChip('pwm',{id:'fixed-pwm'});await old.write(0,0x105);await old.write(1,520);await old.scheduleWrites([{frame:480000,register:4,value:111}]);old.dispose();const next=await createSoundChip('pwm',{id:'fixed-pwm'});await next.setClock(21000000);await next.write(1,700);`,{execution}),execution);
    await until(()=>native.extraPwm.size===1&&[...native.extraPwm.values()][0].chip.clock===21000000,'PWM same-ID replacement');const s=[...native.extraPwm.values()][0];assert.equal(s.queue.length,0);assert.equal(s.chip.read(0),0);assert.equal(s.chip.read(1),700);
    const ids=native.calls.slice(before).filter(c=>c.command==='native_genesis_extra_pwm_create').map(c=>c.args.instance);assert.equal(ids.length,2);assert(ids[1]>ids[0]);await stop();
  }
  await changeMode(page,native,'genesis-full','keep');
  for(const execution of ['main','worker']){
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`if(await useSoundChip('pwm')!==pwm||pwm!==await useSoundChip('pwm'))throw Error('Primary PWM cache');const extra=await createSoundChip('pwm',{id:'side-pwm'});if(extra===pwm)throw Error('Additional PWM borrowed primary');await extra.write(0,0x105);await extra.write(1,321);`,{execution}),execution);
    await until(()=>native.extraPwm.size===1&&[...native.extraPwm.values()][0].chip.read(1)===321,'Independent PWM beside primary');assert.notEqual(native.pwm.read(1),321);
    await page.click('#consoleTab');await page.click('#pwmTab');await page.waitForFunction(()=>document.querySelector('#pwmPanel [data-chip-control="instance"]')?.options.length===2);await stop();await page.locator('#pwmTab').waitFor({state:'visible'});
  }
  await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
  await fs.writeFile(path.join(artifacts,name+'-extra-pwm.json'),JSON.stringify({mockedNative:true,deviceOpened:false,phases,calls:native.calls},null,2));
}
module.exports={installExtraPwmMock,runExtraPwm};
