// Real Main / logic Worker / editor; Native IPC only is mocked, no output device.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {extraChipCount}=require('./native_backend_extra_limits.cjs');
const olderKinds=['segapsg','ym2612','ym2203','ym2608','ym2610','ym2151','ym2413','ay8910','ym3526','ym3812','y8950','ymf262','rf5c164','okim6258','gameboy','nes','huc6280'];

function installExtraDx7Mock(native){
  const invoke=native.invoke.bind(native);native.extraDx7=new Map();
  async function fresh(){
    const {createInitVoice}=await import('../web/msfa_dx7/src/sysex.js');
    return {voices:[Array.from(createInitVoice())],selectedVoice:0,revision:0,notes:new Map(),held:new Map(),mix:{volume:1,pan:0}};
  }
  const snapshot=s=>({sampleRate:48000,frame:native.status().frame,revision:native.calls.length,dx7:{
    voices:s.voices.map(v=>v.slice()),selectedVoice:s.selectedVoice,activeNotes:[...s.notes].map(([midi,n])=>({midi,velocity:n.velocity})),
    held:[...s.held.keys()],pendingCommands:[],
  }});
  const validVoice=v=>assert(Array.isArray(v)&&v.length===155&&v.every(n=>Number.isInteger(n)&&n>=0&&n<=127));
  function apply(s,m,c){
    if(['load-bank','set-preset','edit-voice','select-voice'].includes(m.method)){
      if(s.held.size&&!m.audition)throw Error('Release the manually held additional DX7 voices before changing the voice');
      if(m.method==='load-bank'){assert(m.voices.length&&m.voices.length<=32);m.voices.forEach(validVoice);s.voices=m.voices.map(v=>v.slice());s.selectedVoice=0;}
      if(m.method==='set-preset'){validVoice(m.voice);if(m.indices)for(const i of m.indices)s.voices[s.selectedVoice][i]=m.voice[i];else s.voices[s.selectedVoice]=m.voice.slice();}
      if(m.method==='edit-voice'){validVoice(m.voice);for(const i of m.indices)s.voices[s.selectedVoice][i]=m.voice[i];}
      if(m.method==='select-voice'){assert(Number.isInteger(m.index)&&m.index>=0&&m.index<s.voices.length);s.selectedVoice=m.index;}
      s.revision++;
    }else if(m.method==='note-on'){
      if(s.held.has(m.note)&&!m.audition)return;
      if(s.held.size===16&&!m.audition)return;
      s.notes.set(m.note,{voice:m.voice,velocity:m.velocity,group:m.group,performance:c.performance,owner:c.owner,audition:!!m.audition});
      if(m.audition)s.held.set(m.note,m.voice);
    }else if(m.method==='note-off'){
      const n=s.notes.get(m.note);if(!n||m.voice!==undefined&&n.voice!==m.voice||s.held.has(m.note)&&!m.audition)return;
      s.notes.delete(m.note);if(s.held.get(m.note)===n.voice)s.held.delete(m.note);
    }else if(['all-notes-off','panic'].includes(m.method)){
      for(const[note,n]of s.notes)if((!n.audition||m.audition)&&(m.group===undefined||n.group===m.group)&&(c.owner===undefined||n.owner===c.owner)){s.notes.delete(note);s.held.delete(note);}
    }else if(m.method==='cancel-main-owner'){
      for(const[note,n]of s.notes)if(!n.audition&&n.group===m.targetGroup)s.notes.delete(note);
    }else if(m.method==='mix')s.mix={volume:m.volume,pan:m.pan};
    else assert.equal(m.method,'barrier','Unknown additional DX7 operation '+m.method);
  }
  native.invoke=async(command,args={})=>{
    const match=/^native_genesis_extra_dx7_(create|status|dispose)$/.exec(command);
    if(match){
      native.calls.push({command,args});assert.equal(args.session,native.current?.session);assert(Number.isSafeInteger(args.instance)&&args.instance>0);
      const map=native.extraDx7;
      if(match[1]==='create'){assert(extraChipCount(native)<16);assert(!map.has(args.instance));const s=await fresh();map.set(args.instance,s);return snapshot(s);}
      if(match[1]==='dispose'){map.delete(args.instance);return null;}
      const s=map.get(args.instance);assert(s);return snapshot(s);
    }
    if(command==='native_genesis_commands')for(const c of args.commands)if(c.type==='extra-dx7'){const s=native.extraDx7.get(c.instance);assert(s);apply(s,c.message,c);}
    const value=await invoke(command,args);
    if(['native_genesis_start','native_genesis_stop','native_genesis_shutdown'].includes(command))native.extraDx7.clear();return value;
  };
}
async function runExtraDx7({page,native,artifacts,name,until,assertNoLiveAudio,changeMode}){
  const {createInitVoice,createBankSysex}=await import('../web/msfa_dx7/src/sysex.js');
  const {voiceToPreset}=await import('../web/msfa_dx7/src/preset.js');
  const bank=Array.from(createBankSysex(Array.from({length:32},(_,i)=>createInitVoice('BANK '+String(i).padStart(2,'0')))));
  const program=`
    const a=await createSoundChip('dx7',{id:'keys-a'}),b=await createSoundChip('dx7',{id:'keys-b'});
    await a.loadSysex(new Uint8Array(${JSON.stringify(bank)}));a.selectVoice(31);
    await a.setPreset({name:'KEYS A',algorithm:14,feedback:1,operators:{1:{coarse:2,outputLevel:88}}});
    await b.setPreset({name:'KEYS B',algorithm:31,feedback:2,operators:{1:{coarse:1,outputLevel:70}}});
    await a.setOperator(1,{fine:17});await a.setOperators([[2,{coarse:3}],[6,{outputLevel:50}]]);await a.setFeedback(5);
    let invalid=false;try{await a.loadSysex(new Uint8Array([0xf0,0x43,0xf7]));}catch{invalid=true;}
    if(!invalid||a.voices.length!==32||a.selectedVoice!==31||b.voices.length!==1)throw Error('DX7 bank state changed unexpectedly');
    a.noteOn(48,85);b.noteOn(55,75);
    for(const kind of ${JSON.stringify(olderKinds.filter(k=>!['gameboy','nes','huc6280'].includes(k)))})await createSoundChip(kind,{id:'base-'+kind});
    await mixer.set(a.id,{volume:.4,pan:-.3});await mixer.set(b.id,{volume:.7,pan:.2});
    liveLoop('extra-keys',async()=>{a.noteOn(64,90);await beat(.25);a.noteOff(64);await beat(.25);});log('dx7-ready');
  `;
  const all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]),phases=[];
  const stop=async()=>{await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());await until(()=>extraChipCount(native)===0,'Additional DX7 and mixed rack retire');};
  const field=async(control,value)=>page.locator(`#dx7Panel [data-chip-control="dx7-${control}"]`).evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('change',{bubbles:true}));},value);
  async function keyboard(tab='keyboardTab'){
    const before=all().length;await page.locator('#'+tab).focus();await page.keyboard.down('z');
    try{await until(()=>all().slice(before).some(c=>c.type==='extra-dx7'&&c.message.method==='note-on'&&c.message.audition),'DX7 Keyboard ON');}finally{await page.keyboard.up('z');}
    await until(()=>all().slice(before).some(c=>c.type==='extra-dx7'&&c.message.method==='note-off'&&c.message.audition),'DX7 Keyboard OFF');
  }
  for(const execution of ['main','worker']){
    const before=all().length;await page.evaluate(({program,execution})=>window.__nativeBackendTest.runtime.playSource(program,{execution}),{program,execution});
    await until(()=>extraChipCount(native)===16&&native.extraDx7.size===2&&all().slice(before).some(c=>c.type==='extra-dx7'&&c.message.method==='mix'&&c.message.volume===.7),'Independent DX7 bank and mixed sixteen-slot rack');
    const states=[...native.extraDx7.values()],snapshot=await page.evaluate(async()=>({a:await window.__nativeBackendTest.runtime.chipInspector.read('keys-a'),b:await window.__nativeBackendTest.runtime.chipInspector.read('keys-b'),mixer:window.__nativeBackendTest.runtime.megaDrive.mixer.list().filter(c=>c.connected),audio:window.__audioConstructions}));
    assert.deepEqual(snapshot.audio,{contexts:0,offline:0,worklets:[]});assert.equal(snapshot.mixer.length,18);
    assert.equal(snapshot.a.voices.length,32);assert.equal(snapshot.a.selectedVoice,31);assert.equal(snapshot.b.voices.length,1);assert.equal(snapshot.b.selectedVoice,0);
    assert.equal(snapshot.a.preset.name,'KEYS A');assert.equal(snapshot.a.preset.feedback,5);assert.equal(snapshot.b.preset.feedback,2);assert.equal(snapshot.a.preset.operators[1].fine,17);assert.equal(snapshot.a.preset.operators[2].coarse,3);assert.equal(snapshot.a.preset.operators[6].outputLevel,50);
    if(execution==='worker')await until(()=>all().slice(before).some(c=>c.type==='extra-dx7'&&c.frame>0&&c.performance&&c.owner),'Worker DX7 loop timing');
    await page.click('#consoleTab');await page.locator('#dx7Tab').waitFor({state:'visible'});await page.click('#dx7Tab');await page.selectOption('#dx7Panel [data-chip-control="instance"]','keys-a');
    await field('feedback',6);await field('op-fine',23);await until(()=>{const p=voiceToPreset(Uint8Array.from(states[0].voices[31]));return p.feedback===6&&p.operators[1].fine===23;},'DX7 Operator panel edits');assert.equal(voiceToPreset(Uint8Array.from(states[1].voices[0])).feedback,2);
    await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.invoke('keys-a','auditionOn',[0,72,'held-editor',100]));
    await page.locator('#dx7Panel [data-chip-operator="6"]').click();await field('op-output-level',44);await until(()=>voiceToPreset(Uint8Array.from(states[0].voices[31])).operators[6].outputLevel===44,'DX7 held operator live edit');assert(states[0].held.has(72));assert.equal(voiceToPreset(Uint8Array.from(states[1].voices[0])).operators[6].outputLevel,0);
    await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.invoke('keys-a','auditionOff',[0,'held-editor']));
    await keyboard('dx7Tab');await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:keys-a');await page.selectOption('#playgroundKeyboardTargetChannel','0');await keyboard();
    await page.selectOption('#playgroundKeyboardChip','chip:keys-b');await keyboard();
    await page.click('#consoleTab');await page.click('#dx7Tab');await page.selectOption('#dx7Panel [data-chip-control="instance"]','keys-b');
    await field('algorithm',3);await until(()=>voiceToPreset(Uint8Array.from(states[1].voices[0])).algorithm===3,'Other DX7 algorithm editor');assert.equal(voiceToPreset(Uint8Array.from(states[0].voices[31])).algorithm,14);
    await page.selectOption('#dx7Panel [data-chip-control="instance"]','keys-a');
    const consoleText=await page.locator('#consoleOutput').innerText();assert.match(consoleText,/dx7-ready/);assert.doesNotMatch(consoleText,/\b(?:Error|TypeError|RangeError|ReferenceError):/,'No caught playback error in real Console');
    await page.screenshot({path:path.join(artifacts,`${name}-extra-dx7-${execution}.png`)});phases.push({execution,a:snapshot.a,b:snapshot.b});await stop();await page.locator('#dx7Tab').waitFor({state:'hidden'});
  }
  // Eighteen supported kinds across two legal sixteen-slot combinations.
  for(const [execution,omit]of [['main',['gameboy','nes']],['worker',['segapsg','huc6280']]]){
    await page.evaluate(({execution,kinds})=>window.__nativeBackendTest.runtime.playSource(`const d=await createSoundChip('dx7',{id:'full-dx7'});d.noteOn(60);for(const kind of ${JSON.stringify(kinds)})await createSoundChip(kind,{id:'kind-'+kind});log('eighteen-kinds-covered');`,{execution}),{execution,kinds:olderKinds.filter(k=>!omit.includes(k))});
    await until(()=>extraChipCount(native)===16&&native.extraDx7.size===1,'Eighteen kinds in legal mixed racks');await stop();
  }
  for(const execution of ['main','worker']){
    const before=native.calls.length;
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`const old=await createSoundChip('dx7',{id:'fixed-dx7'});await old.setPreset({name:'OLD BANK',feedback:7});old.noteOn(60);old.dispose();const next=await createSoundChip('dx7',{id:'fixed-dx7'});await next.setPreset({name:'NEW BANK',feedback:1});next.noteOn(64);`,{execution}),execution);
    await until(()=>native.extraDx7.size===1&&voiceToPreset(Uint8Array.from([...native.extraDx7.values()][0].voices[0])).name==='NEW BANK','DX7 same-ID replacement');
    const s=[...native.extraDx7.values()][0];assert.equal(s.voices.length,1);assert.equal(voiceToPreset(Uint8Array.from(s.voices[0])).feedback,1);assert(s.notes.has(64));
    const ids=native.calls.slice(before).filter(c=>c.command==='native_genesis_extra_dx7_create').map(c=>c.args.instance);assert.equal(ids.length,2);assert(ids[1]>ids[0]);await stop();
  }
  await changeMode(page,native,'dx7','keep');
  for(const execution of ['main','worker']){
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`if(await useSoundChip('dx7')!==dx7||dx7!==await useSoundChip('dx7'))throw Error('Primary DX7 cache');const extra=await createSoundChip('dx7',{id:'side-dx7'});if(extra===dx7)throw Error('Additional DX7 borrowed primary');await extra.setPreset({name:'SIDE DX7',feedback:3});extra.noteOn(60);`,{execution}),execution);
    await until(()=>native.extraDx7.size===1&&voiceToPreset(Uint8Array.from([...native.extraDx7.values()][0].voices[0])).name==='SIDE DX7','Independent DX7 beside primary');assert.notEqual(voiceToPreset(Uint8Array.from(native.dx7.voices[0])).name,'SIDE DX7');
    await page.click('#consoleTab');await page.click('#dx7Tab');await page.waitForFunction(()=>document.querySelector('#dx7Panel [data-chip-control="instance"]')?.options.length===2);await stop();await page.locator('#dx7Tab').waitFor({state:'visible'});
  }
  assert.deepEqual(native.dx7WasmRequests,[],'Native additional DX7 must not fetch WASM');await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
  await fs.writeFile(path.join(artifacts,name+'-extra-dx7.json'),JSON.stringify({mockedNative:true,deviceOpened:false,phases,calls:native.calls},null,2));
}
module.exports={installExtraDx7Mock,runExtraDx7};
