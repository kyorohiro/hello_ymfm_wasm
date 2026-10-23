// Native dynamic PSG regression. Only IPC is mocked; real Main/Worker clients,
// Mixer, Inspector, keyboard selectors and MessagePorts run in the browser.
// Enter directly in Native mode so no Web Audio context or worklet is created.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');

function installExtraPsgMock(native){
  const invoke=native.invoke.bind(native);
  native.extraPsg=new Map();
  const snapshot=entry=>({sampleRate:48000,frame:native.status().frame,revision:native.calls.length,
    segapsg:{...entry.states.segapsg,held:[...entry.states.segapsg.held.keys()],pendingCommands:[],sampleRate:48000}});
  native.invoke=async(command,args={})=>{
    if(command.startsWith('native_genesis_extra_psg_')){
      native.calls.push({command,args});
      assert.equal(args.session,native.current?.session,'Extra PSG must use the active Native session');
      assert(Number.isSafeInteger(args.instance)&&args.instance>0,'Extra PSG instance must be a positive safe integer');
      if(command==='native_genesis_extra_psg_create'){
        assert(!native.extraPsg.has(args.instance),'An active Native PSG instance cannot be recreated');
        assert(native.extraPsg.size+(native.extraYm2612?.size??0)<16,'Native additional rack is bounded to sixteen instances');
        const entry={instance:args.instance,states:{segapsg:{clock:3579545,periods:[0,0,0],
          attenuations:[15,15,15,15],lastVolumes:[0,0,0,0],latched:0,mode:0,
          stereo:255,stereoEnabled:true,sourceMuteMask:0,held:new Map()}},mix:{volume:1,left:1,right:1}};
        native.extraPsg.set(args.instance,entry);return snapshot(entry);
      }
      if(command==='native_genesis_extra_psg_dispose'){native.extraPsg.delete(args.instance);return null;}
      assert.equal(command,'native_genesis_extra_psg_status');
      const entry=native.extraPsg.get(args.instance);assert(entry,'Extra PSG status requires a live instance');
      return snapshot(entry);
    }
    if(command==='native_genesis_commands'){
      for(const entry of args.commands.filter(entry=>entry.type==='extra-psg')){
        const chip=native.extraPsg.get(entry.instance);assert(chip,'Extra PSG commands must reference a live Native instance');
        assert.equal(entry.message.chip,'segapsg');
        assert(Number.isSafeInteger(entry.frame)&&entry.frame>=0);
        const apply=message=>{
          if(message.method==='mix')chip.mix={...message};
          else native.applyMasterSystem(message,chip.states);
        };
        apply(entry.message);
      }
    }
    const result=await invoke(command,args);
    if(command==='native_genesis_start'||command==='native_genesis_stop'||command==='native_genesis_shutdown')native.extraPsg.clear();
    return result;
  };
}

const program=`
  if(await useSoundChip('segapsg')!==psg)throw Error('Primary PSG identity changed');
  if(psg.id!=='segapsg'||typeof psg.dispose!=='undefined')throw Error('Primary PSG ownership changed');
  const a=await createSoundChip('segapsg',{id:'extra-a'});
  const b=await createSoundChip('segapsg',{id:'extra-b'});
  if(a===b||a===psg||b===psg||!a.stereoEnabled||!b.stereoEnabled)throw Error('Additional PSGs are not independent stereo clients');
  a.tone(0,{period:173,attenuation:4});a.setStereo(0x10);await a.setClock(4000000);
  b.tone(1,{period:251,attenuation:7});b.noise({type:'white',rate:'tone3',attenuation:9});b.setStereo(0x0a);
  await mixer.set(a.id,{volume:0.4,pan:-0.5});await mixer.set(b.id,{volume:0.7,pan:0.25});
  psg.tone(0,{period:319,attenuation:11});psg.setStereo(0x81);
  liveLoop('extra-psg-browser-regression',async()=>{a.setAttenuation(0,4);await beat(0.25);});
`;

