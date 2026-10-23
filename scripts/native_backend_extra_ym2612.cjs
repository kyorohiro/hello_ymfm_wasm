// Actual browser Main/Worker clients and UI, mocked Native IPC, no audio device.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');

function installExtraYm2612Mock(native){
  const invoke=native.invoke.bind(native);native.extraYm2612=new Map();
  const fresh=()=>({clock:7670454,registers:[Array(256).fill(0),Array(256).fill(0)],keyMasks:Array(6).fill(0),
    frequencyLatch:[0,0],status:0,irq:false,sourceMuteMask:0,held:new Map(),mix:{volume:1,pan:0}});
  const snapshot=state=>({sampleRate:48000,frame:native.status().frame,revision:native.calls.length,
    ym2612:{...state,registers:state.registers.map(r=>r.slice()),keyMasks:state.keyMasks.slice(),held:[...state.held.keys()],pendingCommands:[]}});
  function apply(s,m,bypass=false){
    if(m.method==='batch'){
      assert(Number.isInteger(m.channel)&&m.channel>=0&&m.channel<6);assert(Array.isArray(m.commands));
      if(m.action==='off'&&s.held.get(m.channel)!==m.voice)return;
      if(m.action==='on')s.held.set(m.channel,m.voice);
      m.commands.forEach(op=>apply(s,op,true));if(m.action==='off')s.held.delete(m.channel);return;
    }
    if(m.method==='write'){
      const {port,register,value}=m;
      assert([0,1].includes(port)&&Number.isInteger(register)&&register>=0&&register<=255&&Number.isInteger(value)&&value>=0&&value<=255);
      const key=(value&3)+(value&4?3:0),ch=port*3+(register&3);
      if(!bypass&&((port===0&&register===0x28&&s.held.has(key))||register>=0xa0&&register<=0xa6&&s.held.has(ch)))return;
      if((register&0xf0)===0xa0&&(register&3)!==3){
        const latch=(register>>3)&1;
        if(register&4)s.frequencyLatch[latch]=value&63;
        else{s.registers[port][register]=value;s.registers[port][register|4]=s.frequencyLatch[latch];}
      }else s.registers[port][register]=value;
      if(port===0&&register===0x28&&(value&3)<3)s.keyMasks[key]=value>>4;
    }else if(m.method==='clock'){
      if(s.held.size)throw Error('Release the manually held additional YM2612 voices before changing the clock');
      s.clock=m.hz;
    }else if(m.method==='key-off')s.keyMasks[m.channel]=0;
    else if(m.method==='cancel-csm')s.registers[0][0x27]&=~0x81;
    else if(m.method==='stop-voices'){s.keyMasks.fill(0);s.held.clear();s.registers[0][0x27]&=0xc0;s.registers[0][0x2b]&=127;s.registers[0][0x2a]=128;}
    else if(m.method==='reset'){if(!s.held.size){const clock=s.clock;Object.assign(s,fresh(),{clock});}}
    else if(m.method==='mix')s.mix={volume:m.volume,pan:m.pan};
    else if(m.method==='source-mute')s.sourceMuteMask=m.mask;
    else assert.equal(m.method,'barrier','Unknown extra YM2612 operation '+m.method);
  }
  native.invoke=async(command,args={})=>{
    if(command.startsWith('native_genesis_extra_ym2612_')){
      native.calls.push({command,args});assert.equal(args.session,native.current?.session);
      assert(Number.isSafeInteger(args.instance)&&args.instance>0);
      if(command==='native_genesis_extra_ym2612_create'){
        assert(!native.extraYm2612.has(args.instance)&&!native.extraPsg.has(args.instance)&&!native.extraYm2203?.has(args.instance));
        assert(native.extraYm2612.size+native.extraPsg.size+(native.extraYm2203?.size??0)<16);const s=fresh();
        native.extraYm2612.set(args.instance,s);return snapshot(s);
      }
      if(command==='native_genesis_extra_ym2612_dispose'){native.extraYm2612.delete(args.instance);return null;}
      assert.equal(command,'native_genesis_extra_ym2612_status');
      const s=native.extraYm2612.get(args.instance);assert(s,'Expired additional YM2612');return snapshot(s);
    }
    if(command==='native_genesis_commands')for(const c of args.commands.filter(c=>c.type==='extra-ym2612')){
      const s=native.extraYm2612.get(c.instance);assert(s,'Expired additional YM2612 command');apply(s,c.message);
    }
    const result=await invoke(command,args);
    if(['native_genesis_start','native_genesis_stop','native_genesis_shutdown'].includes(command))native.extraYm2612.clear();
    return result;
  };
}

