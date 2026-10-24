// Execute the shipped editable Example unchanged. Native IPC is mocked; Web
// PCM and both Main/Worker execution paths use the real deployed runtime.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {captureWebMix}=require('./native_backend_extra_stability.cjs');
const {extraChipCount}=require('./native_backend_extra_limits.cjs');
const {assertChipComparisonResources}=require('./native_backend_chip_comparison.cjs');

const example='examples/genesis/ym2612-engine-comparison.js';
const engines=['ymfm','nuked'];
const marker=index=>`YM2612 engine comparison ${index+1}/2: ${engines[index]} · FM1–6`;

async function runEngineComparison({page,native,tracker,artifacts,name,ready,assertNoLiveAudio,until}) {
  const source=await page.evaluate(async example=>{const response=await fetch(example);if(!response.ok)throw Error('Missing YM2612 engine comparison Example');return response.text();},example);
  const report={schemaVersion:1,browser:name,example:'/'+example,rows:[],limits:[
    'The shipped Example is executed unchanged. Native IPC is mocked; offline real-core tests separately verify Native PCM.',
    'Web PCM checks finite values, headroom and alternating waveforms for each engine; this is not a loudness calibration or physical output-device test.',
    'Test observers inspect Mixer lifetimes and the pre-FX bus without changing authored Mixer settings.',
  ]};
  const originalInvoke=native.invoke.bind(native);let nativeObservation;
  native.invoke=async(command,args)=>{
    const result=await originalInvoke(command,args);
    if(nativeObservation){
      const audit=nativeObservation;audit.peakRack=Math.max(audit.peakRack,extraChipCount(native));
      if(command==='native_genesis_extra_ym2612_create')audit.events.push({operation:'create',instance:args.instance,engine:args.engine});
      if(command==='native_genesis_extra_ym2612_dispose')audit.events.push({operation:'dispose',instance:args.instance});
      if(command==='native_genesis_stop')audit.events.push({operation:'bulk-stop',session:args.session,acknowledgedSession:result?.session,remainingRack:extraChipCount(native)});
    }
    return result;
  };

  async function arm(execution) {
    nativeObservation={events:[],peakRack:0};
    await page.evaluate(({source,execution})=>{
      const t=window.__nativeBackendTest,mixer=t.runtime.megaDrive.mixer;
      t.virtualFiles.writeText('/mixer/current.json','{\n  "version": 1,\n  "entries": [{"id":"ym2612","name":"ym2612","settings":{"volume":0.37}}]\n}\n');
      t.virtualFiles.writeText('/mixer/default.json','{\n  "version": 1,\n  "entries": [{"id":"ym2612","name":"ym2612","settings":{"volume":0.61,"pan":0.2}}]\n}\n');
      t.mixerState.selectPreset('/sys/mixer/default.json');
      const baseline=new Set(['ym2612','segapsg',...mixer.list().filter(entry=>entry.connected).map(entry=>entry.id)]),seen=new Set();
      const audit=window.__engineComparisonAudit={created:[],peakConnected:0,connected:[],result:null,
        currentBefore:t.virtualFiles.get('/mixer/current.json').data,defaultsBefore:t.virtualFiles.get('/mixer/default.json').data,
        projectBefore:JSON.stringify(mixer.exportState())};
      audit.release=mixer.subscribe(entries=>{
        const extras=entries.filter(entry=>entry.connected&&!baseline.has(entry.id));audit.peakConnected=Math.max(audit.peakConnected,extras.length);audit.connected=extras.map(entry=>entry.id);
        for(const entry of extras)if(!seen.has(entry.id)){
          seen.add(entry.id);audit.created.push({id:entry.id,name:entry.name,engine:entry.engine,volume:entry.volume,pan:entry.pan,
            muted:entry.muted,solo:entry.solo,kindDefault:mixer.getKindDefault('ym2612',entry.engine)});
        }
      });
      document.getElementById('consoleOutput').replaceChildren();
      t.runtime.playSource(source,{execution}).then(()=>{audit.result={fulfilled:true};},error=>{audit.result={fulfilled:false,name:error?.name,message:error?.message};});
    },{source,execution});
  }
  async function waitForMarker(index) {
    await page.waitForFunction(marker=>document.getElementById('consoleOutput').textContent.includes(marker),marker(index),{timeout:20000});
  }
  async function stopAndObserve(label) {
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    await page.waitForFunction(()=>window.__engineComparisonAudit.result!==null);
    await until(()=>tracker.stats.pending===0&&extraChipCount(native)===0,label+' Native rack/requests');
    const state=await page.evaluate(()=>{
      const t=window.__nativeBackendTest,s=t.runtime.megaDrive,a=window.__engineComparisonAudit;a.release();
      return {created:a.created,peakConnected:a.peakConnected,connected:a.connected,result:a.result,
        currentBefore:a.currentBefore,currentAfter:t.virtualFiles.get('/mixer/current.json')?.data??null,
        defaultsBefore:a.defaultsBefore,defaultsAfter:t.virtualFiles.get('/mixer/default.json')?.data??null,
        projectBefore:a.projectBefore,projectAfter:JSON.stringify(s.mixer.exportState()),reserved:s.mixer.reservedIds.size,
        devices:s.extraDevices?.size??null,requests:s.acceptedRequests??0,commands:s.acceptedCommands??0,queued:s.pending?.length??0};
    });
    assert.equal(state.peakConnected,1,label+' one extra core at a time');assert.deepEqual(state.connected,[],label+' disconnected extras');assert.equal(state.reserved,0,label+' no reserved ID');
    if(state.devices!==null)assert.equal(state.devices,0,label+' no retained JS device');
    for(const field of ['requests','commands','queued'])assert.equal(state[field],0,label+' '+field);
    assert.equal(state.currentAfter,state.currentBefore,label+' current.json bytes unchanged');assert.equal(state.defaultsAfter,state.defaultsBefore,label+' default.json bytes unchanged');
    assert.equal(state.projectAfter,state.projectBefore,label+' exported Mixer authoring unchanged');
    for(const entry of state.created){
      assert.equal(entry.name,'ym2612',label+' physical chip kind');assert(engines.includes(entry.engine),label+' physical core metadata');
      assert.equal(entry.volume,entry.kindDefault.volume,label+' calibrated engine factory volume');assert.equal(entry.pan,entry.kindDefault.pan,label+' factory pan');assert.equal(entry.muted,false);assert.equal(entry.solo,false);
    }
    return state;
  }
  function assertNativeOrder(audit,expected,label,{allowBulkCleanup=false}={}) {
    const active=new Set(),created=[];assert.equal(audit.peakRack,1,label+' one Native instance');
    for(const event of audit.events){
      if(event.operation==='create'){assert.equal(active.size,0,label+' previous Native core retired');active.add(event.instance);created.push(event.engine);}
      else if(event.operation==='dispose')assert(active.delete(event.instance),label+' dispose belongs to an active core');
      else{
        assert.equal(event.acknowledgedSession,event.session,label+' matching bulk Stop acknowledgment');assert.equal(event.remainingRack,0,label+' acknowledged Stop empties Native rack');
        if(active.size){assert(allowBulkCleanup,label+' completed cores dispose individually');assert.equal(active.size,1);active.clear();}
      }
    }
    assert.deepEqual(created,expected,label+' Native create args select exact cores');assert.equal(active.size,0,label+' no active Native core');
  }

  try{
    for(const backend of ['native','webaudio']){
      const url=new URL(page.url());url.searchParams.set('mode','genesis');if(backend==='native')url.searchParams.set('audioEngine','native');else url.searchParams.delete('audioEngine');
      if(page.url()!==url.href){await page.goto(url.href);await ready(page);}
      if(backend==='webaudio')await page.evaluate(()=>window.__nativeBackendTest.runtime.megaDrive.audio.setListeningVolume(0));
      for(const execution of ['main','worker']){
        const workerLookaheadSeconds=await page.evaluate(()=>window.__nativeBackendTest.runtime.getTiming().workerLookaheadSeconds),row={backend,execution,workerLookaheadSeconds,pcm:[]};
        await arm(execution);await waitForMarker(0);
        // Reach the held first note on the physical scheduling timeline before Stop.
        await page.waitForTimeout(100+(execution==='worker'?workerLookaheadSeconds*1000:0));
        row.interrupted=await stopAndObserve(backend+'/'+execution+' interrupted');assert.deepEqual(row.interrupted.created.map(entry=>entry.engine),['ymfm']);
        if(backend==='native'){row.interruptedNative=nativeObservation;assertNativeOrder(nativeObservation,['ymfm'],execution+' interrupted',{allowBulkCleanup:true});await assertNoLiveAudio(page);}
        else{row.interruptedPcm=await captureWebMix(page,.1);assert.equal(Math.max(...row.interruptedPcm.peak),0,'Stopped Web engine has no audio tail');}
        await arm(execution);
        for(const [index,engine]of engines.entries()){
          await waitForMarker(index);
          const current=await page.evaluate(()=>{const a=window.__engineComparisonAudit;return {created:a.created,connected:a.connected};});
          assert.equal(current.created.length,index+1,backend+'/'+execution+' creation order');assert.equal(current.created[index].engine,engine);assert.deepEqual(current.connected,[current.created[index].id]);
          if(backend==='webaudio'){
            const pcm=await captureWebMix(page,.35,.1+(execution==='worker'?workerLookaheadSeconds:0));
            assert.equal(pcm.nonfinite,0,engine+' finite Web PCM');assert.equal(pcm.overrange,0,engine+' Web headroom');assert(Math.max(...pcm.acRms)>.001,engine+' contributes alternating Web PCM');
            const after=await page.evaluate(()=>{const a=window.__engineComparisonAudit;return {created:a.created.length,connected:a.connected};});
            assert.equal(after.created,index+1,engine+' PCM window stays within selected core');assert.deepEqual(after.connected,[current.created[index].id]);row.pcm.push({engine,...pcm});
          }
        }
        await page.waitForFunction(()=>document.getElementById('consoleOutput').textContent.includes('YM2612 engine comparison complete: 2/2'),null,{timeout:20000});
        row.completed=await stopAndObserve(backend+'/'+execution+' completed');assert.deepEqual(row.completed.created.map(entry=>entry.engine),engines);assert.equal(row.completed.result.fulfilled,true);
        if(backend==='native'){row.native=nativeObservation;assertNativeOrder(nativeObservation,engines,execution+' completed');await assertNoLiveAudio(page);}
        else{row.stopped=await captureWebMix(page,.1);assert.equal(Math.max(...row.stopped.peak),0,'Completed Web Example has no audio tail');}
        assert.doesNotMatch(await page.locator('#consoleOutput').innerText(),/\b(?:Error|TypeError|RangeError|ReferenceError):/,backend+'/'+execution+' no caught playback error');report.rows.push(row);
      }
      await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
      await until(()=>tracker.stats.pending===0&&tracker.stats.activeWorkers===0,backend+' final Native/Worker cleanup');
      const {resources,workletTransfers}=await page.evaluate(()=>({resources:window.__nativeLifecycleResources(),workletTransfers:window.__chipComparisonWorkletTransfers()}));
      assertChipComparisonResources(resources,workletTransfers,backend+' final');report[backend+'Final']={...resources,workletTransfers};
    }
    report.transport=tracker.stats;await fs.writeFile(path.join(artifacts,name+'-engine-comparison.json'),JSON.stringify(report,null,2));
  }catch(error){
    report.failure={message:error.message,console:await page.locator('#consoleOutput').innerText(),native:nativeObservation,
      audit:await page.evaluate(()=>{const a=window.__engineComparisonAudit;return a?{created:a.created,connected:a.connected,result:a.result}:null;})};
    await fs.writeFile(path.join(artifacts,name+'-engine-comparison-failure.json'),JSON.stringify(report,null,2));throw error;
  }finally{native.invoke=originalInvoke;}
}

module.exports={runEngineComparison};