async function runExtraPsg({page,native,artifacts,name,assertNoLiveAudio,until}){
  const all=()=>native.calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]);
  const phases=[];
  const observe=async label=>{
    await assertNoLiveAudio(page);
    const state=await page.evaluate(async()=>{
      const runtime=window.__nativeBackendTest.runtime,s=runtime.megaDrive;
      return {audio:{...window.__audioConstructions},backend:s.backend,primaryId:s.psg.id,
        capabilities:s.capabilities,mixer:s.mixer.list().filter(chip=>chip.connected),
        inspected:runtime.chipInspector.list(),
        a:await runtime.chipInspector.read('extra-a'),b:await runtime.chipInspector.read('extra-b')};
    });
    assert.deepEqual(state.audio,{contexts:0,offline:0,worklets:[]},label+' must not construct Web Audio');
    assert.equal(state.backend,'native-genesis');assert.equal(state.primaryId,'segapsg');
    assert.deepEqual(state.mixer.map(chip=>chip.id).sort(),['extra-a','extra-b','segapsg','ym2612']);
    assert(state.inspected.some(chip=>chip.id==='extra-a'&&chip.kind==='segapsg'));
    assert(state.inspected.some(chip=>chip.id==='extra-b'&&chip.kind==='segapsg'));
    phases.push({label,...state});return state;
  };
  const stop=async()=>{
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    await until(()=>native.extraPsg.size===0,'Stop must retire every additional Native PSG');
    await page.waitForFunction(()=>!window.__nativeBackendTest.runtime.chipInspector.list().some(chip=>chip.id.startsWith('extra-')));
    assert.deepEqual(await page.evaluate(()=>window.__nativeBackendTest.runtime.megaDrive.mixer.list().filter(chip=>chip.connected).map(chip=>chip.id).sort()),['segapsg','ym2612']);
  };
  let session;
  for(const execution of ['main','worker']){
    const first=all().length,creates=native.count('native_genesis_extra_psg_create');
    await page.evaluate(({program,execution})=>window.__nativeBackendTest.runtime.playSource(program,{execution}),{program,execution});
    await until(()=>native.extraPsg.size===2&&all().slice(first).some(command=>command.type==='extra-psg'&&command.message.method==='mix'&&command.message.volume===.7),execution+' independent PSG initialization');
    await until(()=>all().slice(first).some(command=>command.type==='psg-stereo'&&command.value===0x81),execution+' unchanged primary transport');
    assert.equal(native.count('native_genesis_extra_psg_create')-creates,2,'Borrowing primary must not allocate an extra PSG');
    session??=native.current.session;assert.equal(native.current.session,session,'Stop/Run must reuse the Native session');
    const state=await observe(execution+'-independent-chips');
    assert.equal(state.a.channels[0].period,173);assert.equal(state.a.clock,4000000);assert.equal(state.a.stereo,0x10);
    assert.equal(state.b.channels[1].period,251);assert.equal(state.b.clock,3579545);assert.equal(state.b.stereo,0x0a);
    assert.equal(state.b.noise.type,'white');assert.equal(state.b.noise.rate,'tone3');
    const mix=id=>state.mixer.find(chip=>chip.id===id);
    assert.equal(mix('extra-a').volume,.4);assert.equal(mix('extra-a').pan,-.5);
    assert.equal(mix('extra-b').volume,.7);assert.equal(mix('extra-b').pan,.25);
    if(execution==='worker'){
      await until(()=>all().slice(first).some(command=>command.type==='extra-psg'&&command.frame>0&&command.performance&&command.owner),'Worker extra PSG timing and ownership');
    }
    const before=all().length;
    await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.invoke('extra-a','setAttenuation',[0,6]));
    await until(()=>all().slice(before).some(command=>command.type==='extra-psg'&&command.message.method==='batch'),'Additional PSG inspector edit');
    assert.equal((await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('extra-b'))).channels[1].period,251,'Editing A must not change B');
    await page.click('#keyboardTab');
    await page.locator('#playgroundKeyboardChip option[value="chip:extra-b"]').waitFor({state:'attached'});
    await page.selectOption('#playgroundKeyboardChip','chip:extra-b');await page.selectOption('#playgroundKeyboardTargetChannel','1');
    await page.locator('#keyboardTab').focus();const keyboardStart=all().length;
    await page.keyboard.down('z');
    await until(()=>all().slice(keyboardStart).some(command=>command.type==='extra-psg'&&command.message.action==='on'&&command.message.channel===1),'Additional PSG PC keyboard');
    await page.keyboard.up('z');
    await until(()=>all().slice(keyboardStart).some(command=>command.type==='extra-psg'&&command.message.action==='off'),'Additional PSG PC keyboard release');
    await page.click('#mixerTab');await page.locator('#mixerPanel [data-chip-id="extra-a"]').waitFor({state:'visible'});
    await page.screenshot({path:path.join(artifacts,name+'-extra-psg-'+execution+'.png')});
    await stop();
  }
  for(const execution of ['main','worker']){
    const first=native.calls.length;
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`
      const old=await createSoundChip('segapsg',{id:'extra-a'});old.tone(0,{period:111,attenuation:3});old.dispose();
      const replacement=await createSoundChip('segapsg',{id:'extra-a'});replacement.tone(0,{period:333,attenuation:6});replacement.setStereo(0x88);
      const b=await createSoundChip('segapsg',{id:'extra-b'});b.tone(1,{period:257,attenuation:8});
    `,{execution}),execution);
    await until(()=>native.extraPsg.size===2&&[...native.extraPsg.values()].some(entry=>entry.states.segapsg.periods[0]===333),execution+' fixed-id replacement');
    const calls=native.calls.slice(first),created=calls.filter(call=>call.command==='native_genesis_extra_psg_create').map(call=>call.args.instance);
    assert.equal(created.length,3);assert.equal(new Set(created).size,3,'A reused Mixer id must receive a fresh Native instance');
    assert(calls.some(call=>call.command==='native_genesis_extra_psg_dispose'&&call.args.instance===created[0]));
    const state=await observe(execution+'-fixed-id-replacement');assert.equal(state.a.channels[0].period,333);assert.equal(state.a.stereo,0x88);
    assert.equal(state.b.channels[1].period,257);await stop();
  }
  await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
  assert.equal(native.extraPsg.size,0);await assertNoLiveAudio(page);
  await fs.writeFile(path.join(artifacts,name+'-extra-psg.json'),JSON.stringify({mockedNative:true,deviceOpened:false,
    browser:name,phases,calls:native.calls},null,2));
}
module.exports={installExtraPsgMock,runExtraPsg};
