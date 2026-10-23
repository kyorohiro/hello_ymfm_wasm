// Real Main/Worker/Inspector/UI/Keyboard, with Native IPC mocked and no output device.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const PAGE=65536,FM=[1,2,4,5];
function installExtraYm2610Mock(native){
  const invoke=native.invoke.bind(native);native.extraYm2610=new Map();
  const fresh=()=>({variant:'ym2610',clock:8000000,registers:[Array(256).fill(0),Array(256).fill(0)],keyMasks:Array(6).fill(0),ssgLevels:[0,0,0],ssgGates:[false,false,false],held:new Map(),groups:Array(16).fill(null),status:0,statusHi:0,irq:false,rom:[new Map(),new Map()],romBytes:[0,0],mix:{volume:1,pan:0},frequencyLatch:[0,0]});
  const snapshot=s=>({sampleRate:48000,frame:native.status().frame,revision:native.calls.length,ym2610:{variant:s.variant,clock:s.clock,registers:s.registers.map(r=>r.slice()),keyMasks:s.keyMasks.slice(),ssgLevels:s.ssgLevels.slice(),ssgGates:s.ssgGates.slice(),status:s.status,statusHi:s.statusHi,irq:s.irq,held:[...s.held.keys()],pendingCommands:[],romBytes:[...s.romBytes],romAllocatedBytes:s.rom.map(pages=>pages.size*PAGE)}});
  function apply(s,m){const [r,p]=s.registers;
    if(m.method==='batch'){
      assert(FM.includes(m.channel)||m.channel>=6&&m.channel<=15);if(m.action==='off'&&s.held.get(m.channel)!==m.voice)return;
      if(m.action==='on')s.held.set(m.channel,m.voice);m.commands.forEach(op=>apply(s,{...op,group:m.group}));if(m.action==='off')s.held.delete(m.channel);return;
    }
    if(m.method==='write'){
      const reg=m.register,value=m.value;assert([0,1].includes(m.port));assert(Number.isInteger(reg)&&reg>=0&&reg<=255&&Number.isInteger(value)&&value>=0&&value<=255);
      const target=m.port===0&&reg===0x28?(value&3)+(value&4?3:0):m.port===0&&reg>=8&&reg<=10?6+reg-8:m.port===0&&reg===0x10?15:null;
      const on=m.port===0&&reg===0x28?!!(value&0xf0):reg===0x10?!!(value&128)&&!(value&65):!!(value&31);
      if(target!==null&&!on&&m.group!==undefined&&s.groups[target]!==null&&s.groups[target]!==m.group&&!s.held.has(target))return;
      const row=s.registers[m.port];if((reg&0xf0)===0xa0&&(reg&3)!==3){const latch=reg>>3&1;if(reg&4)s.frequencyLatch[latch]=value&63;else{row[reg]=value;row[reg|4]=s.frequencyLatch[latch];}}else row[reg]=value;
      if(target!==null)s.groups[target]=on?m.group??null:null;
      if(m.port===0){if(reg===0x28&&(value&3)<3)s.keyMasks[(value&3)+(value&4?3:0)]=value>>4;if(reg>=8&&reg<=10){s.ssgGates[reg-8]=!!(value&31);if(value&31)s.ssgLevels[reg-8]=value&31;}if(reg===0x27)s.csmGroup=m.group??null;}
      else if(reg===0)for(let ch=0;ch<6;ch++)if(value&(1<<ch))s.groups[ch+9]=value&128?null:m.group??null;
    }else if(m.method==='memory'){
      assert([0,1].includes(m.romType));assert(m.offset>=0&&m.offset+m.data.length<=0x1000000);
      if(native.rejectNextYm2610Memory){native.rejectNextYm2610Memory=false;throw Error('Additional Native sound-chip memory budget exceeded (67108864 bytes)');}
      for(let offset=0;offset<m.data.length;){const address=m.offset+offset,page=address>>>16,local=address&65535,count=Math.min(PAGE-local,m.data.length-offset),pages=s.rom[m.romType];if(!pages.has(page))pages.set(page,new Uint8Array(PAGE));pages.get(page).set(m.data.slice(offset,offset+count),local);offset+=count;}s.romBytes[m.romType]=Math.max(s.romBytes[m.romType],m.offset+m.data.length);
    }else if(m.method==='set-retained-level')s.ssgLevels[m.channel]=m.level;
    else if(m.method==='clock'){if(s.held.size)throw Error('Release the manually held additional YM2610 voices before changing the clock');s.clock=m.hz;}
    else if(m.method==='reset'){if(!s.held.size){const {clock,rom,romBytes}=s;Object.assign(s,fresh(),{clock,rom,romBytes});}}
    else if(m.method==='stop-voices'){s.keyMasks.fill(0);r[8]=r[9]=r[10]=0;r[0x10]=1;s.held.clear();s.groups.fill(null);}
    else if(m.method==='key-off'){if(m.channel<6)s.keyMasks[m.channel]=0;else if(m.channel<9){r[8+m.channel-6]=0;s.ssgGates[m.channel-6]=false;}else if(m.channel===15)r[0x10]=1;}
    else if(m.method==='cancel-csm')r[0x27]&=~0x81;
    else if(m.method==='cancel-main-owner'){for(let ch=0;ch<16;ch++)if(s.groups[ch]===m.targetGroup&&!s.held.has(ch)){apply(s,{method:'key-off',channel:ch});s.groups[ch]=null;}if(s.csmGroup===m.targetGroup)r[0x27]&=~0x81;}
    else if(m.method==='mix')s.mix={volume:m.volume,pan:m.pan};
    else assert.equal(m.method,'barrier','Unknown additional YM2610 command '+m.method);
  }
  native.invoke=async(command,args={})=>{
    if(command.startsWith('native_genesis_extra_ym2610_')){
      native.calls.push({command,args});assert.equal(args.session,native.current?.session);assert(Number.isSafeInteger(args.instance)&&args.instance>0);
      if(command.endsWith('_create')){assert(native.extraPsg.size+native.extraYm2612.size+native.extraYm2203.size+native.extraYm2608.size+native.extraYm2610.size+(native.extraYm2151?.size??0)<16);assert(!native.extraYm2610.has(args.instance));const s=fresh();native.extraYm2610.set(args.instance,s);return snapshot(s);}
      if(command.endsWith('_dispose')){native.extraYm2610.delete(args.instance);return null;}assert(command.endsWith('_status'));const s=native.extraYm2610.get(args.instance);assert(s);return snapshot(s);
    }
    if(command==='native_genesis_commands')for(const c of args.commands.filter(c=>c.type==='extra-ym2610')){const s=native.extraYm2610.get(c.instance);assert(s);apply(s,c.message);}
    const result=await invoke(command,args);if(['native_genesis_start','native_genesis_stop','native_genesis_shutdown'].includes(command))native.extraYm2610.clear();return result;
  };
}
const byte=(s,bank,address)=>s.rom[bank].get(address>>>16)?.[address&65535]??0;
const program=`
  if(await useSoundChip('ym2612')!==fm||await useSoundChip('segapsg')!==psg)throw Error('Primary borrowing changed');
  const a=await createSoundChip('ym2610',{id:'opnb-a'}),b=await createSoundChip('ym2610',{id:'opnb-b'});
  if(a.adpcm!==a.adpcmB)throw Error('adpcm must alias ADPCM-B');
  const n=await createSoundChip('ym2608',{id:'opna'}),o=await createSoundChip('ym2203',{id:'mono'}),f=await createSoundChip('ym2612',{id:'dac'}),p=await createSoundChip('segapsg',{id:'tone'});
  a.setPreset(0,FM_PRESETS['one-op-basic']);a.noteOn(0,'C4');a.ssg.tone(0,{period:173,volume:7});a.ssg.setEnvelope({period:769,shape:14});
  await a.adpcmA.loadMemory(new Uint8Array(512).fill(35),0xff00);a.adpcmA.setSample(5,{start:0xff00,end:0x10100});a.adpcmA.setVolume(19);a.adpcmA.setVoice(5,{volume:11,left:true,right:false});a.adpcmA.keyOn(5);
  await a.adpcmB.loadMemory(new Uint8Array(256).fill(71),0xffff00);a.adpcmB.setSample({start:0xffff00,end:0x1000000});a.adpcmB.setDeltaN(12345);a.adpcmB.setVolume(170);a.adpcmB.setPan(true,false);a.adpcmB.keyOn({repeat:true});await a.setClock(8200000);
  b.setPreset(3,FM_PRESETS['one-op-basic']);b.noteOn(3,'G3');b.ssg.noise(2,{period:19,volume:5});await b.adpcmA.loadMemory(new Uint8Array(256).fill(42));await b.adpcmB.loadMemory(new Uint8Array(256).fill(211));
  n.ssg.tone(1,{period:222,volume:6});o.ssg.tone(1,{period:251,volume:5});f.setDacEnabled(true);f.writeDac(181);p.tone(0,{period:319,attenuation:7});
  await mixer.set(a.id,{volume:.4,pan:-.3});await mixer.set(b.id,{volume:.7,pan:.2});
  liveLoop('extra-opnb',async()=>{a.setAlgo(1,7,0);await beat(.25);});
`;
async function runExtraYm2610({page,native,artifacts,name,until,assertNoLiveAudio,changeMode}){
  const all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]),phases=[];
  const [{unzipSync},{parseTfi},{parseVgi}]=await Promise.all([import('../docs/playground/vendor/fflate.js'),import('../web/tfi.js'),import('../web/vgi.js')]);
  const inspect=()=>page.evaluate(async()=>{const r=window.__nativeBackendTest.runtime;return {a:await r.chipInspector.read('opnb-a'),b:await r.chipInspector.read('opnb-b'),mixer:r.megaDrive.mixer.list().filter(c=>c.connected),audio:window.__audioConstructions};});
  const stop=async()=>{await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());await until(()=>!native.extraYm2610.size&&!native.extraYm2608.size&&!native.extraYm2203.size&&!native.extraYm2612.size&&!native.extraPsg.size,'All five additional kinds retire');};
  async function keyboard(ch){const start=all().length;await page.locator('#operatorTabButton').focus();await page.keyboard.down('z');try{await until(()=>all().slice(start).some(c=>c.type==='extra-ym2610'&&c.message.action==='on'&&c.message.channel===ch),'Keyboard physical voice '+ch);}finally{await page.keyboard.up('z');}await until(()=>all().slice(start).some(c=>c.type==='extra-ym2610'&&c.message.action==='off'&&c.message.channel===ch),'Keyboard release '+ch);}
  for(const execution of ['main','worker']){
    const start=all().length;await page.evaluate(({program,execution})=>window.__nativeBackendTest.runtime.playSource(program,{execution}),{program,execution});
    await until(()=>native.extraYm2610.size===2&&all().slice(start).some(c=>c.type==='extra-ym2610'&&c.message.method==='mix'&&c.message.volume===.7),'Complete independent OPNB initialization');
    const s=await inspect(),chips=[...native.extraYm2610.values()];assert.deepEqual(s.audio,{contexts:0,offline:0,worklets:[]});assert.equal(s.a.kind,'ym2610');assert.equal(s.a.clock,8200000);assert.equal(s.b.clock,8000000);assert.equal(s.a.fmState.channels.length,4);assert.equal(s.a.keyboardChannels.length,14);assert.equal(s.a.keyMasks.length,6);assert.deepEqual(s.a.romBytes,[0x10100,0x1000000]);assert.deepEqual(s.a.romAllocatedBytes,[2*PAGE,PAGE]);
    assert.deepEqual(s.mixer.map(c=>c.id).sort(),['dac','mono','opna','opnb-a','opnb-b','segapsg','tone','ym2612']);assert.equal(byte(chips[0],0,0xff00),35);assert.equal(byte(chips[0],0,0x10000),35);assert.equal(byte(chips[0],1,0xffff00),71);assert.equal(byte(chips[0],1,0),0);assert.equal(byte(chips[1],0,0),42);assert.equal(byte(chips[1],1,0),211);
    if(execution==='worker')await until(()=>all().slice(start).some(c=>c.type==='extra-ym2610'&&c.frame>0&&c.owner&&c.performance&&c.message.method==='write'),'Worker timed register owner');
    const edit=all().length;await page.click('#consoleTab');await page.click('#operatorTabButton');await page.selectOption('[data-opn-instance]','opnb-a');await page.waitForFunction(()=>document.querySelector('#extraFm-operatorTabChannelSelect')?.options.length===4);await page.locator('[data-extra-opnb-editor]').waitFor();assert(!all().slice(edit).some(c=>c.type==='extra-ym2610'&&c.message.audition),'Opening UI only observes');
    await page.locator('[data-extra-fm-editor] button[aria-label="TL"]').first().locator('..').locator('button.param-button').first().click();await until(()=>chips[0].registers[0][0x41]===126,'Logical FM1 operator mapped to hardware FM2');
    for(const format of ['tfi','vgi']){await page.evaluate(()=>{document.getElementById('mainMenu').open=true;document.getElementById('menuExport').open=true;});const downloaded=page.waitForEvent('download');await page.click(format==='tfi'?'#exportTfiButton':'#exportVgiButton');const file=path.join(artifacts,`${name}-extra-ym2610-${execution}.${format}.zip`);await(await downloaded).saveAs(file);const files=unzipSync(new Uint8Array(await fs.readFile(file)));assert.deepEqual(Object.keys(files).sort(),Array.from({length:4},(_,i)=>`ch${i+1}.${format}`));assert.equal((format==='tfi'?parseTfi:parseVgi)(files[`ch1.${format}`]).operators[1].tl,126);await page.evaluate(()=>{document.getElementById('mainMenu').open=false;});}
    const ssg=page.locator('[data-ssg-control="volume"]');await ssg.fill('11');await ssg.dispatchEvent('change');await until(()=>chips[0].ssgLevels[0]===11,'SSG edit');await keyboard(6);
    const samples=page.locator('[data-extra-opnb-editor]');await samples.locator('[data-opnb-control="a-voice"]').selectOption('5');await samples.locator('[data-opnb-control="a-level"]').fill('13');await samples.locator('[data-opnb-control="a-level"]').dispatchEvent('change');await until(()=>(chips[0].registers[1][13]&31)===13,'ADPCM-A per-voice edit');await keyboard(14);
    await samples.locator('[data-opnb-control="b-delta"]').fill('23456');await samples.locator('[data-opnb-control="b-delta"]').dispatchEvent('change');await until(()=>chips[0].registers[0][0x19]===(23456&255)&&chips[0].registers[0][0x1a]===(23456>>8),'ADPCM-B speed edit');await keyboard(15);
    await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:opnb-b');await page.selectOption('#playgroundKeyboardTargetChannel','fm:3');const preview=all().length;await page.locator('#keyboardTab').focus();await page.keyboard.down('z');await until(()=>all().slice(preview).some(c=>c.type==='extra-ym2610'&&c.message.action==='on'&&c.message.channel===5),'Second instance logical FM4 maps to hardware FM6');await page.keyboard.up('z');
    assert.equal(chips[1].registers[0][6],19);assert.equal(byte(chips[1],0,0),42);assert.equal(byte(chips[1],1,0),211);phases.push({execution,...await inspect()});await page.screenshot({path:path.join(artifacts,`${name}-extra-ym2610-${execution}.png`)});await stop();
  }
  for(const execution of ['main','worker']){
    const before=native.calls.length;await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`const old=await createSoundChip('ym2610',{id:'same'});await old.adpcmA.loadMemory(new Uint8Array(256).fill(9));old.dispose();const next=await createSoundChip('ym2610',{id:'same'});await next.adpcmB.loadMemory(new Uint8Array(256).fill(27),0xffff00);await next.setClock(8100000);`,{execution}),execution);
    await until(()=>native.extraYm2610.size===1&&[...native.extraYm2610.values()][0].clock===8100000,'Same ID replacement');const ids=native.calls.slice(before).filter(c=>c.command==='native_genesis_extra_ym2610_create').map(c=>c.args.instance);assert.equal(ids.length,2);assert(ids[1]>ids[0]);const next=[...native.extraYm2610.values()][0];assert.equal(byte(next,0,0),0);assert.equal(byte(next,1,0xffff00),27);await stop();
  }
  await changeMode(page,native,'ym3812','keep');await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource(`const c=await createSoundChip('ym2610',{id:'ym2610'});await c.adpcmB.loadMemory(new Uint8Array(256).fill(33));c.ssg.tone(0,{period:321,volume:8});`));await page.locator('#operatorTabButton').waitFor({state:'visible'});await page.click('#operatorTabButton');await page.waitForFunction(()=>document.querySelector('[data-opn-instance]')?.value==='ym2610');await page.locator('[data-extra-opnb-editor]').waitFor();await stop();await page.locator('#operatorTabButton').waitFor({state:'hidden'});
  await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());await fs.writeFile(path.join(artifacts,name+'-extra-ym2610.json'),JSON.stringify({mockedNative:true,deviceOpened:false,phases,calls:native.calls},null,2));
}
module.exports={installExtraYm2610Mock,runExtraYm2610};
