// Shipped Example and real Web PCM; Native IPC is mocked here. Native DSP and
// memory ownership have separate C++/Rust tests. No physical device is opened.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {captureWebMix}=require('./native_backend_extra_stability.cjs');
const {extraChipCount}=require('./native_backend_extra_limits.cjs');
const {assertChipComparisonResources}=require('./native_backend_chip_comparison.cjs');
const example='examples/msx/msx-audio-adpcm.js';

async function runY8950Adpcm({page,native,tracker,artifacts,name,ready,assertNoLiveAudio,until}){
  const source=await page.evaluate(async example=>{const response=await fetch(example);if(!response.ok)throw Error('Missing MSX Audio ADPCM Example');return response.text();},example);
  const report={schemaVersion:1,browser:name,example:'/'+example,rows:[],limits:[
    'The shipped FM/ADPCM Example is executed unchanged. Native IPC is mocked; real Native PCM is verified separately.',
    'ADPCM-only Web PCM checks finite, alternating, mono audio and Stop silence. This is not a physical device/dropout or loudness test.',
  ]};
  const commands=()=>native.calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]);
  const writes=entries=>entries.filter(entry=>entry.message).flatMap(entry=>entry.message.method==='batch'?entry.message.commands.map(message=>({...entry,message})):entry);
  async function stop(label){
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    await until(()=>tracker.stats.pending===0&&extraChipCount(native)===0,label+' requests and additional rack');
    const state=await page.evaluate(()=>{
      const t=window.__nativeBackendTest,s=t.runtime.megaDrive;
      return {reserved:s.mixer.reservedIds.size,extras:s.mixer.list().filter(entry=>entry.connected&&entry.name==='y8950'&&entry.id!=='y8950').length,
        current:t.virtualFiles.get('/mixer/current.json')?.data??null,defaults:t.virtualFiles.get('/mixer/default.json')?.data??null};
    });
    assert.equal(state.reserved,0,label+' reserved Mixer IDs');assert.equal(state.extras,0,label+' no connected additional Y8950');return state;
  }
  const onlySample=additional=>`
    const chip=await ${additional?"createSoundChip('y8950',{id:'adpcm-only'})":"useSoundChip('y8950')"};
    const rate=16000;
    const pcm=Float32Array.from({length:1600},(_,index)=>.4*Math.sin(2*Math.PI*440*index/rate));
    const sample=await chip.adpcm.loadSample({channels:[pcm],sampleRate:rate},{address:4096,sampleRate:rate});
    await chip.adpcm.loadMemory(new Uint8Array([21,43,65,87]),32);
    chip.reset(); // Reset the chip, retaining sample RAM.
    chip.adpcm.setSample({start:sample.start,end:sample.end});
    chip.adpcm.setPlaybackRate(sample.sampleRate);chip.adpcm.setVolume(160);
    liveLoop('adpcm-only',async()=>{chip.adpcm.keyOn({repeat:true});await sleep(60);});
  `;
  try{
    for(const backend of ['native','webaudio']){
      const url=new URL(page.url());url.searchParams.set('mode','msx-audio');
      if(backend==='native')url.searchParams.set('audioEngine','native');else url.searchParams.delete('audioEngine');
      await page.goto(url.href);await ready(page);
      for(const execution of ['main','worker']){
        const row={backend,execution};
        const stored=await page.evaluate(()=>{
          const t=window.__nativeBackendTest;
          t.virtualFiles.writeText('/mixer/current.json','{"version":1,"entries":[{"id":"saved","name":"y8950","settings":{"volume":0.31}}]}\n');
          t.virtualFiles.writeText('/mixer/default.json','{"version":1,"entries":[{"id":"saved","name":"y8950","settings":{"pan":0.2}}]}\n');
          t.mixerState.selectPreset('/sys/mixer/default.json');
          return {current:t.virtualFiles.get('/mixer/current.json').data,defaults:t.virtualFiles.get('/mixer/default.json').data};
        });
        const first=commands().length;
        await page.evaluate(({source,execution})=>window.__nativeBackendTest.runtime.playSource(source,{execution}),{source,execution});
        if(backend==='native'){
          await until(()=>{
            const sent=writes(commands().slice(first)).filter(entry=>entry.type==='opl'&&entry.message.method==='write');
            return sent.some(entry=>entry.message.register===7&&entry.message.value&128)&&sent.some(entry=>entry.message.register===0xb0&&entry.message.value&32);
          },'shipped Example Native FM and ADPCM keyOn');
          const sent=writes(commands().slice(first));
          assert(sent.some(entry=>entry.type==='opl'&&entry.message.method==='write'&&entry.message.register===0xb0&&entry.message.value&32),'shipped Example plays FM too');
          assert(native.opl.adpcmMemorySize>0,'primary Native RAM has been uploaded');
          await assertNoLiveAudio(page);row.example={nativeCommands:sent.length,memorySize:native.opl.adpcmMemorySize};
        }else{
          await page.evaluate(()=>window.__nativeBackendTest.runtime.megaDrive.audio.setListeningVolume(0));
          row.example=await captureWebMix(page,.8);
          assert.equal(row.example.nonfinite,0);assert.equal(row.example.overrange,0);assert(Math.max(...row.example.acRms)>.001,'FM plus drum has real Web audio');
        }
        const stopped=await stop(backend+'/'+execution+' Example');
        assert.equal(stopped.current,stored.current);assert.equal(stopped.defaults,stored.defaults);
        row.adpcmOnly=[];
        for(const additional of [false,true]){
          const start=commands().length;
          await page.evaluate(({source,execution})=>window.__nativeBackendTest.runtime.playSource(source,{execution}),{source:onlySample(additional),execution});
          const audit={additional};
          if(backend==='native'){
            const type=additional?'extra-y8950':'opl';
            await until(()=>writes(commands().slice(start)).some(entry=>entry.type===type&&entry.message.method==='write'&&entry.message.register===7&&entry.message.value===0xb0),'ADPCM-only Native keyOn');
            const sent=writes(commands().slice(start)).filter(entry=>entry.type===type);
            assert.equal(sent.filter(entry=>entry.message.method==='adpcm-memory').length,2,'encoded upload plus nonoverlapping patch');
            assert(!sent.some(entry=>entry.message.method==='write'&&entry.message.register>=0xb0&&entry.message.register<=0xb8&&entry.message.value&32),'ADPCM-only has no FM gate');
            const state=additional?[...native.extraY8950.values()][0]:native.opl;
            assert(state.adpcmMemorySize>4096,'short low-offset patch and reset do not shrink sample RAM');
            audit.memorySize=state.adpcmMemorySize;await assertNoLiveAudio(page);
          }else{
            const lookahead=execution==='worker'?await page.evaluate(()=>window.__nativeBackendTest.runtime.getTiming().workerLookaheadSeconds):0;
            audit.pcm=await captureWebMix(page,.25,lookahead+.05);
            assert.equal(audit.pcm.nonfinite,0);assert.equal(audit.pcm.overrange,0);
            assert(Math.max(...audit.pcm.acRms)>.001,'ADPCM alone wakes up the real Worklet');
            assert.equal(audit.pcm.rms[0],audit.pcm.rms[1],'Y8950 ADPCM is mono in both output channels');
          }
          await stop(backend+'/'+execution+' ADPCM-only');
          if(backend==='webaudio'){audit.stopped=await captureWebMix(page,.1);assert.equal(Math.max(...audit.stopped.peak),0,'Stop silences ADPCM-only output');}
          row.adpcmOnly.push(audit);
        }
        assert.doesNotMatch(await page.locator('#consoleOutput').innerText(),/\b(?:Error|TypeError|RangeError|ReferenceError):/,backend+'/'+execution+' no playback errors');
        report.rows.push(row);
      }
      await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
      await until(()=>tracker.stats.pending===0&&tracker.stats.activeWorkers===0,backend+' final Worker cleanup');
      const state=await page.evaluate(()=>({resources:window.__nativeLifecycleResources(),workletTransfers:window.__chipComparisonWorkletTransfers()}));
      assertChipComparisonResources(state.resources,state.workletTransfers,backend+' final');report[backend+'Final']=state;
    }
    await fs.writeFile(path.join(artifacts,name+'-y8950-adpcm.json'),JSON.stringify(report,null,2));
  }catch(error){
    report.failure={message:error.message,console:await page.locator('#consoleOutput').innerText(),commands:commands().slice(-50)};
    await fs.writeFile(path.join(artifacts,name+'-y8950-adpcm-failure.json'),JSON.stringify(report,null,2));throw error;
  }
}
module.exports={runY8950Adpcm};
