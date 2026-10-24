// Actual Main/Worker/Inspector/UI/Keyboard, mocked Native IPC, no audio device.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {extraChipCount}=require('./native_backend_extra_limits.cjs');
const chips=['ym3526','ym3812','y8950','ymf262'],maps={ym3526:'extraYm3526',ym3812:'extraYm3812',y8950:'extraY8950',ymf262:'extraYmf262'};
const clock=chip=>chip==='ymf262'?14318180:3579545;
const channels=chip=>chip==='ymf262'?18:9;
const address=ch=>(ch>=9?256:0)+0xb0+ch%9;
function installExtraOplMock(native){
  const invoke=native.invoke.bind(native);for(const key of Object.values(maps))native[key]=new Map();
  const fresh=chip=>({chip,channels:channels(chip),clock:clock(chip),registers:Array(chip==='ymf262'?512:256).fill(0),effectiveRegisters:Array(chip==='ymf262'?512:256).fill(0),...(chip==='y8950'?{adpcmMemorySize:0}:{}),status:0,irq:false,layoutRevision:0,layoutPending:false,effectiveFourOpMask:0,newMode:false,held:new Map(),groups:Array(23).fill(null),mix:{volume:1,pan:0}});
  const snapshot=(kind,s)=>({sampleRate:48000,frame:native.status().frame,revision:native.calls.length,[kind]:{...s,registers:s.registers.slice(),effectiveRegisters:s.effectiveRegisters.slice(),held:[...s.held.keys()],pendingCommands:[]}});
  function off(s,ch){const r=ch<18?address(ch):0xbd,mask=ch<18?32:16>>(ch-18);s.registers[r]&=~mask;s.effectiveRegisters[r]&=~mask;}
  function apply(s,m){
    if(m.method==='batch'){
      assert(Number.isInteger(m.channel)&&(m.channel>=0&&m.channel<s.channels||m.channel>=18&&m.channel<=22));if(m.action==='off'&&s.held.get(m.channel)!==m.voice)return;
      if(m.action==='on')s.held.set(m.channel,m.voice);m.commands.forEach(c=>apply(s,{...c,group:m.group}));if(m.action==='off')s.held.delete(m.channel);
    }else if(m.method==='write'){
      const r=m.register,v=m.value;assert(Number.isInteger(r)&&r>=0&&r<s.registers.length&&Number.isInteger(v)&&v>=0&&v<=255);
      const actual=s.chip==='ymf262'&&!s.newMode&&r>=256&&r!==0x105?r&255:r;
      if(actual===0xbd&&((s.effectiveRegisters[actual]^v)&32))s.layoutRevision++;
      if(s.chip==='ymf262'&&actual===0x105&&s.newMode!==!!(v&1)){s.newMode=!!(v&1);s.layoutRevision++;}
      if(s.chip==='ymf262'&&actual===0x104&&s.effectiveFourOpMask!==(v&63)){s.effectiveFourOpMask=v&63;s.layoutRevision++;}
      s.registers[r]=v;s.effectiveRegisters[actual]=v;
      if((r&255)>=0xb0&&(r&255)<=0xb8)s.groups[(r>=256?9:0)+(r&255)-0xb0]=v&32?m.group??null:null;
      if(r===0xbd)for(let i=0;i<5;i++)s.groups[18+i]=v&(16>>i)?m.group??null:null;if(r===8)s.csmGroup=m.group??null;
    }else if(m.method==='adpcm-memory'){assert.equal(s.chip,'y8950');assert(Number.isSafeInteger(m.address)&&m.address>=0&&m.address<=0x200000);assert(Array.isArray(m.bytes)&&m.bytes.length<=0x200000-m.address&&m.bytes.every(v=>Number.isInteger(v)&&v>=0&&v<=255));s.adpcmMemorySize=Math.max(s.adpcmMemorySize,m.address+m.bytes.length);s.registers[7]=s.effectiveRegisters[7]=1;s.adpcmGroup=null;}
    else if(m.method==='adpcm-clear'){assert.equal(s.chip,'y8950');s.adpcmMemorySize=0;s.registers[7]=s.effectiveRegisters[7]=1;s.adpcmGroup=null;}
    else if(m.method==='clock'){if(s.held.size)throw Error(`Release the manually held additional ${s.chip.toUpperCase()} voices before changing the clock`);s.clock=m.hz;}
    else if(m.method==='reset'){if(!s.held.size){const {chip,clock,layoutRevision,adpcmMemorySize}=s;Object.assign(s,fresh(chip),{clock,...(chip==='y8950'?{adpcmMemorySize}:{}),layoutRevision:layoutRevision+!!((s.registers[0xbd]&32)||s.effectiveFourOpMask||s.newMode)});}}
    else if(m.method==='stop-voices'||m.method==='all-notes-off'){for(let ch=0;ch<s.channels;ch++)off(s,ch);s.registers[0xbd]&=224;s.held.clear();s.groups.fill(null);if(m.method==='stop-voices')s.registers[8]&=127;}
    else if(m.method==='key-off')off(s,m.channel);
    else if(m.method==='audition-key-on'){const r=m.channel<18?address(m.channel):0xbd,mask=m.channel<18?32:16>>(m.channel-18);s.registers[r]|=mask;s.effectiveRegisters[r]|=mask;}
    else if(m.method==='cancel-main-owner'){for(let ch=0;ch<s.groups.length;ch++)if(s.groups[ch]===m.targetGroup&&!s.held.has(ch)){off(s,ch);s.groups[ch]=null;}if(s.csmGroup===m.targetGroup)s.registers[8]&=127;}
    else if(m.method==='cancel-csm')s.registers[8]&=127;
    else if(m.method==='mix')s.mix={volume:m.volume,pan:m.pan};
    else assert.equal(m.method,'barrier','Unknown additional '+s.chip+' command '+m.method);
  }
  native.invoke=async(command,args={})=>{
    const match=/^native_genesis_extra_(ym3526|ym3812|y8950|ymf262)_(create|dispose|status)$/.exec(command);
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
  for(const kind of ['ym3526','ym3812','y8950','ymf262']){
    const a=await createSoundChip(kind,{id:kind+'-a'}),b=await createSoundChip(kind,{id:kind+'-b'});
    for(let ch=0;ch<a.channels;ch++){a.setPreset(ch,voice);b.setPreset(ch,voice);}a.noteOn(0,'C4');b.noteOn(b.channels-1,'G3');
    if(kind==='ymf262')a.setFourOp(9,true);
    await a.setClock(kind==='ymf262'?14000000:4000000);
    if(kind==='ymf262'){a.setOperator(9,3,{tl:17});a.setFourOp(9,false);}
    liveLoop('extra-'+kind,async()=>{a.setOperator(1,1,{tl:17});if(kind==='ymf262'&&a.isFourOp(9))a.setOperator(9,3,{ksl:1});await beat(.25);});
  }
  for(const kind of ['ym2413','ay8910','ym2151','ym2610','ym2608','ym2203','ym2612','segapsg'])await createSoundChip(kind,{id:'base-'+kind});
  await mixer.set('ym3526-a',{volume:.4,pan:-.3});await mixer.set('y8950-b',{volume:.7,pan:.2});
`;
async function runExtraOpl({page,native,artifacts,name,until,assertNoLiveAudio,changeMode}){
  const all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]),phases=[];
  const stop=async()=>{await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());await until(()=>extraChipCount(native)===0,'All twelve additional kinds retire');};
  async function keyboard(kind,channel,tab=kind+'Tab'){const before=all().length;await page.locator('#'+tab).focus();await page.keyboard.down('z');try{await until(()=>all().slice(before).some(c=>c.type==='extra-'+kind&&c.message.action==='on'&&c.message.channel===channel),'Keyboard '+kind+' voice'+channel);}finally{await page.keyboard.up('z');}await until(()=>all().slice(before).some(c=>c.type==='extra-'+kind&&c.message.action==='off'&&c.message.channel===channel),'Keyboard release '+kind);}
  async function inspect(){return page.evaluate(async()=>{const r=window.__nativeBackendTest.runtime,result={};for(const kind of ['ym3526','ym3812','y8950','ymf262'])result[kind]=await r.chipInspector.read(kind+'-a');return {snapshots:result,mixer:r.megaDrive.mixer.list().filter(c=>c.connected),audio:window.__audioConstructions};});}
  async function edit(kind,field,value){const node=page.locator(`#${kind}Panel [data-chip-control="opl-${field}"]`);await node.fill(String(value));await node.dispatchEvent('change');}
  for(const execution of ['main','worker']){
    const before=all().length;await page.evaluate(({program,execution})=>window.__nativeBackendTest.runtime.playSource(program,{execution}),{program,execution});await until(()=>extraChipCount(native)===16&&all().slice(before).some(c=>c.type==='extra-y8950'&&c.message.method==='mix'&&c.message.volume===.7),'Independent OPL initialization and twelve-kind rack');
    const first=await inspect();assert.deepEqual(first.audio,{contexts:0,offline:0,worklets:[]});assert.equal(first.mixer.length,18);
    for(const kind of chips){const s=first.snapshots[kind],states=[...native[maps[kind]].values()];assert.equal(s.kind,kind);assert.equal(s.clock,kind==='ymf262'?14000000:4000000);assert.equal(s.channels.length,channels(kind));assert.equal(s.keyboardChannels.length,channels(kind));assert.equal(states[1].clock,clock(kind));assert.equal(states[0].registers[1]&32,kind==='ym3812'?32:0);
      if(execution==='worker')await until(()=>all().slice(before).some(c=>c.type==='extra-'+kind&&c.frame>0&&c.performance&&c.owner),'Scheduled OPL owner '+kind);
      const opening=all().length;await page.click('#consoleTab');await page.locator('#'+kind+'Tab').waitFor({state:'visible'});await page.click('#'+kind+'Tab');await page.selectOption(`#${kind}Panel [data-chip-control="instance"]`,kind+'-a');await page.locator(`#${kind}Panel [data-chip-control="opl-op-1-tl"]`).waitFor();assert(!all().slice(opening).some(c=>c.type==='extra-'+kind&&c.message.audition),'Opening OPL must only observe');
      await edit(kind,'op-1-tl',9);await until(()=>(states[0].registers[0x43]&63)===9,'OPL carrier TL '+kind);assert.equal(states[1].registers[0x43]&63,12);const wave=page.locator(`#${kind}Panel [data-chip-control="opl-op-1-waveform"]`);if(kind==='ym3812'||kind==='ymf262'){await wave.fill(kind==='ymf262'?'7':'2');await wave.dispatchEvent('change');await until(()=>(states[0].registers[0xe3]&(kind==='ymf262'?7:3))===(kind==='ymf262'?7:2),'OPL2 waveform');}else assert(await wave.isDisabled());await keyboard(kind,0);
      await page.selectOption(`#${kind}Panel [data-chip-control="instance"]`,kind+'-b');await page.locator(`#${kind}Panel [data-chip-channel="${channels(kind)-1}"]`).click();await keyboard(kind,channels(kind)-1);
      await page.selectOption(`#${kind}Panel [data-chip-control="instance"]`,kind+'-a');await page.locator(`#${kind}Panel [data-chip-control="opl-rhythm"]`).check();await until(()=>!!(states[0].registers[0xbd]&32),'OPL rhythm enable '+kind);await page.locator(`#${kind}Panel [data-chip-control="opl-rhythm-hiHat"]`).check();await until(()=>!!(states[0].registers[0xbd]&1),'OPL hi-hat toggle '+kind);await page.screenshot({path:path.join(artifacts,`${name}-extra-${kind}-${execution}.png`)});
      await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:'+kind+'-a');await page.waitForFunction(count=>document.querySelector('#playgroundKeyboardTargetChannel')?.options.length===count,channels(kind)+2);await page.selectOption('#playgroundKeyboardTargetChannel','rhythm:4');await keyboard(kind,22,'keyboardTab');
      await page.click('#consoleTab');await page.click('#'+kind+'Tab');await page.locator(`#${kind}Panel [data-chip-control="opl-rhythm"]`).uncheck();await until(()=>!(states[0].registers[0xbd]&32),'OPL melodic restore '+kind);await page.click('#keyboardTab');await page.waitForFunction(count=>document.querySelector('#playgroundKeyboardTargetChannel')?.options.length===count,channels(kind));
    }
    // Exercise both banks and every pair through the actual editor/Keyboard.
    const opl3=[...native.extraYmf262.values()],root='#ymf262Panel';
    await page.click('#consoleTab');await page.click('#ymf262Tab');
    await page.selectOption(root+' [data-chip-control="instance"]','ymf262-a');
    await page.locator(root+' [data-chip-channel="9"]').click();
    await page.locator(root+' [data-chip-control="opl-four-op"]').check();
    await until(()=>opl3[0].effectiveFourOpMask===8,'Bank one OPL3 four-op pair');
    await page.selectOption(root+' [data-chip-control="opl-algorithm"]','3');
    await edit('ymf262','op-3-tl',11);
    await until(()=>(opl3[0].registers[0x14b]&63)===11&&(opl3[0].registers[0x1c0]&1)&&(opl3[0].registers[0x1c3]&1),'Four-op fourth operator and both algorithm bits');
    await until(()=>(opl3[0].registers[0x14b]&255)===75,'Inspector and ongoing script preserve each other\'s fourth-operator edits');
    assert.equal(opl3[1].effectiveFourOpMask,0,'Other instance keeps its two-op layout');
    await keyboard('ymf262',9);
    await page.evaluate(async()=>{const i=window.__nativeBackendTest.runtime.chipInspector;for(const ch of [0,1,2,9,10,11])await i.invoke('ymf262-a','setFourOp',[ch,true]);});
    await until(()=>opl3[0].effectiveFourOpMask===63,'All six independent four-op pairs');
    await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:ymf262-a');
    await page.waitForFunction(()=>document.querySelector('#playgroundKeyboardTargetChannel')?.options.length===12);
    assert.deepEqual(await page.locator('#playgroundKeyboardTargetChannel option').evaluateAll(nodes=>nodes.map(n=>n.value)),['0','1','2','6','7','8','9','10','11','15','16','17']);
    for(const ch of [0,1,2,9,10,11]){await page.selectOption('#playgroundKeyboardTargetChannel',String(ch));await keyboard('ymf262',ch,'keyboardTab');}
    await page.evaluate(async()=>window.__nativeBackendTest.runtime.chipInspector.invoke('ymf262-a','setRhythm',[{enabled:true}]));
    await page.waitForFunction(()=>document.querySelector('#playgroundKeyboardTargetChannel')?.options.length===14);
    await page.selectOption('#playgroundKeyboardTargetChannel','rhythm:4');await keyboard('ymf262',22,'keyboardTab');
    await page.evaluate(async()=>window.__nativeBackendTest.runtime.chipInspector.invoke('ymf262-a','setPan',[9,false,true]));
    await until(()=>(opl3[0].registers[0x1c0]&48)===32&&(opl3[0].registers[0x1c3]&48)===32,'Four-op stereo routing on both physical channels');
    assert.equal(opl3[1].registers[0x1c0]&48,48,'Other instance keeps its stereo routing');
    await page.screenshot({path:path.join(artifacts,`${name}-extra-ymf262-pairs-${execution}.png`)});
    const instance=[...native.extraYmf262.keys()][0];
    const raw=async(register,value)=>native.invoke('native_genesis_commands',{session:native.current.session,commands:[{type:'extra-ymf262',frame:native.status().frame,instance,message:{method:'write',register,value}}]});
    await raw(0x105,0);await raw(0x104,0);
    const compatible=await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('ymf262-a'));
    assert.equal(compatible.authoredRegisters[0x104],0);assert.equal(compatible.effectiveRegisters[0x104],63);assert.equal(compatible.newMode,false);
    await page.waitForFunction(()=>document.querySelector('#playgroundKeyboardTargetChannel')?.options.length===8);
    assert.equal(await page.locator('#playgroundKeyboardTargetChannel option[value="9"]').count(),0,'NEW0 upper-bank gestures must not address a lower channel');
    await raw(0x105,1);await raw(0x104,0);await raw(0xbd,0);
    await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('ymf262-a'));
    await page.waitForFunction(()=>document.querySelector('#playgroundKeyboardTargetChannel')?.options.length===18);
    phases.push({execution,...await inspect()});await stop();for(const kind of chips)await page.locator('#'+kind+'Tab').waitFor({state:'hidden'});
  }
  for(const execution of ['main','worker']){const before=native.calls.length;await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`for(const kind of ['ym3526','ym3812','y8950','ymf262']){const old=await createSoundChip(kind,{id:kind});old.dispose();const next=await createSoundChip(kind,{id:kind});await next.setClock(3900000);}`,{execution}),execution);await until(()=>chips.every(kind=>native[maps[kind]].size===1&&[...native[maps[kind]].values()][0].clock===3900000),'Replaced OPL fixed IDs');for(const kind of chips){const ids=native.calls.slice(before).filter(c=>c.command===`native_genesis_extra_${kind}_create`).map(c=>c.args.instance);assert.equal(ids.length,2);assert(ids[1]>ids[0]);}await stop();}
  for(const mode of ['ym3526','ym3812','msx-audio','ymf262']){const kind=mode==='msx-audio'?'y8950':mode;await changeMode(page,native,mode,'keep');await page.evaluate(kind=>window.__nativeBackendTest.runtime.playSource(`if(await useSoundChip('${kind}')!==opl)throw Error('Primary OPL borrowing changed');await createSoundChip('${kind}',{id:'extra-opl'});`),kind);await until(()=>native[maps[kind]].size===1,'Additional OPL beside primary '+mode);await page.click('#consoleTab');await page.click('#'+kind+'Tab');await page.waitForFunction(kind=>document.querySelector(`#${kind}Panel [data-chip-control="instance"]`)?.options.length===2,kind);await stop();await page.locator('#'+kind+'Tab').waitFor({state:'visible'});}
  await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());await fs.writeFile(path.join(artifacts,name+'-extra-opl.json'),JSON.stringify({mockedNative:true,deviceOpened:false,phases,calls:native.calls},null,2));
}
module.exports={installExtraOplMock,runExtraOpl};