const program=`
  if(await useSoundChip('ym2612')!==fm||await useSoundChip('segapsg')!==psg)throw Error('Primary identity changed');
  if(fm.dispose!==undefined||psg.dispose!==undefined)throw Error('Primary ownership changed');
  const a=await createSoundChip('ym2612',{id:'extra-fm-a'});
  const b=await createSoundChip('ym2612',{id:'extra-fm-b'});
  const p=await createSoundChip('segapsg',{id:'extra-tone'});
  a.setPreset(0,FM_PRESETS['one-op-basic']);a.setAlgo(0,7,2);a.setPan(0,true,false);a.noteOn(0,'C4');await a.setClock(8000000);
  b.setPreset(5,FM_PRESETS['one-op-basic']);b.setAlgo(5,4,1);b.setPan(5,false,true);b.noteOn(5,'E3');
  b.setDacEnabled(true);b.writeDac(173);
  p.tone(0,{period:251,attenuation:7});p.setStereo(0x81);
  await mixer.set(a.id,{volume:.4,pan:-.5});await mixer.set(b.id,{volume:.7,pan:.25});await mixer.set(p.id,{volume:.3});
  fm.setPreset(0,FM_PRESETS['one-op-basic']);fm.noteOn(0,'G3');psg.tone(0,{period:319,attenuation:10});
  liveLoop('extra-fm-browser',async()=>{a.setAlgo(1,7,0);await beat(.25);});
`;

