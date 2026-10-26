/** WonderSwan editor. Applied snapshots render; only explicit edits write. */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = hz => {if (!Number.isFinite(hz) || hz <= 0) return ''; const midi = Math.round(69 + 12 * Math.log2(hz / 440)); return `${NOTE_NAMES[(midi % 12 + 12) % 12]}${Math.floor(midi / 12) - 1}`;};
let panelSequence = 0;

export function wonderswanNoteMidi(note) {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(String(note).trim());
  if (!match) throw new RangeError('Use a note name such as C4 or F#4.');
  const semitone = {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[match[1].toUpperCase()] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0), midi = (Number(match[3]) + 1) * 12 + semitone;
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new RangeError('Use a note within MIDI 0–127 and the WonderSwan pitch range.');
  return midi;
}

export function wonderswanVoiceCode(state, channel = 0) {
  const voice = state?.channels?.[channel]; if (!voice) return '';
  const lines = [`ws.keyOff(${channel}); // Configure this physical voice silently.`];
  if (voice.waveformKnown !== false && voice.waveform?.length === 32) lines.push(`ws.setWaveform(${channel}, ${JSON.stringify(Array.from(voice.waveform))});`);
  else lines.push('// Wave RAM is unknown; select a complete waveform in the panel first.');
  lines.push(`ws.setVolume(${channel}, ${voice.pan?.left ?? 0}, ${voice.pan?.right ?? 0});`);
  if (Number.isInteger(voice.frequencyRegister)) lines.push(`ws.writeRegister(${0x80 + channel * 2}, ${voice.frequencyRegister & 255});`, `ws.writeRegister(${0x81 + channel * 2}, ${(voice.frequencyRegister >> 8) & 7}); // 11-bit frequency register`);
  else if (Number.isFinite(voice.frequency) && voice.frequency > 0) lines.push(`ws.setFrequency(${channel}, ${voice.frequency});`);
  if (channel === 1) {lines.push(`ws.setVoiceMode(${Boolean(state.voiceMode)});`); if (Number.isInteger(state.pcmVolume)) lines.push(`ws.writeRegister(148, ${state.pcmVolume}); // PCM routing / half-full gain bits`);}
  if (channel === 2 && state.sweep) lines.push(`ws.setSweep(${JSON.stringify(state.sweep)});`);
  if (channel === 3 && state.noise) lines.push(`ws.setNoise(${JSON.stringify(state.noise)});`);
  if (channel === 1 && state.voiceMode) lines.push('// Direct PCM needs timed ws.writeVoice(sample) calls; note audition is disabled.');
  else lines.push(`// Trigger with ws.keyOn(${channel}); release with ws.keyOff(${channel}).`);
  return lines.join('\n');
}

