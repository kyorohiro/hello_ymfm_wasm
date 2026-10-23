// Real Main / Worker / UI; Native IPC only is mocked, with no audio device.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {extraChipCount}=require('./native_backend_extra_limits.cjs');

function installExtraRf5c164Mock(native){
  const invoke=native.invoke.bind(native);native.extraRf5c164=new Map();
  async function fresh(){
    const {RfInspectorState}=await import('../web/playground_chip_inspector_state.js');
    const {RF5C164Synth}=await import('../web/rf5c164synth.js');
    const s={clock:12500000,bank:0,held:new Map(),groups:Array(8).fill(null),memory:new Uint8Array(65536),mix:{volume:1,pan:0}};
    s.inspector=new RfInspectorState({writeRegister(){},loadMemory(){},reset(){}},{clock:()=>s.clock,sampleRate:48000});
    s.control=new RF5C164Synth({transport:{write:(register,value)=>{
      const before=s.inspector.mask;s.inspector.write(register,value);
      if(register===7&&!(value&64))s.bank=(value&15)<<12;
      if(register===8)for(let ch=0;ch<8;ch++)if((before^value)&(1<<ch))s.groups[ch]=value&(1<<ch)?null:s.group??null;
    },loadMemory(){},reset:()=>{s.inspector.reset();s.bank=0;}}});return s;
  }
  const snapshot=s=>({sampleRate:48000,frame:native.status().frame,revision:native.calls.length,rf5c164:{
    ...s.inspector.read(),clock:s.clock,mask:s.inspector.mask,selected:s.inspector.selected,bank:s.bank,
    channels:s.inspector.read().channels.map(ch=>({...ch,configuredStep:s.inspector.configuredSteps[ch.channel]})),
    held:[...s.held.keys()],pendingCommands:[],knownMemoryRanges:s.inspector.memoryRanges.map(r=>({start:r.address,end:r.end})),
  }});
  function apply(s,m){
    const previous=s.group;s.group=m.group;
    try{
      if(m.method==='batch'){
        assert(Number.isInteger(m.channel)&&m.channel>=0&&m.channel<8);
        if(m.action==='off'&&s.held.get(m.channel)!==m.voice)return;
        if(m.action==='on')s.held.set(m.channel,m.voice);
        s.inspector.auditionWriting+=m.audition&&m.action!=='edit'?1:0;
        try{for(const c of m.commands)apply(s,{...c,group:m.group});}finally{s.inspector.auditionWriting-=m.audition&&m.action!=='edit'?1:0;}
        if(m.action==='off')s.held.delete(m.channel);
      }else if(m.method==='write')s.control.writeRegister(m.register,m.value);
      else if(m.method==='set-channel')s.control.setChannel(m.channel,m.options);
      else if(m.method==='key-on'||m.method==='key-off'){
        s.control.channelMask=s.inspector.mask;s.control[m.method==='key-on'?'keyOn':'keyOff'](m.channel);
        s.groups[m.channel]=m.method==='key-on'?m.group??null:null;
      }else if(m.method==='write-memory'){
        assert(Number.isInteger(m.offset)&&m.offset>=0&&m.offset<4096);const address=s.bank|m.offset;s.memory[address]=m.value;s.inspector.memoryWrite(address,1);
      }else if(m.method==='load-memory'){
        assert(Number.isInteger(m.offset)&&m.offset>=0&&m.offset+m.data.length<=65536);
        s.memory.set(m.data,m.offset);s.inspector.memoryWrite(m.offset,m.data.length);
      }else if(m.method==='reset'){s.control.reset();s.groups.fill(null);s.held.clear();}
      else if(m.method==='clear-memory'){s.memory.fill(0);s.inspector.memoryRanges=[];s.inspector.memoryRevision++;}
      else if(m.method==='clock'){if(s.held.size)throw Error('Release the manually held additional RF5C164 voices before changing the clock');s.clock=m.hz;}
      else if(m.method==='mix')s.mix={volume:m.volume,pan:m.pan};
      else if(m.method==='stop-voices'){
        s.control.channelMask=s.inspector.mask;for(let ch=0;ch<8;ch++)s.control.keyOff(ch);s.held.clear();s.groups.fill(null);
      }else if(m.method==='cancel-main-owner'){
        s.control.channelMask=s.inspector.mask;for(let ch=0;ch<8;ch++)if(s.groups[ch]===m.targetGroup&&!s.held.has(ch)){s.control.keyOff(ch);s.groups[ch]=null;}
      }else assert.equal(m.method,'barrier','Unknown additional RF5C164 command '+m.method);
    }finally{s.group=previous;}
  }
  native.invoke=async(command,args={})=>{
    const match=/^native_genesis_extra_rf5c164_(create|status|dispose)$/.exec(command);
    if(match){
      native.calls.push({command,args});assert.equal(args.session,native.current?.session);assert(Number.isSafeInteger(args.instance)&&args.instance>0);
      const map=native.extraRf5c164;
      if(match[1]==='create'){assert(extraChipCount(native)<16);assert(!map.has(args.instance));const s=await fresh();map.set(args.instance,s);return snapshot(s);}
      if(match[1]==='dispose'){map.delete(args.instance);return null;}
      const s=map.get(args.instance);assert(s);return snapshot(s);
    }
    if(command==='native_genesis_commands')for(const c of args.commands)if(c.type==='extra-rf5c164'){const s=native.extraRf5c164.get(c.instance);assert(s);apply(s,c.message);}
    const result=await invoke(command,args);
    if(['native_genesis_start','native_genesis_stop','native_genesis_shutdown'].includes(command))native.extraRf5c164.clear();return result;
  };
}

