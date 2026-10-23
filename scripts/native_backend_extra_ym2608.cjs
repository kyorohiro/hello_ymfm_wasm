const {extraChipCount}=require('./native_backend_extra_limits.cjs');
// Real Main/Worker, Mixer, Inspector, Keyboard and exports; only Native IPC is mocked.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
function installExtraYm2608Mock(native){
  const invoke=native.invoke.bind(native);native.extraYm2608=new Map();
  const fresh=()=>({clock:8000000,registers:[Array(256).fill(0),Array(256).fill(0)],keyMasks:Array(6).fill(0),
    ssgLevels:[0,0,0],ssgGates:[false,false,false],held:new Map(),groups:Array(16).fill(null),prescaler:6,status:0,statusHi:0,irq:false,
    rom:new Uint8Array(8192),memory:new Uint8Array(0x200000),romLoaded:false,adpcmMemoryBytes:0,mix:{volume:1,pan:0},frequencyLatch:[0,0]});
  function cancel(s){if(s.timeline)s.timeline={...s.timeline,pending:false,playing:false,ended:false,cancelled:true};}
  function reset(s){const keep={clock:s.clock,rom:s.rom,memory:s.memory,romLoaded:s.romLoaded,adpcmMemoryBytes:s.adpcmMemoryBytes,prepared:s.prepared,timeline:s.timeline};cancel(s);keep.timeline=s.timeline;Object.assign(s,fresh(),keep);}
  function update(s){if(!s.timeline?.playing)return;const now=native.status().frame-s.timeline.start;
    while(s.timeline.index<s.prepared.events.length){const e=s.prepared.events[s.timeline.index];if(Math.ceil(e[0]*48000/44100)>now)break;s.timeline.index++;
      if(e[1]===2)apply(s,{method:'memory',data:s.prepared.blocks[e[2]],offset:e[3]});else apply(s,{method:'write',port:e[1],register:e[2],value:e[3],group:s.timeline.group});}
    if(now>=Math.ceil(s.prepared.durationSamples*48000/44100))Object.assign(s.timeline,{playing:false,ended:true});
  }
  function snapshot(s){update(s);return {sampleRate:48000,frame:native.status().frame,revision:native.calls.length,ym2608:{clock:s.clock,
    registers:s.registers.map(r=>r.slice()),keyMasks:s.keyMasks.slice(),ssgLevels:s.ssgLevels.slice(),ssgGates:s.ssgGates.slice(),prescaler:s.prescaler,
    status:s.status,statusHi:s.statusHi,irq:s.irq,romLoaded:s.romLoaded,adpcmMemoryBytes:s.adpcmMemoryBytes,held:[...s.held.keys()],pendingCommands:[],
    timeline:{prepared:!!s.prepared,durationSamples:s.prepared?.durationSamples??0,...s.timeline}}};}
  function apply(s,m,entry={}){const r=s.registers[0];
    if(m.method==='batch'){
      assert(Number.isInteger(m.channel)&&m.channel>=0&&m.channel<16);if(m.action==='off'&&s.held.get(m.channel)!==m.voice)return;
      if(m.action==='on')s.held.set(m.channel,m.voice);m.commands.forEach(op=>apply(s,{...op,group:m.group}));if(m.action==='off')s.held.delete(m.channel);return;
    }
    if(m.method==='write'){
      assert([0,1].includes(m.port));const reg=m.register,value=m.value;assert(Number.isInteger(reg)&&reg>=0&&reg<=255&&Number.isInteger(value)&&value>=0&&value<=255);
      const row=s.registers[m.port];if((reg&0xf0)===0xa0&&(reg&3)!==3){const latch=reg>>3&1;if(reg&4)s.frequencyLatch[latch]=value&63;else{row[reg]=value;row[reg|4]=s.frequencyLatch[latch];}}else row[reg]=value;
      if(m.port===0){if(reg===0x28&&(value&3)<3){const ch=(value&3)+(value&4?3:0);s.keyMasks[ch]=value>>4;s.groups[ch]=m.group??null;}
        if(reg>=8&&reg<=10){s.ssgGates[reg-8]=!!(value&31);if(value&31)s.ssgLevels[reg-8]=value&31;s.groups[reg-8+6]=m.group??null;}
        if(reg===0x27)s.csmGroup=m.group??null;if(reg===0x2d)s.prescaler=6;else if(reg===0x2e&&s.prescaler===6)s.prescaler=3;else if(reg===0x2f)s.prescaler=2;
      }
    }else if(m.method==='set-retained-level')s.ssgLevels[m.channel]=m.level;
    else if(m.method==='clock'){if(s.held.size)throw Error('Release the manually held additional YM2608 voices before changing the clock');s.clock=m.hz;}
    else if(m.method==='key-off'){if(m.channel<6)s.keyMasks[m.channel]=0;else if(m.channel<9){r[8+m.channel-6]=0;s.ssgGates[m.channel-6]=false;}else if(m.channel===15)s.registers[1][0]=1;}
    else if(m.method==='cancel-csm')r[0x27]&=~0x81;
    else if(m.method==='stop-voices'){cancel(s);s.keyMasks.fill(0);s.ssgGates.fill(false);r[8]=r[9]=r[10]=0;s.held.clear();}
    else if(m.method==='reset')reset(s);
    else if(m.method==='mix')s.mix={volume:m.volume,pan:m.pan};
    else if(m.method==='rom'){assert.equal(m.data.length,8192);s.rom.set(m.data);s.romLoaded=true;}
    else if(m.method==='memory'){assert(m.offset>=0&&m.offset+m.data.length<=0x200000);s.memory.set(m.data,m.offset);s.adpcmMemoryBytes=Math.max(s.adpcmMemoryBytes,m.offset+m.data.length);}
    else if(m.method==='prepare-timeline'){if(s.timeline?.playing)throw Error('YM2608 timeline already playing or pending');s.prepared={events:m.events,blocks:m.blocks,durationSamples:m.durationSamples};}
    else if(m.method==='play-timeline'){assert(s.prepared);reset(s);s.timeline={token:m.token,group:m.group,owner:entry.owner,performance:entry.performance,start:native.status().frame,index:0,pending:false,playing:true,ended:false,cancelled:false};}
    else if(m.method==='cancel-main-owner'){for(let ch=0;ch<16;ch++)if(s.groups[ch]===m.targetGroup&&!s.held.has(ch)){apply(s,{method:'key-off',channel:ch});s.groups[ch]=null;}if(s.timeline?.group===m.targetGroup)cancel(s);}
    else if(m.method==='cancel-timeline'){if(s.timeline?.token===m.token)cancel(s);}
    else assert.equal(m.method,'barrier','Unknown additional YM2608 command '+m.method);
  }
  native.invoke=async(command,args={})=>{
    if(command.startsWith('native_genesis_extra_ym2608_')){
      native.calls.push({command,args});assert.equal(args.session,native.current?.session);assert(Number.isSafeInteger(args.instance)&&args.instance>0);
      if(command.endsWith('_create')){assert(extraChipCount(native)<16);assert(!native.extraYm2608.has(args.instance));const s=fresh();native.extraYm2608.set(args.instance,s);return snapshot(s);}
      if(command.endsWith('_dispose')){native.extraYm2608.delete(args.instance);return null;}assert(command.endsWith('_status'));const s=native.extraYm2608.get(args.instance);assert(s);return snapshot(s);
    }
    if(command==='native_genesis_commands')for(const c of args.commands.filter(c=>c.type==='extra-ym2608')){const s=native.extraYm2608.get(c.instance);assert(s);update(s);apply(s,c.message,c);}
    if(command==='native_genesis_performance')for(const s of native.extraYm2608.values())if(s.timeline?.performance===args.performance&&(args.op==='cancel'||args.op==='cancel-owner'&&s.timeline.owner===args.owner))cancel(s);
    const result=await invoke(command,args);if(['native_genesis_start','native_genesis_stop','native_genesis_shutdown'].includes(command))native.extraYm2608.clear();return result;
  };
}
const program=`
  if(await useSoundChip('ym2612')!==fm||await useSoundChip('segapsg')!==psg)throw Error('Primary borrowing changed');
  const a=await createSoundChip('ym2608',{id:'opna-a'}),b=await createSoundChip('ym2608',{id:'opna-b'});
  const o=await createSoundChip('ym2203',{id:'mono'}),f=await createSoundChip('ym2612',{id:'dac'}),p=await createSoundChip('segapsg',{id:'tone'});
  a.setPreset(0,FM_PRESETS['one-op-basic']);a.noteOn(0,'C4');a.ssg.tone(0,{period:173,volume:7});a.ssg.setEnvelope({period:769,shape:14});
  a.rhythm.setVolume(19);a.rhythm.setVoice(5,{volume:11,left:true,right:false});a.rhythm.keyOn(5);
  await a.adpcm.loadMemory(Uint8Array.from({length:64},(_,i)=>i+1),32);a.adpcm.setSample({start:32,end:96});a.adpcm.setDeltaN(12345);a.adpcm.setVolume(170);a.adpcm.setPan(true,false);a.adpcm.keyOn({repeat:true});await a.setClock(8200000);
  b.setPreset(5,FM_PRESETS['one-op-basic']);b.noteOn(5,'G3');b.ssg.noise(2,{period:19,volume:5});await b.rhythm.loadRom(new Uint8Array(8192).fill(42));await b.adpcm.loadMemory(new Uint8Array(32).fill(211));b.adpcm.setSample({start:0,end:32});
  o.ssg.tone(1,{period:251,volume:5});f.setDacEnabled(true);f.writeDac(181);p.tone(0,{period:319,attenuation:7});
  await mixer.set(a.id,{volume:.4,pan:-.3});await mixer.set(b.id,{volume:.7,pan:.2});
  liveLoop('extra-opna',async()=>{a.setAlgo(1,7,0);await beat(.25);});
`;
async function runExtraYm2608({page,native,artifacts,name,until,assertNoLiveAudio,changeMode}){
  const all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]),phases=[];
  const [{unzipSync},{parseTfi},{parseVgi}]=await Promise.all([import('../docs/playground/vendor/fflate.js'),import('../web/tfi.js'),import('../web/vgi.js')]);
  const inspect=()=>page.evaluate(async()=>{const r=window.__nativeBackendTest.runtime;return {a:await r.chipInspector.read('opna-a'),b:await r.chipInspector.read('opna-b'),mixer:r.megaDrive.mixer.list().filter(c=>c.connected),audio:window.__audioConstructions};});
  const stop=async()=>{await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());await until(()=>!native.extraYm2608.size&&!native.extraYm2203.size&&!native.extraYm2612.size&&!native.extraPsg.size,'All four additional kinds retire');};
  async function keyboard(channel){const start=all().length;await page.locator('#operatorTabButton').focus();await page.keyboard.down('z');try{await until(()=>all().slice(start).some(c=>c.type==='extra-ym2608'&&c.message.action==='on'&&c.message.channel===channel),'Keyboard channel '+channel);}finally{await page.keyboard.up('z');}await until(()=>all().slice(start).some(c=>c.type==='extra-ym2608'&&c.message.action==='off'&&c.message.channel===channel),'Keyboard channel release '+channel);}
  for(const execution of ['main','worker']){
    const start=all().length;await page.evaluate(({program,execution})=>window.__nativeBackendTest.runtime.playSource(program,{execution}),{program,execution});
    await until(()=>native.extraYm2608.size===2&&[...native.extraYm2608.values()].some(s=>s.rom[0]===42)&&all().slice(start).some(c=>c.type==='extra-ym2608'&&c.message.method==='mix'&&c.message.volume===.7),'Complete independent OPNA initialization');
    const s=await inspect();assert.deepEqual(s.audio,{contexts:0,offline:0,worklets:[]});assert.equal(s.a.kind,'ym2608');assert.equal(s.a.clock,8200000);assert.equal(s.b.clock,8000000);assert.equal(s.a.keyMasks.length,6);assert.equal(s.a.keyboardChannels.length,16);assert.equal(s.a.romLoaded,true);assert.equal(s.a.adpcmMemoryBytes,96);assert.equal(s.b.adpcmMemoryBytes,32);
    assert.deepEqual(s.mixer.map(c=>c.id).sort(),['dac','mono','opna-a','opna-b','segapsg','tone','ym2612']);const chips=[...native.extraYm2608.values()];assert.equal(chips[0].memory[32],1);assert.equal(chips[1].memory[32],0);assert.equal(chips[1].memory[0],211);assert.equal(chips[1].rom[0],42);assert.notEqual(chips[0].rom[0],42);
    if(execution==='worker')await until(()=>all().slice(start).some(c=>c.type==='extra-ym2608'&&c.frame>0&&c.owner&&c.performance),'Worker timed owner');
    const edit=all().length;await page.click('#consoleTab');await page.click('#operatorTabButton');await page.selectOption('[data-opn-instance]','opna-a');await page.waitForFunction(()=>document.querySelector('#extraFm-operatorTabChannelSelect')?.options.length===6);await page.locator('[data-extra-opna-editor]').waitFor();assert(!all().slice(edit).some(c=>c.type==='extra-ym2608'&&c.message.audition),'Opening UI only observes');
    await page.locator('[data-extra-fm-editor] button[aria-label="TL"]').first().locator('..').locator('button.param-button').first().click();await until(()=>chips[0].registers[0][0x40]===126,'FM6 operator edit');
    for(const format of ['tfi','vgi']){await page.evaluate(()=>{document.getElementById('mainMenu').open=true;document.getElementById('menuExport').open=true;});const downloaded=page.waitForEvent('download');await page.click(format==='tfi'?'#exportTfiButton':'#exportVgiButton');const file=path.join(artifacts,`${name}-extra-ym2608-${execution}.${format}.zip`);await(await downloaded).saveAs(file);const files=unzipSync(new Uint8Array(await fs.readFile(file)));assert.equal(Object.keys(files).length,6);assert.equal((format==='tfi'?parseTfi:parseVgi)(files[`ch1.${format}`]).operators[1].tl,126);await page.evaluate(()=>{document.getElementById('mainMenu').open=false;});}
    const ssg=page.locator('[data-ssg-control="volume"]');await ssg.fill('11');await ssg.dispatchEvent('change');await until(()=>chips[0].ssgLevels[0]===11,'SSG edit');await keyboard(6);
    const sample=page.locator('[data-extra-opna-editor]');await sample.locator('[data-opna-control="rhythm-voice"]').selectOption('5');await sample.locator('[data-opna-control="rhythm-level"]').fill('13');await sample.locator('[data-opna-control="rhythm-level"]').dispatchEvent('change');await until(()=>(chips[0].registers[0][0x1d]&31)===13,'Rhythm voice edit');await keyboard(14);
    await sample.locator('[data-opna-control="adpcm-delta"]').fill('23456');await sample.locator('[data-opna-control="adpcm-delta"]').dispatchEvent('change');await until(()=>chips[0].registers[1][9]===(23456&255)&&chips[0].registers[1][10]===(23456>>8),'ADPCM speed edit');await keyboard(15);
    await sample.screenshot({path:path.join(artifacts,`${name}-extra-ym2608-samples-${execution}.png`)});
    await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:opna-b');await page.selectOption('#playgroundKeyboardTargetChannel','fm:5');const keyStart=all().length;await page.locator('#keyboardTab').focus();await page.keyboard.down('z');await until(()=>all().slice(keyStart).some(c=>c.type==='extra-ym2608'&&c.message.action==='on'&&c.message.channel===5),'Selected second instance FM6');await page.keyboard.up('z');
    assert.equal(chips[1].registers[0][6],19);assert.equal(chips[1].memory[0],211);assert.equal(chips[1].rom[0],42);phases.push({execution,...await inspect()});await page.screenshot({path:path.join(artifacts,`${name}-extra-ym2608-${execution}.png`)});await stop();
  }
  for(const execution of ['main','worker']){
    const before=native.calls.length;await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`const old=await createSoundChip('ym2608',{id:'same'});await old.adpcm.loadMemory(new Uint8Array(32).fill(9));old.dispose();const next=await createSoundChip('ym2608',{id:'same'});await next.adpcm.loadMemory(new Uint8Array(32).fill(27),32);await next.setClock(8100000);`,{execution}),execution);await until(()=>native.extraYm2608.size===1&&[...native.extraYm2608.values()][0].clock===8100000,'Same ID replacement');const ids=native.calls.slice(before).filter(c=>c.command==='native_genesis_extra_ym2608_create').map(c=>c.args.instance);assert.equal(ids.length,2);assert(ids[1]>ids[0]);const next=[...native.extraYm2608.values()][0];assert.equal(next.memory[0],0);assert.equal(next.memory[32],27);await stop();
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`const c=await createSoundChip('ym2608',{id:'timeline'});await c.prepareTimeline([[0,2,0,32],[0,0,8,11],[441,0,8,0]],[new Uint8Array(32).fill(71)],441);await c.playTimeline();await c.playTimeline();c.ssg.setVolume(2,9);`,{execution}),execution);await until(()=>[...native.extraYm2608.values()].some(s=>s.registers[0][10]===9),'Reusable timeline completion');assert.equal([...native.extraYm2608.values()][0].memory[32],71);await stop();
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`const c=await createSoundChip('ym2608',{id:'timeline'});await c.prepareTimeline([[4410,0,8,12]],[],8820);const playing=c.playTimeline().then(()=>false,()=>true);c.resetRegisters();if(!await playing)throw Error('Reset did not cancel');c.ssg.setVolume(1,6);`,{execution}),execution);await until(()=>[...native.extraYm2608.values()].some(s=>s.registers[0][9]===6),'Reset releases pending completion');await stop();
    const long=all().length;await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`const c=await createSoundChip('ym2608',{id:'timeline'});await c.prepareTimeline([[0,0,8,9]],[],44100*3600);liveLoop('long-timeline',async()=>{try{await c.playTimeline();}catch{}});keyboard.bind('replace-long',{async noteOn(){stopLoop('long-timeline');await c.prepareTimeline([[0,0,8,3],[441,0,8,0]],[],441);await c.playTimeline();c.ssg.setVolume(2,7);},noteOff(){},allNotesOff(){}});`,{execution}),execution);await until(()=>all().slice(long).some(c=>c.type==='extra-ym2608'&&c.message.method==='play-timeline'),'Hour long timeline accepted');await page.waitForFunction(()=>Boolean(window.__nativeBackendTest.runtime.getKeyboardTarget()));await page.evaluate(()=>window.__nativeBackendTest.runtime.getKeyboardTarget().noteOn({id:'replace',midi:60}));await until(()=>[...native.extraYm2608.values()].some(s=>s.registers[0][10]===7),'Owner cancellation permits immediate new timeline');await stop();
  }
  await changeMode(page,native,'ym3812','keep');await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource(`const c=await createSoundChip('ym2608',{id:'ym2608'});await c.adpcm.loadMemory(new Uint8Array(32).fill(33));c.ssg.tone(0,{period:321,volume:8});`));await page.locator('#operatorTabButton').waitFor({state:'visible'});await page.click('#operatorTabButton');await page.waitForFunction(()=>document.querySelector('[data-opn-instance]')?.value==='ym2608');await page.locator('[data-extra-opna-editor]').waitFor();await stop();await page.locator('#operatorTabButton').waitFor({state:'hidden'});
  await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());await fs.writeFile(path.join(artifacts,name+'-extra-ym2608.json'),JSON.stringify({mockedNative:true,deviceOpened:false,phases,calls:native.calls},null,2));
}
module.exports={installExtraYm2608Mock,runExtraYm2608};
