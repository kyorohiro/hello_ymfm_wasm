// Real Main / logic Worker / editors; only Native IPC is mocked, no audio device.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {extraChipCount}=require('./native_backend_extra_limits.cjs');
const olderKinds=['segapsg','ym2612','ym2203','ym2608','ym2610','ym2151','ym2413','ay8910','ym3526','ym3812','y8950','ymf262','rf5c164','okim6258','gameboy','nes'];

function installExtraHuc6280Mock(native){
  const invoke=native.invoke.bind(native);native.extraHuc6280=new Map();
  async function fresh(){
    const {Huc6280VoiceInspector}=await import('../web/playground_huc6280_inspector.js');
    const s={clock:3579545,held:new Map(),groups:Array(6).fill(null),sourceMuteMask:0,mix:{volume:1,pan:0}};
    s.inspector=new Huc6280VoiceInspector({clock:()=>s.clock,sampleRate:48000});return s;
  }
  const snapshot=s=>{const i=s.inspector;return{sampleRate:48000,frame:native.status().frame,revision:native.calls.length,huc6280:{
    clock:s.clock,selectedChannel:i.selected,globals:[...i.globals],registers:i.registers.map(r=>[...r]),waveforms:i.waveforms.map(r=>[...r]),indices:[...i.indices],
    pointerKnown:Array.from(i.pointerKnown,Boolean),waveformKnown:Array.from(i.waveformKnown,Boolean),knownSamples:[...i.knownSamples],ddaValues:[...i.ddaValues],
    initialized:true,held:[...s.held.keys()],sourceMuteMask:s.sourceMuteMask,pendingCommands:[],
  }};};
  const off=(s,ch)=>{s.inspector.registers[ch][4]&=127;s.groups[ch]=null;};
  function apply(s,m){
    const i=s.inspector;
    if(m.method==='batch'){
      assert(Number.isInteger(m.channel)&&m.channel>=0&&m.channel<6);
      if(m.action==='off'&&m.voice!==undefined&&s.held.get(m.channel)!==m.voice)return;
      if(m.action==='edit'&&s.held.has(m.channel)&&s.held.get(m.channel)!==m.voice)return;
      if(m.action==='on')s.held.set(m.channel,m.voice);
      for(const op of m.commands)apply(s,{...op,channel:op.channel??m.channel,group:m.group});
      if(m.action==='off')s.held.delete(m.channel);
    }else if(m.method==='write'){
      if(m.channel!==undefined&&m.register!==0)i.observeWrite(0,m.channel);
      i.observeWrite(m.register,m.value);
      if(m.register===4&&i.selected<6)s.groups[i.selected]=m.value&128?m.group??null:null;
    }else if(m.method==='waveform'){
      const ch=m.channel;assert.equal(m.samples.length,32);assert(m.samples.every(v=>Number.isInteger(v)&&v>=0&&v<=31));
      i.waveforms[ch].set(m.samples);i.indices[ch]=0;i.waveformKnown[ch]=i.pointerKnown[ch]=1;i.knownSamples[ch]=0xffffffff;
    }else if(m.method==='key-off')off(s,m.channel);
    else if(m.method==='clock'){
      if(s.held.size&&!m.audition)throw Error('Release the manually held additional HuC6280 voices before changing the clock');s.clock=m.hz;
    }else if(m.method==='mix')s.mix={volume:m.volume,pan:m.pan};
    else if(m.method==='source-mute')s.sourceMuteMask=m.mask;
    else if(m.method==='reset'){i.reset();s.held.clear();s.groups.fill(null);}
    else if(['stop-voices','all-notes-off'].includes(m.method)){for(let ch=0;ch<6;ch++)if(!s.held.has(ch))off(s,ch);}
    else if(m.method==='cancel-main-owner'){for(let ch=0;ch<6;ch++)if(s.groups[ch]===m.targetGroup&&!s.held.has(ch))off(s,ch);}
    else assert.equal(m.method,'barrier','Unknown additional HuC6280 operation '+m.method);
  }
  native.invoke=async(command,args={})=>{
    const match=/^native_genesis_extra_huc6280_(create|status|dispose)$/.exec(command);
    if(match){
      native.calls.push({command,args});assert.equal(args.session,native.current?.session);assert(Number.isSafeInteger(args.instance)&&args.instance>0);
      const map=native.extraHuc6280;
      if(match[1]==='create'){assert(extraChipCount(native)<16);assert(!map.has(args.instance));const s=await fresh();map.set(args.instance,s);return snapshot(s);}
      if(match[1]==='dispose'){map.delete(args.instance);return null;}
      const s=map.get(args.instance);assert(s);return snapshot(s);
    }
    if(command==='native_genesis_commands')for(const c of args.commands)if(c.type==='extra-huc6280'){const s=native.extraHuc6280.get(c.instance);assert(s);apply(s,c.message);}
    const value=await invoke(command,args);
    if(['native_genesis_start','native_genesis_stop','native_genesis_shutdown'].includes(command))native.extraHuc6280.clear();return value;
  };
}
const program=`
  const a=await createSoundChip('huc6280',{id:'pce-a'});
  const b=await createSoundChip('huc6280',{id:'pce-b'});
  a.initialize();b.initialize();
  a.setWaveform(0,Array.from({length:32},(_,i)=>i));b.setWaveform(0,Array.from({length:32},(_,i)=>31-i));
  a.setVolume(0,23);b.setVolume(0,17);a.setPan(0,15,3);b.setPan(0,2,15);
  a.setLfo({frequency:37,depth:1});b.setLfo({frequency:11,depth:2});
  a.noteOn(0,'C4');b.noteOn(0,'G3');a.setNoise(4,{enabled:true,frequency:17});b.setNoise(4,{enabled:true,frequency:23});a.keyOn(4);b.keyOn(4);
  a.setDda(3,true);a.writeDda(3,20);a.keyOn(3);b.setDda(3,true);b.writeDda(3,9);b.keyOn(3);
  await a.setClock(4000000);
  for(const kind of ${JSON.stringify(olderKinds.filter(kind=>!['gameboy','nes'].includes(kind)))})await createSoundChip(kind,{id:'base-'+kind});
  await mixer.set(a.id,{volume:.4,pan:-.3});await mixer.set(b.id,{volume:.7,pan:.2});
  liveLoop('extra-pce',async()=>{a.noteOn(2,'E4');await beat(.25);a.keyOff(2);await beat(.25);});
  log('huc6280-ready');
`;
async function runExtraHuc6280({page,native,artifacts,name,until,assertNoLiveAudio,changeMode}){
  const all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]),phases=[];
  const stop=async()=>{await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());await until(()=>extraChipCount(native)===0,'Additional HuC6280 and mixed rack retire');};
  async function keyboard(channel,tab='keyboardTab'){
    const before=all().length;await page.locator('#'+tab).focus();await page.keyboard.down('z');
    try{await until(()=>all().slice(before).some(c=>c.type==='extra-huc6280'&&c.message.action==='on'&&c.message.channel===channel),'HuC6280 Keyboard ON '+channel);}finally{await page.keyboard.up('z');}
    await until(()=>all().slice(before).some(c=>c.type==='extra-huc6280'&&c.message.action==='off'&&c.message.channel===channel),'HuC6280 Keyboard OFF '+channel);
  }
  const edit=async(control,value)=>page.locator(`#huc6280Panel [data-chip-control="pce-${control}"]`).evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('change',{bubbles:true}));},value);
  for(const execution of ['main','worker']){
    const before=all().length;
    await page.evaluate(({program,execution})=>window.__nativeBackendTest.runtime.playSource(program,{execution}),{program,execution});
    await until(()=>extraChipCount(native)===16&&native.extraHuc6280.size===2&&all().slice(before).some(c=>c.type==='extra-huc6280'&&c.message.method==='mix'&&c.message.volume===.7),'Independent HuC6280 and mixed sixteen-slot rack');
    const states=[...native.extraHuc6280.values()],snapshot=await page.evaluate(async()=>({a:await window.__nativeBackendTest.runtime.chipInspector.read('pce-a'),b:await window.__nativeBackendTest.runtime.chipInspector.read('pce-b'),mixer:window.__nativeBackendTest.runtime.megaDrive.mixer.list().filter(c=>c.connected),audio:window.__audioConstructions}));
    assert.deepEqual(snapshot.audio,{contexts:0,offline:0,worklets:[]});assert.equal(snapshot.mixer.length,18);assert.equal(snapshot.a.channels.length,6);
    assert.equal(snapshot.a.clock,4000000);assert.equal(snapshot.b.clock,3579545);assert.equal(snapshot.a.channels[0].volume,23);assert.equal(snapshot.b.channels[0].volume,17);
    assert.deepEqual(snapshot.a.channels[0].waveform,Array.from({length:32},(_,i)=>i));assert.deepEqual(snapshot.b.channels[0].waveform,Array.from({length:32},(_,i)=>31-i));
    assert.equal(snapshot.a.lfo.frequency,37);assert.equal(snapshot.b.lfo.frequency,11);assert.equal(snapshot.a.channels[3].ddaValue,20);assert.equal(snapshot.b.channels[3].ddaValue,9);
    if(execution==='worker')await until(()=>all().slice(before).some(c=>c.type==='extra-huc6280'&&c.frame>0&&c.performance&&c.owner),'Worker HuC6280 loop timing');
    await page.click('#consoleTab');await page.locator('#huc6280Tab').waitFor({state:'visible'});await page.click('#huc6280Tab');
    await page.selectOption('#huc6280Panel [data-chip-control="instance"]','pce-a');await page.locator('#huc6280Panel [data-chip-channel="0"]').click();
    await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.invoke('pce-a','auditionOn',[0,60,'held-edit']));
    await edit('volume',27);await until(()=>states[0].inspector.registers[0][4]%32===27,'HuC6280 volume editor');assert.equal(states[1].inspector.registers[0][4]%32,17);
    await page.locator('#huc6280Panel [data-chip-action="pce-wave-square"]').click();await until(()=>states[0].inspector.waveforms[0][0]===31&&states[0].inspector.waveforms[0][16]===0,'HuC6280 waveform editor');assert.equal(states[1].inspector.waveforms[0][16],15);
    await edit('lfo-depth',3);await until(()=>(states[0].inspector.globals[9]&3)===3,'HuC6280 shared LFO editor');assert.equal(states[1].inspector.globals[9]&3,2);
    assert(states[0].held.has(0));assert(states[0].inspector.registers[0][4]&128,'Editing a held wave keeps its key gate');
    assert(all().some(c=>c.type==='extra-huc6280'&&c.message.action==='edit'&&c.message.voice!==undefined),'Held edits carry the manual voice lease');
    await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.invoke('pce-a','auditionOff',[0,'held-edit']));
    await keyboard(0,'huc6280Tab');
    await page.locator('#huc6280Panel [data-chip-channel="4"]').click();await edit('noise-frequency',29);await until(()=>(states[0].inspector.registers[4][7]&31)===29,'HuC6280 noise editor');assert.equal(states[1].inspector.registers[4][7]&31,23);
    await keyboard(4,'huc6280Tab');
    await page.locator('#huc6280Panel [data-chip-channel="3"]').click();await edit('dda-value',25);await until(()=>states[0].inspector.ddaValues[3]===25,'HuC6280 direct DAC editor');assert.equal(states[1].inspector.ddaValues[3],9);
    // Release DDA before the melodic Keyboard sweep; DDA is held DAC, not a pitched voice.
    await page.locator('#huc6280Panel [data-chip-control="pce-dda"]').evaluate(node=>{node.checked=false;node.dispatchEvent(new Event('change',{bubbles:true}));});await until(()=>!(states[0].inspector.registers[3][4]&64),'DDA leaves note audition safely');
    await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.invoke('pce-a','auditionOn',[3,60,'held-dda-edit']));
    await page.locator('#huc6280Panel [data-chip-control="pce-dda"]').evaluate(node=>{node.checked=true;node.dispatchEvent(new Event('change',{bubbles:true}));});
    await until(()=>!!(states[0].inspector.registers[3][4]&64)&&!states[0].held.has(3),'Entering DDA while held applies the mode and releases the manual lease');
    await edit('dda-value',19);await until(()=>states[0].inspector.ddaValues[3]===19,'DDA sample remains editable after manual release');
    await page.locator('#huc6280Panel [data-chip-control="pce-dda"]').evaluate(node=>{node.checked=false;node.dispatchEvent(new Event('change',{bubbles:true}));});await until(()=>!(states[0].inspector.registers[3][4]&64),'DDA returns to melodic Keyboard mode');
    await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:pce-a');
    for(let ch=0;ch<6;ch++){await page.selectOption('#playgroundKeyboardTargetChannel',String(ch));await keyboard(ch);}
    await page.selectOption('#playgroundKeyboardChip','chip:pce-b');await page.selectOption('#playgroundKeyboardTargetChannel','5');await keyboard(5);
    await page.click('#consoleTab');await page.click('#huc6280Tab');await page.selectOption('#huc6280Panel [data-chip-control="instance"]','pce-a');await page.locator('#huc6280Panel [data-chip-channel="0"]').click();
    const consoleText=await page.locator('#consoleOutput').innerText();assert.match(consoleText,/huc6280-ready/);assert.doesNotMatch(consoleText,/\b(?:Error|TypeError|RangeError|ReferenceError):|Call initialize\(\)/,'No caught playback error in real Console');
    await page.screenshot({path:path.join(artifacts,`${name}-extra-huc6280-${execution}.png`)});phases.push({execution,a:snapshot.a,b:snapshot.b});await stop();await page.locator('#huc6280Tab').waitFor({state:'hidden'});
  }
  // All seventeen supported kinds across two legal sixteen-slot combinations.
  for(const [execution,omit]of [['main','nes'],['worker','gameboy']]){
    await page.evaluate(({execution,kinds})=>window.__nativeBackendTest.runtime.playSource(`const h=await createSoundChip('huc6280',{id:'full-pce'});h.initialize();h.noteOn(0,'C4');for(const kind of ${JSON.stringify(kinds)})await createSoundChip(kind,{id:'kind-'+kind});log('seventeen-kinds-covered');`,{execution}),{execution,kinds:olderKinds.filter(k=>k!==omit)});
    await until(()=>extraChipCount(native)===16&&native.extraHuc6280.size===1,'Seventeen kinds in legal mixed racks');await stop();
  }
  for(const execution of ['main','worker']){
    const before=native.calls.length;
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`const old=await createSoundChip('huc6280',{id:'fixed-pce'});old.initialize();old.setWaveform(0,Array(32).fill(31));old.dispose();const next=await createSoundChip('huc6280',{id:'fixed-pce'});next.initialize();await next.setClock(5000000);`,{execution}),execution);
    await until(()=>native.extraHuc6280.size===1&&[...native.extraHuc6280.values()][0].clock===5000000,'HuC6280 same-ID replacement');assert.notEqual([...native.extraHuc6280.values()][0].inspector.waveforms[0][0],31);
    const ids=native.calls.slice(before).filter(c=>c.command==='native_genesis_extra_huc6280_create').map(c=>c.args.instance);assert.equal(ids.length,2);assert(ids[1]>ids[0]);await stop();
  }
  await changeMode(page,native,'pc-engine','keep');
  for(const execution of ['main','worker']){
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`if(await useSoundChip('huc6280')!==pce||pce!==await useSoundChip('huc6280'))throw Error('Primary HuC6280 cache');const extra=await createSoundChip('huc6280',{id:'extra-pce'});if(extra===pce)throw Error('Additional HuC6280 borrowed primary');extra.initialize();extra.setWaveform(0,Array(32).fill(14));extra.noteOn(0,'C4');`,{execution}),execution);
    await until(()=>native.extraHuc6280.size===1&&[...native.extraHuc6280.values()][0].inspector.waveforms[0][0]===14,'Independent HuC6280 beside primary');assert.notEqual(native.hucInspector.waveforms[0][0],14);
    await page.click('#consoleTab');await page.click('#huc6280Tab');await page.waitForFunction(()=>document.querySelector('#huc6280Panel [data-chip-control="instance"]')?.options.length===2);await stop();await page.locator('#huc6280Tab').waitFor({state:'visible'});
  }
  await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
  await fs.writeFile(path.join(artifacts,name+'-extra-huc6280.json'),JSON.stringify({mockedNative:true,deviceOpened:false,phases,calls:native.calls},null,2));
}
module.exports={installExtraHuc6280Mock,runExtraHuc6280};
