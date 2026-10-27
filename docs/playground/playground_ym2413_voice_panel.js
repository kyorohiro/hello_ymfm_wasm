import {YM2413_INSTRUMENTS,YM2413_USER_PRESETS} from '../js/ym2413synth.js?v=pokey-mode-1';

const FIELDS = [['multi','MUL',15],['ksl','KSL',3],['tl','TL',63],['ar','AR',15],['dr','DR',15],['sl','SL',15],['rr','RR',15],['waveform','Wave',1],['am','AM',1],['vibrato','VIB',1],['egt','EGT',1],['ksr','KSR',1]];
const FLAGS = new Set(['am','vibrato','egt','ksr']);
const DRUMS = [['bassDrum','Bass drum'],['snare','Snare'],['tom','Tom'],['cymbal','Cymbal'],['hiHat','Hi-hat']];
let sequence = 0;
function noteName(hz) {if (!Number.isFinite(hz) || hz <= 0) return ''; const midi = Math.round(69 + 12 * Math.log2(hz / 440)); return ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][(midi % 12 + 12) % 12] + (Math.floor(midi / 12) - 1);}

/** Only instrument 0 has writable operator bytes, shared by the whole chip. */
export function ym2413VoiceCode(state,channel = 0) {
  const voice = state?.channels?.[channel]; if (!voice) return '';
  const lines = [];
  if (voice.instrument === 0 && state.userPatch) {
    const patch = {feedback:state.userPatch.feedback,operators:state.userPatch.operators.map((operator,index) => Object.fromEntries(FIELDS.filter(([key]) => key !== 'tl' || index === 0).map(([key]) => [key,FLAGS.has(key) ? Boolean(operator[key]) : operator[key]])))};
    lines.push('// Shared by every channel using instrument 0.',`opll.setUserPatch(${JSON.stringify(patch,null,2)});`);
  } else lines.push(`// Built-in ${YM2413_INSTRUMENTS[voice.instrument] ?? voice.instrument}: ROM operator parameters are read-only.`);
  lines.push(`opll.setVoice(${channel}, ${JSON.stringify({instrument:voice.instrument,attenuation:voice.attenuation,sustain:Boolean(voice.sustain)})});`,`// opll.noteOn(${channel}, 'A4');`,`// opll.keyOff(${channel});`);
  return lines.join('\n');
}

