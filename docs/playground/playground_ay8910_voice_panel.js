const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
let sequence = 0;
function noteName(hz) {if (!Number.isFinite(hz) || hz <= 0) return ''; const midi = Math.round(69 + 12 * Math.log2(hz / 440)); return NOTE_NAMES[(midi % 12 + 12) % 12] + (Math.floor(midi / 12) - 1);}

/** Source mixing is per channel; the noise generator and envelope are shared. */
export function ay8910VoiceCode(state,channel = 0) {
  const voice = state?.channels?.[channel]; if (!voice) return '';
  const envelope = voice.configuredEnvelope ?? voice.envelope;
  const settings = {tone:Boolean(voice.toneEnabled),noise:Boolean(voice.noiseEnabled),volume:voice.configuredVolume ?? voice.volume,envelope:Boolean(envelope)};
  const lines = [`ay.setVoice(${channel}, ${JSON.stringify(settings)});`];
  if (voice.noiseEnabled) lines.push(`ay.setNoisePeriod(${state.noise?.period ?? 0}); // Shared by all noise-enabled channels.`);
  if (envelope) lines.push(`ay.setEnvelope(${JSON.stringify({period:state.envelope?.period ?? 0,shape:state.envelope?.shape ?? 0})}); // Shared; writing shape retriggers.`);
  if (Number.isFinite(voice.frequency) && voice.frequency > 0) lines.push(`ay.setFrequency(${channel}, ${voice.frequency});`);
  lines.push(`// ay.noteOn(${channel}, 'A4');`,`// ay.keyOff(${channel});`); return lines.join('\n');
}

