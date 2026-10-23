// Real Main / logic Worker / editor; Native IPC only is mocked, no output device.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {extraChipCount}=require('./native_backend_extra_limits.cjs');

function installExtraGameboyMock(native){
  const invoke=native.invoke.bind(native);native.extraGameboy=new Map();
  async function fresh(){
    const {GameboyVoiceInspector}=await import('../web/playground_native_voice_inspector.js');
    const s={clock:4194304,sourceMuteMask:0,held:new Map(),groups:Array(4).fill(null),mix:{volume:1,pan:0}};
    s.chip={writeRegister(){},reset(){}};
    s.inspector=new GameboyVoiceInspector(s.chip,{clock:()=>s.clock,sampleRate:48000});return s;
  }
  const snapshot=s=>({sampleRate:48000,frame:native.status().frame,revision:native.calls.length,gameboy:{
    clock:s.clock,registers:[...s.inspector.registers],voice:[...s.inspector.voice],gates:s.inspector.gates.slice(),sourceMuteMask:s.sourceMuteMask,held:[...s.held.keys()],pendingCommands:[],
  }});
  const off=(s,ch)=>{s.chip.writeRegister([2,7,10,17][ch],0);s.groups[ch]=null;};
  function apply(s,m){
    if(m.method==='batch'){
      assert(Number.isInteger(m.channel)&&m.channel>=0&&m.channel<4);
      if(m.action==='off'&&s.held.get(m.channel)!==m.voice)return;
      if(m.action==='on')s.held.set(m.channel,m.voice);
      for(const op of m.commands)apply(s,{...op,group:m.group});
      if(m.action==='off')s.held.delete(m.channel);
    }else if(m.method==='write'){
      const a=m.address;assert(Number.isInteger(a)&&a>=0&&a<48);
      s.chip.writeRegister(a,m.value);
      const ch=[4,9,14,19].indexOf(a);if(ch>=0&&(m.value&128))s.groups[ch]=m.group??null;
      const dac=[2,7,10,17].indexOf(a);if(dac>=0&&!s.inspector.gates[dac])s.groups[dac]=null;
      if(a===22&&!(m.value&128)){s.held.clear();s.groups.fill(null);}
    }else if(m.method==='clock'){
      if(s.held.size&&!m.audition)throw Error('Release the manually held additional Game Boy voices before changing the clock');s.clock=m.hz;
    }else if(m.method==='mix')s.mix={volume:m.volume,pan:m.pan};
    else if(m.method==='source-mute'){assert(Number.isInteger(m.mask)&&m.mask>=0&&m.mask<=15);s.sourceMuteMask=m.mask;}
    else if(m.method==='reset'){s.chip.reset();s.held.clear();s.groups.fill(null);}
    else if(['stop-voices','all-notes-off'].includes(m.method)){
      for(let ch=0;ch<4;ch++)if(!s.held.has(ch))off(s,ch);
    }else if(m.method==='cancel-main-owner'){
      for(let ch=0;ch<4;ch++)if(s.groups[ch]===m.targetGroup&&!s.held.has(ch))off(s,ch);
    }else assert.equal(m.method,'barrier','Unknown additional Game Boy operation '+m.method);
  }
  native.invoke=async(command,args={})=>{
    const match=/^native_genesis_extra_gameboy_(create|status|dispose)$/.exec(command);
    if(match){
      native.calls.push({command,args});assert.equal(args.session,native.current?.session);
      assert(Number.isSafeInteger(args.instance)&&args.instance>0);const map=native.extraGameboy;
      if(match[1]==='create'){assert(extraChipCount(native)<16);assert(!map.has(args.instance));const s=await fresh();map.set(args.instance,s);return snapshot(s);}
      if(match[1]==='dispose'){map.delete(args.instance);return null;}
      const s=map.get(args.instance);assert(s);return snapshot(s);
    }
    if(command==='native_genesis_commands')for(const c of args.commands)if(c.type==='extra-gameboy'){
      const s=native.extraGameboy.get(c.instance);assert(s);apply(s,c.message);
    }
    const value=await invoke(command,args);
    if(['native_genesis_start','native_genesis_stop','native_genesis_shutdown'].includes(command))native.extraGameboy.clear();return value;
  };
}
const program=`
  const a=await createSoundChip('gameboy',{id:'handheld-a'});
  const b=await createSoundChip('gameboy',{id:'handheld-b'});
  a.initialize();b.initialize();
  a.pulse.setVoice(0,{duty:.25,volume:11});b.pulse.setVoice(0,{duty:.75,volume:7});
  a.wave.setWaveform(Array.from({length:32},(_,i)=>i%16));b.wave.setWaveform(Array.from({length:32},(_,i)=>15-i%16));
  a.setPan(0,true,false);b.setPan(0,false,true);a.pulse.noteOn(0,'C4');b.pulse.noteOn(0,'G3');
  a.wave.noteOn('C3');b.wave.noteOn('G3');a.noise.keyOn();b.noise.keyOn();await a.setClock(4000000);
  for(const kind of ['segapsg','ym2612','ym2203','ym2608','ym2610','ym2151','ym2413','ay8910','ym3526','ym3812','y8950','ymf262','rf5c164','okim6258'])await createSoundChip(kind,{id:'base-'+kind});
  await mixer.set(a.id,{volume:.4,pan:-.3});await mixer.set(b.id,{volume:.7,pan:.2});
  liveLoop('extra-gb',async()=>{a.pulse.noteOn(1,'E4');await beat(.25);a.pulse.keyOff(1);await beat(.25);});
  log('gb-ready');
`;
async function runExtraGameboy({page,native,artifacts,name,until,assertNoLiveAudio,changeMode}){
  const all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]),phases=[];
  const stop=async()=>{await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());await until(()=>extraChipCount(native)===0,'All fifteen additional kinds retire');};
  async function keyboard(channel,tab='keyboardTab'){
    const before=all().length;await page.locator('#'+tab).focus();await page.keyboard.down('z');
    try{await until(()=>all().slice(before).some(c=>c.type==='extra-gameboy'&&c.message.action==='on'&&c.message.channel===channel),'Game Boy Keyboard ON '+channel);}finally{await page.keyboard.up('z');}
    await until(()=>all().slice(before).some(c=>c.type==='extra-gameboy'&&c.message.action==='off'&&c.message.channel===channel),'Game Boy Keyboard OFF '+channel);
  }
  for(const execution of ['main','worker']){
    const before=all().length;
    await page.evaluate(({program,execution})=>window.__nativeBackendTest.runtime.playSource(program,{execution}),{program,execution});
    await until(()=>extraChipCount(native)===16&&native.extraGameboy.size===2&&all().slice(before).some(c=>c.type==='extra-gameboy'&&c.message.method==='mix'&&c.message.volume===.7),'Independent Game Boy APU and fifteen-kind rack');
    const states=[...native.extraGameboy.values()],snapshot=await page.evaluate(async()=>({a:await window.__nativeBackendTest.runtime.chipInspector.read('handheld-a'),b:await window.__nativeBackendTest.runtime.chipInspector.read('handheld-b'),mixer:window.__nativeBackendTest.runtime.megaDrive.mixer.list().filter(c=>c.connected),audio:window.__audioConstructions}));
    assert.deepEqual(snapshot.audio,{contexts:0,offline:0,worklets:[]});assert.equal(snapshot.mixer.length,18);
    assert.equal(snapshot.a.clock,4000000);assert.equal(snapshot.b.clock,4194304);assert.equal(snapshot.a.channels.length,4);
    assert.equal(snapshot.a.channels[0].volume,11);assert.equal(snapshot.b.channels[0].volume,7);
    assert.deepEqual(snapshot.a.channels[0].pan,{left:true,right:false});assert.deepEqual(snapshot.b.channels[0].pan,{left:false,right:true});
    assert.equal(snapshot.a.registers[32],0x01);assert.equal(snapshot.b.registers[32],0xfe);
    if(execution==='worker')await until(()=>all().slice(before).some(c=>c.type==='extra-gameboy'&&c.frame>0&&c.performance&&c.owner),'Worker Game Boy loop timing');
    await page.click('#consoleTab');await page.locator('#gameboyTab').waitFor({state:'visible'});await page.click('#gameboyTab');
    await page.selectOption('#gameboyPanel [data-chip-control="instance"]','handheld-a');
    await page.locator('#gameboyPanel [data-chip-channel="0"]').click();
    await page.locator('#gameboyPanel [data-chip-control="gb-volume"]').evaluate(node=>{node.value='13';node.dispatchEvent(new Event('input',{bubbles:true}));});
    await until(()=>states[0].inspector.voice[2]>>4===13,'Game Boy pulse editor');assert.equal(states[1].inspector.voice[2]>>4,7);
    await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:handheld-a');
    for(let ch=0;ch<4;ch++){await page.selectOption('#playgroundKeyboardTargetChannel',String(ch));await keyboard(ch);}
    await page.selectOption('#playgroundKeyboardChip','chip:handheld-b');await page.selectOption('#playgroundKeyboardTargetChannel','2');await keyboard(2);
    await page.click('#consoleTab');await page.click('#gameboyTab');await page.selectOption('#gameboyPanel [data-chip-control="instance"]','handheld-a');
    await page.locator('#gameboyPanel [data-chip-channel="2"]').click();
    await page.locator('#gameboyPanel [data-chip-action="gb-wave-saw"]').click();
    await until(()=>states[0].inspector.voice[32]===0&&states[0].inspector.voice[33]===0x11,'Game Boy Wave RAM editor');
    assert.equal(states[1].inspector.voice[32],0xfe,'Other Wave RAM remains independent');
    await keyboard(2,'gameboyTab');
    await page.locator('#gameboyPanel [data-chip-channel="3"]').click();
    await page.selectOption('#gameboyPanel [data-chip-control="gb-noise-width"]','7');
    await until(()=>!!(states[0].inspector.voice[18]&8),'Game Boy noise editor');assert.equal(states[1].inspector.voice[18]&8,0);
    await keyboard(3,'gameboyTab');
    // Keep the liveLoop's initialized APU running while powering off its sibling.
    await page.selectOption('#gameboyPanel [data-chip-control="instance"]','handheld-b');
    await page.locator('#gameboyPanel [data-chip-control="gb-power"]').evaluate(node=>{node.checked=false;node.dispatchEvent(new Event('change',{bubbles:true}));});
    await until(()=>!(states[1].inspector.registers[22]&128),'Game Boy power editor');assert(states[0].inspector.registers[22]&128);
    assert.equal(states[1].inspector.voice[32],0xfe,'Power off retains Wave RAM');
    await page.selectOption('#gameboyPanel [data-chip-control="instance"]','handheld-a');await page.locator('#gameboyPanel [data-chip-channel="2"]').click();
    const consoleText=await page.locator('#consoleOutput').innerText();
    assert.match(consoleText,/gb-ready/);assert.doesNotMatch(consoleText,/\b(?:Error|TypeError|RangeError|ReferenceError):|Call initialize\(\)/,'No caught playback error in the real Console');
    await page.screenshot({path:path.join(artifacts,`${name}-extra-gameboy-${execution}.png`)});
    phases.push({execution,a:await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('handheld-a')),b:await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('handheld-b'))});
    await stop();await page.locator('#gameboyTab').waitFor({state:'hidden'});
  }
  for(const execution of ['main','worker']){
    const before=native.calls.length;
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`const old=await createSoundChip('gameboy',{id:'fixed-gb'});old.initialize();old.wave.setWaveform(Array(32).fill(15));old.dispose();const next=await createSoundChip('gameboy',{id:'fixed-gb'});next.initialize();await next.setClock(5000000);`,{execution}),execution);
    await until(()=>native.extraGameboy.size===1&&[...native.extraGameboy.values()][0].clock===5000000,'Game Boy same-ID replacement');
    const ids=native.calls.slice(before).filter(c=>c.command==='native_genesis_extra_gameboy_create').map(c=>c.args.instance);assert.equal(ids.length,2);assert(ids[1]>ids[0]);assert.notEqual([...native.extraGameboy.values()][0].inspector.voice[32],255);await stop();
  }
  await changeMode(page,native,'gameboy','keep');
  for(const execution of ['main','worker']){
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`const primary=await useSoundChip('gameboy');if(primary!==await useSoundChip('gameboy'))throw Error('Primary Game Boy cache');const extra=await createSoundChip('gameboy',{id:'extra-gb'});if(extra===primary)throw Error('Independent Game Boy borrowed primary');extra.initialize();extra.wave.setWaveform(Array(32).fill(14));extra.pulse.noteOn(0,'C4');`,{execution}),execution);
    await until(()=>native.extraGameboy.size===1&&[...native.extraGameboy.values()][0].inspector.voice[32]===0xee,'Independent Game Boy beside primary');
    assert.notEqual(native.gameboyInspector.voice[32],0xee);await page.click('#consoleTab');await page.click('#gameboyTab');
    await page.waitForFunction(()=>document.querySelector('#gameboyPanel [data-chip-control="instance"]')?.options.length===2);
    await stop();await page.locator('#gameboyTab').waitFor({state:'visible'});
  }
  await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
  await fs.writeFile(path.join(artifacts,name+'-extra-gameboy.json'),JSON.stringify({mockedNative:true,deviceOpened:false,phases,calls:native.calls},null,2));
}
module.exports={installExtraGameboyMock,runExtraGameboy};
