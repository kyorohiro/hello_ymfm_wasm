// Real browser/runtime/logic Worker; Native command IPC alone is mocked.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {extraChipCount}=require('./native_backend_extra_limits.cjs');
const kinds=['segapsg','ym2612','ym2203','ym2608','ym2610','ym2151','ym2413','ay8910','ym3526','ym3812','y8950','ymf262','rf5c164','okim6258','gameboy','nes','huc6280','dx7','pwm','snes','spc'];
function holdExtraCreation(native){
  const invoke=native.invoke.bind(native);let held=null;
  native.invoke=async(command,args)=>{
    const result=await invoke(command,args),gate=held;
    if(gate&&command===`native_genesis_extra_${gate.kind==='segapsg'?'psg':gate.kind}_create`){held=null;gate.args=args;gate.arrive(args);await gate.promise;}
    return result;
  };
  return {hold(kind){assert.equal(held,null);let release,arrive;const gate={kind,promise:new Promise(resolve=>{release=resolve;}),arrived:new Promise(resolve=>{arrive=resolve;}),arrive:args=>arrive(args),release:()=>{if(held===gate)held=null;release();}};held=gate;return gate;}};
}
function observeExtraCreationResponses(){
  const post=Worker.prototype.postMessage;let enabled=false;const held=[];
  Worker.prototype.postMessage=function(message,options){
    if(enabled&&message.type==='response'&&message.value?.id==='creation-pending'){
      enabled=false;held.push({worker:this,message,options});return;
    }
    return post.call(this,message,options);
  };
  window.__nativeCreationResponses={hold(){if(held.length)throw Error('Response is already held');enabled=true;},get count(){return held.length;},release(){for(const entry of held.splice(0))post.call(entry.worker,entry.message,entry.options);}};
}
async function runExtraCreation({page,native,gate,tracker,artifacts,name,until,assertNoLiveAudio}){
  const rows=[],limits=['Native IPC is mocked; no physical output, DSP accuracy or heap-GC assertion.','Port counters cover tracked main-page handles and close transferred handles with the owning Worker.'];
  const commands=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]);
  const book=()=>page.evaluate(()=>{const s=window.__nativeBackendTest.runtime.megaDrive;return {devices:s.extraDevices.size,reserved:s.mixer.reservedIds.size,requests:s.acceptedRequests,commands:s.acceptedCommands,queued:s.pending.length,resources:window.__nativeLifecycleResources()};});
  const run=async(source,execution)=>page.evaluate(({source,execution})=>window.__nativeBackendTest.runtime.playSource(source,{execution}),{source,execution});
  async function noWork(label){
    await until(()=>tracker.stats.pending===0,label+' Native IPC');
    await page.waitForFunction(()=>{const s=window.__nativeBackendTest.runtime.megaDrive;return s.acceptedRequests===0&&s.acceptedCommands===0&&s.pending.length===0;});
    const state=await book();assert.equal(state.devices,0,label+' devices');assert.equal(state.reserved,0,label+' reserved IDs');assert.equal(extraChipCount(native),0,label+' Native rack');return state;
  }
  async function stop(label){await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());return noWork(label);}
  async function cancel(execution){
    if(execution==='main')await page.evaluate(()=>window.__nativeBackendTest.runtime.context.cancelCreation());
    else await page.evaluate(()=>window.__nativeBackendTest.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60,velocity:100}));
  }
  for(const execution of ['main','worker'])for(const kind of kinds){
    const marker=`creation-${execution}-${kind}`,held=gate.hold(kind),before=commands().length;
    try{
      await run(`liveLoop('make',async()=>{await createSoundChip(${JSON.stringify(kind)},{id:'creation-pending'});log(${JSON.stringify(marker+'-stale')});await beat(100);});${execution==='main'?"context.cancelCreation=()=>stopLoop('make');":"keyboard.bind('cancel',{noteOn(){stopLoop('make');log('creation-cancelled');},noteOff(){},allNotesOff(){}});"}`,execution);
      await until(()=>Boolean(held.args),marker+' Native create reply held');await cancel(execution);
      await page.waitForFunction(()=>{const s=window.__nativeBackendTest.runtime.megaDrive;return s.extraDevices.size===0&&s.mixer.reservedIds.size===0;});
    }finally{held.release();}
    await noWork(marker+' cancelled');
    const beforeReplacement=commands().slice(before);assert(!beforeReplacement.some(c=>c.instance===held.args.instance),'Cancelled source must not initialize or execute after the delayed reply');
    assert(!await page.locator('#consoleOutput').innerText().then(s=>s.includes(marker+'-stale')),'Cancelled user continuation');
    await run(`await createSoundChip(${JSON.stringify(kind)},{id:'creation-pending'});log(${JSON.stringify(marker+'-replaced')});`,execution);
    await until(()=>extraChipCount(native)===1,marker+' replacement');
    const state=await book();assert.equal(state.devices,1);assert.equal(state.reserved,0);
    rows.push({kind,execution,phase:'pending Native reply',oldInstance:held.args.instance,stopped:await stop(marker+' stop')});
  }
  for(const kind of kinds){
    const marker=`late-worker-${kind}`;await page.evaluate(()=>window.__nativeCreationResponses.hold());
    await run(`liveLoop('make',async()=>{await createSoundChip(${JSON.stringify(kind)},{id:'creation-pending'});log(${JSON.stringify(marker+'-stale')});await beat(100);});keyboard.bind('cancel',{noteOn(){stopLoop('make');log(${JSON.stringify(marker+'-cancelled')});},noteOff(){},allNotesOff(){}});`,'worker');
    await page.waitForFunction(()=>window.__nativeCreationResponses.count===1);
    await cancel('worker');await page.waitForFunction(marker=>document.getElementById('consoleOutput').textContent.includes(marker+'-cancelled'),marker);
    await page.evaluate(()=>window.__nativeCreationResponses.release());await noWork(marker+' late reply');
    assert(!await page.locator('#consoleOutput').innerText().then(s=>s.includes(marker+'-stale')),'Late response must not resume cancelled owner');
    await run(`await createSoundChip(${JSON.stringify(kind)},{id:'creation-pending'});log(${JSON.stringify(marker+'-replaced')});`,'worker');
    await until(()=>extraChipCount(native)===1,marker+' replacement');rows.push({kind,execution:'worker',phase:'held transferred response',stopped:await stop(marker+' stop')});
  }
  // A cached source belongs to the run. Cancelling one waiter keeps its sibling.
  for(const execution of ['main','worker'])for(const kind of ['segapsg','ym2612','ym2203','spc']){
    const marker=`shared-${execution}-${kind}`,held=gate.hold(kind);
    try{
      await run(`liveLoop('first',async()=>{await useSoundChip(${JSON.stringify(kind)});log(${JSON.stringify(marker+'-stale')});await beat(100);});liveLoop('second',async()=>{const a=await useSoundChip(${JSON.stringify(kind)});if(a!==await useSoundChip(${JSON.stringify(kind)}))throw Error('Shared cache split');log(${JSON.stringify(marker+'-ready')});await beat(100);});${execution==='main'?"context.cancelCreation=()=>stopLoop('first');":"keyboard.bind('cancel',{noteOn(){stopLoop('first');},noteOff(){},allNotesOff(){}});"}`,execution);
      await until(()=>Boolean(held.args),marker+' Native create reply held');await cancel(execution);
    }finally{held.release();}
    await page.waitForFunction(marker=>document.getElementById('consoleOutput').textContent.includes(marker+'-ready'),marker);assert.equal(extraChipCount(native),1);
    assert(!await page.locator('#consoleOutput').innerText().then(s=>s.includes(marker+'-stale')),'Cancelled shared waiter resumed');
    rows.push({kind,execution,phase:'shared surviving waiter',stopped:await stop(marker+' stop')});
  }
  await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());await until(()=>tracker.stats.pending===0&&tracker.stats.activeWorkers===0,'Final Native IPC/Worker cleanup');
  const final=await book();assert.equal(final.devices,0);assert.equal(final.reserved,0);
  for(const key of ['workersActive','localPortsOpen','transferredPortsOpen','activeTargetListeners','activePropertyHandlers'])assert.equal(final.resources[key],0,'Final '+key);
  await fs.writeFile(path.join(artifacts,name+'-extra-creation.json'),JSON.stringify({schemaVersion:1,mockedNative:true,deviceOpened:false,limits,kinds,rows,final,transport:tracker.stats},null,2));
}
module.exports={holdExtraCreation,observeExtraCreationResponses,runExtraCreation};