export function createPlaygroundAy8910VoicePanel({root,invoke,onKeyboardTargetChange = () => {},onError = () => {}}) {
  const doc = root.ownerDocument ?? globalThis.document, win = doc.defaultView ?? globalThis, panelId = ++sequence;
  const listeners = [], held = new Map();
  let state = null, channel = 0, connected = false, visible = true, disposed = false, keyboardActive = false, hardwareName = 'AY-3-8910';
  let connectionEpoch = 0, bindingEpoch = 0, pressSequence = 0, target, timer = null, holdPress = null;
  const make = (tag,className,text) => {const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;};
  function listen(node,type,handler) {node.addEventListener(type,handler); listeners.push(() => node.removeEventListener(type,handler));}
  function field(parent,label) {const node = make('label','chip-field'); node.appendChild(make('span','chip-field-label',label)); parent.appendChild(node); return node;}
  function fields(parent) {const node = make('div','chip-fields'); parent.appendChild(node); return node;}
  function button(parent,label,action,name) {const node = make('button','',label); node.type = 'button'; if (name) node.dataset.chipAction = `ay-${name}`; if (action) listen(node,'click',action); parent.appendChild(node); return node;}
  function value(node,next) {if (doc.activeElement !== node) node.value = next == null || typeof next === 'number' && !Number.isFinite(next) ? '' : String(next);}
  function checked(node,next) {if (doc.activeElement !== node) node.checked = Boolean(next);}
  async function command(method,args = []) {
    if (!connected || disposed) return; const epoch = connectionEpoch;
    try {const result = await invoke(method,args); if (!disposed && connected && connectionEpoch === epoch) {status.textContent = ''; delete status.dataset.error;} return result;}
    catch (error) {if (!disposed && connected && connectionEpoch === epoch) {status.textContent = error.message ?? String(error); status.dataset.error = 'true'; onError(error);}}
  }
  function number(parent,label,name,max,change,{min = 0,step = 1} = {}) {
    const node = make('input'); node.type = 'number'; node.min = String(min); if (max !== undefined) node.max = String(max); node.step = String(step); node.dataset.chipControl = `ay-${name}`; field(parent,label).appendChild(node);
    listen(node,'change',() => {const n = Number(node.value); if (!node.value.trim() || !Number.isFinite(n) || n < min || max !== undefined && n > max || step === 1 && !Number.isInteger(n)) {node.setCustomValidity('Enter a value within the displayed range.'); node.reportValidity?.(); return;} node.setCustomValidity(''); change?.(n);}); return node;
  }
  function checkbox(parent,label,name,change) {const node = make('input'); node.type = 'checkbox'; node.dataset.chipControl = `ay-${name}`; field(parent,label).appendChild(node); listen(node,'change',() => change(node.checked)); return node;}
  function section(title) {const node = make('section','chip-section'); node.appendChild(make('h3','',title)); body.appendChild(node); return node;}
  const body = make('fieldset','chip-editor-body'); body.disabled = true; root.appendChild(body);
  const channels = make('div','chip-channel-list'); channels.setAttribute('aria-label','AY-3-8910 channel'); body.appendChild(channels);
  const channelButtons = Array.from({length:3},(_,index) => {const node = button(channels,`CH${index + 1}`,() => selectChannel(index)); node.dataset.chipChannel = String(index); return node;});
  const selected = section('Selected PSG voice'), common = fields(selected);
  const gate = make('output'); gate.dataset.chipOutput = 'ay-gate'; field(common,'Applied output').appendChild(gate);
  const tone = checkbox(common,'Tone source','tone',enabled => command('setVoice',[channel,{tone:enabled}]));
  const noise = checkbox(common,'Noise source','noise',enabled => command('setVoice',[channel,{noise:enabled}]));
  const volume = number(common,'Fixed volume (0 silent / 15 loud)','volume',15,n => command('setVoice',[channel,{volume:n}]));
  const envelope = checkbox(common,'Use shared envelope','envelope',enabled => command('setVoice',[channel,{envelope:enabled}]));
  const frequency = number(common,'Tone frequency (Hz)','frequency',undefined,n => command('setFrequency',[channel,n]),{min:0.001,step:'any'});
  const period = number(common,'Tone period (12-bit)','period',4095,n => command('setTonePeriod',[channel,n]));
  const note = make('input'); note.type = 'text'; note.placeholder = 'A4'; note.dataset.chipControl = 'ay-note'; field(common,'Tone note').appendChild(note);
  listen(note,'change',() => {if (note.value.trim()) void command('setNote',[channel,note.value.trim()]);});
  selected.appendChild(make('p','subtext','Each of three channels mixes tone and/or the shared noise source. Fixed volume uses 0–15; selecting envelope replaces fixed volume with the shared hardware envelope. Keyboard changes tone pitch while preserving the tone/noise mix. Noise-only voices keep their configured noise rate.'));
  const audition = fields(selected), midi = number(audition,'Audition MIDI note','audition-midi',127); midi.value = '69';
  const actions = make('div','chip-actions'); audition.appendChild(actions);
  const hold = button(actions,'Hold to play',null,'hold');
  button(actions,'Play 1 second',() => {if (!visible) return; releaseSource('preview'); const id = startNote(Number(midi.value),'preview'); if (id) timer = win.setTimeout(() => {timer = null; endNote(id);},1000);},'play');
  button(actions,'Release',releaseAll,'release');
  const keyboard = button(actions,'Use Keyboard',() => {if (!connected) return; keyboardActive = true; updateTarget(); status.textContent = `${hardwareName} CH${channel + 1} is connected to the Guitar Keyboard.`;},'keyboard');
  button(actions,'Load basic tone',() => {releaseAll(); void command('setVoice',[channel,{tone:true,noise:false,volume:9,envelope:false,note:'A4'}]);},'basic');
  const noiseCard = section('Shared noise generator'), noiseFields = fields(noiseCard);
  const noisePeriod = number(noiseFields,'Noise period (5-bit)','noise-period',31,n => command('setNoisePeriod',[n]));
  const noiseInfo = make('p','subtext'); noiseInfo.dataset.chipOutput = 'ay-noise-info'; noiseCard.appendChild(noiseInfo);
  noiseCard.appendChild(make('p','subtext','All noise-enabled channels use this generator. There is no fourth independent noise channel. Changing its period changes those channels together.'));
  const envelopeCard = section('Shared hardware envelope'), envelopeFields = fields(envelopeCard);
  const envelopePeriod = number(envelopeFields,'Envelope period (16-bit)','envelope-period',65535,n => command('setEnvelope',[{period:n}]));
  const envelopeShape = number(envelopeFields,'Shape (4-bit)','envelope-shape',15,n => command('setEnvelope',[{shape:n}]));
  button(envelopeFields,'Retrigger shared envelope',() => {
    const shape = Number(envelopeShape.value);
    if (!envelopeShape.value.trim() || !Number.isInteger(shape) || shape < 0 || shape > 15) {envelopeShape.setCustomValidity('Enter a shape from 0 to 15.'); envelopeShape.reportValidity?.(); return;}
    envelopeShape.setCustomValidity(''); void command('setEnvelope',[{shape}]);
  },'envelope-retrigger');
  const envelopeInfo = make('p','subtext'); envelopeInfo.dataset.chipOutput = 'ay-envelope-info'; envelopeCard.appendChild(envelopeInfo);
  envelopeCard.appendChild(make('p','subtext','One envelope is shared by every envelope-enabled channel. Writing Shape explicitly restarts it; changing Period keeps its phase. Hold and Keyboard only key the selected voice. Retrigger starts the envelope again for all voices using it. Shapes 8/12 repeat a ramp; 10/14 repeat a triangle.'));
  const advanced = make('details','chip-advanced'); advanced.appendChild(make('summary','','Voice JavaScript and applied registers')); body.appendChild(advanced);
  const code = make('textarea','chip-voice-code'); code.readOnly = true; code.rows = 10; code.dataset.chipControl = 'ay-code'; code.setAttribute('aria-label','AY-3-8910 voice JavaScript'); advanced.appendChild(code);
  button(advanced,'Copy voice JavaScript',async () => {try {await win.navigator.clipboard.writeText(code.value);} catch {code.focus?.(); code.select?.();}},'copy');
  const registers = make('pre','chip-memory-ranges'); registers.dataset.chipOutput = 'ay-registers'; advanced.appendChild(registers);
  const status = make('p','chip-editor-status'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite'); root.appendChild(status);

  function startNote(note,source,externalId,epoch) {if (!connected || disposed || !Number.isInteger(note) || note < 0 || note > 127) return null; const id = `ay-panel:${panelId}:${++pressSequence}`; held.set(id,{channel,source,externalId,epoch}); void command('auditionOn',[channel,note,id]); return id;}
  function endNote(id) {const entry = held.get(id); if (!entry) return; held.delete(id); void command('auditionOff',[entry.channel,id]);}
  function releaseSource(source) {for (const [id,entry] of held) if (entry.source === source) endNote(id); if (source === 'preview' && timer !== null) {win.clearTimeout(timer); timer = null;} if (source === 'hold') {holdPress = null; hold.setAttribute('aria-pressed','false');}}
  function releaseAll() {for (const id of [...held.keys()]) endNote(id); if (timer !== null) {win.clearTimeout(timer); timer = null;} holdPress = null; hold.setAttribute('aria-pressed','false');}
  function updateTarget() {
    const selectedChannel = channel, epoch = ++bindingEpoch;
    target = {owner:'ay8910-voice-panel',name:`${hardwareName} · CH${channel + 1}`,
      noteOn(event) {if (!keyboardActive || !connected || epoch !== bindingEpoch || typeof event?.id !== 'string') return; for (const [id,entry] of held) if (entry.source === 'keyboard' && entry.externalId === event.id && entry.epoch === epoch) endNote(id); startNote(event.midi,'keyboard',event.id,epoch);},
      noteOff(event) {for (const [id,entry] of held) if (entry.source === 'keyboard' && entry.externalId === event?.id && entry.epoch === epoch && entry.channel === selectedChannel) endNote(id);},
      allNotesOff() {for (const [id,entry] of held) if (entry.source === 'keyboard' && entry.epoch === epoch) endNote(id);},
    }; keyboard.setAttribute('aria-pressed',String(keyboardActive)); if (keyboardActive) onKeyboardTargetChange(target);
  }
  function selectChannel(next) {if (channel === next) return; releaseAll(); channel = next; updateTarget(); if (state) update(state);}
  function holdStart(event) {if (!visible || !connected || event.type === 'pointerdown' && event.button !== undefined && event.button !== 0 || event.type === 'keydown' && (event.repeat || ![' ','Enter'].includes(event.key))) return; event.preventDefault(); releaseSource('hold'); const id = startNote(Number(midi.value),'hold'); if (!id) return; holdPress = {id,pointerId:event.pointerId,key:event.key}; hold.setAttribute('aria-pressed','true'); if (event.pointerId !== undefined) try {hold.setPointerCapture(event.pointerId);} catch {}}
  function holdEnd(event) {if (!holdPress || event.pointerId !== undefined && event.pointerId !== holdPress.pointerId || event.type === 'keyup' && event.key !== holdPress.key) return; releaseSource('hold');}
  listen(hold,'pointerdown',holdStart); listen(hold,'keydown',holdStart); for (const name of ['pointerup','pointercancel','lostpointercapture','keyup']) listen(hold,name,holdEnd);
  listen(hold,'blur',() => releaseSource('hold')); listen(win,'blur',releaseAll); listen(doc,'visibilitychange',() => {if (doc.hidden) releaseAll();});
  function update(snapshot) {
    if (disposed || !snapshot) return; state = snapshot; const voice = snapshot.channels?.[channel] ?? {};
    const nextHardwareName = snapshot.type === 0x10 ? 'YM2149' : 'AY-3-8910';
    if (hardwareName !== nextHardwareName) {hardwareName = nextHardwareName; target.name = `${hardwareName} · CH${channel + 1}`;}
    channels.setAttribute('aria-label',`${hardwareName} channel`);
    code.setAttribute('aria-label',`${hardwareName} voice JavaScript`);
    channelButtons.forEach((node,index) => {node.setAttribute('aria-pressed',String(channel === index)); node.dataset.sounding = String(Boolean(snapshot.channels?.[index]?.active));});
    gate.textContent = `${voice.active ? 'Enabled' : 'Silent'} · applied volume ${voice.volume ?? '—'}${voice.envelope ? ' · shared envelope' : ''}`;
    checked(tone,voice.toneEnabled); checked(noise,voice.noiseEnabled); value(volume,voice.configuredVolume ?? voice.volume); checked(envelope,voice.configuredEnvelope ?? voice.envelope);
    value(frequency,Number.isFinite(voice.frequency) ? Number(voice.frequency.toFixed(5)) : null); value(period,voice.period); value(note,noteName(voice.frequency));
    value(noisePeriod,snapshot.noise?.period); noiseInfo.textContent = `Period ${snapshot.noise?.period ?? '—'} · ${Number.isFinite(snapshot.noise?.frequency) ? snapshot.noise.frequency.toFixed(2) + ' Hz' : 'shared hardware noise'}`;
    value(envelopePeriod,snapshot.envelope?.period); value(envelopeShape,snapshot.envelope?.shape);
    const e = snapshot.envelope ?? {}; envelopeInfo.textContent = `Shape ${e.shape ?? '—'} · Continue ${Number(Boolean(e.continue))} · Attack ${Number(Boolean(e.attack))} · Alternate ${Number(Boolean(e.alternate))} · Hold ${Number(Boolean(e.hold))}`;
    value(code,ay8910VoiceCode(snapshot,channel)); registers.textContent = Array.from(snapshot.registers ?? [],(n,index) => `${index.toString(16).padStart(2,'0')}: ${Number(n).toString(16).padStart(2,'0')}`).join('  ');
  }
  function setConnected(next) {if (disposed) return; next = Boolean(next); if (!next) {releaseAll(); if (keyboardActive) {keyboardActive = false; onKeyboardTargetChange(null);} bindingEpoch++; keyboard.setAttribute('aria-pressed','false');} if (next !== connected) connectionEpoch++; connected = next; body.disabled = !next;}
  updateTarget();
  return {update,setConnected,releaseAll,getSelectedChannel:() => channel,getNoteTarget:() => target,
    setVisible(next) {visible = Boolean(next); if (!visible) {releaseSource('hold'); releaseSource('preview');}},
    setKeyboardActive(next) {if (!next && keyboardActive) {keyboardActive = false; releaseSource('keyboard'); bindingEpoch++; keyboard.setAttribute('aria-pressed','false');}},
    dispose() {if (disposed) return; setConnected(false); disposed = true; for (const remove of listeners) remove();},
  };
}