const program=`
  const a=await createSoundChip('rf5c164',{id:'sampler-a'});
  const b=await createSoundChip('rf5c164',{id:'sampler-b'});
  const wave=Float32Array.from({length:512},(_,i)=>.7*Math.sin(2*Math.PI*i/64));
  const sa=await a.loadSample({channels:[wave],sampleRate:22050},{loopStart:0,endGuardBytes:16});
  const sb=await b.loadSample({channels:[wave],sampleRate:22050},{address:8192,loopStart:0});
  for(let ch=0;ch<8;ch++){
    await a.setChannel(ch,{...sa,volume:180,pan:{left:15,right:15}});
    await b.setChannel(ch,{...sb,volume:140,pan:{left:3,right:12}});
  }
  await a.keyOn(1);await b.keyOn(7);await a.setClock(12000000);await a.writeRegister(7,0x83);
  for(const kind of ['segapsg','ym2612','ym2203','ym2608','ym2610','ym2151','ym2413','ay8910','ym3526','ym3812','y8950','ymf262'])await createSoundChip(kind,{id:'base-'+kind});
  await createSoundChip('segapsg',{id:'extra-psg-a'});await createSoundChip('segapsg',{id:'extra-psg-b'});
  await mixer.set(a.id,{volume:.4,pan:-.3});await mixer.set(b.id,{volume:.7,pan:.2});
  liveLoop('extra-rf',async()=>{await a.setPitch(7,sa.step);await beat(.25);});
  log('rf-ready');
`;
function wavBytes(){
  const n=384,bytes=Buffer.alloc(44+n*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);
  bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(22050,24);bytes.writeUInt32LE(44100,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);
  bytes.write('data',36);bytes.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)bytes.writeInt16LE(Math.round(18000*Math.sin(i*Math.PI/24)),44+i*2);return [...bytes];
}
async function runExtraRf5c164({page,native,artifacts,name,until,assertNoLiveAudio,changeMode}){
  const all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]),phases=[];
  const stop=async()=>{await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());await until(()=>extraChipCount(native)===0,'All thirteen additional kinds retire');};
  async function keyboard(channel,tab='keyboardTab'){
    const before=all().length;await page.locator('#'+tab).focus();await page.keyboard.down('z');
    try{await until(()=>all().slice(before).some(c=>c.type==='extra-rf5c164'&&c.message.action==='on'&&c.message.channel===channel),'RF Keyboard ON '+channel);}finally{await page.keyboard.up('z');}
    await until(()=>all().slice(before).some(c=>c.type==='extra-rf5c164'&&c.message.action==='off'&&c.message.channel===channel),'RF Keyboard OFF '+channel);
  }
  for(const execution of ['main','worker']){
    const before=all().length;await page.evaluate(({program,execution})=>window.__nativeBackendTest.runtime.playSource(program,{execution}),{program,execution});
    await until(()=>extraChipCount(native)===16&&[...native.extraRf5c164.values()].length===2&&all().slice(before).some(c=>c.type==='extra-rf5c164'&&c.message.method==='mix'&&c.message.volume===.7),'Independent RF RAM and thirteen-kind rack');
    const states=[...native.extraRf5c164.values()],snapshot=await page.evaluate(async()=>({a:await window.__nativeBackendTest.runtime.chipInspector.read('sampler-a'),b:await window.__nativeBackendTest.runtime.chipInspector.read('sampler-b'),mixer:window.__nativeBackendTest.runtime.megaDrive.mixer.list().filter(c=>c.connected),audio:window.__audioConstructions}));
    assert.deepEqual(snapshot.audio,{contexts:0,offline:0,worklets:[]});assert.equal(snapshot.mixer.length,18);assert.equal(snapshot.a.clock,12000000);assert.equal(snapshot.b.clock,12500000);assert.equal(snapshot.a.bank,12288);assert.equal(snapshot.b.bank,0);
    assert.equal(snapshot.a.channels.length,8);assert.equal(snapshot.a.channels[0].start,0);assert.equal(snapshot.b.channels[0].start,8192);
    assert(snapshot.a.samples.length&&snapshot.a.samples[0].waveform.length);assert.equal(states[1].memory[0],0);assert.notEqual(states[0].memory[8192],states[1].memory[8192]);
    if(execution==='worker')await until(()=>all().slice(before).some(c=>c.type==='extra-rf5c164'&&c.frame>0&&c.performance&&c.owner),'Async RF RPC preserves Worker loop timing');
    await page.click('#consoleTab');await page.locator('#rf5c164Tab').waitFor({state:'visible'});await page.click('#rf5c164Tab');
    await page.selectOption('#rf5c164Panel [data-chip-control="instance"]','sampler-a');
    const volume=page.locator('#rf5c164Panel [data-chip-control="rf-volume"]');await volume.evaluate(node=>{node.value='123';node.dispatchEvent(new Event('input',{bubbles:true}));});
    await until(()=>states[0].inspector.channels[0].volume===123,'RF volume editor');assert.equal(states[1].inspector.channels[0].volume,140);
    await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:sampler-a');await page.selectOption('#playgroundKeyboardTargetChannel','0');
    const sibling=states[0].inspector.mask&2,baseStep=states[0].inspector.configuredSteps[0];await keyboard(0);
    assert.equal(states[0].inspector.mask&2,sibling,'Manual preview preserves sibling gate');assert.equal(states[0].inspector.configuredSteps[0],baseStep,'Manual preview preserves configured pitch');
    await page.selectOption('#playgroundKeyboardChip','chip:sampler-b');await page.selectOption('#playgroundKeyboardTargetChannel','7');await keyboard(7);
    await page.click('#consoleTab');await page.click('#rf5c164Tab');await page.selectOption('#rf5c164Panel [data-chip-control="instance"]','sampler-b');
    await page.evaluate(bytes=>window.__nativeBackendTest.virtualFiles.writeBinary('/samples/native-extra-rf.wav',Uint8Array.from(bytes)),wavBytes());
    await page.locator('#rf5c164Panel').getByRole('button',{name:'Refresh',exact:true}).click();
    await page.selectOption('#rf5c164Panel [data-chip-control="rf-file"]','/samples/native-extra-rf.wav');
    await page.locator('#rf5c164Panel').getByRole('button',{name:'Load audio file',exact:true}).click();
    await page.waitForFunction(async()=>{const s=await window.__nativeBackendTest.runtime.chipInspector.read('sampler-b');return s.samples.some(sample=>sample.name==='/samples/native-extra-rf.wav');});
    await until(()=>states[1].inspector.channels[0].start===0,'Loaded WAV is assigned to the selected RF channel');
    await page.waitForFunction(()=>{const select=document.querySelector('#rf5c164Panel [data-chip-control="rf-sample"]');return select?.options.length===3&&select.value==='0';});
    await keyboard(0,'rf5c164Tab');
    assert.equal(states[0].inspector.channels[0].volume,123,'Other RAM allocator/voice remains independent');
    await page.screenshot({path:path.join(artifacts,`${name}-extra-rf5c164-${execution}.png`)});
    phases.push({execution,a:await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('sampler-a')),b:await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('sampler-b'))});
    await stop();await page.locator('#rf5c164Tab').waitFor({state:'hidden'});
  }
  for(const execution of ['main','worker']){
    const before=native.calls.length;
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`const old=await createSoundChip('rf5c164',{id:'fixed-rf'});await old.loadMemory(new Uint8Array([0x81,0xff]));old.dispose();const next=await createSoundChip('rf5c164',{id:'fixed-rf'});await next.setClock(13000000);`,{execution}),execution);
    await until(()=>native.extraRf5c164.size===1&&[...native.extraRf5c164.values()][0].clock===13000000,'RF same-ID replacement');
    const ids=native.calls.slice(before).filter(c=>c.command==='native_genesis_extra_rf5c164_create').map(c=>c.args.instance);assert.equal(ids.length,2);assert(ids[1]>ids[0]);assert.equal([...native.extraRf5c164.values()][0].memory[0],0);await stop();
  }
  for(const mode of ['mega-cd','genesis-full','genesis-full-nuked']){
    await changeMode(page,native,mode,'keep');
    await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource(`const primary=await useSoundChip('rf5c164');if(primary!==await useSoundChip('rf5c164'))throw Error('Primary RF cache');const extra=await createSoundChip('rf5c164',{id:'extra-rf'});if(extra===primary)throw Error('Independent RF borrowed primary');await extra.loadMemory(new Uint8Array([0xb1,0xff]),1024);`));
    await until(()=>native.extraRf5c164.size===1&&[...native.extraRf5c164.values()][0].memory[1024]===0xb1,'Independent RF beside primary '+mode);
    assert.equal(native.pcmMemory[1024],0);await page.click('#consoleTab');await page.click('#rf5c164Tab');
    await page.waitForFunction(()=>document.querySelector('#rf5c164Panel [data-chip-control="instance"]')?.options.length===2);await stop();await page.locator('#rf5c164Tab').waitFor({state:'visible'});
  }
  await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
  await fs.writeFile(path.join(artifacts,name+'-extra-rf5c164.json'),JSON.stringify({mockedNative:true,deviceOpened:false,phases,calls:native.calls},null,2));
}
module.exports={installExtraRf5c164Mock,runExtraRf5c164};
