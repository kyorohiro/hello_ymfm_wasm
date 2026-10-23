// Actual Main/Worker, editor and Keyboard; Native IPC only is mocked. No device.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
function installExtraYm2203Mock(native){
  const invoke=native.invoke.bind(native);native.extraYm2203=new Map();
  const fresh=()=>({clock:4000000,registers:[Array(256).fill(0)],keyMasks:[0,0,0],ssgLevels:[0,0,0],ssgGates:[false,false,false],
    held:new Map(),groups:Array(6).fill(null),prescaler:6,status:0,irq:false,sourceMuteMask:0,mix:{volume:1,pan:0},frequencyLatch:[0,0]});
  const snapshot=s=>({sampleRate:48000,frame:native.status().frame,revision:native.calls.length,
    ym2203:{...s,registers:s.registers.map(r=>r.slice()),held:[...s.held.keys()],pendingCommands:[]}});
  function apply(s,m){const r=s.registers[0];
    if(m.method==='batch'){
      assert(Number.isInteger(m.channel)&&m.channel>=0&&m.channel<6);assert(Array.isArray(m.commands));
      if(m.action==='off'&&s.held.get(m.channel)!==m.voice)return;
      if(m.action==='on')s.held.set(m.channel,m.voice);
      m.commands.forEach(op=>apply(s,{...op,group:m.group}));if(m.action==='off')s.held.delete(m.channel);return;
    }
    if(m.method==='write'){
      assert.equal(m.port??0,0);assert(Number.isInteger(m.register)&&m.register>=0&&m.register<=255);assert(Number.isInteger(m.value)&&m.value>=0&&m.value<=255);
      const reg=m.register,value=m.value;
      if((reg&0xf0)===0xa0&&(reg&3)!==3){const latch=reg>>3&1;if(reg&4)s.frequencyLatch[latch]=value&63;else{r[reg]=value;r[reg|4]=s.frequencyLatch[latch];}}
      else r[reg]=value;
      if(reg===0x28&&(value&7)<3){s.keyMasks[value&7]=value>>4;s.groups[value&7]=m.group??null;}
      if(reg===0x27)s.csmGroup=m.group??null;
      if(reg>=8&&reg<=10){s.ssgGates[reg-8]=!!(value&31);if(value&31)s.ssgLevels[reg-8]=value&31;s.groups[reg-8+3]=m.group??null;}
      if(reg===0x2d)s.prescaler=6;else if(reg===0x2e){if(s.prescaler===6)s.prescaler=3;}else if(reg===0x2f)s.prescaler=2;
    }else if(m.method==='set-retained-level')s.ssgLevels[m.channel]=m.level;
    else if(m.method==='clock'){if(s.held.size)throw Error('Release the manually held additional YM2203 voices before changing the clock');s.clock=m.hz;}
    else if(m.method==='key-off'){if(m.channel<3)s.keyMasks[m.channel]=0;else{r[8+m.channel-3]=0;s.ssgGates[m.channel-3]=false;}}
    else if(m.method==='cancel-csm')r[0x27]&=~0x81;
    else if(m.method==='stop-voices'){s.keyMasks.fill(0);s.ssgGates.fill(false);r[8]=r[9]=r[10]=0;r[0x27]&=0xc0;s.held.clear();}
    else if(m.method==='reset'){const clock=s.clock;Object.assign(s,fresh(),{clock});}
    else if(m.method==='mix')s.mix={volume:m.volume,pan:m.pan};
    else if(m.method==='source-mute')s.sourceMuteMask=m.mask;
    else if(m.method==='channel-mute')s.channelMuteMask=m.mask;
    else if(m.method==='schedule'){assert(Array.isArray(m.entries));m.entries.forEach(([,register,value])=>apply(s,{method:'write',port:0,register,value,group:m.group}));s.schedule={token:m.token,group:m.group,pending:false,playing:false,ended:true,cancelled:false};}
    else if(m.method==='cancel-schedule'){if(s.schedule?.token===m.token)s.schedule={...s.schedule,ended:false,cancelled:true,playing:false,pending:false};}
    else if(m.method==='cancel-main-owner'){
      for(let ch=0;ch<6;ch++)if(s.groups[ch]===m.targetGroup&&!s.held.has(ch)){apply(s,{method:'key-off',channel:ch});s.groups[ch]=null;}
      if(s.csmGroup===m.targetGroup)r[0x27]&=~0x81;
      if(s.schedule?.group===m.targetGroup)s.schedule={...s.schedule,ended:false,cancelled:true,playing:false,pending:false};
    }
    else assert.equal(m.method,'barrier','Unknown extra YM2203 operation '+m.method);
  }
  native.invoke=async(command,args={})=>{
    if(command.startsWith('native_genesis_extra_ym2203_')){
      native.calls.push({command,args});assert.equal(args.session,native.current?.session);assert(Number.isSafeInteger(args.instance)&&args.instance>0);
      if(command==='native_genesis_extra_ym2203_create'){
        assert(!native.extraYm2203.has(args.instance)&&!native.extraYm2612.has(args.instance)&&!native.extraPsg.has(args.instance));
        assert(native.extraYm2203.size+native.extraYm2612.size+native.extraPsg.size+(native.extraYm2608?.size??0)+(native.extraYm2610?.size??0)<16);const s=fresh();native.extraYm2203.set(args.instance,s);return snapshot(s);
      }
      if(command==='native_genesis_extra_ym2203_dispose'){native.extraYm2203.delete(args.instance);return null;}
      assert.equal(command,'native_genesis_extra_ym2203_status');const s=native.extraYm2203.get(args.instance);assert(s);return snapshot(s);
    }
    if(command==='native_genesis_commands')for(const c of args.commands.filter(c=>c.type==='extra-ym2203')){const s=native.extraYm2203.get(c.instance);assert(s);apply(s,c.message);}
    const result=await invoke(command,args);if(['native_genesis_start','native_genesis_stop','native_genesis_shutdown'].includes(command))native.extraYm2203.clear();return result;
  };
}
const program=`
  if(await useSoundChip('ym2612')!==fm||await useSoundChip('segapsg')!==psg)throw Error('Primary borrowing changed');
  const a=await createSoundChip('ym2203',{id:'opn-a'}),b=await createSoundChip('ym2203',{id:'opn-b'});
  const f=await createSoundChip('ym2612',{id:'extra-fm'}),p=await createSoundChip('segapsg',{id:'extra-tone'});
  a.setPreset(0,FM_PRESETS['one-op-basic']);a.noteOn(0,'C4');a.ssg.tone(0,{period:173,volume:7});
  a.ssg.setEnvelope({period:769,shape:14});a.ssg.setVolume(1,0);a.write(0,0x2f,0);await a.setClock(4200000);
  b.setPreset(2,FM_PRESETS['one-op-basic']);b.noteOn(2,'G3');b.ssg.noise(2,{period:19,volume:5});
  f.setDacEnabled(true);f.writeDac(181);p.tone(0,{period:251,attenuation:7});
  await mixer.set(a.id,{volume:.4,pan:-.3});await mixer.set(b.id,{volume:.7,pan:.2});
  liveLoop('extra-opn',async()=>{a.setAlgo(1,7,0);await beat(.25);});
`;
async function runExtraYm2203({page,native,artifacts,name,until,assertNoLiveAudio,changeMode}){
  const all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]),phases=[];
  const [{unzipSync},{parseTfi},{parseVgi}]=await Promise.all([import('../docs/playground/vendor/fflate.js'),import('../web/tfi.js'),import('../web/vgi.js')]);
  async function exportFm(format){
    await page.evaluate(()=>{document.getElementById('mainMenu').open=true;document.getElementById('menuExport').open=true;});
    const downloaded=page.waitForEvent('download');await page.click(format==='tfi'?'#exportTfiButton':'#exportVgiButton');const download=await downloaded;
    const file=path.join(artifacts,`${name}-extra-ym2203.${format}.zip`);await download.saveAs(file);const files=unzipSync(new Uint8Array(await fs.readFile(file)));
    assert.deepEqual(Object.keys(files).sort(),Array.from({length:3},(_,i)=>`ch${i+1}.${format}`));const preset=(format==='tfi'?parseTfi:parseVgi)(files[`ch1.${format}`]);assert.equal(preset.operators[1].tl,126);
    await page.evaluate(()=>{document.getElementById('mainMenu').open=false;});
  }
  const inspect=()=>page.evaluate(async()=>{const r=window.__nativeBackendTest.runtime;return {a:await r.chipInspector.read('opn-a'),b:await r.chipInspector.read('opn-b'),
    f:await r.chipInspector.read('extra-fm'),p:await r.chipInspector.read('extra-tone'),mixer:r.megaDrive.mixer.list().filter(c=>c.connected),audio:window.__audioConstructions};});
  const stop=async()=>{await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());await until(()=>!native.extraYm2203.size&&!native.extraYm2612.size&&!native.extraPsg.size,'All additional chips retire');};
  for(const execution of ['main','worker']){
    const first=all().length;
    await page.evaluate(({program,execution})=>window.__nativeBackendTest.runtime.playSource(program,{execution}),{program,execution});
    await until(()=>native.extraYm2203.size===2&&native.extraYm2612.size===1&&native.extraPsg.size===1,'Three chip kinds connect');
    await until(()=>[...native.extraYm2203.values()].some(s=>s.clock===4200000),'Applied independent clock');
    await until(()=>[...native.extraYm2203.values()].some(s=>s.registers[0][6]===19)&&[...native.extraYm2612.values()].some(s=>s.registers[0][0x2a]===181),'Complete FM/SSG/DAC phrase writes');
    const s=await inspect();assert.deepEqual(s.audio,{contexts:0,offline:0,worklets:[]});assert.equal(s.a.kind,'ym2203');assert.equal(s.a.clock,4200000);assert.equal(s.b.clock,4000000);
    assert.equal(s.a.registers.length,1);assert.equal(s.a.keyMasks.length,3);assert.equal(s.a.prescaler,2);assert.equal(s.a.ssgLevels[1],0);assert.equal(s.b.registers[0][6],19);assert.equal(s.f.registers[0][0x2a],181);
    assert.deepEqual(s.mixer.map(c=>c.id).sort(),['extra-fm','extra-tone','opn-a','opn-b','segapsg','ym2612']);
    if(execution==='worker')await until(()=>all().slice(first).some(c=>c.type==='extra-ym2203'&&c.frame>0&&c.owner&&c.performance),'Worker timing owner');
    const editStart=all().length;
    await page.click('#consoleTab');await page.click('#operatorTabButton');await page.selectOption('[data-opn-instance]','opn-a');
    await page.waitForFunction(()=>document.querySelector('#extraFm-operatorTabChannelSelect')?.options.length===3);
    assert(!all().slice(editStart).some(c=>c.type==='extra-ym2203'&&c.message.audition),'Opening the editor must not apply a preset');
    await page.locator('[data-extra-fm-editor] button[aria-label="TL"]').first().locator('..').locator('button.param-button').first().click();
    await until(()=>all().slice(editStart).some(c=>c.type==='extra-ym2203'&&c.message.action==='edit'&&c.message.commands.some(op=>op.register===0x40&&op.value===126)),'Additional mono FM operator edit');
    await exportFm('tfi');await exportFm('vgi');
    const ssg=page.locator('[data-extra-ssg-editor]');await ssg.locator('[data-ssg-control="volume"]').fill('11');await ssg.locator('[data-ssg-control="volume"]').dispatchEvent('change');
    await until(()=>[...native.extraYm2203.values()].some(s=>s.ssgLevels[0]===11),'SSG retained volume edit');
    await ssg.locator('[data-ssg-control="noise-period"]').fill('17');await ssg.locator('[data-ssg-control="noise-period"]').dispatchEvent('change');
    await until(()=>[...native.extraYm2203.values()].some(s=>s.registers[0][6]===17),'Shared noise edit');
    await ssg.locator('[data-ssg-control="envelope-period"]').fill('1025');await ssg.locator('[data-ssg-control="envelope-period"]').dispatchEvent('change');
    await until(()=>[...native.extraYm2203.values()].some(s=>s.registers[0][11]===1&&s.registers[0][12]===4),'Envelope period edit without shape retrigger');
    const edited=await inspect();assert.equal(edited.a.registers[0][13],14);assert.equal(edited.b.registers[0][6],19);assert.equal(edited.f.registers[0][0x2a],181);
    const preview=all().length;await page.locator('#operatorTabButton').focus();await page.keyboard.down('z');
    try{await until(()=>all().slice(preview).some(c=>c.type==='extra-ym2203'&&c.message.action==='on'&&c.message.channel===3),'SSG editor Keyboard target');}
    catch(error){await fs.writeFile(path.join(artifacts,name+'-ym2203-keyboard-error.json'),JSON.stringify({execution,calls:all().slice(preview),ui:await page.evaluate(()=>({label:document.querySelector('#playgroundKeyboardEditorTarget')?.textContent,status:document.querySelector('#audioStatus')?.textContent,active:document.activeElement?.id}))},null,2));throw error;}
    await page.keyboard.up('z');
    await until(()=>all().slice(preview).some(c=>c.type==='extra-ym2203'&&c.message.action==='off'&&c.message.channel===3),'SSG keyboard release');
    await page.screenshot({path:path.join(artifacts,name+'-extra-ym2203-'+execution+'.png')});
    await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:opn-b');await page.selectOption('#playgroundKeyboardTargetChannel','fm:2');
    const fmPreview=all().length;await page.locator('#keyboardTab').focus();await page.keyboard.down('z');
    await until(()=>all().slice(fmPreview).some(c=>c.type==='extra-ym2203'&&c.message.action==='on'&&c.message.channel===2),'FM Keyboard target');await page.keyboard.up('z');
    await until(()=>all().slice(fmPreview).some(c=>c.type==='extra-ym2203'&&c.message.action==='off'&&c.message.channel===2),'FM keyboard release');
    phases.push({execution,...edited});await stop();
  }
  for(const execution of ['main','worker']){
    const before=native.calls.length;
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`const old=await createSoundChip('ym2203',{id:'same'});old.ssg.tone(0,{period:111});old.dispose();const next=await createSoundChip('ym2203',{id:'same'});next.ssg.tone(1,{period:222});await next.setClock(3993600);`,{execution}),execution);
    await until(()=>native.extraYm2203.size===1&&[...native.extraYm2203.values()][0].clock===3993600,'Same ID replacement');
    const ids=native.calls.slice(before).filter(c=>c.command==='native_genesis_extra_ym2203_create').map(c=>c.args.instance);assert.equal(ids.length,2);assert(ids[1]>ids[0]);assert.equal([...native.extraYm2203.values()][0].registers[0][2],222);await stop();
  }
  for(const execution of ['main','worker']){
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`const opn=await createSoundChip('ym2203',{id:'scheduled'});await opn.scheduleRegisters([[0,7,56],[0,8,11],[441,8,0]],441);opn.ssg.setVolume(2,9);`,{execution}),execution);
    await until(()=>[...native.extraYm2203.values()].some(s=>s.registers[0][10]===9),'Schedule completion releases awaiting Main/Worker');await stop();
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`const opn=await createSoundChip('ym2203',{id:'scheduled'});const playing=opn.scheduleRegisters([[4410,8,12]],8820).then(()=>false,()=>true);opn.reset();if(!await playing)throw Error('Reset did not cancel');opn.ssg.setVolume(1,6);`,{execution}),execution);
    await until(()=>[...native.extraYm2203.values()].some(s=>s.registers[0][9]===6),'Reset interrupts deferred schedule without blocking reset RPC');assert.equal([...native.extraYm2203.values()][0].registers[0][8],0);await stop();
    const longStart=all().length;
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`
      const opn=await createSoundChip('ym2203',{id:'scheduled'});
      liveLoop('long-schedule',async()=>{try{await opn.scheduleRegisters([[0,8,9]],44100*3600);}catch{}});
      keyboard.bind('replace-long-schedule',{async noteOn(){stopLoop('long-schedule');await opn.scheduleRegisters([[0,8,3],[441,8,0]],441);opn.ssg.setVolume(2,7);},noteOff(){},allNotesOff(){}});
    `,{execution}),execution);
    await until(()=>all().slice(longStart).some(c=>c.type==='extra-ym2203'&&c.message.method==='schedule'&&c.message.durationSamples===44100*3600),'Hour-long schedule is accepted before cancellation');
    await page.waitForFunction(()=>Boolean(window.__nativeBackendTest.runtime.getKeyboardTarget()));
    await page.evaluate(()=>window.__nativeBackendTest.runtime.getKeyboardTarget().noteOn({id:'replace',midi:60}));
    await until(()=>[...native.extraYm2203.values()].some(s=>s.registers[0][10]===7),'Owner cancellation permits immediate replacement of an hour-long schedule');await stop();
  }
  await changeMode(page,native,'ym3812','keep');
  await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource(`const extra=await createSoundChip('ym2203',{id:'ym2203'});extra.ssg.tone(0,{period:321,volume:8});`));
  await page.locator('#operatorTabButton').waitFor({state:'visible'});await page.click('#operatorTabButton');await page.waitForFunction(()=>document.querySelector('[data-opn-instance]')?.value==='ym2203');
  await page.locator('[data-extra-ssg-editor]').waitFor();await stop();await page.locator('#operatorTabButton').waitFor({state:'hidden'});
  await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
  await fs.writeFile(path.join(artifacts,name+'-extra-ym2203.json'),JSON.stringify({mockedNative:true,deviceOpened:false,phases,calls:native.calls},null,2));
}
module.exports={installExtraYm2203Mock,runExtraYm2203};
