// Real Main / logic Worker / UI; only Native IPC is mocked, no audio device.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {extraChipCount}=require('./native_backend_extra_limits.cjs');
const olderKinds=['segapsg','ym2612','ym2203','ym2608','ym2610','ym2151','ym2413','ay8910','ym3526','ym3812','y8950','ymf262','rf5c164','okim6258','gameboy'];

function installExtraNesMock(native){
  const invoke=native.invoke.bind(native);native.extraNes=new Map();
  async function fresh({clock=1789773,fds=false}){
    const {NesVoiceInspector}=await import('../web/playground_native_voice_inspector.js');
    const s={clock,baseClock:clock,fdsEnabled:fds,held:new Map(),groups:Array(6).fill(null),memory:new Uint8Array(65536),sourceMuteMask:0,mix:{volume:1,pan:0}};
    s.chip={clock,fdsEnabled:fds,writeRegister(){},reset(){s.memory.fill(0);},loadMemory(bytes,address){s.memory.set(bytes,address);},setChannelEnabled(ch,enabled){s.inspector.observeWrite(0x4015,enabled?s.inspector.enabled|(1<<ch):s.inspector.enabled&~(1<<ch));}};
    s.inspector=new NesVoiceInspector(s.chip,{clock:()=>s.clock,sampleRate:48000});return s;
  }
  const snapshot=s=>({sampleRate:48000,frame:native.status().frame,revision:native.calls.length,nes:{
    clock:s.clock,baseClock:s.baseClock,fdsEnabled:s.fdsEnabled,registers:[...s.inspector.registers],enabled:s.inspector.enabled,
    fdsGain:s.inspector.fdsGain,fdsMaster:s.inspector.fdsMaster,modulation:[...s.inspector.modTable],
    memoryRanges:s.inspector.memoryRanges.map(r=>({...r})),dmcActive:!!(s.inspector.enabled&16),
    fdsActive:s.fdsEnabled&&!!(s.inspector.registers[0x23]&2)&&!(s.inspector.registers[0x83]&128),
    sourceMuteMask:s.sourceMuteMask,held:[...s.held.keys()],pendingCommands:[],
  }});
  const off=(s,ch)=>{if(ch<5)s.chip.setChannelEnabled(ch,false);else{s.chip.writeRegister(0x4080,128);s.chip.writeRegister(0x4083,s.inspector.registers[0x83]|128);}s.groups[ch]=null;};
  function apply(s,m){
    if(m.method==='batch'){
      assert(Number.isInteger(m.channel)&&m.channel>=0&&m.channel<(s.fdsEnabled?6:5));
      if(m.action==='off'&&s.held.get(m.channel)!==m.voice)return;
      if(m.action==='on')s.held.set(m.channel,m.voice);
      for(const op of m.commands)apply(s,{...op,group:m.group});
      if(m.fdsGain!==undefined)s.inspector.fdsGain=m.fdsGain;
      if(m.fdsMaster!==undefined)s.inspector.fdsMaster=m.fdsMaster;
      if(m.action==='off')s.held.delete(m.channel);
    }else if(m.method==='write'){
      s.chip.writeRegister(m.address,m.value);
      const ch=m.address>=0x4000&&m.address<=0x400f?(m.address-0x4000)>>2:-1;
      if(ch>=0&&(m.address&3)===3)s.groups[ch]=m.group??null;
      if(m.address===0x4083)s.groups[5]=m.value&128?null:m.group??null;
      if(m.address===0x4015)for(let i=0;i<5;i++)s.groups[i]=m.value&(1<<i)?m.group??null:null;
    }else if(m.method==='enable'){
      s.chip.setChannelEnabled(m.channel,m.enabled);s.groups[m.channel]=m.enabled?m.group??null:null;
    }else if(m.method==='memory'||m.method==='load-memory'){
      if(s.held.has(4)&&!m.audition)throw Error('Release the manually held additional NES DMC voice before replacing sample memory');
      const address=m.offset??m.address;assert(address>=0&&address+m.data.length<=65536);s.chip.loadMemory(Uint8Array.from(m.data),address);
    }else if(m.method==='clock'){
      if(s.held.size&&!m.audition)throw Error('Release the manually held additional NES voices before changing the clock');s.clock=m.hz;
    }else if(m.method==='mix')s.mix={volume:m.volume,pan:m.pan};
    else if(m.method==='source-mute')s.sourceMuteMask=m.mask;
    else if(m.method==='reset'){s.chip.reset();s.held.clear();s.groups.fill(null);}
    else if(['stop-voices','all-notes-off'].includes(m.method)){for(let ch=0;ch<(s.fdsEnabled?6:5);ch++)if(!s.held.has(ch))off(s,ch);}
    else if(m.method==='cancel-main-owner'){for(let ch=0;ch<(s.fdsEnabled?6:5);ch++)if(s.groups[ch]===m.targetGroup&&!s.held.has(ch))off(s,ch);}
    else assert.equal(m.method,'barrier','Unknown additional NES operation '+m.method);
  }
  native.invoke=async(command,args={})=>{
    const match=/^native_genesis_extra_nes_(create|status|dispose)$/.exec(command);
    if(match){
      native.calls.push({command,args});assert.equal(args.session,native.current?.session);assert(Number.isSafeInteger(args.instance)&&args.instance>0);
      const map=native.extraNes;
      if(match[1]==='create'){assert(extraChipCount(native)<16);assert(!map.has(args.instance));const s=await fresh(args);map.set(args.instance,s);return snapshot(s);}
      if(match[1]==='dispose'){map.delete(args.instance);return null;}
      const s=map.get(args.instance);assert(s);return snapshot(s);
    }
    if(command==='native_genesis_commands')for(const c of args.commands)if(c.type==='extra-nes'){const s=native.extraNes.get(c.instance);assert(s);apply(s,c.message);}
    const value=await invoke(command,args);
    if(['native_genesis_start','native_genesis_stop','native_genesis_shutdown'].includes(command))native.extraNes.clear();return value;
  };
}
const program=`
  const a=await createSoundChip('nes',{id:'famicom-a',fds:true});
  const b=await createSoundChip('nes',{id:'famicom-b',fds:false,clock:1662607.125});
  a.pulse.setVoice(0,{duty:.25,volume:11});b.pulse.setVoice(0,{duty:.75,volume:7});
  await a.dmc.loadSample(new Uint8Array(33).fill(0xa5),{address:0xc000});
  await b.dmc.loadSample(new Uint8Array(49).fill(0x3c),{address:0xc040});
  a.fds.setWave(Array.from({length:64},(_,i)=>i));a.fds.setVolume(24,1);a.fds.noteOn('C3');
  a.pulse.noteOn(0,'C4');b.pulse.noteOn(0,'G3');a.triangle.noteOn('C3');b.triangle.noteOn('G3');
  a.noise.noteOn();b.noise.noteOn();a.dmc.play({loop:true,rate:12});b.dmc.play({loop:true,rate:9});
  await a.setClock(1800000);
  for(const kind of ${JSON.stringify(olderKinds.filter(kind=>kind!=='gameboy'))})await createSoundChip(kind,{id:'base-'+kind});
  await mixer.set(a.id,{volume:.4,pan:-.3});await mixer.set(b.id,{volume:.7,pan:.2});
  liveLoop('extra-nes',async()=>{a.pulse.noteOn(1,'E4');await beat(.25);a.pulse.noteOff(1);await beat(.25);});
  log('nes-ready');
`;
async function runExtraNes({page,native,artifacts,name,until,assertNoLiveAudio,changeMode}){
  const all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]),phases=[];
  const stop=async()=>{await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());await until(()=>extraChipCount(native)===0,'All additional kinds retire');};
  async function keyboard(channel,tab='keyboardTab'){
    const before=all().length;await page.locator('#'+tab).focus();await page.keyboard.down('z');
    try{await until(()=>all().slice(before).some(c=>c.type==='extra-nes'&&c.message.action==='on'&&c.message.channel===channel),'NES Keyboard ON '+channel);}finally{await page.keyboard.up('z');}
    await until(()=>all().slice(before).some(c=>c.type==='extra-nes'&&c.message.action==='off'&&c.message.channel===channel),'NES Keyboard OFF '+channel);
  }
  for(const execution of ['main','worker']){
    const before=all().length;await page.evaluate(({program,execution})=>window.__nativeBackendTest.runtime.playSource(program,{execution}),{program,execution});
    await until(()=>extraChipCount(native)===16&&native.extraNes.size===2&&all().slice(before).some(c=>c.type==='extra-nes'&&c.message.method==='mix'&&c.message.volume===.7),'Independent NES memory and sixteen-instance rack');
    const states=[...native.extraNes.values()],snapshot=await page.evaluate(async()=>({a:await window.__nativeBackendTest.runtime.chipInspector.read('famicom-a'),b:await window.__nativeBackendTest.runtime.chipInspector.read('famicom-b'),mixer:window.__nativeBackendTest.runtime.megaDrive.mixer.list().filter(c=>c.connected),audio:window.__audioConstructions}));
    assert.deepEqual(snapshot.audio,{contexts:0,offline:0,worklets:[]});assert.equal(snapshot.mixer.length,18);
    assert.equal(snapshot.a.clock,1800000);assert.equal(snapshot.b.clock,1662607.125);assert.equal(snapshot.a.channels.length,6);assert.equal(snapshot.b.channels.length,5);
    assert.equal(snapshot.a.channels[0].volume,11);assert.equal(snapshot.b.channels[0].volume,7);
    assert.equal(snapshot.a.fds.wave[7],7);assert.equal(snapshot.b.fds,null);assert.equal(states[0].memory[0xc000],0xa5);assert.equal(states[1].memory[0xc040],0x3c);assert.equal(states[1].memory[0xc000],0);
    if(execution==='worker')await until(()=>all().slice(before).some(c=>c.type==='extra-nes'&&c.frame>0&&c.performance&&c.owner),'Worker NES loop timing');
    await page.click('#consoleTab');await page.locator('#nesTab').waitFor({state:'visible'});await page.click('#nesTab');
    await page.selectOption('#nesPanel [data-chip-control="instance"]','famicom-a');await page.locator('#nesPanel [data-nes-channel="0"]').click();
    await page.locator('#nesPanel [data-nes-control="pulse-0-volume"]').evaluate(node=>{node.value='13';node.dispatchEvent(new Event('change',{bubbles:true}));});
    await until(()=>(states[0].inspector.registers[0]&15)===13,'NES pulse editor');assert.equal(states[1].inspector.registers[0]&15,7);
    await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:famicom-a');
    for(let ch=0;ch<6;ch++){await page.selectOption('#playgroundKeyboardTargetChannel',String(ch));await keyboard(ch);}
    await page.selectOption('#playgroundKeyboardChip','chip:famicom-b');assert.equal(await page.locator('#playgroundKeyboardTargetChannel option[value="5"]').count(),0,'FDS-disabled keyboard has only five channels');
    await page.selectOption('#playgroundKeyboardTargetChannel','4');await keyboard(4);
    await page.click('#consoleTab');await page.click('#nesTab');await page.selectOption('#nesPanel [data-chip-control="instance"]','famicom-a');
    await page.locator('#nesPanel [data-nes-channel="5"]').click();await page.locator('#nesPanel [data-nes-action="wave-square"]').click();
    await until(()=>states[0].inspector.registers[0x40]===63&&states[0].inspector.registers[0x60]===0,'FDS wave editor');
    await page.locator('#nesPanel [data-nes-control="fds-gain"]').evaluate(node=>{node.value='19';node.dispatchEvent(new Event('change',{bubbles:true}));});
    await until(()=>states[0].inspector.fdsGain===19,'FDS gain editor');
    await page.locator('#nesPanel [data-nes-control="fds-mod-depth"]').evaluate(node=>{node.value='7';node.dispatchEvent(new Event('change',{bubbles:true}));});
    await until(()=>(states[0].inspector.registers[0x84]&63)===7,'FDS modulation editor');await keyboard(5,'nesTab');
    assert.equal(states[1].memory[0xc040],0x3c,'Sibling DMC sample preserved');
    const consoleText=await page.locator('#consoleOutput').innerText();assert.match(consoleText,/nes-ready/);assert.doesNotMatch(consoleText,/\b(?:Error|TypeError|RangeError|ReferenceError):/,'No caught playback error in the real Console');
    await page.screenshot({path:path.join(artifacts,`${name}-extra-nes-${execution}.png`)});
    phases.push({execution,a:await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('famicom-a')),b:await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('famicom-b'))});
    await stop();await page.locator('#nesTab').waitFor({state:'hidden'});
  }
  for(const execution of ['main','worker']){
    await page.evaluate(({olderKinds,execution})=>window.__nativeBackendTest.runtime.playSource(`for(const kind of ${JSON.stringify(['nes',...olderKinds])})await createSoundChip(kind,{id:'all-'+kind});log('all-sixteen');`,{execution}),{olderKinds,execution});
    await until(()=>extraChipCount(native)===16&&native.extraNes.size===1&&native.extraGameboy.size===1,'All sixteen distinct Native kinds');await stop();
    const before=native.calls.length;
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`const old=await createSoundChip('nes',{id:'fixed-nes',fds:true});await old.loadMemory(new Uint8Array([0xff]),0xc000);old.dispose();const next=await createSoundChip('nes',{id:'fixed-nes',fds:false,clock:1662607.125});await next.setClock(1700000);`,{execution}),execution);
    await until(()=>native.extraNes.size===1&&[...native.extraNes.values()][0].clock===1700000,'NES same-ID replacement');const s=[...native.extraNes.values()][0];assert.equal(s.memory[0xc000],0);assert.equal(s.fdsEnabled,false);
    const ids=native.calls.slice(before).filter(c=>c.command==='native_genesis_extra_nes_create').map(c=>c.args.instance);assert.equal(ids.length,2);assert(ids[1]>ids[0]);await stop();
  }
  await changeMode(page,native,'nes','keep');
  for(const execution of ['main','worker']){
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`const primary=await useSoundChip('nes');if(primary!==await useSoundChip('nes'))throw Error('Primary NES cache');const extra=await createSoundChip('nes',{id:'extra-nes',fds:false,clock:1662607.125});if(extra===primary||!primary.fdsEnabled||extra.fdsEnabled)throw Error('NES options/primary');await extra.loadMemory(new Uint8Array([0xe1]),0xc080);`,{execution}),execution);
    await until(()=>native.extraNes.size===1&&[...native.extraNes.values()][0].memory[0xc080]===0xe1,'Independent NES beside primary');
    await page.click('#consoleTab');await page.click('#nesTab');await page.waitForFunction(()=>document.querySelector('#nesPanel [data-chip-control="instance"]')?.options.length===2);await stop();await page.locator('#nesTab').waitFor({state:'visible'});
  }
  await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
  await fs.writeFile(path.join(artifacts,name+'-extra-nes.json'),JSON.stringify({mockedNative:true,deviceOpened:false,phases,calls:native.calls},null,2));
}
module.exports={installExtraNesMock,runExtraNes};
