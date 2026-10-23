const {extraChipCount}=require('./native_backend_extra_limits.cjs');
// Real Main/Worker, Inspector, Keyboard and UI; mocked Native IPC, no audio device.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const kinds=['extraPsg','extraYm2612','extraYm2203','extraYm2608','extraYm2610','extraYm2151'];
function installExtraYm2151Mock(native){
  const invoke=native.invoke.bind(native);native.extraYm2151=new Map();
  const fresh=()=>({clock:3579545,registers:Array(256).fill(0),keyMasks:Array(8).fill(0),amDepth:0,pmDepth:0,status:0,irq:false,held:new Map(),groups:Array(8).fill(null),mix:{volume:1,pan:0}});
  const snapshot=s=>({sampleRate:48000,frame:native.status().frame,revision:native.calls.length,ym2151:{...s,registers:s.registers.slice(),keyMasks:s.keyMasks.slice(),held:[...s.held.keys()],pendingCommands:[]}});
  function apply(s,m){
    if(m.method==='batch'){
      assert(m.channel>=0&&m.channel<8);if(m.action==='off'&&s.held.get(m.channel)!==m.voice)return;
      if(m.action==='on')s.held.set(m.channel,m.voice);m.commands.forEach(c=>apply(s,{...c,group:m.group}));if(m.action==='off')s.held.delete(m.channel);
    }else if(m.method==='write'){
      const r=m.register,v=m.value;assert(Number.isInteger(r)&&r>=0&&r<256&&Number.isInteger(v)&&v>=0&&v<256);
      if(r===8){const ch=v&7;if(!(v&120)&&m.group!==undefined&&s.groups[ch]!==null&&s.groups[ch]!==m.group&&!s.held.has(ch))return;s.keyMasks[ch]=v>>3&15;s.groups[ch]=s.keyMasks[ch]?m.group??null:null;}
      s.registers[r]=v;if(r===0x19)s[v&128?'pmDepth':'amDepth']=v&127;if(r===0x14)s.csmGroup=m.group??null;
    }else if(m.method==='clock'){if(s.held.size)throw Error('Release the manually held additional YM2151 voices before changing the clock');s.clock=m.hz;}
    else if(m.method==='reset'){if(!s.held.size){const {clock}=s;Object.assign(s,fresh(),{clock});}}
    else if(['all-notes-off','stop-voices'].includes(m.method)){s.keyMasks.fill(0);s.held.clear();s.groups.fill(null);if(m.method==='stop-voices')s.registers[0x14]&=~0x81;}
    else if(m.method==='key-off')s.keyMasks[m.channel]=0;
    else if(m.method==='audition-key-on')s.keyMasks[m.channel]=m.mask;
    else if(m.method==='cancel-main-owner'){for(let ch=0;ch<8;ch++)if(s.groups[ch]===m.targetGroup&&!s.held.has(ch)){s.keyMasks[ch]=0;s.groups[ch]=null;}if(s.csmGroup===m.targetGroup)s.registers[0x14]&=~0x81;}
    else if(m.method==='cancel-csm')s.registers[0x14]&=~0x81;
    else if(m.method==='mix')s.mix={volume:m.volume,pan:m.pan};
    else assert.equal(m.method,'barrier','Unknown extra YM2151 command '+m.method);
  }
  native.invoke=async(command,args={})=>{
    if(command.startsWith('native_genesis_extra_ym2151_')){
      native.calls.push({command,args});assert.equal(args.session,native.current?.session);assert(Number.isSafeInteger(args.instance)&&args.instance>0);
      if(command.endsWith('_create')){assert(extraChipCount(native)<16);assert(!native.extraYm2151.has(args.instance));const s=fresh();native.extraYm2151.set(args.instance,s);return snapshot(s);}
      if(command.endsWith('_dispose')){native.extraYm2151.delete(args.instance);return null;}
      assert(command.endsWith('_status'));const s=native.extraYm2151.get(args.instance);assert(s);return snapshot(s);
    }
    if(command==='native_genesis_commands')for(const c of args.commands.filter(c=>c.type==='extra-ym2151')){const s=native.extraYm2151.get(c.instance);assert(s);apply(s,c.message);}
    const result=await invoke(command,args);if(['native_genesis_start','native_genesis_stop','native_genesis_shutdown'].includes(command))native.extraYm2151.clear();return result;
  };
}
const program=`
  const a=await createSoundChip('ym2151',{id:'opm-a'}),b=await createSoundChip('ym2151',{id:'opm-b'});
  for(const c of [a,b])for(let ch=0;ch<8;ch++){c.setAlgo(ch,7,0);c.setPan(ch,true,true);for(let op=0;op<4;op++)c.setOperator(ch,op,{mul:1,tl:op===3?32:127,ar:31,rr:15});}
  a.noteOn(0,'C4');a.setOperator(0,1,{tl:61});a.writeRegister(0x19,37);a.writeRegister(0x19,128|53);await a.setClock(4000000);
  b.noteOn(7,'G3');b.setNoise(true,19);
  await createSoundChip('ym2610',{id:'opnb'});await createSoundChip('ym2608',{id:'opna'});await createSoundChip('ym2203',{id:'mono'});await createSoundChip('ym2612',{id:'dac'});await createSoundChip('segapsg',{id:'tone'});
  await mixer.set(a.id,{volume:.4,pan:-.3});await mixer.set(b.id,{volume:.7,pan:.2});
  liveLoop('extra-opm',async()=>{a.setAlgo(1,7,0);await beat(.25);});
`;
async function runExtraYm2151({page,native,artifacts,name,until,assertNoLiveAudio,changeMode}){
  const all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]),phases=[];
  const stop=async()=>{await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());await until(()=>kinds.every(k=>!native[k].size),'All six additional kinds retire');};
  const inspect=()=>page.evaluate(async()=>{const r=window.__nativeBackendTest.runtime;return {a:await r.chipInspector.read('opm-a'),b:await r.chipInspector.read('opm-b'),mixer:r.megaDrive.mixer.list().filter(c=>c.connected),audio:window.__audioConstructions};});
  async function keyboard(channel){const before=all().length;await page.locator('#ym2151Tab').focus();await page.keyboard.down('z');try{await until(()=>all().slice(before).some(c=>c.type==='extra-ym2151'&&c.message.action==='on'&&c.message.channel===channel),'OPM Keyboard CH'+channel);}finally{await page.keyboard.up('z');}await until(()=>all().slice(before).some(c=>c.type==='extra-ym2151'&&c.message.action==='off'&&c.message.channel===channel),'OPM Keyboard release');}
  for(const execution of ['main','worker']){
    const before=all().length;await page.evaluate(({program,execution})=>window.__nativeBackendTest.runtime.playSource(program,{execution}),{program,execution});
    await until(()=>native.extraYm2151.size===2&&all().slice(before).some(c=>c.type==='extra-ym2151'&&c.message.method==='mix'&&c.message.volume===.7),'Independent OPM initialization');
    const s=await inspect(),chips=[...native.extraYm2151.values()];assert.deepEqual(s.audio,{contexts:0,offline:0,worklets:[]});assert.equal(s.a.kind,'ym2151');assert.equal(s.a.clock,4000000);assert.equal(s.b.clock,3579545);assert.equal(s.a.channels.length,8);assert.equal(s.a.amDepth??s.a.lfo.amDepth,37);assert.equal(s.a.pmDepth??s.a.lfo.pmDepth,53);assert.equal(chips[0].registers[0x68],61);assert.equal(chips[1].registers[15],147);assert.equal(s.mixer.length,9);
    if(execution==='worker')await until(()=>all().slice(before).some(c=>c.type==='extra-ym2151'&&c.owner&&c.performance&&c.frame>0),'Worker timed OPM owner');
    const opening=all().length;await page.click('#consoleTab');await page.locator('#ym2151Tab').waitFor({state:'visible'});await page.click('#ym2151Tab');await page.selectOption('#ym2151Panel [data-chip-control="instance"]','opm-a');await page.locator('#ym2151Panel [data-chip-control="ym2151-op-1-tl"]').waitFor();assert(!all().slice(opening).some(c=>c.type==='extra-ym2151'&&c.message.audition),'Opening tab must only observe');
    const field=page.locator('#ym2151Panel [data-chip-control="ym2151-op-1-tl"]');await field.fill('29');await field.dispatchEvent('change');await until(()=>chips[0].registers[0x70]===29,'Logical M2 maps to register-order operator2');assert.equal(chips[1].registers[0x70],127);
    await page.locator('#ym2151Panel [data-chip-control="ym2151-lfo-am-depth"]').fill('43');await page.locator('#ym2151Panel [data-chip-control="ym2151-lfo-am-depth"]').dispatchEvent('change');await until(()=>chips[0].amDepth===43,'Applied AM latch');assert.equal(chips[0].pmDepth,53);
    await keyboard(0);await page.selectOption('#ym2151Panel [data-chip-control="instance"]','opm-b');await page.locator('#ym2151Panel [data-chip-channel="7"]').click();await keyboard(7);
    await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:opm-a');await page.selectOption('#playgroundKeyboardTargetChannel','3');const keys=all().length;await page.locator('#keyboardTab').focus();await page.keyboard.down('z');try{await until(()=>all().slice(keys).some(c=>c.type==='extra-ym2151'&&c.message.action==='on'&&c.message.channel===3),'Bottom Keyboard exact OPM channel');}finally{await page.keyboard.up('z');}
    phases.push({execution,...await inspect()});await page.screenshot({path:path.join(artifacts,`${name}-extra-ym2151-${execution}.png`)});await stop();await page.locator('#ym2151Tab').waitFor({state:'hidden'});
  }
  for(const execution of ['main','worker']){
    const before=native.calls.length;await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`const old=await createSoundChip('ym2151',{id:'same'});old.setNoise(true,5);old.dispose();const next=await createSoundChip('ym2151',{id:'same'});next.setNoise(true,27);await next.setClock(3900000);`,{execution}),execution);await until(()=>native.extraYm2151.size===1&&[...native.extraYm2151.values()][0].clock===3900000,'Same ID replacement');const ids=native.calls.slice(before).filter(c=>c.command==='native_genesis_extra_ym2151_create').map(c=>c.args.instance);assert.equal(ids.length,2);assert(ids[1]>ids[0]);assert.equal([...native.extraYm2151.values()][0].registers[15],155);await stop();
  }
  await changeMode(page,native,'x68000','keep');await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource(`if(await useSoundChip('ym2151')!==opm)throw Error('Primary OPM borrowing changed');const c=await createSoundChip('ym2151',{id:'extra-opm'});c.setAlgo(7,6,2);`));await until(()=>native.extraYm2151.size===1,'Extra OPM beside primary X68000');assert.equal(native.x68000.ym2151.clock,4000000);assert.equal([...native.extraYm2151.values()][0].clock,3579545);await page.click('#consoleTab');await page.click('#ym2151Tab');await page.waitForFunction(()=>document.querySelector('#ym2151Panel [data-chip-control="instance"]')?.options.length===2);await stop();await page.locator('#ym2151Tab').waitFor({state:'visible'});
  await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());await fs.writeFile(path.join(artifacts,name+'-extra-ym2151.json'),JSON.stringify({mockedNative:true,deviceOpened:false,phases,calls:native.calls},null,2));
}
module.exports={installExtraYm2151Mock,runExtraYm2151};
