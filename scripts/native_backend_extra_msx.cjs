// Real Main/Worker and chip UI. Native IPC is mocked; no audio device is opened.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {extraChipCount}=require('./native_backend_extra_limits.cjs');
function installExtraMsxMock(native){
  const invoke=native.invoke.bind(native);native.extraYm2413=new Map();native.extraAy8910=new Map();
  const names={ym2413:'extraYm2413',ay8910:'extraAy8910'};
  const fresh=kind=>({clock:kind==='ym2413'?3579545:1789773,registers:Array(kind==='ym2413'?64:16).fill(0),levels:[9,9,9],gates:[false,false,false],status:0,irq:false,layoutRevision:0,layoutPending:false,held:new Map(),groups:Array(kind==='ym2413'?14:3).fill(null),mix:{volume:1,pan:0}});
  const snapshot=(kind,s)=>({sampleRate:48000,frame:native.status().frame,revision:native.calls.length,[kind]:{...s,registers:s.registers.slice(),levels:s.levels.slice(),gates:s.gates.slice(),held:[...s.held.keys()],pendingCommands:[]}});
  function off(kind,s,ch){if(kind==='ay8910'){s.registers[8+ch]=0;s.gates[ch]=false;}else if(ch<9)s.registers[0x20+ch]&=239;else s.registers[14]&=~(16>>(ch-9));}
  function apply(kind,s,m){
    if(m.method==='batch'){
      assert(Number.isInteger(m.channel)&&m.channel>=0&&m.channel<s.groups.length);if(m.action==='off'&&s.held.get(m.channel)!==m.voice)return;
      if(m.action==='on')s.held.set(m.channel,m.voice);m.commands.forEach(c=>apply(kind,s,{...c,group:m.group}));if(m.action==='off')s.held.delete(m.channel);
    }else if(m.method==='write'){
      const r=m.register,v=m.value;assert(Number.isInteger(r)&&r>=0&&r<s.registers.length&&Number.isInteger(v)&&v>=0&&v<=255);if(kind==='ym2413'&&r===14&&((s.registers[r]^v)&32))s.layoutRevision++;s.registers[r]=v;
      if(kind==='ay8910'&&r>=8&&r<=10){const ch=r-8;s.gates[ch]=!!(v&31);if(v&31)s.levels[ch]=v&31;s.groups[ch]=v&31?m.group??null:null;}
      if(kind==='ym2413'&&r>=0x20&&r<=0x28)s.groups[r-0x20]=v&16?m.group??null:null;
      if(kind==='ym2413'&&r===14)for(let i=0;i<5;i++)s.groups[9+i]=v&(16>>i)?m.group??null:null;
    }else if(m.method==='set-retained-level')s.levels[m.channel]=m.level;
    else if(m.method==='clock'){if(s.held.size)throw Error(`Release the manually held additional ${kind==='ym2413'?'YM2413':'AY8910'} voices before changing the clock`);s.clock=m.hz;}
    else if(m.method==='reset'){if(!s.held.size){const {clock,layoutRevision}=s;const nextRevision=layoutRevision+(kind==='ym2413'&&!!(s.registers[14]&32)?1:0);Object.assign(s,fresh(kind),{clock,layoutRevision:nextRevision});}}
    else if(m.method==='stop-voices'||m.method==='all-notes-off'){for(let ch=0;ch<s.groups.length;ch++)off(kind,s,ch);s.held.clear();s.groups.fill(null);}
    else if(m.method==='key-off')off(kind,s,m.channel);
    else if(m.method==='audition-key-on'){if(kind==='ay8910'){s.registers[8+m.channel]=s.levels[m.channel];s.gates[m.channel]=!!s.levels[m.channel];}else if(m.channel<9)s.registers[0x20+m.channel]|=16;else s.registers[14]|=16>>(m.channel-9);}
    else if(m.method==='cancel-main-owner'){for(let ch=0;ch<s.groups.length;ch++)if(s.groups[ch]===m.targetGroup&&!s.held.has(ch)){off(kind,s,ch);s.groups[ch]=null;}}
    else if(m.method==='mix')s.mix={volume:m.volume,pan:m.pan};
    else assert.equal(m.method,'barrier','Unknown additional '+kind+' command '+m.method);
  }
  native.invoke=async(command,args={})=>{
    const match=/^native_genesis_extra_(ym2413|ay8910)_(create|dispose|status)$/.exec(command);
    if(match){
      native.calls.push({command,args});assert.equal(args.session,native.current?.session);assert(Number.isSafeInteger(args.instance)&&args.instance>0);
      const [,kind,method]=match,map=native[names[kind]];
      if(method==='create'){assert(extraChipCount(native)<16);assert(!map.has(args.instance));const s=fresh(kind);map.set(args.instance,s);return snapshot(kind,s);}
      if(method==='dispose'){map.delete(args.instance);return null;}const s=map.get(args.instance);assert(s);return snapshot(kind,s);
    }
    if(command==='native_genesis_commands')for(const c of args.commands){const kind=c.type==='extra-ym2413'?'ym2413':c.type==='extra-ay8910'?'ay8910':null;if(kind){const s=native[names[kind]].get(c.instance);assert(s);apply(kind,s,c.message);}}
    const result=await invoke(command,args);if(['native_genesis_start','native_genesis_stop','native_genesis_shutdown'].includes(command)){native.extraYm2413.clear();native.extraAy8910.clear();}return result;
  };
}
const program=`
  const a=await createSoundChip('ym2413',{id:'opll-a'}),b=await createSoundChip('ym2413',{id:'opll-b'});
  const x=await createSoundChip('ay8910',{id:'ay-a'}),y=await createSoundChip('ay8910',{id:'ay-b'});
  a.setVoice(0,{instrument:0,attenuation:4});a.setUserPatch({feedback:3,operators:[{multi:2,tl:19,ar:15,dr:3,sl:4,rr:7},{multi:1,ar:15,dr:2,sl:3,rr:6}]});a.noteOn(0,'C4');await a.setClock(4000000);
  b.setVoice(8,{instrument:5,attenuation:7});b.noteOn(8,'G3');
  x.tone(0,{note:'C4',volume:8});x.setEnvelope({period:769,shape:14});x.noise(1,{period:19,volume:6,envelope:true});await x.setClock(2000000);
  y.setVoice(2,{tone:true,noise:true,volume:0,envelope:false,note:'G3'});y.keyOff(2);
  for(const [kind,id]of [['ym2151','opm'],['ym2610','opnb'],['ym2608','opna'],['ym2203','mono'],['ym2612','dac'],['segapsg','tone']])await createSoundChip(kind,{id});
  await mixer.set(a.id,{volume:.4,pan:-.3});await mixer.set(y.id,{volume:.7,pan:.2});
  liveLoop('opll-live',async()=>{a.setSustain(1,true);await beat(.25);});
  liveLoop('ay-live',async()=>{x.setTonePeriod(0,333);await beat(.25);});
`;
async function runExtraMsx({page,native,artifacts,name,until,assertNoLiveAudio,changeMode}){
  const all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]),phases=[];
  const stop=async()=>{await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());await until(()=>extraChipCount(native)===0,'All eight additional kinds retire');};
  const inspect=()=>page.evaluate(async()=>{const r=window.__nativeBackendTest.runtime;return {opll:await r.chipInspector.read('opll-a'),ay:await r.chipInspector.read('ay-a'),zero:await r.chipInspector.read('ay-b'),mixer:r.megaDrive.mixer.list().filter(c=>c.connected),audio:window.__audioConstructions};});
  const edit=async(kind,control,value)=>{const field=page.locator(`#${kind}Panel [data-chip-control="${control}"]`);await field.fill(String(value));await field.dispatchEvent('change');};
  async function keyboard(kind,channel,tab=kind+'Tab'){const before=all().length;await page.locator('#'+tab).focus();await page.keyboard.down('z');try{await until(()=>all().slice(before).some(c=>c.type==='extra-'+kind&&c.message.action==='on'&&c.message.channel===channel),'Keyboard '+kind+' voice'+channel);}finally{await page.keyboard.up('z');}await until(()=>all().slice(before).some(c=>c.type==='extra-'+kind&&c.message.action==='off'&&c.message.channel===channel),'Keyboard release '+kind);}
  for(const execution of ['main','worker']){
    const before=all().length;await page.evaluate(({program,execution})=>window.__nativeBackendTest.runtime.playSource(program,{execution}),{program,execution});await until(()=>native.extraYm2413.size===2&&native.extraAy8910.size===2&&all().slice(before).some(c=>c.type==='extra-ay8910'&&c.message.method==='mix'&&c.message.volume===.7),'Both standalone types initialize');
    const s=await inspect(),opll=[...native.extraYm2413.values()],ay=[...native.extraAy8910.values()];assert.deepEqual(s.audio,{contexts:0,offline:0,worklets:[]});assert.equal(s.opll.kind,'ym2413');assert.equal(s.opll.clock,4000000);assert.equal(s.opll.channels.length,9);assert.equal(s.ay.kind,'ay8910');assert.equal(s.ay.clock,2000000);assert.equal(s.ay.channels.length,3);assert.equal(s.zero.channels[2].configuredVolume,0);assert.equal(s.mixer.length,12);assert.equal(extraChipCount(native),10);assert.equal(opll[0].registers[2]&63,19);assert.equal(ay[0].registers[13],14);
    if(execution==='worker')for(const kind of ['ym2413','ay8910'])await until(()=>all().slice(before).some(c=>c.type==='extra-'+kind&&c.frame>0&&c.performance&&c.owner),'Worker scheduled '+kind);
    const opening=all().length;await page.click('#consoleTab');await page.locator('#ym2413Tab').waitFor({state:'visible'});await page.click('#ym2413Tab');await page.selectOption('#ym2413Panel [data-chip-control="instance"]','opll-a');await page.locator('#ym2413Panel [data-chip-control="opll-user-feedback"]').waitFor();assert(!all().slice(opening).some(c=>c.type==='extra-ym2413'&&c.message.audition),'Opening OPLL is observational');
    await edit('ym2413','opll-user-op-0-tl',23);await until(()=>(opll[0].registers[2]&63)===23,'Shared User patch edit');assert.notEqual(opll[1].registers[2]&63,23);await keyboard('ym2413',0);
    await page.locator('#ym2413Panel [data-chip-control="opll-rhythm"]').check();await until(()=>!!(opll[0].registers[14]&32),'OPLL rhythm enable');await page.locator('#ym2413Panel [data-chip-rhythm="4"]').click();await edit('ym2413','opll-rhythm-hiHat-attenuation',5);await until(()=>opll[0].registers[0x37]>>4===5,'Hi-hat volume high nibble');await keyboard('ym2413',13);await page.screenshot({path:path.join(artifacts,`${name}-extra-opll-${execution}.png`)});
    await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:opll-a');await page.waitForFunction(()=>document.querySelector('#playgroundKeyboardTargetChannel')?.options.length===11);await page.selectOption('#playgroundKeyboardTargetChannel','rhythm:1');await keyboard('ym2413',10,'keyboardTab');
    await page.click('#consoleTab');await page.click('#ym2413Tab');await page.locator('#ym2413Panel [data-chip-control="opll-rhythm"]').uncheck();await until(()=>!(opll[0].registers[14]&32),'OPLL back to melodic');await page.click('#keyboardTab');await page.waitForFunction(()=>document.querySelector('#playgroundKeyboardTargetChannel')?.options.length===9);
    await page.click('#consoleTab');await page.click('#ay8910Tab');await page.selectOption('#ay8910Panel [data-chip-control="instance"]','ay-a');await edit('ay8910','ay-volume',11);await until(()=>ay[0].levels[0]===11,'AY retained volume edit');await edit('ay8910','ay-envelope-shape',10);await until(()=>ay[0].registers[13]===10,'AY shared envelope edit');assert.equal(ay[1].registers[13],0);await keyboard('ay8910',0);
    await page.selectOption('#ay8910Panel [data-chip-control="instance"]','ay-b');await page.locator('#ay8910Panel [data-chip-channel="2"]').click();await page.waitForFunction(()=>document.querySelector('#ay8910Panel [data-chip-control="ay-volume"]')?.value==='0');await keyboard('ay8910',2);assert.equal(ay[1].levels[2],0);
    phases.push({execution,...await inspect()});await page.screenshot({path:path.join(artifacts,`${name}-extra-msx-${execution}.png`)});await stop();for(const kind of ['ym2413','ay8910'])await page.locator('#'+kind+'Tab').waitFor({state:'hidden'});
  }
  for(const execution of ['main','worker']){
    const before=native.calls.length;await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`for(const kind of ['ym2413','ay8910']){const old=await createSoundChip(kind,{id:kind});old.dispose();const next=await createSoundChip(kind,{id:kind});await next.setClock(3900000);}`,{execution}),execution);await until(()=>native.extraYm2413.size===1&&native.extraAy8910.size===1&&[...native.extraAy8910.values()][0].clock===3900000,'Replaced both fixed IDs');for(const kind of ['ym2413','ay8910']){const ids=native.calls.slice(before).filter(c=>c.command===`native_genesis_extra_${kind}_create`).map(c=>c.args.instance);assert.equal(ids.length,2);assert(ids[1]>ids[0]);}await stop();
  }
  for(const mode of ['master-system','msx','msx-audio']){
    await changeMode(page,native,mode,'keep');await page.evaluate(mode=>window.__nativeBackendTest.runtime.playSource(`if(await useSoundChip('ym2413')!==opll)throw Error('Primary OPLL borrowing changed');${mode==='master-system'?'':`if(await useSoundChip('ay8910')!==ay)throw Error('Primary AY borrowing changed');`}await createSoundChip('ym2413',{id:'extra-opll'});await createSoundChip('ay8910',{id:'extra-ay'});`),mode);await until(()=>native.extraYm2413.size===1&&native.extraAy8910.size===1,'Additional OPLL/AY beside '+mode);await page.click('#consoleTab');await page.click('#ym2413Tab');await page.waitForFunction(()=>document.querySelector('#ym2413Panel [data-chip-control="instance"]')?.options.length===2);await stop();await page.locator('#ym2413Tab').waitFor({state:'visible'});await page.locator('#ay8910Tab').waitFor({state:mode==='master-system'?'hidden':'visible'});
  }
  await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());await fs.writeFile(path.join(artifacts,name+'-extra-msx.json'),JSON.stringify({mockedNative:true,deviceOpened:false,phases,calls:native.calls},null,2));
}
module.exports={installExtraMsxMock,runExtraMsx};