export function createPlaygroundYm2413VoicePanel({root,invoke,onKeyboardTargetChange = () => {},onError = () => {}}) {
  const doc = root.ownerDocument ?? globalThis.document, win = doc.defaultView ?? globalThis;
  const listeners = [], held = new Map(), panelId = ++sequence;
  let state = null, selected = 0, connected = false, visible = true, disposed = false, keyboardActive = false;
  let connectionEpoch = 0, bindingEpoch = 0, pressSequence = 0, target, timer = null, holdPress = null;
  const make = (tag,className,text) => {const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;};
  function listen(node,type,handler) {node.addEventListener(type,handler); listeners.push(() => node.removeEventListener(type,handler));}
  function field(parent,label) {const node = make('label','chip-field'); node.appendChild(make('span','chip-field-label',label)); parent.appendChild(node); return node;}
  function fields(parent) {const node = make('div','chip-fields'); parent.appendChild(node); return node;}
  function button(parent,label,action,name) {const node = make('button','',label); node.type = 'button'; if (name) node.dataset.chipAction = `opll-${name}`; if (action) listen(node,'click',action); parent.appendChild(node); return node;}
  function value(node,next) {if (doc.activeElement !== node) node.value = next == null || typeof next === 'number' && !Number.isFinite(next) ? '' : String(next);}
  function checked(node,next) {if (doc.activeElement !== node) node.checked = Boolean(next);}
  async function command(method,args = []) {
    if (!connected || disposed) return; const epoch = connectionEpoch;
    try {const result = await invoke(method,args); if (!disposed && connected && connectionEpoch === epoch) {status.textContent = ''; delete status.dataset.error;} return result;}
    catch (error) {if (!disposed && connected && connectionEpoch === epoch) {status.textContent = error.message ?? String(error); status.dataset.error = 'true'; onError(error);}}
  }
  function number(parent,label,name,max,change,{min = 0,step = 1,cell = false} = {}) {
    const node = make('input'); node.type = 'number'; node.min = String(min); if (max !== undefined) node.max = String(max); node.step = String(step); node.dataset.chipControl = `opll-${name}`;
    if (cell) {node.setAttribute('aria-label',label); parent.appendChild(node);} else field(parent,label).appendChild(node);
    listen(node,'change',() => {const n = Number(node.value); if (!node.value.trim() || !Number.isFinite(n) || n < min || max !== undefined && n > max || step === 1 && !Number.isInteger(n)) {node.setCustomValidity('Enter a value within the displayed range.'); node.reportValidity?.(); return;} node.setCustomValidity(''); change?.(n);}); return node;
  }
  function checkbox(parent,label,name,change,cell = false) {
    const node = make('input'); node.type = 'checkbox'; node.dataset.chipControl = `opll-${name}`;
    if (cell) {node.setAttribute('aria-label',label); parent.appendChild(node);} else field(parent,label).appendChild(node);
    listen(node,'change',() => change(node.checked)); return node;
  }
  function select(parent,label,name,choices,change) {
    const node = make('select'); node.dataset.chipControl = `opll-${name}`;
    for (const [key,text] of choices) {const option = make('option','',text); option.value = String(key); node.appendChild(option);}
    field(parent,label).appendChild(node); listen(node,'change',() => change(node.value)); return node;
  }
  function section(title) {const node = make('section','chip-section'); node.appendChild(make('h3','',title)); body.appendChild(node); return node;}
  const drumIndex = () => typeof selected === 'string' ? Number(selected.split(':')[1]) : -1;
  const current = () => typeof selected === 'number' ? state?.channels?.[selected] ?? {} : null;
  const available = () => typeof selected === 'number' ? current()?.available !== false : Boolean(state?.rhythm?.enabled);
  const label = () => typeof selected === 'number' ? `YM2413 · CH${selected + 1}` : `YM2413 · ${DRUMS[drumIndex()]?.[1] ?? 'Rhythm'}`;

  const body = make('fieldset','chip-editor-body'); body.disabled = true; root.appendChild(body);
  const channels = make('div','chip-channel-list'); channels.setAttribute('aria-label','YM2413 voice'); body.appendChild(channels);
  const channelButtons = Array.from({length:9},(_,index) => {const node = button(channels,`CH${index + 1}`,() => selectVoice(index)); node.dataset.chipChannel = String(index); return node;});
  const drumButtons = DRUMS.map(([,name],index) => {const node = button(channels,name,() => selectVoice(`rhythm:${index}`)); node.dataset.chipRhythm = String(index); return node;});
  const voiceCard = section('Selected voice'), common = fields(voiceCard);
  const gate = make('output'); gate.dataset.chipOutput = 'opll-gate'; field(common,'Applied key gate').appendChild(gate);
  const instrument = select(common,'Instrument','instrument',YM2413_INSTRUMENTS.map((name,index) => [index,`${index} · ${name}`]),n => command('setVoice',[selected,{instrument:Number(n)}]));
  const attenuation = number(common,'Attenuation (0 loud / 15 quiet)','attenuation',15,n => command('setVoice',[selected,{attenuation:n}]));
  const sustain = checkbox(common,'Channel sustain','sustain',n => command('setVoice',[selected,{sustain:n}]));
  const frequency = number(common,'Frequency (Hz)','frequency',undefined,n => command('setFrequency',[selected,n]),{min:0.001,step:'any'});
  const note = make('input'); note.type = 'text'; note.placeholder = 'A4'; note.dataset.chipControl = 'opll-note'; field(common,'Note').appendChild(note);
  listen(note,'change',() => {if (note.value.trim()) void command('setNote',[selected,note.value.trim()]);});
  const voiceDescription = make('p','subtext'); voiceDescription.dataset.chipOutput = 'opll-instrument-info'; voiceCard.appendChild(voiceDescription);
  const audition = fields(voiceCard), midi = number(audition,'Audition MIDI note','audition-midi',127); midi.value = '69';
  const actions = make('div','chip-actions'); audition.appendChild(actions);
  const hold = button(actions,'Hold to play',null,'hold');
  const preview = button(actions,'Play 1 second',() => {if (!visible) return; releaseSource('preview'); const id = startNote(Number(midi.value),'preview'); if (id) timer = win.setTimeout(() => {timer = null; endNote(id);},1000);},'play');
  button(actions,'Release',releaseAll,'release');
  const keyboard = button(actions,'Use Keyboard',() => {if (!connected || !available()) return; keyboardActive = true; updateTarget(); status.textContent = `${label()} is connected to the Guitar Keyboard.`;},'keyboard');
  voiceCard.appendChild(make('p','subtext','Built-in instruments 1–15 use the chip’s fixed ROM voices. The selected channel’s level and sustain remain editable. Rhythm notes keep their configured tuning.'));

  const userCard = section('Shared User patch · instrument 0'), used = make('p','subtext'); used.dataset.chipOutput = 'opll-user-users'; userCard.appendChild(used);
  userCard.appendChild(make('p','subtext','There is one User patch for the whole YM2413. Every edit below immediately affects every channel using instrument 0. Built-in ROM voices are unchanged. Carrier level belongs to each channel’s attenuation control.'));
  const userFields = fields(userCard);
  const presets = select(userFields,'Original User preset','user-preset',Object.entries(YM2413_USER_PRESETS).map(([key,preset]) => [key,preset.label ?? key]),() => {});
  button(userFields,'Load shared User patch',() => command('setUserPatch',[YM2413_USER_PRESETS[presets.value]]),'user-preset');
  const useUser = button(userFields,'Use User on selected channel',() => command('setVoice',[selected,{instrument:0}]),'use-user');
  const feedback = number(userFields,'User feedback (modulator)','user-feedback',7,n => command('setUserPatch',[{feedback:n}]));
  const scroll = make('div','chip-opm-table-scroll'), table = make('table','chip-opm-table'); scroll.appendChild(table); userCard.appendChild(scroll);
  const head = make('thead'), headings = make('tr'); head.appendChild(headings); table.appendChild(head);
  for (const text of ['Operator',...FIELDS.map(([,name]) => name)]) {const cell = make('th','',text); cell.setAttribute('scope','col'); headings.appendChild(cell);}
  const rows = make('tbody'); table.appendChild(rows);
  const operatorControls = Array.from({length:2},(_,index) => {
    const row = make('tr'), name = make('th','',index ? 'Carrier' : 'Modulator'); name.setAttribute('scope','row'); row.appendChild(name); rows.appendChild(row);
    return Object.fromEntries(FIELDS.map(([key,title,max]) => {
      const cell = make('td'); row.appendChild(cell);
      if (key === 'tl' && index === 1) {const out = make('output','','Per channel'); cell.appendChild(out); return [key,null];}
      const change = n => command('setUserOperator',[index,{[key]:n}]);
      const node = FLAGS.has(key) ? checkbox(cell,`${index ? 'Carrier' : 'Modulator'} ${title}`,`user-op-${index}-${key}`,change,true) : number(cell,`${index ? 'Carrier' : 'Modulator'} ${title}`,`user-op-${index}-${key}`,max,change,{cell:true}); return [key,node];
    }));
  });
  userCard.appendChild(make('p','subtext','OP1 modulator → OP2 carrier. MUL 0 = ×½; modulator TL 63 is quietest. Wave 0 is sine; Wave 1 is half-wave rectified sine. AM / VIB use the fixed hardware LFO.'));

  const rhythmCard = section('Rhythm · six melodic voices and five drums'), rhythmFields = fields(rhythmCard);
  const rhythm = checkbox(rhythmFields,'Enable rhythm (uses physical CH7–CH9)','rhythm',n => {releaseAll(); void command('setRhythm',[{enabled:n}]);});
  const drumLevels = DRUMS.map(([name,title]) => number(rhythmFields,`${title} attenuation`,`rhythm-${name}-attenuation`,15,n => command('setRhythmLevel',[name,n])));
  const tuning = fields(rhythmCard);
  const drumPitch = [6,7,8].map(channel => number(tuning,`API CH${channel} drum tuning (Hz)`,`rhythm-pitch-${channel}`,undefined,n => command('setFrequency',[channel,n]),{min:0.001,step:'any'}));
  rhythmCard.appendChild(make('p','subtext','Rhythm reuses CH6–CH8 and their instrument/volume register nibbles. Rhythm level edits are enabled only in rhythm mode. Returning to melody does not restore the previous CH6–CH8 instrument numbers; select their voices explicitly.'));
  const advanced = make('details','chip-advanced'); advanced.appendChild(make('summary','','Voice JavaScript and applied registers')); body.appendChild(advanced);
  const code = make('textarea','chip-voice-code'); code.readOnly = true; code.rows = 10; code.dataset.chipControl = 'opll-code'; code.setAttribute('aria-label','YM2413 voice JavaScript'); advanced.appendChild(code);
  button(advanced,'Copy voice JavaScript',async () => {try {await win.navigator.clipboard.writeText(code.value);} catch {code.focus?.(); code.select?.();}},'copy');
  const registers = make('pre','chip-memory-ranges'); registers.dataset.chipOutput = 'opll-registers'; advanced.appendChild(registers);
  const status = make('p','chip-editor-status'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite'); root.appendChild(status);

  function startNote(note,source,externalId,epoch) {
    if (!connected || disposed || !available() || !Number.isInteger(note) || note < 0 || note > 127) return null;
    const id = `opll-panel:${panelId}:${++pressSequence}`; held.set(id,{channel:selected,source,externalId,epoch}); void command('auditionOn',[selected,note,id]); return id;
  }
  function endNote(id) {const entry = held.get(id); if (!entry) return; held.delete(id); void command('auditionOff',[entry.channel,id]);}
  function releaseSource(source) {for (const [id,entry] of held) if (entry.source === source) endNote(id); if (source === 'preview' && timer !== null) {win.clearTimeout(timer); timer = null;} if (source === 'hold') {holdPress = null; hold.setAttribute('aria-pressed','false');}}
  function releaseAll() {for (const id of [...held.keys()]) endNote(id); if (timer !== null) {win.clearTimeout(timer); timer = null;} holdPress = null; hold.setAttribute('aria-pressed','false');}
  function updateTarget() {
    const selectedChannel = selected, epoch = ++bindingEpoch;
    target = {owner:'ym2413-voice-panel',name:label(),
      noteOn(event) {if (!keyboardActive || !connected || epoch !== bindingEpoch || typeof event?.id !== 'string') return; for (const [id,entry] of held) if (entry.source === 'keyboard' && entry.externalId === event.id && entry.epoch === epoch) endNote(id); startNote(event.midi,'keyboard',event.id,epoch);},
      noteOff(event) {for (const [id,entry] of held) if (entry.source === 'keyboard' && entry.externalId === event?.id && entry.epoch === epoch && entry.channel === selectedChannel) endNote(id);},
      allNotesOff() {for (const [id,entry] of held) if (entry.source === 'keyboard' && entry.epoch === epoch) endNote(id);},
    }; keyboard.setAttribute('aria-pressed',String(keyboardActive)); if (keyboardActive) onKeyboardTargetChange(target);
  }
  function selectVoice(next) {if (selected === next) return; releaseAll(); selected = next; updateTarget(); if (state) update(state);}
  function holdStart(event) {
    if (!visible || !connected || event.type === 'pointerdown' && event.button !== undefined && event.button !== 0 || event.type === 'keydown' && (event.repeat || ![' ','Enter'].includes(event.key))) return;
    event.preventDefault(); releaseSource('hold'); const id = startNote(Number(midi.value),'hold'); if (!id) return; holdPress = {id,pointerId:event.pointerId,key:event.key}; hold.setAttribute('aria-pressed','true'); if (event.pointerId !== undefined) try {hold.setPointerCapture(event.pointerId);} catch {}
  }
  function holdEnd(event) {if (!holdPress || event.pointerId !== undefined && event.pointerId !== holdPress.pointerId || event.type === 'keyup' && event.key !== holdPress.key) return; releaseSource('hold');}
  listen(hold,'pointerdown',holdStart); listen(hold,'keydown',holdStart);
  for (const name of ['pointerup','pointercancel','lostpointercapture','keyup']) listen(hold,name,holdEnd);
  listen(hold,'blur',() => releaseSource('hold')); listen(win,'blur',releaseAll); listen(doc,'visibilitychange',() => {if (doc.hidden) releaseAll();});
  function update(snapshot) {
    if (disposed || !snapshot) return; state = snapshot;
    if (!available()) {selectVoice(snapshot.channels?.find(channel => channel.available !== false)?.channel ?? 0); return;}
    channelButtons.forEach((node,index) => {const channel = snapshot.channels?.[index] ?? {}; node.disabled = channel.available === false; node.setAttribute('aria-pressed',String(selected === index)); node.textContent = `CH${index + 1}${channel.active ? ' ▸' : ''}`; node.title = channel.available === false ? 'Reserved for rhythm' : `${YM2413_INSTRUMENTS[channel.instrument] ?? 'Instrument'} · ${noteName(channel.frequency)}`;});
    drumButtons.forEach((node,index) => {node.hidden = !snapshot.rhythm?.enabled; node.setAttribute('aria-pressed',String(selected === `rhythm:${index}`)); node.dataset.sounding = String(Boolean(snapshot.rhythm?.[DRUMS[index][0]]));});
    const voice = current(), drum = drumIndex();
    gate.textContent = `${label()} · ${(voice?.active ?? snapshot.rhythm?.[DRUMS[drum]?.[0]]) ? 'Triggered' : 'Released'}`;
    instrument.disabled = attenuation.disabled = sustain.disabled = frequency.disabled = note.disabled = drum >= 0;
    value(instrument,voice?.instrument); value(attenuation,voice?.attenuation); checked(sustain,voice?.sustain); value(frequency,Number.isFinite(voice?.frequency) ? Number(voice.frequency.toFixed(5)) : null); value(note,noteName(voice?.frequency));
    voiceDescription.textContent = drum >= 0 ? `${DRUMS[drum][1]} · rhythm voice; MIDI keys trigger its configured sound.` : voice?.instrument === 0 ? 'User instrument: this channel uses the one shared User patch below.' : `${YM2413_INSTRUMENTS[voice?.instrument] ?? 'Built-in instrument'} · fixed ROM operator parameters (read-only).`;
    const users = snapshot.channels?.filter(channel => channel.instrument === 0 && channel.available !== false).map(channel => `CH${channel.channel + 1}`) ?? [];
    used.textContent = `Currently used by: ${users.length ? users.join(', ') : 'no melodic channels'}.${voice?.instrument > 0 ? ` Selected CH${selected + 1} uses a built-in instrument and is unaffected by User edits.` : ''}`;
    useUser.disabled = drum >= 0; value(feedback,snapshot.userPatch?.feedback);
    operatorControls.forEach((controls,index) => {for (const [key] of FIELDS) if (controls[key]) FLAGS.has(key) ? checked(controls[key],snapshot.userPatch?.operators?.[index]?.[key]) : value(controls[key],snapshot.userPatch?.operators?.[index]?.[key]);});
    checked(rhythm,snapshot.rhythm?.enabled); drumLevels.forEach((node,index) => {node.disabled = !snapshot.rhythm?.enabled; value(node,snapshot.rhythm?.levels?.[DRUMS[index][0]]);});
    drumPitch.forEach((node,index) => {const hz = snapshot.channels?.[index + 6]?.frequency; value(node,Number.isFinite(hz) ? Number(hz.toFixed(5)) : null);});
    value(code,drum >= 0 ? `opll.setRhythm({enabled:true});\nopll.setRhythmLevel('${DRUMS[drum][0]}', ${snapshot.rhythm?.levels?.[DRUMS[drum][0]] ?? 15});\n// opll.setRhythm({${DRUMS[drum][0]}:true});\n// opll.setRhythm({${DRUMS[drum][0]}:false});` : ym2413VoiceCode(snapshot,selected));
    registers.textContent = Array.from(snapshot.registers ?? [],(n,index) => `${index.toString(16).padStart(2,'0')}: ${Number(n).toString(16).padStart(2,'0')}`).join('  ');
  }
  function setConnected(next) {
    if (disposed) return; next = Boolean(next);
    if (!next) {releaseAll(); if (keyboardActive) {keyboardActive = false; onKeyboardTargetChange(null);} bindingEpoch++; keyboard.setAttribute('aria-pressed','false');}
    if (next !== connected) connectionEpoch++; connected = next; body.disabled = !next;
  }
  updateTarget();
  return {update,setConnected,releaseAll,getSelectedChannel:() => selected,getNoteTarget:() => target,
    setVisible(next) {visible = Boolean(next); if (!visible) {releaseSource('hold'); releaseSource('preview');}},
    setKeyboardActive(next) {if (!next && keyboardActive) {keyboardActive = false; releaseSource('keyboard'); bindingEpoch++; keyboard.setAttribute('aria-pressed','false');}},
    dispose() {if (disposed) return; setConnected(false); disposed = true; for (const remove of listeners) remove();},
  };
}