export function createPlaygroundWonderSwanVoicePanel({root, invoke, onKeyboardTargetChange = () => {}, onError = () => {}}) {
  const doc = root.ownerDocument ?? globalThis.document, win = doc.defaultView ?? globalThis, panelId = ++panelSequence;
  const listeners = [], held = new Map();
  let snapshot = null, selected = 0, connected = false, visible = true, disposed = false, keyboardActive = false, connectionEpoch = 0;
  let pressSequence = 0, bindingEpoch = 0, target, holdPress = null, previewTimer = null, waveDrag = null, waveDraft = null, waveSignature = '';
  const make = (tag, className, text) => {const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;};
  function listen(node, type, handler) {node.addEventListener(type, handler); listeners.push(() => node.removeEventListener(type, handler));}
  function button(parent, text, handler, name) {const node = make('button', '', text); node.type = 'button'; if (name) node.dataset.chipAction = `ws-${name}`; if (handler) listen(node, 'click', handler); parent.appendChild(node); return node;}
  function field(parent, label) {const node = make('label', 'chip-field'); node.appendChild(make('span', 'chip-field-label', label)); parent.appendChild(node); return node;}
  function output(parent, label, name) {const node = make('output'); node.dataset.chipOutput = `ws-${name}`; field(parent, label).appendChild(node); return node;}
  function setValue(node, value) {if (doc.activeElement !== node) node.value = value == null || typeof value === 'number' && !Number.isFinite(value) ? '' : String(value);}
  function checked(node, value) {if (doc.activeElement !== node) node.checked = Boolean(value);}
  function report(error) {if (disposed) return; status.textContent = error?.message ?? String(error); status.dataset.error = 'true'; onError(error);}
  async function command(method, args = []) {if (!connected || disposed) return; const epoch = connectionEpoch; try {const result = await invoke(method, args); if (!disposed && connected && epoch === connectionEpoch) {status.textContent = ''; delete status.dataset.error;} return result;} catch (error) {if (!disposed && connected && epoch === connectionEpoch) report(error);}}
  const patch = value => command('setVoice', [selected, value]);
  function number(parent, label, name, {min = 0, max, step = 1, change} = {}) {
    const node = make('input'); node.type = 'number'; node.dataset.chipControl = `ws-${name}`; node.min = String(min); if (max !== undefined) node.max = String(max); node.step = String(step); field(parent, label).appendChild(node);
    listen(node, 'change', () => {const value = Number(node.value); if (!node.value.trim() || !Number.isFinite(value) || value < min || max !== undefined && value > max || step === 1 && !Number.isInteger(value)) {node.setCustomValidity('Enter a value within the displayed range.'); node.reportValidity?.(); return;} node.setCustomValidity(''); change?.(value);}); return node;
  }
  function checkbox(parent, label, name, change) {const node = make('input'); node.type = 'checkbox'; node.dataset.chipControl = `ws-${name}`; field(parent, label).appendChild(node); listen(node, 'change', () => change(node.checked)); return node;}
  function section(title) {const node = make('section', 'chip-section'); node.appendChild(make('h3', '', title)); body.appendChild(node); return node;}
  function fields(parent) {const node = make('div', 'chip-fields'); parent.appendChild(node); return node;}
  const voice = () => snapshot?.channels?.[selected] ?? {};

  const body = make('fieldset', 'chip-editor-body'); body.disabled = true; root.appendChild(body);
  const channelList = make('div', 'chip-channel-list'); channelList.setAttribute('aria-label', 'WonderSwan channel'); body.appendChild(channelList);
  const channelButtons = Array.from({length:4}, (_, channel) => {const node = button(channelList, `CH${channel + 1}`, () => selectChannel(channel)); node.dataset.chipChannel = String(channel); return node;});
  const voiceCard = section('Selected wavetable voice'), common = fields(voiceCard);
  const gate = output(common, 'Applied channel state', 'gate'), clock = output(common, 'Master clock (Hz)', 'clock');
  const frequency = number(common, 'Base wavetable frequency (Hz)', 'frequency', {min: 0.001, step:'any', change: value => command('setFrequency', [selected, value])});
  const note = make('input'); note.type = 'text'; note.placeholder = 'A4'; note.dataset.chipControl = 'ws-note'; field(common, 'Note').appendChild(note);
  listen(note, 'change', () => {try {const midi = wonderswanNoteMidi(note.value); note.setCustomValidity(''); void command('setNote', [selected, midi]);} catch (error) {note.setCustomValidity(error.message); note.reportValidity?.();}});
  const period = number(common, 'Frequency register (0–2047)', 'period', {max:2047, change: value => patch({frequencyRegister:value})});
  const panLeft = number(common, 'Left balance', 'pan-left', {max:15, change:value => patch({pan:{left:value}})});
  const panRight = number(common, 'Right balance', 'pan-right', {max:15, change:value => patch({pan:{right:value}})});
  const audition = fields(voiceCard), auditionMidi = number(audition, 'Audition MIDI note', 'audition-midi', {max:127}); auditionMidi.value = '69';
  const actions = make('div', 'chip-actions'); audition.appendChild(actions);
  const hold = button(actions, 'Hold to play', null, 'hold');
  const play = button(actions, 'Play 1 second', () => {if (!visible) return; releaseSource('preview'); const id = startNote(selected, Number(auditionMidi.value), 'preview'); if (id) previewTimer = win.setTimeout(() => {previewTimer = null; endNote(id);}, 1000);}, 'play');
  button(actions, 'Release', () => releaseAll(), 'release');
  const keyboardButton = button(actions, 'Use Keyboard', () => {if (!connected || (selected === 1 && snapshot?.voiceMode)) return; keyboardActive = true; updateTarget(); status.textContent = `WonderSwan CH${selected + 1} is connected to the Guitar Keyboard.`; delete status.dataset.error;}, 'keyboard');
  const auditionHelp = make('p', 'subtext'); voiceCard.appendChild(auditionHelp);

  const waveCard = section('Wave RAM · 32 × 4-bit'), waveActions = make('div', 'chip-actions'); waveCard.appendChild(waveActions);
  for (const name of ['Sine','Triangle','Saw','Square']) button(waveActions, name, () => setWave(Array.from({length:32}, (_, i) => name === 'Sine' ? Math.round(7.5 + 7.5 * Math.sin(i * Math.PI / 16)) : name === 'Triangle' ? i < 16 ? i : 31 - i : name === 'Saw' ? i >> 1 : i < 16 ? 15 : 0)), `wave-${name.toLowerCase()}`);
  const canvas = make('canvas', 'chip-sample-waveform'); canvas.width = 800; canvas.height = 160; canvas.dataset.chipControl = 'ws-waveform'; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'WonderSwan waveform, 32 samples from 0 to 15. Drag to edit.'); waveCard.appendChild(canvas);
  const waveFields = fields(waveCard);
  const waveIndex = number(waveFields, 'Sample index', 'wave-index', {max:31, change:value => setValue(waveValue, (waveDraft ?? voice().waveform ?? [])[value])}); waveIndex.value = '0';
  const waveValue = number(waveFields, 'Sample value', 'wave-value', {max:15, change:value => {if (voice().waveformKnown === false) return; const wave = Array.from(waveDraft ?? voice().waveform ?? Array(32).fill(8)); wave[Number(waveIndex.value)] = value; setWave(wave);}});
  const waveInfo = make('p', 'subtext'); waveInfo.dataset.chipOutput = 'ws-wave-info'; waveCard.appendChild(waveInfo);

  const noiseCard = section('CH4 noise generator'), noiseFields = fields(noiseCard);
  const noiseEnabled = checkbox(noiseFields, 'Replace waveform with noise', 'noise-enabled', value => command('setNoise', [{enabled:value}]));
  const noiseType = number(noiseFields, 'Noise polynomial (0–7)', 'noise-type', {max:7, change:value => command('setNoise', [{type:value}])});
  button(noiseFields, 'Reset noise sequence', () => command('setNoise', [{reset:true}]), 'noise-reset');
  noiseCard.appendChild(make('p', 'subtext', 'Noise shares CH4’s frequency register and stereo levels. MIDI notes set its noise clock.'));
  const voiceModeCard = section('CH2 direct eight-bit PCM'), voiceModeFields = fields(voiceModeCard);
  const voiceMode = checkbox(voiceModeFields, 'Direct PCM enabled', 'voice-mode', value => {releaseAll(); void command('setVoiceMode', [value]);});
  const pcmVolume = number(voiceModeFields, 'PCM routing / gain bits', 'pcm-volume', {max:15, change:value => command('setPcmVolume', [value])});
  voiceModeCard.appendChild(make('p', 'subtext', 'Direct PCM consumes CH2. Audio playback needs timed ws.writeVoice(sample) calls in code; chromatic note audition is disabled in this mode. Routing bits: 8 = left full, 4 = left half, 2 = right full, 1 = right half. Full takes priority.'));
  const sweepCard = section('CH3 frequency sweep'), sweepFields = fields(sweepCard);
  const sweepEnabled = checkbox(sweepFields, 'Sweep enabled', 'sweep-enabled', value => command('setSweep', [{enabled:value}]));
  const sweepStep = number(sweepFields, 'Signed frequency-register step', 'sweep-step', {min:-128,max:127, change:value => command('setSweep', [{step:value}])});
  const sweepTime = number(sweepFields, 'Sweep time register', 'sweep-time', {max:31, change:value => command('setSweep', [{time:value}])});
  sweepCard.appendChild(make('p', 'subtext', 'Sweep changes CH3’s frequency register automatically. The readout follows the applied register.'));
  const details = make('details', 'chip-advanced'); details.appendChild(make('summary', '', 'Voice JavaScript and applied registers')); body.appendChild(details);
  const code = make('textarea', 'chip-voice-code'); code.readOnly = true; code.rows = 10; code.dataset.chipControl = 'ws-code'; code.setAttribute('aria-label', 'WonderSwan configured voice JavaScript'); details.appendChild(code);
  button(details, 'Copy voice JavaScript', async () => {try {await win.navigator.clipboard.writeText(code.value); if (!disposed) {status.textContent = 'Voice JavaScript copied.'; delete status.dataset.error;}} catch {if (!disposed) {code.focus(); code.select(); status.textContent = 'Code selected. Copy it with your keyboard.';}}}, 'copy');
  const registers = make('pre', 'chip-memory-ranges'); registers.dataset.chipOutput = 'ws-registers'; details.appendChild(registers);
  const status = make('p', 'chip-editor-status'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite'); root.appendChild(status);
  root.appendChild(make('p','subtext','Values show applied WonderSwan settings. Code and manual audition share four hardware channels. Opening this view never starts audio or replaces a waveform.'));

  function startNote(channel, midi, source, externalId, epoch) {if (!connected || disposed || (channel === 1 && snapshot?.voiceMode) || !Number.isInteger(midi) || midi < 0 || midi > 127) return null; const id = `ws-panel:${panelId}:${++pressSequence}`; held.set(id,{channel,source,externalId,epoch}); void command('auditionOn',[channel,midi,id]); return id;}
  function endNote(id) {const entry=held.get(id); if (!entry) return; held.delete(id); void command('auditionOff',[entry.channel,id]);}
  function releaseSource(source) {for (const [id,entry]of held) if (entry.source===source) endNote(id); if (source==='preview'&&previewTimer!==null) {win.clearTimeout(previewTimer); previewTimer=null;} if (source==='hold') {holdPress=null;hold.setAttribute('aria-pressed','false');}}
  function releaseAll() {for(const id of [...held.keys()])endNote(id);if(previewTimer!==null){win.clearTimeout(previewTimer);previewTimer=null;}holdPress=null;hold.setAttribute('aria-pressed','false');}
  function updateTarget() {
    const channel=selected,epoch=++bindingEpoch;
    target={owner:'wonderswan-voice-panel',name:`WonderSwan · CH${channel+1}`,
      noteOn(event){if(!keyboardActive||!connected||epoch!==bindingEpoch||typeof event?.id!=='string')return;for(const[id,entry]of held)if(entry.source==='keyboard'&&entry.externalId===event.id&&entry.epoch===epoch)endNote(id);startNote(channel,event.midi,'keyboard',event.id,epoch);},
      noteOff(event){for(const[id,entry]of held)if(entry.source==='keyboard'&&entry.externalId===event?.id&&entry.epoch===epoch)endNote(id);},
      allNotesOff(){for(const[id,entry]of held)if(entry.source==='keyboard'&&entry.epoch===epoch)endNote(id);},};
    keyboardButton.setAttribute('aria-pressed',String(keyboardActive));if(keyboardActive)onKeyboardTargetChange(target);
  }
  function selectChannel(channel){if(selected===channel)return;releaseAll();waveDrag=null;waveDraft=null;selected=channel;updateTarget();if(snapshot)update(snapshot);}
  function holdStart(event){if(!visible||!connected||event.type==='pointerdown'&&event.button!==undefined&&event.button!==0||event.type==='keydown'&&(event.repeat||![' ','Enter'].includes(event.key)))return;event.preventDefault();releaseSource('hold');const id=startNote(selected,Number(auditionMidi.value),'hold');if(!id)return;holdPress={id,pointerId:event.pointerId,key:event.key};hold.setAttribute('aria-pressed','true');if(event.pointerId!==undefined)try{hold.setPointerCapture(event.pointerId);}catch{}}
  function holdEnd(event){if(!holdPress||event.pointerId!==undefined&&event.pointerId!==holdPress.pointerId||event.type==='keyup'&&event.key!==holdPress.key)return;releaseSource('hold');}
  listen(hold,'pointerdown',holdStart);listen(hold,'keydown',holdStart);for(const name of ['pointerup','pointercancel','lostpointercapture','keyup'])listen(hold,name,holdEnd);listen(hold,'blur',()=>releaseSource('hold'));
  listen(win,'blur',()=>{releaseAll();cancelWave();});listen(doc,'visibilitychange',()=>{if(doc.hidden){releaseAll();cancelWave();}});

  function setWave(values){if(!connected||disposed)return;waveDraft=Array.from(values);drawWave();setValue(waveValue,waveDraft[Number(waveIndex.value)]);void command('setWaveform',[selected,waveDraft.slice()]);}
  function drawWave(){if(!visible)return;const known=voice().waveformKnown!==false,values=waveDraft??voice().waveform;const signature=JSON.stringify([known,values]);if(signature===waveSignature)return;waveSignature=signature;const ctx=canvas.getContext?.('2d');if(!ctx)return;const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.fillStyle='#101820';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#34444e';ctx.lineWidth=1;for(const v of [0,8,15]){const y=h-8-v/15*(h-16);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}if(!known&&!waveDraft){ctx.fillStyle='#b5c2cc';ctx.font='13px sans-serif';ctx.fillText('Waveform data unknown; choose a shape to replace all 32 samples.',12,25);return;}ctx.strokeStyle='#7bbcf7';ctx.lineWidth=2;ctx.beginPath();Array.from(values??[]).forEach((value,index)=>{const x=index*w/32,next=(index+1)*w/32,y=h-8-value/15*(h-16);if(index)ctx.lineTo(x,y);else ctx.moveTo(x,y);ctx.lineTo(next,y);});ctx.stroke();}
  function drawPoint(event){const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height||!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY))return;const index=Math.max(0,Math.min(31,Math.floor((event.clientX-rect.left)/rect.width*32))),value=Math.max(0,Math.min(15,Math.round((1-(event.clientY-rect.top)/rect.height)*15)));const from=waveDrag.lastIndex??index,old=waveDrag.lastValue??value;for(let i=Math.min(from,index);i<=Math.max(from,index);i++)waveDraft[i]=from===index?value:Math.round(old+(value-old)*(i-from)/(index-from));waveDrag.lastIndex=index;waveDrag.lastValue=value;setValue(waveIndex,index);setValue(waveValue,value);drawWave();}
  function cancelWave(){if(!waveDrag)return;waveDrag=null;waveDraft=null;waveSignature='';drawWave();}
  listen(canvas,'pointerdown',event=>{if(!connected||!visible||voice().waveformKnown===false||event.button!==undefined&&event.button!==0)return;event.preventDefault();waveDraft=Array.from(voice().waveform??Array(32).fill(8));waveDrag={pointerId:event.pointerId,channel:selected,epoch:connectionEpoch};try{canvas.setPointerCapture(event.pointerId);}catch{}drawPoint(event);});
  listen(canvas,'pointermove',event=>{if(waveDrag?.pointerId===event.pointerId){event.preventDefault();drawPoint(event);}});
  listen(canvas,'pointerup',event=>{if(!waveDrag||event.pointerId!==waveDrag.pointerId)return;drawPoint(event);const drag=waveDrag,values=waveDraft;waveDrag=null;if(drag.channel===selected&&drag.epoch===connectionEpoch)setWave(values);});
  listen(canvas,'pointercancel',cancelWave);listen(canvas,'lostpointercapture',cancelWave);

  function update(state){if(disposed||!state)return;snapshot=state;const ch=voice(),pcmOn=selected===1&&!!state.voiceMode,noiseOn=selected===3&&!!state.noise?.enabled;
    channelButtons.forEach((node,index)=>{const c=state.channels?.[index]??{};node.setAttribute('aria-pressed',String(index===selected));node.dataset.sounding=String(!!c.active);node.textContent=`CH${index+1}${c.active?' ▸':''}`;node.title=index===1&&state.voiceMode?'PCM':index===3&&state.noise?.enabled?'Noise':`${noteName(c.frequency)} · ${Number.isFinite(c.frequency)?c.frequency.toFixed(2):'—'} Hz`;});
    gate.textContent=`${ch.active?'Enabled':'Off'} · ${pcmOn?'PCM':noiseOn?'Noise':'Wave'}`;clock.textContent=Number.isFinite(state.clock)?state.clock.toLocaleString('en-US'):'—';setValue(frequency,Number.isFinite(ch.frequency)?Number(ch.frequency.toFixed(6)):null);setValue(note,noteName(ch.frequency));setValue(period,ch.frequencyRegister);setValue(panLeft,ch.pan?.left);setValue(panRight,ch.pan?.right);
    frequency.disabled=note.disabled=period.disabled=pcmOn;hold.disabled=play.disabled=keyboardButton.disabled=pcmOn;auditionMidi.disabled=pcmOn;
    auditionHelp.textContent=pcmOn?'Direct PCM is driven by timed samples, so note audition and Keyboard triggering are unavailable. Turn PCM off to audition CH2’s waveform.':noiseOn?'Audition sets CH4’s noise clock from the MIDI pitch. Stereo levels remain editable while it sounds.':'Audition borrows this channel and changes its wavetable pitch. Waveform and stereo levels remain editable while it sounds.';
    noiseCard.hidden=selected!==3;checked(noiseEnabled,state.noise?.enabled);setValue(noiseType,state.noise?.type);
    voiceModeCard.hidden=selected!==1;checked(voiceMode,state.voiceMode);setValue(pcmVolume,state.pcmVolume);pcmVolume.disabled=!pcmOn;
    sweepCard.hidden=selected!==2;checked(sweepEnabled,state.sweep?.enabled);setValue(sweepStep,state.sweep?.step);setValue(sweepTime,state.sweep?.time);
    if(!waveDrag){waveDraft=null;setValue(waveValue,ch.waveform?.[Number(waveIndex.value)]);drawWave();}waveIndex.disabled=waveValue.disabled=ch.waveformKnown===false;
    waveInfo.textContent=ch.waveformKnown===false?'Waveform data is unknown. Choose a shape to replace the complete waveform.':'Drag to edit, or set individual samples numerically. A completed stroke sends all 32 samples once; cancelled strokes do not write.';
    setValue(code,wonderswanVoiceCode(state,selected));registers.textContent=Array.from(state.registers??[],(value,index)=>`${(index+0x80).toString(16).toUpperCase()}: ${Number(value).toString(16).toUpperCase().padStart(2,'0')}`).join('  ');
  }

  function setConnected(value){if(disposed)return;const next=Boolean(value);if(!next){releaseAll();cancelWave();if(keyboardActive){keyboardActive=false;onKeyboardTargetChange(null);}bindingEpoch++;keyboardButton.setAttribute('aria-pressed','false');}if(connected!==next)connectionEpoch++;connected=next;body.disabled=!next;}
  updateTarget();
  return{update,setConnected,releaseAll,getNoteTarget:()=>target,getSelectedChannel:()=>selected,
    setVisible(value){visible=Boolean(value);if(!visible){releaseSource('hold');releaseSource('preview');cancelWave();}else{waveSignature='';drawWave();}},
    setKeyboardActive(value){if(!value&&keyboardActive){keyboardActive=false;releaseSource('keyboard');bindingEpoch++;keyboardButton.setAttribute('aria-pressed','false');}},
    dispose(){if(disposed)return;setConnected(false);disposed=true;for(const remove of listeners)remove();},};
}
