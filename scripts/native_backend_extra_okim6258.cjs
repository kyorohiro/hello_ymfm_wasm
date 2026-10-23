// Real Main / logic Worker / UI, Native IPC mocked; no output device.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {extraChipCount}=require('./native_backend_extra_limits.cjs');

function installExtraOkim6258Mock(native){
  const invoke=native.invoke.bind(native);native.extraOkim6258=new Map();
  const fresh=()=>({clock:8000000,divider:512,pan:0,playing:false,streaming:false,repeat:false,
    positionFrames:0,fedBytes:0,memoryRevision:0,sampleId:0,sample:null,held:new Map(),
    memory:new Uint8Array(),group:null,mix:{volume:1,pan:0}});
  const snapshot=s=>({sampleRate:48000,frame:native.status().frame,revision:native.calls.length,
    okim6258:{...s,memory:undefined,held:[...s.held.keys()],pendingCommands:[],sampleRate:48000}});
  function apply(s,m){
    if(m.method==='batch'){
      assert.equal(m.channel,0);
      if(m.action==='off'&&s.held.get(0)!==m.voice)return;
      if(m.action==='on')s.held.set(0,m.voice);
      for(const op of m.commands)apply(s,{...op,group:m.group});
      if(m.action==='off')s.held.delete(0);
    }else if(m.method==='write'){
      assert(Number.isInteger(m.register)&&m.register>=0&&m.register<=12);
      if(m.register===12)s.divider=[1024,768,512,512][m.value&3];
      if(m.register===2)s.pan=m.value&3;
      if(m.register===0){s.streaming=false;s.playing=!!(m.value&2)&&!(m.value&1);s.group=m.group??null;}
    }else if(m.method==='load-memory'){
      if(s.held.size&&!m.audition)throw Error('Release the manually held additional OKIM6258 voices before replacing their sample');
      assert(m.data.length>0&&m.data.length<=0x1000000);assert(Array.isArray(m.metadata.waveform));
      s.memory=Uint8Array.from(m.data);s.sampleId=m.sampleId;
      s.sample={...m.metadata,bytes:s.memory.length,durationSeconds:m.metadata.frames/m.metadata.sampleRate};
      s.memoryRevision++;s.playing=s.streaming=false;s.group=null;
    }else if(m.method==='play'){
      assert(s.sample,'Upload before playback');s.playing=s.streaming=true;s.repeat=m.repeat;
      s.positionFrames=s.fedBytes=0;s.group=m.group??null;
    }else if(m.method==='set-repeat')s.repeat=m.repeat;
    else if(m.method==='stop'||m.method==='stop-voices'){
      s.playing=s.streaming=false;s.group=null;if(m.method==='stop-voices')s.held.clear();
    }else if(m.method==='reset'){
      s.held.clear();s.playing=s.streaming=false;s.divider=512;s.pan=0;s.group=null;
    }else if(m.method==='clock'){
      if(s.held.size&&!m.audition)throw Error('Release the manually held additional OKIM6258 voices before changing the clock');
      s.clock=m.hz;
    }
    else if(m.method==='mix')s.mix={volume:m.volume,pan:m.pan};
    else if(m.method==='cancel-main-owner'){
      if(!s.held.size&&s.group===m.targetGroup){s.playing=s.streaming=false;s.group=null;}
    }else assert.equal(m.method,'barrier','Unknown additional OKIM6258 operation '+m.method);
  }
  native.invoke=async(command,args={})=>{
    const match=/^native_genesis_extra_okim6258_(create|status|dispose)$/.exec(command);
    if(match){
      native.calls.push({command,args});assert.equal(args.session,native.current?.session);
      assert(Number.isSafeInteger(args.instance)&&args.instance>0);const map=native.extraOkim6258;
      if(match[1]==='create'){assert(extraChipCount(native)<16);assert(!map.has(args.instance));const s=fresh();map.set(args.instance,s);return snapshot(s);}
      if(match[1]==='dispose'){map.delete(args.instance);return null;}
      const s=map.get(args.instance);assert(s);return snapshot(s);
    }
    if(command==='native_genesis_commands')for(const c of args.commands)if(c.type==='extra-okim6258'){
      const s=native.extraOkim6258.get(c.instance);assert(s);apply(s,c.message);
    }
    const value=await invoke(command,args);
    if(['native_genesis_start','native_genesis_stop','native_genesis_shutdown'].includes(command))native.extraOkim6258.clear();return value;
  };
}

