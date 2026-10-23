// Real Main / logic Worker / UI. Only Native IPC is mocked; no DSP/device rendering.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {extraChipCount}=require('./native_backend_extra_limits.cjs');
const olderKinds=['segapsg','ym2612','ym2203','ym2608','ym2610','ym2151','ym2413','ay8910','ym3526','ym3812','y8950','ymf262','rf5c164','okim6258','gameboy','nes','huc6280','dx7','pwm'];
function installExtraSnesMock(native){
  const invoke=native.invoke.bind(native);native.extraSnes=new Map();
  const empty=(generation=0)=>({loaded:false,playing:false,positionFrames:0,totalFrames:0,ended:false,generation,playCommandId:0});
  const fresh=()=>({registers:new Uint8Array(128),ram:new Uint8Array(65536),enabled:0,nativeFrames:0,revision:0,held:new Map(),owners:Array(8).fill(null),captures:new Map(),timeline:empty(),timelineOwner:null,mix:{volume:1,pan:0}});
  function advance(s){if(!s.timeline.playing)return;s.timeline.positionFrames=Math.min(s.timeline.totalFrames,Math.floor((performance.now()-s.began)*32));s.nativeFrames=s.timeline.positionFrames;if(s.timeline.positionFrames===s.timeline.totalFrames){s.timeline.playing=false;s.timeline.ended=true;}}
  function data(s,ram=false){advance(s);return {clock:1024000,frame:native.status().frame,revision:s.revision,registers:Array.from(s.registers),...(ram?{ram:Array.from(s.ram)}:{}),enabled:s.enabled,nativeFrames:s.nativeFrames,held:[...s.held.keys()],pendingCommands:[],timeline:{...s.timeline}};}
  const snapshot=(s,args={})=>{const snes=s.captures.get(args.after)??data(s,!!args.ram);return {sampleRate:48000,frame:snes.frame,revision:snes.revision,snes};};
  const owner=(m,c)=>m.group!==undefined?`main:${m.group}`:c.performance!==undefined?`worker:${c.performance}:${c.owner}`:null;
  function off(s,ch){s.enabled&=~(1<<ch);s.registers[0x4c]&=~(1<<ch);s.registers[0x5c]|=1<<ch;s.owners[ch]=null;}
  function uploads(s,list){for(const u of list){const address=u.address??u.offset;assert(Number.isInteger(address)&&address>=0&&address+u.data.length<=65536);s.ram.set(u.data,address);}}
  function apply(s,m,c={}){
    advance(s);s.revision++;const who=owner(m,c),mask=[...s.held.keys()].reduce((mask,ch)=>mask|(1<<ch),0);
    if(m.method==='batch'){
      assert(Number.isInteger(m.channel)&&m.channel>=0&&m.channel<8);
      if(m.audition&&m.action==='off'&&s.held.get(m.channel)!==m.voice)return;
      if(m.audition&&m.action==='on')s.held.set(m.channel,m.voice);
      for(const op of m.commands)apply(s,{...op,group:m.group,audition:m.audition},c);
      if(m.audition&&m.action==='off')s.held.delete(m.channel);
    }else if(m.method==='write'){
      const r=m.register,v=m.value;
      if(!m.audition&&r<128&&(r&15)<8&&s.held.has(r>>4))return;
      if(r===0x4c){const bits=m.audition?v:v&~mask;s.registers[r]=(s.registers[r]&mask)|bits;s.enabled|=bits;for(let ch=0;ch<8;ch++)if(bits&(1<<ch))s.owners[ch]=who;}
      else if(r===0x5c){const bits=m.audition?v:v&~mask;s.registers[r]=(v&~mask)|(s.registers[r]&mask);for(let ch=0;ch<8;ch++)if(bits&(1<<ch))off(s,ch);}
      else s.registers[r]=v;
    }else if(m.method==='key-on'){
      if(s.held.has(m.channel)&&!m.audition)return;s.enabled|=1<<m.channel;s.registers[0x5c]&=~(1<<m.channel);s.registers[0x4c]|=1<<m.channel;s.owners[m.channel]=who;
    }else if(m.method==='key-off'){
      if(s.held.has(m.channel)&&!m.audition)return;if(who!==null&&s.owners[m.channel]!==null&&s.owners[m.channel]!==who&&!m.audition)return;off(s,m.channel);
    }else if(m.method==='load-memory')uploads(s,[m]);
    else if(m.method==='load-memory-batch'){if(s.held.size&&!m.audition)throw Error('Release the manually held additional SNES voices before replacing sample memory');uploads(s,m.uploads);}
    else if(m.method==='reset-state'||m.method==='reset'){
      if(s.held.size&&!m.audition)throw Error('Release the manually held additional SNES voices before replacing the DSP state');s.registers.fill(0);s.ram.fill(0);s.enabled=0;s.nativeFrames=0;s.held.clear();s.owners.fill(null);s.timeline=empty(s.timeline.generation+1);s.timelineOwner=null;
      if(m.dsp)s.registers.set(m.dsp);if(m.uploads)uploads(s,m.uploads);
    }else if(m.method==='prepare-timeline'){
      if(s.held.size)throw Error('Release held SNES voices before replacing timeline');s.ram.set(m.ram);s.registers.set(m.dsp);s.nativeFrames=0;s.enabled=0;
      s.timeline={loaded:true,playing:false,positionFrames:0,totalFrames:Math.ceil(m.durationClocks/32),ended:false,generation:s.timeline.generation+1,playCommandId:0};s.timelineOwner=who;
    }else if(m.method==='play-timeline'){assert(s.timeline.loaded);s.timeline.positionFrames=0;s.timeline.ended=false;s.timeline.playing=true;s.timeline.generation++;s.timeline.playCommandId=m.id??0;s.began=performance.now();s.timelineOwner=who;}
    else if(m.method==='stop-timeline'){s.timeline.playing=false;s.timeline.generation++;s.timeline.playCommandId=0;}
    else if(m.method==='stop-voices'){for(let ch=0;ch<8;ch++)if(!s.held.has(ch)&&(who===null||s.owners[ch]===who))off(s,ch);if(who===null||who===s.timelineOwner)s.timeline.playing=false;}
    else if(m.method==='cancel-main-owner'){const target=`main:${m.targetGroup}`;for(let ch=0;ch<8;ch++)if(s.owners[ch]===target&&!s.held.has(ch))off(s,ch);if(s.timelineOwner===target)s.timeline.playing=false;}
    else if(m.method==='mix')s.mix={volume:m.volume,pan:m.pan};
    else if(m.method==='barrier'){if(m.ram)s.captures.set(m.id,data(s,true));}
    else assert.fail('Unknown additional SNES operation '+m.method);
  }
  native.invoke=async(command,args={})=>{
    const match=/^native_genesis_extra_snes_(create|status|dispose)$/.exec(command);
    if(match){native.calls.push({command,args});assert.equal(args.session,native.current?.session);assert(Number.isSafeInteger(args.instance)&&args.instance>0);
      if(match[1]==='create'){assert(extraChipCount(native)<16);assert(!native.extraSnes.has(args.instance));const s=fresh();native.extraSnes.set(args.instance,s);return snapshot(s,args);}
      if(match[1]==='dispose'){native.extraSnes.delete(args.instance);return null;}
      const s=native.extraSnes.get(args.instance);assert(s);return snapshot(s,args);
    }
    if(command==='native_genesis_commands')for(const c of args.commands)if(c.type==='extra-snes'){const s=native.extraSnes.get(c.instance);assert(s);apply(s,c.message,c);}
    if(command==='native_genesis_performance'&&['cancel-owner','stop'].includes(args.op))for(const s of native.extraSnes.values()){
      const prefix=`worker:${args.performance}:`;for(let ch=0;ch<8;ch++)if(s.owners[ch]?.startsWith(prefix)&&(args.op==='stop'||s.owners[ch]===prefix+args.owner)&&!s.held.has(ch))off(s,ch);
      if(s.timelineOwner?.startsWith(prefix)&&(args.op==='stop'||s.timelineOwner===prefix+args.owner))s.timeline.playing=false;
    }
    const result=await invoke(command,args);if(['native_genesis_start','native_genesis_stop','native_genesis_shutdown'].includes(command))native.extraSnes.clear();return result;
  };
}
const brrA=[0xb3,0x12,0x34,0x56,0x78,0x9a,0xbc,0xde,0xf0],brrB=[0xa3,0x76,0x54,0x32,0x10,0xfe,0xdc,0xba,0x98];
const program=`
  const a=await createSoundChip('snes',{id:'snes-a'}),b=await createSoundChip('snes',{id:'snes-b'});
  const sa=await a.loadBRR(new Uint8Array(${JSON.stringify(brrA)}),{baseFrequencyHz:2000,loopStartSamples:0});
  const sb=await b.loadBRR(new Uint8Array(${JSON.stringify(brrB)}),{rootNote:'C4',loopStartSamples:0});
  for(let ch=0;ch<8;ch++){await a.setPreset(ch,{sample:sa,adsr1:0,adsr2:0,gain:100,volumeLeft:80,volumeRight:90});await b.setPreset(ch,{sample:sb,gain:70,volumeLeft:55,volumeRight:65});}
  await a.noteOn(1,'E4');await b.noteOn(7,'G4');
  const snap=await a.snapshot();if(snap.ram.length!==65536||snap.dsp.length!==128)throw Error('Incomplete SNES snapshot');
  for(const kind of ${JSON.stringify(olderKinds.filter(k=>!['gameboy','nes','huc6280','dx7','pwm'].includes(k)))})await createSoundChip(kind,{id:'base-'+kind});
  await mixer.set(a.id,{volume:.4,pan:-.3});await mixer.set(b.id,{volume:.7,pan:.2});
  liveLoop('snes-line',async()=>{await a.noteOn(2,'C4');await beat(.1);await a.noteOff(2);await beat(.1);});
  log('snes-ready');
`;
async function runExtraSnes({page,native,artifacts,name,until,assertNoLiveAudio,changeMode}){
  const all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]),phases=[];
  const stop=async()=>{await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());await until(()=>extraChipCount(native)===0,'All additional SNES instances retire');};
  const number=(key,value)=>page.locator(`#snesPanel [data-chip-control="snes-${key}"]`).evaluate((n,v)=>{n.value=String(v);n.dispatchEvent(new Event('change',{bubbles:true}));},value);
  async function keyboard(channel,tab='keyboardTab',type='extra-snes'){
    const before=all().length;await page.locator('#'+tab).focus();await page.keyboard.down('z');
    try{await until(()=>all().slice(before).some(c=>c.type===type&&c.message.action==='on'&&c.message.channel===channel),'SNES Keyboard on '+channel);}
    catch(error){error.message+='\n'+JSON.stringify({console:await page.locator('#consoleOutput').innerText(),recent:all().slice(before).map(c=>({type:c.type,method:c.message?.method,action:c.message?.action,channel:c.message?.channel})).slice(-10),status:await page.evaluate(()=>({selection:window.__nativeBackendTest.editorSelection,routes:window.__nativeBackendTest.routes.chips.filter(c=>c.kind==='snes').map(c=>({id:c.id,endpointId:c.endpointId,disabled:c.disabled,channels:c.channels})),status:document.getElementById('status')?.textContent,tab:document.getElementById('snesTab')?.getAttribute('aria-selected'),panelHidden:document.getElementById('snesPanel')?.hidden,target:document.getElementById('playgroundKeyboardEditorTarget')?.textContent,targetHidden:document.getElementById('playgroundKeyboardEditorTarget')?.hidden,keyboardHidden:document.getElementById('keyboardPanel')?.hidden}))});throw error;}
    finally{await page.keyboard.up('z');}
    try{await until(()=>all().slice(before).some(c=>c.type===type&&c.message.action==='off'&&c.message.channel===channel),'SNES Keyboard off '+channel);}
    catch(error){error.message+='\n'+JSON.stringify({console:await page.locator('#consoleOutput').innerText(),held:[...native.extraSnes.values()].map(s=>[...s.held]),recent:all().slice(before).filter(c=>c.type==='extra-snes').slice(-8).map(c=>({method:c.message.method,action:c.message.action,channel:c.message.channel,voice:c.message.voice}))});throw error;}
  }
  for(const execution of ['main','worker']){
    const before=all().length;await page.evaluate(({program,execution})=>window.__nativeBackendTest.runtime.playSource(program,{execution}),{program,execution});
    await until(()=>extraChipCount(native)===16&&native.extraSnes.size===2&&[...native.extraSnes.values()][1].mix.volume===.7,'Independent SNES and mixed sixteen-slot rack');
    const states=[...native.extraSnes.values()],snapshot=await page.evaluate(async()=>({a:await window.__nativeBackendTest.runtime.chipInspector.read('snes-a'),b:await window.__nativeBackendTest.runtime.chipInspector.read('snes-b'),mixer:window.__nativeBackendTest.runtime.megaDrive.mixer.list().filter(c=>c.connected),audio:window.__audioConstructions}));
    assert.deepEqual(snapshot.audio,{contexts:0,offline:0,worklets:[]});assert.equal(snapshot.mixer.length,18);assert.equal(snapshot.a.channels.length,8);assert.equal(snapshot.a.samples[0].rootFrequencyHz,2000);assert.equal(snapshot.a.channels[0].gain,100);assert.equal(snapshot.b.channels[0].gain,70);
    assert.deepEqual(snapshot.a.channels.map(c=>c.sample),Array(8).fill(0),execution+' assigned all SNES A voices');assert.deepEqual(snapshot.b.channels.map(c=>c.sample),Array(8).fill(0),execution+' assigned all SNES B voices');
    assert.equal(states[0].ram[1024],brrA[0]);assert.equal(states[1].ram[1024],brrB[0]);assert.equal(states[0].ram[1],4);
    if(execution==='worker')await until(()=>all().slice(before).some(c=>c.type==='extra-snes'&&c.frame>0&&c.performance&&c.owner),'Worker SNES timing and owner');
    await page.click('#consoleTab');await page.locator('#snesTab').waitFor({state:'visible'});await page.click('#snesTab');await page.selectOption('#snesPanel [data-chip-control="instance"]','snes-a');
    await number('gain',73);await until(()=>states[0].registers[7]===73,'SNES voice gain edit');assert.equal(states[1].registers[7],70);
    await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:snes-a');
    for(let ch=0;ch<8;ch++){await page.selectOption('#playgroundKeyboardTargetChannel',String(ch));await keyboard(ch);}
    await page.selectOption('#playgroundKeyboardChip','chip:snes-b');await page.selectOption('#playgroundKeyboardTargetChannel','7');await keyboard(7);
    await page.click('#consoleTab');await page.click('#snesTab');await page.selectOption('#snesPanel [data-chip-control="instance"]','snes-a');
    await page.locator('#snesPanel [data-chip-channel="0"]').click();await keyboard(0,'snesTab');
    const hold=page.locator('#snesPanel [data-chip-action="snes-hold"]');await hold.dispatchEvent('pointerdown',{button:0,pointerId:1});
    try{await until(()=>states[0].held.has(0),'Held SNES audition');await number('volume-left',61);await until(()=>states[0].registers[0]===61,'Held SNES parameter edit');assert(states[0].held.has(0));}finally{await hold.dispatchEvent('pointerup',{pointerId:1});}
    await until(()=>!states[0].held.has(0),'Held SNES release');assert.equal(states[1].registers[0],55);
    const text=await page.locator('#consoleOutput').innerText();assert.match(text,/snes-ready/);assert.doesNotMatch(text,/\b(?:Error|TypeError|RangeError|ReferenceError):/);
    await page.screenshot({path:path.join(artifacts,`${name}-extra-snes-${execution}.png`)});phases.push({execution,a:snapshot.a,b:snapshot.b});await stop();await page.locator('#snesTab').waitFor({state:'hidden'});
  }
  for(const [execution,omit]of [['main',['gameboy','nes','huc6280','dx7']],['worker',['segapsg','ym2612','ym2203','ym2608']]]){
    await page.evaluate(({execution,kinds})=>window.__nativeBackendTest.runtime.playSource(`await createSoundChip('snes',{id:'full-snes'});for(const kind of ${JSON.stringify(kinds)})await createSoundChip(kind,{id:'kind-'+kind});log('twenty-kinds-covered');`,{execution}),{execution,kinds:olderKinds.filter(k=>!omit.includes(k))});
    await until(()=>extraChipCount(native)===16&&native.extraSnes.size===1,'Twenty kinds in legal mixed racks');await stop();
  }
  for(const execution of ['main','worker']){
    await page.evaluate(({execution,brrA})=>window.__nativeBackendTest.runtime.playSource(`const s=await createSoundChip('snes',{id:'timeline'});await s.loadBRR(new Uint8Array(${JSON.stringify(brrA)}),{rootNote:'C4',loopStartSamples:0});const initial=await s.snapshot();await s.prepareTimeline({version:1,clockRate:1024000,durationClocks:32000,initialState:{ram:initial.ram,dsp:initial.dsp,outputDelayFrames:4},events:new Uint32Array([0,0,0x5c,0,0,0,0x4c,1])});await s.playTimeline();if(!(await s.getTimelineState()).ended)throw Error('Missing timeline completion');await s.reset();if((await s.getState()).samples.length!==1||(await s.snapshot()).ram[1024]!==${brrA[0]})throw Error('Reset lost authored BRR');log('snes-timeline-ended');`,{execution}),{execution,brrA});
    await page.waitForFunction(()=>document.getElementById('consoleOutput').textContent.includes('snes-timeline-ended'));await stop();
    const before=native.calls.length;await page.evaluate(({execution,brrA})=>window.__nativeBackendTest.runtime.playSource(`const old=await createSoundChip('snes',{id:'fixed-snes'});await old.loadBRR(new Uint8Array(${JSON.stringify(brrA)}),{rootNote:'C4',loopStartSamples:0});old.dispose();const next=await createSoundChip('snes',{id:'fixed-snes'});if((await next.getState()).samples.length||(await next.snapshot()).ram[1024])throw Error('SNES replacement retained sample RAM');log('snes-replaced');`,{execution}),{execution,brrA});
    await page.waitForFunction(()=>document.getElementById('consoleOutput').textContent.includes('snes-replaced'));assert.equal(native.extraSnes.size,1);
    const ids=native.calls.slice(before).filter(c=>c.command==='native_genesis_extra_snes_create').map(c=>c.args.instance);assert.equal(ids.length,2);assert(ids[1]>ids[0]);await stop();
  }
  await changeMode(page,native,'snes','keep');
  for(const execution of ['main','worker']){
    await page.evaluate(({execution,brrA,brrB})=>window.__nativeBackendTest.runtime.playSource(`const primary=await useSoundChip('snes');if(primary!==snes||primary!==await useSoundChip('snes'))throw Error('SNES primary cache');await primary.loadBRR(new Uint8Array(${JSON.stringify(brrA)}),{rootNote:'C4',loopStartSamples:0});primary.setPreset(0,{sample:0,gain:100});const extra=await createSoundChip('snes',{id:'side-snes'});if(extra===primary)throw Error('Additional SNES borrowed primary');await extra.loadBRR(new Uint8Array(${JSON.stringify(brrB)}),{rootNote:'C4',loopStartSamples:0});log('snes-primary-extra');`,{execution}),{execution,brrA,brrB});
    await until(()=>native.extraSnes.size===1&&[...native.extraSnes.values()][0].ram[1024]===brrB[0],'Independent SNES beside primary');assert.equal(native.snes.ram[1024],brrA[0]);
    await page.click('#consoleTab');await page.click('#snesTab');await page.waitForFunction(()=>document.querySelector('#snesPanel [data-chip-control="instance"]')?.options.length===2);await page.selectOption('#snesPanel [data-chip-control="instance"]','snes');await number('gain',66);await until(()=>native.snes.registers[7]===66,'Primary SNES parameter edit');await keyboard(0,'snesTab','snes');await stop();await page.locator('#snesTab').waitFor({state:'visible'});
  }
  await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
  await fs.writeFile(path.join(artifacts,name+'-extra-snes.json'),JSON.stringify({mockedNative:true,deviceOpened:false,phases,calls:native.calls},null,2));
}
module.exports={installExtraSnesMock,runExtraSnes};