async function runExtraYm2612({page,native,artifacts,name,assertNoLiveAudio,until,changeMode}){
  const all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]),phases=[];
  const [{unzipSync},{parseTfi},{parseVgi}]=await Promise.all([
    import('../docs/playground/vendor/fflate.js'),import('../web/tfi.js'),import('../web/vgi.js'),
  ]);
  const primaryState=()=>page.evaluate(()=>window.__nativeBackendTest.runtime.megaDrive.fm.getState());
  async function exportSelectedFm(format,expectedTl,execution){
    await page.evaluate(()=>{document.getElementById('mainMenu').open=true;document.getElementById('menuExport').open=true;});
    const button=page.locator(format==='tfi'?'#exportTfiButton':'#exportVgiButton');assert(await button.isVisible(),'Selected extra FM export is visible');
    const downloaded=page.waitForEvent('download');await button.click();const download=await downloaded;
    const file=path.join(artifacts,`${name}-extra-ym2612-${execution}.${format}.zip`);await download.saveAs(file);
    const files=unzipSync(new Uint8Array(await fs.readFile(file)));assert.deepEqual(Object.keys(files).sort(),Array.from({length:6},(_,i)=>`ch${i+1}.${format}`));
    const preset=(format==='tfi'?parseTfi:parseVgi)(files[`ch1.${format}`]);
    assert.equal(preset.operators[1].tl,expectedTl,`${format.toUpperCase()} exports the selected additional FM operator state`);
    await page.evaluate(()=>{document.getElementById('mainMenu').open=false;});
  }
  const inspect=()=>page.evaluate(async()=>{
    const r=window.__nativeBackendTest.runtime,s=r.megaDrive;
    return {audio:{...window.__audioConstructions},session:s.session,mixer:s.mixer.list().filter(x=>x.connected),list:r.chipInspector.list(),
      a:await r.chipInspector.read('extra-fm-a'),b:await r.chipInspector.read('extra-fm-b'),p:await r.chipInspector.read('extra-tone')};
  });
  const stop=async()=>{
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    await until(()=>!native.extraYm2612.size&&!native.extraPsg.size,'Native mixed rack Stop');
    assert.deepEqual(await page.evaluate(()=>window.__nativeBackendTest.runtime.megaDrive.mixer.list().filter(x=>x.connected).map(x=>x.id).sort()),['segapsg','ym2612']);
  };
  let session;
  for(const execution of ['main','worker']){
    const first=all().length;
    await page.evaluate(({program,execution})=>window.__nativeBackendTest.runtime.playSource(program,{execution}),{program,execution});
    await until(()=>native.extraYm2612.size===2&&native.extraPsg.size===1&&all().slice(first).some(c=>c.type==='extra-ym2612'&&c.message.method==='write'&&c.message.register===0x2a&&c.message.value===173),execution+' FM/DAC writes');
    const s=await inspect();session??=s.session;assert.equal(s.session,session);
    assert.deepEqual(s.audio,{contexts:0,offline:0,worklets:[]});
    assert.deepEqual(s.mixer.map(x=>x.id).sort(),['extra-fm-a','extra-fm-b','extra-tone','segapsg','ym2612']);
    assert.equal(s.a.kind,'ym2612');assert.equal(s.b.kind,'ym2612');assert.equal(s.a.clock,8000000);assert.equal(s.b.clock,7670454);
    assert.equal(s.a.registers[0][0xb0],23);assert.equal(s.b.registers[1][0xb2],12);
    assert.equal(s.b.registers[0][0x2b],128);assert.equal(s.b.registers[0][0x2a],173);assert.equal(s.p.channels[0].period,251);
    if(execution==='worker')await until(()=>all().slice(first).some(c=>c.type==='extra-ym2612'&&c.frame>0&&c.performance&&c.owner),'Worker timing/owners');
    const editorStart=all().length,primaryBeforeEdit=await primaryState();
    await page.click('#operatorTabButton');await page.selectOption('[data-opn-instance]','extra-fm-a');
    await page.waitForFunction(()=>document.querySelector('#extraFm-operatorTabChannelSelect')?.options.length===6);
    assert(!all().slice(editorStart).some(c=>c.type==='extra-ym2612'&&c.message.audition),'Opening the applied voice view must not write a preset');
    await page.locator('[data-extra-fm-editor] button[aria-label="TL"]').first().locator('..').locator('button.param-button').first().click();
    await until(()=>all().slice(editorStart).some(c=>c.type==='extra-ym2612'&&c.message.method==='batch'&&c.message.action==='edit'&&c.message.commands.some(op=>op.method==='write'&&op.register===0x40&&op.value===126)),'Selected extra FM operator edit');
    assert.equal((await inspect()).b.registers[0][0x2a],173,'Editing A must preserve B DAC');
    await exportSelectedFm('tfi',126,execution);await exportSelectedFm('vgi',126,execution);
    assert.deepEqual(await primaryState(),primaryBeforeEdit,'Editing/exporting the selected additional FM must preserve the primary FM state');
    await page.screenshot({path:path.join(artifacts,name+'-extra-ym2612-operators-'+execution+'.png')});
    const previewStart=all().length;await page.locator('#operatorTabButton').focus();await page.keyboard.down('z');
    await until(()=>all().slice(previewStart).some(c=>c.type==='extra-ym2612'&&c.message.action==='on'),'Selected extra FM operator keyboard');
    await page.keyboard.up('z');await until(()=>all().slice(previewStart).some(c=>c.type==='extra-ym2612'&&c.message.action==='off'),'Selected extra FM operator keyboard release');
    await page.click('#keyboardTab');await page.locator('#playgroundKeyboardChip option[value="chip:extra-fm-a"]').waitFor({state:'attached'});
    await page.selectOption('#playgroundKeyboardChip','chip:extra-fm-a');await page.selectOption('#playgroundKeyboardTargetChannel','fm:0');
    await page.locator('#keyboardTab').focus();const before=all().length;await page.keyboard.down('z');
    await until(()=>all().slice(before).some(c=>c.type==='extra-ym2612'&&c.message.action==='on'),'Additional FM Keyboard note on');
    await page.keyboard.up('z');await until(()=>all().slice(before).some(c=>c.type==='extra-ym2612'&&c.message.action==='off'),'Additional FM Keyboard note off');
    assert.equal((await inspect()).b.registers[0][0x2a],173,'Manual audition must not change sibling DAC');
    phases.push({execution,...s});await page.click('#mixerTab');
    await page.screenshot({path:path.join(artifacts,name+'-extra-ym2612-'+execution+'.png')});await stop();
  }
  for(const execution of ['main','worker']){
    const first=native.calls.length;
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`
      const old=await createSoundChip('ym2612',{id:'extra-fm-a'});old.noteOn(0,'C3');old.dispose();
      const a=await createSoundChip('ym2612',{id:'extra-fm-a'});a.setAlgo(0,6,3);a.noteOn(0,'D4');await a.setClock(7000000);
      const b=await createSoundChip('ym2612',{id:'extra-fm-b'});b.setDacEnabled(true);b.writeDac(181);
      const p=await createSoundChip('segapsg',{id:'extra-tone'});p.tone(1,{period:333,attenuation:5});
    `,{execution}),execution);
    await until(()=>native.extraYm2612.size===2&&native.extraPsg.size===1&&[...native.extraYm2612.values()].some(s=>s.clock===7000000),'Mixed rack replacement');
    const created=native.calls.slice(first).filter(c=>c.command==='native_genesis_extra_ym2612_create').map(c=>c.args.instance);
    assert.equal(created.length,3);assert.equal(new Set(created).size,3);
    assert(native.calls.slice(first).some(c=>c.command==='native_genesis_extra_ym2612_dispose'&&c.args.instance===created[0]));
    const s=await inspect();assert.equal(s.a.clock,7000000);assert.equal(s.a.registers[0][0xb0],30);assert.equal(s.b.registers[0][0x2a],181);
    assert.equal(s.p.channels[1].period,333);phases.push({execution,replacement:true,...s});await stop();
  }
  await changeMode(page,native,'ym3812','keep');
  assert(await page.locator('#operatorTabButton').isHidden(),'Non-FM mode starts without an OPN editor');
  await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource(`const added=await createSoundChip('ym2612',{id:'ym2612'});added.setPreset(0,{algorithm:7,pan:{left:true,right:true},operators:[{multi:1,tl:12,ar:31,d1r:0,d2r:0,sl:0,rr:15}]});added.noteOn(0,'C4');`));
  await page.locator('#operatorTabButton').waitFor({state:'visible'});await page.click('#operatorTabButton');
  await page.waitForFunction(()=>document.querySelector('[data-opn-instance]')?.value==='ym2612');
  assert(await page.locator('#menuExport').evaluate(element=>!element.hidden),'Non-FM mode exposes exports when an additional FM connects');
  await exportSelectedFm('tfi',12,'non-fm');await exportSelectedFm('vgi',12,'non-fm');
  const nonFmStart=all().length;await page.locator('#operatorTabButton').focus();await page.keyboard.down('z');
  await until(()=>all().slice(nonFmStart).some(c=>c.type==='extra-ym2612'&&c.message.action==='on'),'Non-FM mode added YM2612 editor audition');
  await page.keyboard.up('z');await until(()=>all().slice(nonFmStart).some(c=>c.type==='extra-ym2612'&&c.message.action==='off'),'Non-FM mode added YM2612 editor release');
  await page.screenshot({path:path.join(artifacts,name+'-extra-ym2612-non-fm-mode.png')});
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  await page.locator('#operatorTabButton').waitFor({state:'hidden'});assert(await page.locator('#codePanel').isVisible(),'Removing the final extra FM returns to Code');
  assert(await page.locator('#menuExport').evaluate(element=>element.hidden),'Removing the final extra FM hides its export menu in a non-FM mode');
  await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());await assertNoLiveAudio(page);
  await fs.writeFile(path.join(artifacts,name+'-extra-ym2612.json'),JSON.stringify({mockedNative:true,deviceOpened:false,phases,calls:native.calls},null,2));
}
module.exports={installExtraYm2612Mock,runExtraYm2612};
