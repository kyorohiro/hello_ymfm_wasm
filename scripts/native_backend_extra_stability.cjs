// Run the shipped scene unchanged through real Main/Worker and Web Worklets.
// Native IPC is mocked here; actual Native PCM/budgets are tested in Rust.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {extraChipCount}=require('./native_backend_extra_limits.cjs');
const ids=['scene-fm','scene-pcm','scene-dx7'];

// Diagnostic-only processor. It observes the mix bus and outputs silence, so
// connecting the observer cannot double the listening level or change the DSP.
async function captureWebMix(page,seconds=1){
  return page.evaluate(async seconds=>{
    const audio=window.__nativeBackendTest.runtime.megaDrive.audio,context=audio.audioContext;
    const name='mixed-scene-audit-'+(window.__mixedSceneAuditSequence=(window.__mixedSceneAuditSequence??0)+1);
    const frames=Math.round(context.sampleRate*seconds),skip=Math.round(context.sampleRate*.02);
    const code=`class Audit extends AudioWorkletProcessor {
      constructor(){super();this.frames=0;this.skip=${skip};this.peak=[0,0];this.sum=[0,0];this.square=[0,0];this.nonzero=[0,0];this.nonfinite=0;this.overrange=0;this.done=false;}
      process(inputs){if(this.done)return true;const input=inputs[0];if(!input?.[0])return true;
        for(let i=0;i<input[0].length&&this.frames<${frames};i++){
          if(this.skip){this.skip--;continue;}this.frames++;
          for(let ch=0;ch<2;ch++){const v=(input[ch]??input[0])[i];if(!Number.isFinite(v)){this.nonfinite++;continue;}
            this.peak[ch]=Math.max(this.peak[ch],Math.abs(v));this.sum[ch]+=v;this.square[ch]+=v*v;if(v!==0)this.nonzero[ch]++;if(Math.abs(v)>1)this.overrange++;}
        }
        if(this.frames===${frames}){this.done=true;this.port.postMessage({frames:this.frames,sampleRate,peak:this.peak,rms:this.square.map(v=>Math.sqrt(v/this.frames)),dc:this.sum.map(v=>v/this.frames),acRms:this.square.map((v,ch)=>Math.sqrt(Math.max(0,v/this.frames-(this.sum[ch]/this.frames)**2))),nonzero:this.nonzero,nonfinite:this.nonfinite,overrange:this.overrange});}return true;
      }
    }registerProcessor(${JSON.stringify(name)},Audit);`;
    const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
    try{await context.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
    const node=new AudioWorkletNode(context,name,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
    let timer;
    try{
      const result=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Mixed-scene audio observation timed out')),10000);node.port.onmessage=event=>resolve(event.data);});
      audio.masterInputNode.connect(node);node.connect(context.destination);
      return await result;
    }finally{clearTimeout(timer);node.port.onmessage=null;node.port.close();audio.masterInputNode.disconnect(node);node.disconnect();}
  },seconds);
}

async function runExtraStability({page,native,tracker,name,artifacts,ready,assertNoLiveAudio,until}){
  const scene=await page.evaluate(()=>fetch('examples/genesis/mixed-chip-stability.js').then(response=>{if(!response.ok)throw Error('Missing mixed scene Example');return response.text();}));
  const report={schemaVersion:1,browser:name,example:'/examples/genesis/mixed-chip-stability.js',
    limits:['Native IPC is mocked; actual Native rendering is covered by the Rust mixed-rack test.',
      'Web measurements observe this example at authored levels; they are not chip loudness calibration or physical dropout detection.',
      'Port/listener counts cover tracked main-page handles and terminate transferred handles with their owning Worker.'],rows:[]};
  const commands=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]);
  const gate=(type,message)=>message.method==='batch'?message.commands.some(op=>gate(type,op)):
    type==='extra-ym2612'?message.method==='write'&&message.register===0x28&&Boolean(message.value&240):
    type==='extra-rf5c164'?message.method==='key-on':message.method==='note-on';
  const mixer=()=>page.evaluate(()=>window.__nativeBackendTest.runtime.megaDrive.mixer.list());
  for(const backend of ['native','webaudio']){
    const url=new URL(page.url());
    if(backend==='native')url.searchParams.set('audioEngine','native');else url.searchParams.delete('audioEngine');
    url.searchParams.set('mode','genesis');
    if(page.url()!==url.href){await page.goto(url.href);await ready(page);}
    const nativeStarts=native.count('native_genesis_start');
    for(const execution of ['main','worker'])for(let round=0;round<2;round++){
      const before=commands().length;
      await page.evaluate(({scene,execution})=>window.__nativeBackendTest.runtime.playSource(scene,{execution}),{scene,execution});
      await page.waitForFunction(ids=>{const mixer=window.__nativeBackendTest.runtime.megaDrive.mixer;return ids.every(id=>mixer.list().some(entry=>entry.id===id&&entry.connected));},ids);
      await page.waitForFunction(()=>window.__nativeBackendTest.runtime.getKeyboardTarget()?.name==='Mixed scene · YM2612 CH2–6');
      const entries=(await mixer()).filter(entry=>ids.includes(entry.id));
      assert.deepEqual(entries.map(entry=>entry.name).sort(),['dx7','rf5c164','ym2612']);
      assert(entries.every(entry=>entry.connected&&entry.volume>0&&entry.volume<1),'All scene sources have conservative authored levels');
      const row={backend,execution,round,mixer:entries};
      if(backend==='native'){
        await until(()=>extraChipCount(native)===3&&['extra-ym2612','extra-rf5c164','extra-dx7'].every(type=>commands().slice(before).some(c=>c.type===type&&gate(type,c.message))), 'Mixed Example three Native note gates');
        await assertNoLiveAudio(page);
        row.instances=await page.evaluate(()=>[...window.__nativeBackendTest.runtime.megaDrive.extraDevices.values()].map(d=>({kind:d.kind,instance:d.nativeInstance})));
      }else{
        assert.equal(native.count('native_genesis_start'),nativeStarts,'Web Audio must not start the Native backend');
        row.mix=await captureWebMix(page);
        assert.equal(row.mix.nonfinite,0);assert.equal(row.mix.overrange,0,'Authored example must leave Web mix headroom');
        assert(Math.max(...row.mix.peak)>1e-5,'Mixed Web PCM must be audible');
        assert(Math.max(...row.mix.acRms)>1e-5,'Mixed Web PCM must vary, rather than only hold DC');
        if(round===0){
          row.solo=[];
          try{for(const id of ids){
            await page.evaluate(({id,ids})=>{const mixer=window.__nativeBackendTest.runtime.megaDrive.mixer;for(const source of ids)mixer.set(source,{muted:source!==id});},{id,ids});
            const pcm=await captureWebMix(page);assert.equal(pcm.nonfinite,0);assert.equal(pcm.overrange,0);
            assert(Math.max(...pcm.peak)>1e-5,id+' must contribute actual nonzero Web PCM');
            assert(Math.max(...pcm.acRms)>1e-5,id+' must produce an alternating waveform');row.solo.push({id,...pcm});
          }}finally{await page.evaluate(ids=>{for(const id of ids)window.__nativeBackendTest.runtime.megaDrive.mixer.set(id,{muted:false});},ids);}
        }
      }
      // The shared Guitar/PC key route uses spare FM channels while CH1 loops.
      await page.evaluate(async()=>{const keyboard=window.__nativeBackendTest.runtime.getKeyboardTarget();await keyboard.noteOn({id:'mixed-audit-note',midi:60,velocity:80});await keyboard.noteOff({id:'mixed-audit-note',midi:60});});
      await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
      const stopped=await mixer();assert(!stopped.some(entry=>ids.includes(entry.id)&&entry.connected),'Stop must disconnect every extra scene source');
      assert.equal(await page.evaluate(()=>window.__nativeBackendTest.runtime.megaDrive.mixer.reservedIds.size),0,'Stop must release initializing IDs');
      if(backend==='native'){
        await until(()=>extraChipCount(native)===0&&tracker.stats.pending===0,'Mixed Example Native Stop cleanup');
        const pending=await page.evaluate(()=>{const s=window.__nativeBackendTest.runtime.megaDrive;return {devices:s.extraDevices.size,requests:s.acceptedRequests,commands:s.acceptedCommands,queued:s.pending.length};});
        assert.deepEqual(pending,{devices:0,requests:0,commands:0,queued:0});row.stopped=pending;
      }else if(round===0){row.stopped=await captureWebMix(page,.25);assert.equal(Math.max(...row.stopped.peak),0,'Disposed Web scene leaves no audio tail');}
      const text=await page.locator('#consoleOutput').innerText();
      if(/\b(?:Error|TypeError|RangeError|ReferenceError):/.test(text))await fs.writeFile(path.join(artifacts,name+'-extra-stability-failure.json'),JSON.stringify({backend,execution,round,text},null,2));
      assert.doesNotMatch(text,/\b(?:Error|TypeError|RangeError|ReferenceError):/,backend+'/'+execution+'/'+round+' no caught playback error');
      report.rows.push(row);
    }
    await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
    await until(()=>tracker.stats.pending===0&&tracker.stats.activeWorkers===0,backend+' final IPC/Worker cleanup');
    if(backend==='native'){
      report.nativeFinal=await page.evaluate(()=>window.__nativeLifecycleResources());
      for(const key of ['workersActive','localPortsOpen','transferredPortsOpen','activeTargetListeners','activePropertyHandlers'])assert.equal(report.nativeFinal[key],0,'Native '+key);
      await assertNoLiveAudio(page);
    }
  }
  report.transport=tracker.stats;
  await fs.writeFile(path.join(artifacts,name+'-extra-stability.json'),JSON.stringify(report,null,2));
}
module.exports={runExtraStability};
