// Actual chip-tab and common Sample Editor UI. Native's IPC boundary is mocked;
// Web cases use the real Worklet/WASM. No physical microphone is opened.
const assert=require('node:assert/strict');
const path=require('node:path');

function waveFile(){
  const rate=16000,frames=6400,bytes=Buffer.alloc(44+frames*2);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(frames*2,40);
  for(let i=0;i<frames;i++)bytes.writeInt16LE(Math.round(Math.sin(2*Math.PI*440*i/rate)*.15*32767),44+i*2);
  return bytes;
}

async function runY8950AdpcmPanel({page,native,tracker,backend,execution,additional,name,artifacts}){
  const id=additional?'panel-adpcm':'y8950',label=`${name}/${backend}/${execution}/${additional?'additional':'primary'}`;
  const report={additional,label};
  const source=`
    const chip=await ${additional?"createSoundChip('y8950',{id:'panel-adpcm'})":"useSoundChip('y8950')"};
    const pcm=Float32Array.from({length:1600},(_,i)=>.2*Math.sin(2*Math.PI*330*i/8000));
    await chip.adpcm.loadSample({channels:[pcm],sampleRate:8000},{address:0,sampleRate:8000});
    chip.adpcm.setVolume(170);
    chip.setPreset(0,{algorithm:1,feedback:0,operators:[{multi:1,tl:63,ar:15,dr:0,sl:0,rr:15,egt:true},{multi:1,tl:20,ar:15,dr:0,sl:0,rr:15,egt:true}]});
    chip.noteOn(0,'A4');
    keyboard.bind('Y8950 UI test controls',{noteOn(event){if(event.midi===1){chip.writeRegister(8,(chip.getRegisterSnapshot()[8]&0xc0)|2);chip.writeRegister(7,0x60);for(let i=0;i<32;i++)chip.writeRegister(15,(i*7)&255);chip.writeRegister(7,1);log('ui-raw-write');}${additional?"if(event.midi===2){chip.dispose();log('ui-disposed');}":''}},noteOff(){},allNotesOff(){}});
  `;
  const read=()=>page.evaluate(id=>window.__nativeBackendTest.runtime.chipInspector.read(id),id);
  async function waitState(predicate,message){const deadline=Date.now()+12000;let state;while(Date.now()<deadline){state=await read();if(predicate(state))return state;await page.waitForTimeout(25);}throw Error(label+': '+message+' '+JSON.stringify(state?.adpcm));}
  const panel=page.locator('#y8950Panel');
  const control=key=>panel.locator(`[data-chip-control="y8950-adpcm-${key}"]`);
  const action=key=>panel.locator(`[data-chip-action="y8950-adpcm-${key}"]`);
  const refresh=async()=>{await panel.getByRole('button',{name:'Refresh',exact:true}).click();};
  const edit=async(key,value)=>{await control(key).fill(String(value));await control(key).dispatchEvent('change');};
  const fmPreserved=state=>assert.equal(state.registers[0xb0]&32,32,label+' ADPCM controls preserve FM gate');
  const held=state=>state.held?.includes('adpcm');
  const dialog=page.locator('dialog[data-audio-input]');
  async function openEditor(){await action('sample-editor').click();await dialog.waitFor({state:'visible'});assert.equal(await dialog.locator('[data-field="target"]').inputValue(),'adpcm-b',label+' common editor ADPCM target');}
  async function loadEditedAudio(){
    await openEditor();await dialog.locator('[data-audio-file]').setInputFiles({name:'y8950-panel.wav',mimeType:'audio/wav',buffer:waveFile()});
    await page.waitForFunction(()=>{const d=document.querySelector('dialog[data-audio-input]');return d&&(!d.querySelector('[data-audio-action="use"]').disabled||d.querySelector('[data-audio-input-status]').dataset.error==='true');});
    assert.notEqual(await dialog.locator('[data-audio-input-status]').getAttribute('data-error'),'true',label+' file decode: '+await dialog.locator('[data-audio-input-status]').innerText());
    for(const [key,value]of [['startFrame',.05],['endFrame',.25],['gainDb',6]]){const node=dialog.locator(`[data-field="${key}"]`);await node.fill(String(value));await node.dispatchEvent('change');}
    const previewStart=native.calls.length;await dialog.locator('[data-action="preview"]').click();
    if(backend==='native'){
      const deadline=Date.now()+12000;let loaded,played;
      while(Date.now()<deadline){const calls=native.calls.slice(previewStart);loaded=calls.find(c=>c.command==='native_genesis_media_load'&&c.args.kind==='sample');played=calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]).find(c=>c.type==='sample-play');if(loaded&&played)break;await page.waitForTimeout(25);}
      assert(loaded&&played,label+' Sample Editor preview uses Native sample load/play');assert.equal(played.name,loaded.args.name);
      assert.equal(await dialog.count(),1,label+' editor remains open during Native preview');
      await dialog.locator('[data-action="silence"]').click();
      await page.waitForFunction(()=>!document.querySelector('dialog[data-audio-input] [data-action="preview"]').disabled);
      const cleanupDeadline=Date.now()+12000;
      while(Date.now()<cleanupDeadline&&!native.calls.slice(previewStart).some(c=>c.command==='native_genesis_media_remove'&&c.args.name===loaded.args.name))await page.waitForTimeout(25);
      const calls=native.calls.slice(previewStart);assert(calls.some(c=>c.command==='native_genesis_media_remove'&&c.args.name===loaded.args.name),label+' Native preview bank removed');assert(calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]).some(c=>c.type==='sample-stop'),label+' Native preview voice stopped');report.nativePreview={name:loaded.args.name,frames:loaded.args.channels[0].length,sampleRate:loaded.args.sampleRate};
    }else await dialog.locator('[data-action="silence"]').click();
    await dialog.locator('[data-field="save"]').uncheck();await dialog.locator('[data-audio-action="use"]').click();await dialog.waitFor({state:'detached'});
    const state=await waitState(s=>s.adpcm?.waveformKnown&&s.adpcm.sampleName==='y8950-panel.wav','edited sample uploaded');
    assert.equal(state.adpcm.start,0);assert(state.adpcm.end>=1568&&state.adpcm.end<=1664,label+' trimmed .2s at16kHz encoded to aligned ADPCM bytes');
    assert(Math.max(...state.adpcm.waveform.map(Math.abs))>.2,label+' +6dB edit is present in the loaded waveform');fmPreserved(state);return state;
  }
  await page.evaluate(({source,execution})=>window.__nativeBackendTest.runtime.playSource(source,{execution}),{source,execution});
  await page.waitForFunction(id=>window.__nativeBackendTest.runtime.chipInspector.list().some(entry=>entry.id===id),id);
  await page.locator('#consoleTab').click();await page.locator('#y8950Tab').click();
  await panel.locator('[data-chip-control="instance"]').selectOption(id);await control('waveform').waitFor({state:'visible'});
  let state=await waitState(s=>s.adpcm?.validRange&&s.adpcm.volume===170,'initial ADPCM state');fmPreserved(state);
  assert((state.keyboardChannels??[]).some(channel=>channel.id==='adpcm'),label+' Inspector exposes ADPCM target');
  const openingWrites=native.calls.length;await refresh();await control('volume').waitFor({state:'visible'});
  if(backend==='native'){
    const sent=native.calls.slice(openingWrites).flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]);
    assert(!sent.some(command=>command.message?.audition),label+' view refresh is read-only');
  }
  await edit('volume',183);state=await waitState(s=>s.adpcm.volume===183,'UI volume');fmPreserved(state);
  await edit('rate',7000);state=await waitState(s=>Math.abs(s.adpcm.playbackRate-7000)<2,'UI playback rate');
  const delta=state.adpcm.deltaN;await edit('delta',delta+10);await waitState(s=>s.adpcm.deltaN===delta+10,'UI Delta-N');
  await control('repeat').check();await waitState(s=>s.adpcm.repeat&&!held(s),'Repeat preference does not audition');
  await action('hold').scrollIntoViewIfNeeded();await action('hold').hover();await page.mouse.down();
  try{state=await waitState(held,'ADPCM Hold lease');fmPreserved(state);}finally{await page.mouse.up();}
  state=await waitState(s=>!held(s),'ADPCM Hold release');assert.equal(state.adpcm.repeat,true,label+' manual release retains Repeat');fmPreserved(state);
  await action('play').click();await waitState(held,'bounded preview starts');await waitState(s=>!held(s),'bounded preview releases');

  // The chip tab's custom target and the global hardware selector both address
  // this instance's one ADPCM voice. The selected MIDI note does not transpose it.
  await action('keyboard').click();await page.locator('#y8950Tab').focus();await page.keyboard.down('z');
  try{state=await waitState(held,'panel Keyboard ADPCM');fmPreserved(state);assert.equal(state.adpcm.deltaN,delta+10);}finally{await page.keyboard.up('z');}
  await waitState(s=>!held(s),'panel Keyboard release');
  await page.locator('#keyboardTab').click();await page.selectOption('#playgroundKeyboardChip','chip:'+id);await page.selectOption('#playgroundKeyboardTargetChannel','adpcm');await page.locator('#keyboardTab').focus();await page.keyboard.down('x');
  try{state=await waitState(held,'global Keyboard ADPCM');assert.equal(state.adpcm.deltaN,delta+10);fmPreserved(state);}finally{await page.keyboard.up('x');}
  await waitState(s=>!held(s),'global Keyboard release');await page.locator('#consoleTab').click();await page.locator('#y8950Tab').click();

  report.loaded=await loadEditedAudio();await refresh();
  report.screenshot=path.join(artifacts,`${name}-y8950-adpcm-section-${backend}-${execution}-${additional?'additional':'primary'}.png`);await panel.locator('[data-y8950-adpcm]').screenshot({path:report.screenshot});
  const knownWave=await control('waveform').evaluate(canvas=>canvas.toDataURL());
  const oldEnd=report.loaded.adpcm.end;await edit('end',oldEnd-32);state=await waitState(s=>s.adpcm.end===oldEnd-32&&!s.adpcm.waveformKnown,'range change invalidates waveform');fmPreserved(state);await refresh();
  await page.waitForFunction(({knownWave})=>document.querySelector('[data-chip-control="y8950-adpcm-waveform"]')?.toDataURL()!==knownWave,{knownWave});
  await edit('end',oldEnd);await waitState(s=>s.adpcm.waveformKnown,'restoring known range');
  await page.evaluate(()=>window.__nativeBackendTest.runtime.getKeyboardTarget().noteOn({id:'raw-write',midi:1}));
  state=await waitState(s=>!s.adpcm.waveformKnown,'CPU data-port write invalidates waveform');fmPreserved(state);await refresh();report.rawWrite={revision:state.adpcm.memoryRevision,waveformKnown:state.adpcm.waveformKnown};

  await action('hold').scrollIntoViewIfNeeded();await action('hold').hover();await page.mouse.down();await waitState(held,'Hold before hiding');
  await page.locator('#ym2413Tab').evaluate(node=>node.click());await page.mouse.up();await waitState(s=>!held(s),'hiding chip tab releases its preview');await page.locator('#y8950Tab').click();
  await openEditor();await page.locator('#ym2413Tab').evaluate(node=>node.click());await dialog.waitFor({state:'detached'});await page.locator('#y8950Tab').click();fmPreserved(await read());
  if(additional){
    await openEditor();await page.evaluate(()=>window.__nativeBackendTest.runtime.getKeyboardTarget().noteOn({id:'dispose',midi:2}));await dialog.waitFor({state:'detached'});
    await page.waitForFunction(id=>!window.__nativeBackendTest.runtime.chipInspector.list().some(entry=>entry.id===id),id);
    report.disposed=true;
  }else report.after=await read();
  const settled=Date.now()+12000;while(tracker.stats.pending&&Date.now()<settled)await page.waitForTimeout(25);assert.equal(tracker.stats.pending,0,label+' no pending Native IPC after UI');
  await page.screenshot({path:path.join(artifacts,`${name}-y8950-panel-${backend}-${execution}-${additional?'additional':'primary'}.png`)});
  console.log(label+': ADPCM panel, configured-rate Keyboard, file/trim/gain, waveform invalidation and lifecycle PASS');
  return report;
}
module.exports={runY8950AdpcmPanel};
