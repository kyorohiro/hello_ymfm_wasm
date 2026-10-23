// Real Main / logic Worker / import UI. Only Native IPC is mocked here.
// This models command/lifecycle state, not SPC700/DSP or audible output.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {extraChipCount}=require('./native_backend_extra_limits.cjs');
const olderKinds=['segapsg','ym2612','ym2203','ym2608','ym2610','ym2151','ym2413','ay8910','ym3526','ym3812','y8950','ymf262','rf5c164','okim6258','gameboy','nes','huc6280','dx7','pwm','snes'];
function installExtraSpcMock(native){
  const invoke=native.invoke.bind(native);native.extraSpc=new Map();
  const fresh=()=>({source:null,ram:new Uint8Array(65536),dsp:new Uint8Array(128),playing:false,mute:0,position:0,rendered:0,began:0,revision:0,captures:new Map(),seek:null,owner:null,stopped:new Set(),cancelled:new Set(),observing:false,epoch:0,reset:null,sequence:0,credits:new Set(),mix:{volume:1,pan:0}});
  const key=o=>o?`${o.session}:${o.owner}`:null;
  function advance(s){if(s.playing){s.position=s.base+(performance.now()-s.began)*32;s.rendered=Math.ceil((s.position+2)/128)*128;}}
  function reset(s){s.ram.set(s.source.subarray(0x100,0x10100));s.dsp.set(s.source.subarray(0x10100,0x10180));s.position=0;s.rendered=0;s.playing=false;}
  const state=s=>{advance(s);const frames=s.seek?.frames??s.position;return {ready:true,loaded:!!s.source,playing:s.playing,paused:!!s.source&&!s.playing,muteMask:s.mute,sampleRate:48000,nativeSampleRate:32000,playbackNativeFrames:frames,positionSeconds:frames/32000,renderedNativeFrames:s.seek?.frames??s.rendered,failed:false};};
  const snapshot=(s,args={})=>{const spc=state(s),capture=s.captures.get(args.after);return {sampleRate:48000,frame:native.status().frame,revision:s.revision,spc,...(capture?{snapshot:capture}:{})};};
  const eventReset=(s,reason)=>{s.credits.clear();s.sequence=0;if(s.observing)s.reset={clock:Math.floor(s.position)*32,dsp:Array.from(s.dsp),reason};};
  function apply(s,m,c){
    assert.equal(c.frame,0,'SPC file controls bypass musical scheduling');assert.equal(c.performance,undefined);assert.equal(c.owner,undefined);
    if(m.sourceOwner){assert(!s.stopped.has(m.sourceOwner.session));assert(!s.cancelled.has(key(m.sourceOwner)));}
    advance(s);s.revision++;
    if(m.eventEpoch!==undefined)s.epoch=m.eventEpoch;
    if(m.method==='load-spc'){
      const bytes=Uint8Array.from(m.data);if(new TextDecoder().decode(bytes.subarray(0,27))!=='SNES-SPC700 Sound File Data')throw Error('Native SPC load rejected: Invalid SPC header');s.source=bytes;reset(s);s.seek=null;s.owner=m.sourceOwner??null;eventReset(s,'load');
    }else if(m.method==='play'){
      assert(s.source,'SPC is not loaded');s.seek=null;s.base=s.position;s.began=performance.now();s.playing=true;s.owner=m.sourceOwner??null;
    }else if(m.method==='pause'){s.playing=false;s.seek=null;}
    else if(m.method==='stop'){if(s.source)reset(s);s.seek=null;s.owner=null;eventReset(s,'stop');}
    else if(m.method==='mute')s.mute=m.mask;
    else if(m.method==='seek-begin'){
      assert(s.source);s.playing=false;s.seek={id:m.seekId,frames:0,owner:m.sourceOwner};eventReset(s,'seek');
    }else if(m.method==='seek-end'){
      assert.equal(s.seek?.id,m.seekId);s.position=s.seek.frames;s.rendered=s.seek.frames;s.seek=null;s.base=s.position;s.began=performance.now();s.playing=m.resume;s.owner=m.sourceOwner??null;eventReset(s,'seek');
    }else if(m.method==='snapshot'){
      assert(s.source);const current=state(s);s.captures.set(m.id,{ram:Array.from(s.ram),dsp:Array.from(s.dsp),nativeFrames:current.renderedNativeFrames,positionSeconds:current.positionSeconds,playbackNativeFrames:current.playbackNativeFrames,nativeSampleRate:32000,muteMask:current.muteMask});
    }else if(m.method==='observe'){
      s.observing=m.enabled;s.epoch=m.epoch;eventReset(s,'observe');if(!m.enabled){s.reset=null;s.credits.clear();}
    }else if(m.method==='event-ack'){if(m.epoch===s.epoch)s.credits.delete(m.sequence);}
    else if(m.method==='cancel-owner'){
      const target=key(m);s.cancelled.add(target);if(key(s.owner)===target){s.playing=false;s.owner=null;}if(key(s.seek?.owner)===target)s.seek=null;
    }else if(m.method==='cancel-performance'){
      s.stopped.add(m.session);if(s.owner?.session===m.session){s.playing=false;s.owner=null;}if(s.seek?.owner?.session===m.session)s.seek=null;
    }else if(m.method==='mix')s.mix={volume:m.volume,pan:m.pan};
    else assert.equal(m.method,'barrier','Unknown SPC operation '+m.method);
  }
  native.invoke=async(command,args={})=>{
    const match=/^native_genesis_extra_spc_(create|status|dispose|seek_step|events)$/.exec(command);
    if(match){
      native.calls.push({command,args});assert.equal(args.session,native.current?.session);assert(Number.isSafeInteger(args.instance)&&args.instance>0);
      if(match[1]==='create'){assert(extraChipCount(native)<16);assert(!native.extraSpc.has(args.instance));const s=fresh();native.extraSpc.set(args.instance,s);return snapshot(s,args);}
      if(match[1]==='dispose'){native.extraSpc.delete(args.instance);return null;}
      const s=native.extraSpc.get(args.instance);assert(s);
      if(match[1]==='seek_step'){assert.equal(s.seek?.id,args.seekId);assert(args.frames>=0&&args.frames<=16000);s.seek.frames+=args.frames;return snapshot(s);}
      if(match[1]==='events'){
        advance(s);const data={epoch:s.epoch,failed:false,batches:[]};if(!s.observing||args.epoch!==s.epoch)return data;
        if(s.reset){data.reset=s.reset;s.reset=null;}
        if(s.playing&&s.credits.size<4){const sequence=++s.sequence,clock=Math.floor(s.position)*32,writes=[clock,3,8+(sequence&1),clock,0,40+(sequence&1),clock,0x4c,1,clock,0x73,8,clock,0x4c,128];s.credits.add(sequence);data.batches.push({sequence,clock,writes,count:5,droppedWrites:0,final:false});}
        return data;
      }
      return snapshot(s,args);
    }
    if(command==='native_genesis_commands')for(const c of args.commands)if(c.type==='extra-spc'){const s=native.extraSpc.get(c.instance);assert(s);apply(s,c.message,c);}
    const result=await invoke(command,args);if(['native_genesis_start','native_genesis_stop','native_genesis_shutdown'].includes(command))native.extraSpc.clear();return result;
  };
}
async function runExtraSpc({page,native,artifacts,name,until,assertNoLiveAudio}){
  await page.setViewportSize({width:1440,height:1100});
  const {createSyntheticSpc}=await import(pathToFileURL(path.join(__dirname,'../web/spc_test_fixture.mjs')));
  const a=createSyntheticSpc({voices:1}),b=createSyntheticSpc({voices:2});a[0x400]=73;b[0x400]=91;
  const phases=[],all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]);
  const stop=async()=>{await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());await until(()=>extraChipCount(native)===0,'All additional SPC instances retire');};
  const run=async(program,execution,done)=>{
    try{await page.evaluate(({program,execution})=>window.__nativeBackendTest.runtime.playSource(program,{execution}),{program,execution});await page.waitForFunction(done=>document.getElementById('consoleOutput').textContent.includes(done),done);}
    catch(error){error.message+='\n'+await page.locator('#consoleOutput').innerText()+'\n'+JSON.stringify(native.calls.slice(-12).map(c=>c.command==='native_genesis_commands'?{command:c.command,commands:c.args.commands.map(c=>({type:c.type,method:c.message?.method,sourceOwner:c.message?.sourceOwner}))}:{command:c.command,args:c.args}));throw new Error(error.message);}
  };
  for(const execution of ['main','worker']){
    const before=native.calls.length,code=`
      const a=await createSoundChip('spc',{id:'spc-a'}),b=await createSoundChip('spc',{id:'spc-b'});
      await a.loadSPC(new Uint8Array(${JSON.stringify(Array.from(a))}));await b.loadSPC(new Uint8Array(${JSON.stringify(Array.from(b))}));
      await a.setMuteMask(2);await b.setMuteMask(128);await a.play();await b.play();
      await new Promise(r=>setTimeout(r,40));await a.pause();const paused=await a.getState();
      await new Promise(r=>setTimeout(r,30));if((await a.getState()).playbackNativeFrames!==paused.playbackNativeFrames)throw Error('Pause advanced SPC position');
      const seek=await a.seek(.125);if(seek.playing||seek.playbackNativeFrames!==4000)throw Error('Paused seek');
      const sa=await a.snapshot(),sb=await b.snapshot();if(sa.ram.length!==65536||sa.dsp.length!==128||sa.ram[0x300]!==73||sb.ram[0x300]!==91||sa.muteMask!==2||sb.muteMask!==128)throw Error('Independent SPC snapshot');
      await a.stop();if((await a.getState()).playbackNativeFrames!==0||!(await a.getState()).loaded)throw Error('Stop must retain and rewind SPC');
      await a.play();let rejected=false;try{await a.loadSPC(new Uint8Array(0x10180));}catch{rejected=true;}const retry=await a.getState();if(!rejected||!retry.loaded||retry.playing||(await a.snapshot()).ram[0x300]!==73)throw Error('Invalid file lost the retryable loaded SPC');
      let events=0;const off=a.onEvent(e=>{if(e.channel!==0||e.type!=='noteOn')throw Error('Event filter');events++;log('spc-event-'+e.type);},{voices:[0],types:['noteOn'],intervalMs:16});
      await a.play();await new Promise(r=>setTimeout(r,100));off();if(!events)throw Error('Missing SPC events');
      const afterSeek=await a.seek(.0625);if(!afterSeek.playing||afterSeek.playbackNativeFrames<2000)throw Error('Playing seek');
      await mixer.set(a.id,{volume:.4,pan:-.3});await mixer.set(b.id,{volume:.7,pan:.2});
      for(const kind of ${JSON.stringify(olderKinds.filter(k=>!['gameboy','nes','huc6280','dx7','pwm','snes'].includes(k)))})await createSoundChip(kind,{id:'base-'+kind});
      log('spc-ready-${execution}');
    `;
    await run(code,execution,`spc-ready-${execution}`);assert.equal(extraChipCount(native),16);assert.equal(native.extraSpc.size,2);
    const states=[...native.extraSpc.values()];assert.equal(states[0].ram[0x300],73);assert.equal(states[1].ram[0x300],91);assert.equal(states[0].mute,2);assert.equal(states[1].mute,128);assert.equal(states[0].mix.volume,.4);assert.equal(states[1].mix.volume,.7);
    const views=await page.evaluate(()=>({audio:window.__audioConstructions,mixer:window.__nativeBackendTest.runtime.megaDrive.mixer.list().filter(c=>c.connected).map(c=>({id:c.id,kind:c.kind})),routes:window.__nativeBackendTest.routes.chips.filter(c=>c.kind==='spc')}));
    assert.deepEqual(views.audio,{contexts:0,offline:0,worklets:[]});assert.equal(views.mixer.length,18);assert(views.routes.every(c=>!c.channels?.length),'SPC file player has no pitched keyboard channels');
    const eventCalls=native.calls.slice(before).filter(c=>c.command==='native_genesis_extra_spc_events').length;assert(eventCalls>0);
    const idleEvents=native.count('native_genesis_extra_spc_events');await page.waitForTimeout(70);assert.equal(native.count('native_genesis_extra_spc_events'),idleEvents,'Unsubscribed SPC has no event polling');
    await page.click('#mixerTab');await page.screenshot({path:path.join(artifacts,`${name}-extra-spc-${execution}.png`)});
    assert(all().filter(c=>c.type==='extra-spc').every(c=>c.frame===0&&c.performance===undefined),'SPC bypasses Worker lookahead');
    phases.push({execution,eventCalls,mixer:views.mixer});await stop();
  }
  for(const [execution,omit]of [['main',['gameboy','nes','huc6280','dx7','pwm']],['worker',['segapsg','ym2612','ym2203','ym2608','ym2610']]]){
    await run(`await createSoundChip('spc',{id:'full-spc'});for(const kind of ${JSON.stringify(olderKinds.filter(k=>!omit.includes(k)))})await createSoundChip(kind,{id:'kind-'+kind});log('spc-all-kinds-${execution}');`,execution,`spc-all-kinds-${execution}`);assert.equal(extraChipCount(native),16);await stop();
  }
  for(const execution of ['main','worker']){
    const before=all().length;
    await run(`const a=await createSoundChip('spc',{id:'owner-spc-a'}),b=await createSoundChip('spc',{id:'owner-spc-b'});
      await a.loadSPC(new Uint8Array(${JSON.stringify(Array.from(a))}));await b.loadSPC(new Uint8Array(${JSON.stringify(Array.from(b))}));await b.play();
      liveLoop('spc-owned',async()=>{a.onEvent(e=>{if(e.type==='noteOn')return a.setMuteMask(4);},{voices:[0],types:['noteOn'],intervalMs:16});await a.play();log('spc-owner-started');await beat(16);});
      log('spc-owner-ready-${execution}');`,execution,`spc-owner-ready-${execution}`);
    await until(()=>[...native.extraSpc.values()][0].playing&&[...native.extraSpc.values()][0].mute===4,'SPC owning loop and its callback start');
    await run(`stopLoop('spc-owned');log('spc-owner-done-${execution}');`,execution,`spc-owner-done-${execution}`);
    await until(()=>[...native.extraSpc.values()][0].playing===false,'SPC owner cancellation applies');assert([...native.extraSpc.values()][1].playing,'SPC cancellation preserves sibling');
    const commands=all().slice(before).filter(c=>c.type==='extra-spc'),cancel=commands.find(c=>c.message.method==='cancel-owner');assert(cancel,'Loop cancellation reaches SPC Native endpoint: '+execution+' '+JSON.stringify(commands.map(c=>({method:c.message.method,sourceOwner:c.message.sourceOwner,session:c.message.session,owner:c.message.owner}))));
    const lease={session:cancel.message.session,owner:cancel.message.owner};assert(commands.some(c=>c.message.method==='mute'&&c.message.sourceOwner?.owner===lease.owner&&c.message.sourceOwner?.session===lease.session),'onEvent callback keeps its loop owner');
    await until(()=>[...native.extraSpc.values()].every(s=>!s.observing),'Cancelled loop releases its SPC subscription');
    const idle=native.count('native_genesis_extra_spc_events');await page.waitForTimeout(60);assert.equal(native.count('native_genesis_extra_spc_events'),idle,'Cancelled loop leaves no SPC event polling');await stop();
  }
  for(const execution of ['main','worker']){
    const before=native.calls.length;
    await run(`const shared=await useSoundChip('spc');if(shared!==await useSoundChip('spc'))throw Error('SPC shared cache');const old=await createSoundChip('spc',{id:'replace-spc'});await old.loadSPC(new Uint8Array(${JSON.stringify(Array.from(a))}));old.dispose();const next=await createSoundChip('spc',{id:'replace-spc'});if((await next.getState()).loaded||next===shared)throw Error('SPC replacement retained song');log('spc-replaced-${execution}');`,execution,`spc-replaced-${execution}`);
    assert.equal(native.extraSpc.size,2);const ids=native.calls.slice(before).filter(c=>c.command==='native_genesis_extra_spc_create').map(c=>c.args.instance);assert.equal(ids.length,3);assert(ids[2]>ids[1]);await stop();
  }
  // Existing Song import must select the same Native endpoint, retaining its asset.
  if(!await page.locator('#mainMenu').evaluate(n=>n.open))await page.locator('#mainMenu > summary').click();
  if(!await page.locator('#menuImport').evaluate(n=>n.open))await page.locator('#menuImport > summary').click();
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#importSpcButton').click()]);
  await chooser.setFiles({name:'original-native.spc',mimeType:'application/octet-stream',buffer:Buffer.from(a)});
  const dialog=page.locator('#spcImportDialog');await dialog.waitFor({state:'visible'});await dialog.locator('input[name="spc-import-mode"][value="song"]').check();await dialog.locator('[data-spc-import-confirm]').click();await dialog.waitFor({state:'hidden'});
  const imported=await page.evaluate(()=>({source:window.__nativeBackendTest.editor.getValue(),files:window.__nativeBackendTest.virtualFiles.list().map(f=>({path:f.path,type:f.type}))}));
  assert.match(imported.source,/useSoundChip\(['"]spc['"]\)/);assert(imported.files.some(f=>f.path.endsWith('.spc')&&f.type==='binary'));
  for(const execution of ['main','worker']){await page.locator('#workerExecution').setChecked(execution==='worker');await page.click('#runButton');await until(()=>native.extraSpc.size===1&&[...native.extraSpc.values()][0].playing,'Imported SPC song starts on Native '+execution);await stop();}
  await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
  await fs.writeFile(path.join(artifacts,name+'-extra-spc.json'),JSON.stringify({mockedNative:true,deviceOpened:false,phases,calls:native.calls.map(c=>c.command==='native_genesis_commands'?{...c,args:{...c.args,commands:c.args.commands.map(command=>command.type==='extra-spc'&&command.message.data?{...command,message:{...command.message,data:{length:command.message.data.length}}}:command)}}:c)},null,2));
}
module.exports={installExtraSpcMock,runExtraSpc};