const program=`
  const a=await createSoundChip('okim6258',{id:'adpcm-a'});
  const b=await createSoundChip('okim6258',{id:'adpcm-b'});
  await a.loadMemory(new Uint8Array([0x11,0x72,0xf8,0x03,0x99,0x40]));
  const wave=Float32Array.from({length:512},(_,i)=>.7*Math.sin(2*Math.PI*i/64));
  await b.loadSample({channels:[wave],sampleRate:22050});
  a.setDivider(1024);a.setPan(true,false);a.play({repeat:true});
  b.setDivider(768);b.setPan(false,true);b.play({repeat:false});
  await a.setClock(7680000);
  for(const kind of ['segapsg','ym2612','ym2203','ym2608','ym2610','ym2151','ym2413','ay8910','ym3526','ym3812','y8950','ymf262','rf5c164'])await createSoundChip(kind,{id:'base-'+kind});
  await createSoundChip('segapsg',{id:'extra-psg'});
  await mixer.set(a.id,{volume:.4,pan:-.3});await mixer.set(b.id,{volume:.7,pan:.2});
  liveLoop('extra-oki',async()=>{b.play({repeat:true});await beat(.25);b.stop();await beat(.25);});
  log('oki-ready');
`;
function wavBytes(){
  const n=384,bytes=Buffer.alloc(44+n*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);
  bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(22050,24);bytes.writeUInt32LE(44100,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);
  bytes.write('data',36);bytes.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)bytes.writeInt16LE(Math.round(18000*Math.sin(i*Math.PI/24)),44+i*2);return [...bytes];
}
async function runExtraOkim6258({page,native,artifacts,name,until,assertNoLiveAudio,changeMode}){
  const all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]),phases=[];
  const stop=async()=>{await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());await until(()=>extraChipCount(native)===0,'All fourteen additional kinds retire');};
  async function keyboard(tab='keyboardTab',during){
    const before=all().length;await page.locator('#'+tab).focus();await page.keyboard.down('z');
    try{await until(()=>all().slice(before).some(c=>c.type==='extra-okim6258'&&c.message.action==='on'&&c.message.channel===0),'OKI Keyboard ON');await during?.();}finally{await page.keyboard.up('z');}
    await until(()=>all().slice(before).some(c=>c.type==='extra-okim6258'&&c.message.action==='off'&&c.message.channel===0),'OKI Keyboard OFF');
  }
  for(const execution of ['main','worker']){
    const before=all().length;
    await page.evaluate(({program,execution})=>window.__nativeBackendTest.runtime.playSource(program,{execution}),{program,execution});
    await until(()=>extraChipCount(native)===16&&native.extraOkim6258.size===2&&all().slice(before).some(c=>c.type==='extra-okim6258'&&c.message.method==='mix'&&c.message.volume===.7),'Independent OKI samples and fourteen-kind rack');
    const states=[...native.extraOkim6258.values()];
    const snapshot=await page.evaluate(async()=>({a:await window.__nativeBackendTest.runtime.chipInspector.read('adpcm-a'),b:await window.__nativeBackendTest.runtime.chipInspector.read('adpcm-b'),mixer:window.__nativeBackendTest.runtime.megaDrive.mixer.list().filter(c=>c.connected),audio:window.__audioConstructions}));
    assert.deepEqual(snapshot.audio,{contexts:0,offline:0,worklets:[]});assert.equal(snapshot.mixer.length,18);
    assert.equal(snapshot.a.clock,7680000);assert.equal(snapshot.b.clock,8000000);assert.equal(snapshot.a.divider,1024);assert.equal(snapshot.b.divider,768);
    assert.deepEqual(snapshot.a.pan,{left:true,right:false});assert.deepEqual(snapshot.b.pan,{left:false,right:true});
    assert.equal(snapshot.a.channels.length,1);assert.equal(snapshot.a.sample.bytes,6);assert(snapshot.b.sample.bytes>6);assert(snapshot.b.sample.waveform.length);
    assert.notDeepEqual([...states[0].memory],[...states[1].memory]);
    if(execution==='worker')await until(()=>all().slice(before).some(c=>c.type==='extra-okim6258'&&c.frame>0&&c.performance&&c.owner),'Worker OKI preserves loop timing');
    await page.click('#consoleTab');await page.locator('#okim6258Tab').waitFor({state:'visible'});await page.click('#okim6258Tab');
    await page.selectOption('#okim6258Panel [data-chip-control="instance"]','adpcm-a');
    await page.selectOption('#okim6258Panel [data-chip-control="oki6258-divider"]','512');
    await until(()=>states[0].divider===512,'OKI divider editor');assert.equal(states[1].divider,768);
    await page.locator('#okim6258Panel [data-chip-control="oki6258-clock"]').evaluate(node=>{node.value='7200000';node.dispatchEvent(new Event('change',{bubbles:true}));});
    await until(()=>states[0].clock===7200000,'OKI clock editor');assert.equal(states[1].clock,8000000);
    await page.locator('#okim6258Panel [data-chip-control="oki6258-pan-right"]').evaluate(node=>{node.checked=true;node.dispatchEvent(new Event('change',{bubbles:true}));});
    await until(()=>states[0].pan===0,'OKI pan editor');assert.equal(states[1].pan,2);
    await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:adpcm-a');
    await page.selectOption('#playgroundKeyboardTargetChannel','0');await keyboard();
    await page.selectOption('#playgroundKeyboardChip','chip:adpcm-b');await keyboard();
    await page.click('#consoleTab');await page.click('#okim6258Tab');await page.selectOption('#okim6258Panel [data-chip-control="instance"]','adpcm-b');
    await page.evaluate(bytes=>window.__nativeBackendTest.virtualFiles.writeBinary('/samples/native-extra-oki.wav',Uint8Array.from(bytes)),wavBytes());
    await page.locator('#okim6258Panel').getByRole('button',{name:'Refresh',exact:true}).click();
    await page.selectOption('#okim6258Panel [data-chip-control="oki6258-file"]','/samples/native-extra-oki.wav');
    await page.locator('#okim6258Panel').getByRole('button',{name:'Load audio file',exact:true}).click();
    await page.waitForFunction(async()=>{const s=await window.__nativeBackendTest.runtime.chipInspector.read('adpcm-b');return s.sample?.name==='/samples/native-extra-oki.wav';});
    await keyboard('okim6258Tab',async()=>{
      await page.locator('#okim6258Panel [data-chip-control="oki6258-clock"]').evaluate(node=>{node.value='7100000';node.dispatchEvent(new Event('change',{bubbles:true}));});
      await until(()=>states[1].clock===7100000,'OKI manual clock edit while held');
      assert(states[1].held.has(0),'Manual clock edit retains the held preview');
    });assert.equal(states[0].memory.length,6,'Other instance sample retained');
    await page.screenshot({path:path.join(artifacts,`${name}-extra-okim6258-${execution}.png`)});
    phases.push({execution,a:await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('adpcm-a')),b:await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('adpcm-b'))});
    await stop();await page.locator('#okim6258Tab').waitFor({state:'hidden'});
  }
  for(const execution of ['main','worker']){
    const before=native.calls.length;
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`const old=await createSoundChip('okim6258',{id:'fixed-oki'});await old.loadMemory(new Uint8Array([0x11,0x70]));old.dispose();const next=await createSoundChip('okim6258',{id:'fixed-oki'});await next.setClock(7000000);await next.loadMemory(new Uint8Array([0x39]));next.setDivider(1024);next.reset();`,{execution}),execution);
    await until(()=>native.extraOkim6258.size===1&&[...native.extraOkim6258.values()][0].clock===7000000&&[...native.extraOkim6258.values()][0].memory.length===1&&[...native.extraOkim6258.values()][0].divider===512,'OKI replacement/reset retaining sample');
    const ids=native.calls.slice(before).filter(c=>c.command==='native_genesis_extra_okim6258_create').map(c=>c.args.instance);assert.equal(ids.length,2);assert(ids[1]>ids[0]);await stop();
  }
  await changeMode(page,native,'x68000','keep');
  for(const execution of ['main','worker']){
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`const primary=await useSoundChip('okim6258');if(primary!==await useSoundChip('okim6258'))throw Error('Primary OKI cache');const extra=await createSoundChip('okim6258',{id:'extra-oki'});if(extra===primary)throw Error('Independent OKI borrowed primary');await extra.loadMemory(new Uint8Array([0x91,0x22]));`,{execution}),execution);
    await until(()=>native.extraOkim6258.size===1&&[...native.extraOkim6258.values()][0].memory.length===2,'Independent OKI beside primary');
    assert.equal(native.x68000.memory.length,0);await page.click('#consoleTab');await page.click('#okim6258Tab');
    await page.waitForFunction(()=>document.querySelector('#okim6258Panel [data-chip-control="instance"]')?.options.length===2);
    await stop();await page.locator('#okim6258Tab').waitFor({state:'visible'});
  }
  await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
  await fs.writeFile(path.join(artifacts,name+'-extra-okim6258.json'),JSON.stringify({mockedNative:true,deviceOpened:false,phases,calls:native.calls},null,2));
}
module.exports={installExtraOkim6258Mock,runExtraOkim6258};
