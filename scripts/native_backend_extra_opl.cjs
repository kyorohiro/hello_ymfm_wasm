// Actual Main/Worker/Inspector/UI/Keyboard, mocked Native IPC, no audio device.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {extraChipCount}=require('./native_backend_extra_limits.cjs');
const chips=['ym3526','ym3812','y8950'],maps={ym3526:'extraYm3526',ym3812:'extraYm3812',y8950:'extraY8950'};
function installExtraOplMock(native){
  const invoke=native.invoke.bind(native);for(const key of Object.values(maps))native[key]=new Map();
  const fresh=chip=>({chip,channels:9,clock:3579545,registers:Array(256).fill(0),status:0,irq:false,layoutRevision:0,layoutPending:false,held:new Map(),groups:Array(23).fill(null),mix:{volume:1,pan:0}});
  const snapshot=(kind,s)=>({sampleRate:48000,frame:native.status().frame,revision:native.calls.length,[kind]:{...s,registers:s.registers.slice(),held:[...s.held.keys()],pendingCommands:[]}});
  function off(s,ch){if(ch<9)s.registers[0xb0+ch]&=223;else s.registers[0xbd]&=~(16>>(ch-18));}
  function apply(s,m){
    if(m.method==='batch'){
      assert(Number.isInteger(m.channel)&&(m.channel>=0&&m.channel<9||m.channel>=18&&m.channel<=22));if(m.action==='off'&&s.held.get(m.channel)!==m.voice)return;
      if(m.action==='on')s.held.set(m.channel,m.voice);m.commands.forEach(c=>apply(s,{...c,group:m.group}));if(m.action==='off')s.held.delete(m.channel);
    }else if(m.method==='write'){
      const r=m.register,v=m.value;assert(Number.isInteger(r)&&r>=0&&r<256&&Number.isInteger(v)&&v>=0&&v<=255);if(r===0xbd&&((s.registers[r]^v)&32))s.layoutRevision++;s.registers[r]=v;
      if(r>=0xb0&&r<=0xb8)s.groups[r-0xb0]=v&32?m.group??null:null;
      if(r===0xbd)for(let i=0;i<5;i++)s.groups[18+i]=v&(16>>i)?m.group??null:null;if(r===8)s.csmGroup=m.group??null;
    }else if(m.method==='clock'){if(s.held.size)throw Error(`Release the manually held additional ${s.chip.toUpperCase()} voices before changing the clock`);s.clock=m.hz;}
    else if(m.method==='reset'){if(!s.held.size){const {chip,clock,layoutRevision}=s;Object.assign(s,fresh(chip),{clock,layoutRevision:layoutRevision+!!(s.registers[0xbd]&32)});}}
    else if(m.method==='stop-voices'||m.method==='all-notes-off'){for(let ch=0;ch<9;ch++)off(s,ch);s.registers[0xbd]&=224;s.held.clear();s.groups.fill(null);if(m.method==='stop-voices')s.registers[8]&=127;}
    else if(m.method==='key-off')off(s,m.channel);
    else if(m.method==='audition-key-on'){if(m.channel<9)s.registers[0xb0+m.channel]|=32;else s.registers[0xbd]|=16>>(m.channel-18);}
    else if(m.method==='cancel-main-owner'){for(let ch=0;ch<s.groups.length;ch++)if(s.groups[ch]===m.targetGroup&&!s.held.has(ch)){off(s,ch);s.groups[ch]=null;}if(s.csmGroup===m.targetGroup)s.registers[8]&=127;}
    else if(m.method==='cancel-csm')s.registers[8]&=127;
    else if(m.method==='mix')s.mix={volume:m.volume,pan:m.pan};
    else assert.equal(m.method,'barrier','Unknown additional '+s.chip+' command '+m.method);
  }
  native.invoke=async(command,args={})=>{
    const match=/^native_genesis_extra_(ym3526|ym3812|y8950)_(create|dispose|status)$/.exec(command);
    if(match){
      native.calls.push({command,args});assert.equal(args.session,native.current?.session);assert(Number.isSafeInteger(args.instance)&&args.instance>0);const [,kind,method]=match,map=native[maps[kind]];
      if(method==='create'){assert(extraChipCount(native)<16);assert(!map.has(args.instance));const s=fresh(kind);map.set(args.instance,s);return snapshot(kind,s);}
      if(method==='dispose'){map.delete(args.instance);return null;}const s=map.get(args.instance);assert(s);return snapshot(kind,s);
    }
    if(command==='native_genesis_commands')for(const c of args.commands){const kind=c.type.startsWith('extra-')?c.type.slice(6):null;if(maps[kind]){const s=native[maps[kind]].get(c.instance);assert(s);apply(s,c.message);}}
    const result=await invoke(command,args);if(['native_genesis_start','native_genesis_stop','native_genesis_shutdown'].includes(command))for(const key of Object.values(maps))native[key].clear();return result;
  };
}
const program=`
  const voice={algorithm:0,feedback:0,operators:[{multi:1,tl:63,ar:15,dr:0,sl:0,rr:10,egt:true},{multi:1,tl:12,ar:15,dr:0,sl:0,rr:10,egt:true}]};
  for(const kind of ['ym3526','ym3812','y8950']){
    const a=await createSoundChip(kind,{id:kind+'-a'}),b=await createSoundChip(kind,{id:kind+'-b'});
    for(let ch=0;ch<9;ch++){a.setPreset(ch,voice);b.setPreset(ch,voice);}a.noteOn(0,'C4');b.noteOn(8,'G3');await a.setClock(4000000);
    liveLoop('extra-'+kind,async()=>{a.setOperator(1,1,{tl:17});await beat(.25);});
  }
  for(const kind of ['ym2413','ay8910','ym2151','ym2610','ym2608','ym2203','ym2612','segapsg'])await createSoundChip(kind,{id:'base-'+kind});
  await mixer.set('ym3526-a',{volume:.4,pan:-.3});await mixer.set('y8950-b',{volume:.7,pan:.2});
`;
async function runExtraOpl({page,native,artifacts,name,until,assertNoLiveAudio,changeMode}){
  const all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]),phases=[];
  const stop=async()=>{await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());await until(()=>extraChipCount(native)===0,'All eleven additional kinds retire');};
  async function keyboard(kind,channel,tab=kind+'Tab'){const before=all().length;await page.locator('#'+tab).focus();await page.keyboard.down('z');try{await until(()=>all().slice(before).some(c=>c.type==='extra-'+kind&&c.message.action==='on'&&c.message.channel===channel),'Keyboard '+kind+' voice'+channel);}finally{await page.keyboard.up('z');}await until(()=>all().slice(before).some(c=>c.type==='extra-'+kind&&c.message.action==='off'&&c.message.channel===channel),'Keyboard release '+kind);}
  async function inspect(){return page.evaluate(async()=>{const r=window.__nativeBackendTest.runtime,result={};for(const kind of ['ym3526','ym3812','y8950'])result[kind]=await r.chipInspector.read(kind+'-a');return {snapshots:result,mixer:r.megaDrive.mixer.list().filter(c=>c.connected),audio:window.__audioConstructions};});}
  async function edit(kind,field,value){const node=page.locator(`#${kind}Panel [data-chip-control="opl-${field}"]`);await node.fill(String(value));await node.dispatchEvent('change');}
  for(const execution of ['main','worker']){
    const before=all().length;await page.evaluate(({program,execution})=>window.__nativeBackendTest.runtime.playSource(program,{execution}),{program,execution});await until(()=>extraChipCount(native)===14&&all().slice(before).some(c=>c.type==='extra-y8950'&&c.message.method==='mix'&&c.message.volume===.7),'Independent OPL initialization and eleven-kind rack');
    const first=await inspect();assert.deepEqual(first.audio,{contexts:0,offline:0,worklets:[]});assert.equal(first.mixer.length,16);
    for(const kind of chips){const s=first.snapshots[kind],states=[...native[maps[kind]].values()];assert.equal(s.kind,kind);assert.equal(s.clock,4000000);assert.equal(s.channels.length,9);assert.equal(s.keyboardChannels.length,9);assert.equal(states[1].clock,3579545);assert.equal(states[0].registers[1]&32,kind==='ym3812'?32:0);
      if(execution==='worker')await until(()=>all().slice(before).some(c=>c.type==='extra-'+kind&&c.frame>0&&c.performance&&c.owner),'Scheduled OPL owner '+kind);
      const opening=all().length;await page.click('#consoleTab');await page.locator('#'+kind+'Tab').waitFor({state:'visible'});await page.click('#'+kind+'Tab');await page.selectOption(`#${kind}Panel [data-chip-control="instance"]`,kind+'-a');await page.locator(`#${kind}Panel [data-chip-control="opl-op-1-tl"]`).waitFor();assert(!all().slice(opening).some(c=>c.type==='extra-'+kind&&c.message.audition),'Opening OPL must only observe');
      await edit(kind,'op-1-tl',9);await until(()=>(states[0].registers[0x43]&63)===9,'OPL carrier TL '+kind);assert.equal(states[1].registers[0x43]&63,12);const wave=page.locator(`#${kind}Panel [data-chip-control="opl-op-1-waveform"]`);if(kind==='ym3812'){await wave.fill('2');await wave.dispatchEvent('change');await until(()=>(states[0].registers[0xe3]&3)===2,'OPL2 waveform');}else assert(await wave.isDisabled());await keyboard(kind,0);
      await page.selectOption(`#${kind}Panel [data-chip-control="instance"]`,kind+'-b');await page.locator(`#${kind}Panel [data-chip-channel="8"]`).click();await keyboard(kind,8);
      await page.selectOption(`#${kind}Panel [data-chip-control="instance"]`,kind+'-a');await page.locator(`#${kind}Panel [data-chip-control="opl-rhythm"]`).check();await until(()=>!!(states[0].registers[0xbd]&32),'OPL rhythm enable '+kind);await page.locator(`#${kind}Panel [data-chip-control="opl-rhythm-hiHat"]`).check();await until(()=>!!(states[0].registers[0xbd]&1),'OPL hi-hat toggle '+kind);await page.screenshot({path:path.join(artifacts,`${name}-extra-${kind}-${execution}.png`)});
      await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:'+kind+'-a');await page.waitForFunction(()=>document.querySelector('#playgroundKeyboardTargetChannel')?.options.length===11);await page.selectOption('#playgroundKeyboardTargetChannel','rhythm:4');await keyboard(kind,22,'keyboardTab');
      await page.click('#consoleTab');await page.click('#'+kind+'Tab');await page.locator(`#${kind}Panel [data-chip-control="opl-rhythm"]`).uncheck();await until(()=>!(states[0].registers[0xbd]&32),'OPL melodic restore '+kind);await page.click('#keyboardTab');await page.waitForFunction(()=>document.querySelector('#playgroundKeyboardTargetChannel')?.options.length===9);
    }
    phases.push({execution,...await inspect()});await stop();for(const kind of chips)await page.locator('#'+kind+'Tab').waitFor({state:'hidden'});
  }
  for(const execution of ['main','worker']){const before=native.calls.length;await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`for(const kind of ['ym3526','ym3812','y8950']){const old=await createSoundChip(kind,{id:kind});old.dispose();const next=await createSoundChip(kind,{id:kind});await next.setClock(3900000);}`,{execution}),execution);await until(()=>chips.every(kind=>native[maps[kind]].size===1&&[...native[maps[kind]].values()][0].clock===3900000),'Replaced OPL fixed IDs');for(const kind of chips){const ids=native.calls.slice(before).filter(c=>c.command===`native_genesis_extra_${kind}_create`).map(c=>c.args.instance);assert.equal(ids.length,2);assert(ids[1]>ids[0]);}await stop();}
  for(const mode of ['ym3526','ym3812','msx-audio']){const kind=mode==='msx-audio'?'y8950':mode;await changeMode(page,native,mode,'keep');await page.evaluate(kind=>window.__nativeBackendTest.runtime.playSource(`if(await useSoundChip('${kind}')!==opl)throw Error('Primary OPL borrowing changed');await createSoundChip('${kind}',{id:'extra-opl'});`),kind);await until(()=>native[maps[kind]].size===1,'Additional OPL beside primary '+mode);await page.click('#consoleTab');await page.click('#'+kind+'Tab');await page.waitForFunction(kind=>document.querySelector(`#${kind}Panel [data-chip-control="instance"]`)?.options.length===2,kind);await stop();await page.locator('#'+kind+'Tab').waitFor({state:'visible'});}
  await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());await fs.writeFile(path.join(artifacts,name+'-extra-opl.json'),JSON.stringify({mockedNative:true,deviceOpened:false,phases,calls:native.calls},null,2));
}
module.exports={installExtraOplMock,runExtraOpl};
