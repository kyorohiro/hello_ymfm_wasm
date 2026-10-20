import {OPL_PRESETS} from '../js/opl_synth.js?v=msx-modes-2';

// Rendering applied state is deliberately read-only. Edits and note gestures
// use the same inspector commands as scripts; there is no view-to-audio loop.
const FIELDS = [
  ['multi','MUL',15], ['tl','TL',63], ['ksl','KSL',3],
  ['ar','AR',15], ['dr','DR',15], ['sl','SL',15], ['rr','RR',15],
  ['waveform','Wave',7], ['am','AM',1], ['vibrato','VIB',1], ['egt','EGT',1], ['ksr','KSR',1],
];
const FLAGS = new Set(['am','vibrato','egt','ksr']);
const PAIRS = new Map([[0,3],[1,4],[2,5],[9,12],[10,13],[11,14]]);
// The two CON bits, primary then secondary, select the ymfm OPL3 routes.
const ROUTES_2 = ['OP1 → OP2 → OUT','OP1 + OP2 → OUT'];
const ROUTES_4 = ['OP1 → OP2 → OP3 → OP4 → OUT','OP1 + (OP2 → OP3 → OP4) → OUT','(OP1 → OP2) + (OP3 → OP4) → OUT','OP1 + (OP2 → OP3) + OP4 → OUT'];
const frequencyNote = hz => {
  if (!Number.isFinite(hz) || hz <= 0) return '';
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][(midi % 12 + 12) % 12] + (Math.floor(midi / 12) - 1);
};
let sequence = 0;

export function oplVoiceCode(state, channel = 0) {
  const voice = state?.channels?.[channel]; if (!voice) return '';
  const preset = {algorithm:voice.algorithm, feedback:voice.feedback,
    ...(state.kind === 'ymf262' ? {fourOp:Boolean(voice.fourOp),pan:voice.pan} : {}),
    operators:voice.operators?.map(operator => Object.fromEntries(FIELDS.map(([key]) => [key, FLAGS.has(key) ? Boolean(operator[key]) : operator[key]])))};
  return `opl.setPreset(${channel}, ${JSON.stringify(preset, null, 2)});\n// opl.noteOn(${channel}, 'A4');\n// opl.keyOff(${channel});`;
}

export function createPlaygroundOplVoicePanel({root, kind = 'ym3812', invoke,
  onKeyboardTargetChange = () => {}, onError = () => {}}) {
  const doc = root.ownerDocument ?? globalThis.document, win = doc.defaultView ?? globalThis;
  const stereo = kind === 'ymf262', waveformMax = stereo ? 7 : kind === 'ym3812' ? 3 : 0;
  const label = kind.toUpperCase(), panelId = ++sequence, listeners = [], held = new Map();
  let state = null, channel = 0, connected = false, disposed = false, visible = true;
  let keyboardActive = false, bindingEpoch = 0, connectionEpoch = 0, pressSequence = 0, target, holdPress = null, timer = null;
  const make = (tag, className, text) => {const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;};
  function listen(node, type, handler) {node.addEventListener(type,handler); listeners.push(() => node.removeEventListener(type,handler));}
  function button(parent, text, action, name) {const node = make('button','',text); node.type = 'button'; if (name) node.dataset.chipAction = `opl-${name}`; if (action) listen(node,'click',action); parent.appendChild(node); return node;}
  function field(parent,label) {const node = make('label','chip-field'); node.appendChild(make('span','chip-field-label',label)); parent.appendChild(node); return node;}
  function fields(parent) {const node = make('div','chip-fields'); parent.appendChild(node); return node;}
  function value(node,next) {if (doc.activeElement !== node) node.value = next == null || typeof next === 'number' && !Number.isFinite(next) ? '' : String(next);}
  function checked(node,next) {if (doc.activeElement !== node) node.checked = Boolean(next);}
  function section(title) {const card = make('section','chip-section'); card.appendChild(make('h3','',title)); body.appendChild(card); return card;}
  async function command(method,args = []) {
    if (disposed || !connected) return; const epoch = connectionEpoch;
    try {const result = await invoke(method,args); if (!disposed && connected && epoch === connectionEpoch) {status.textContent = ''; delete status.dataset.error;} return result;}
    catch (error) {if (!disposed && connected && epoch === connectionEpoch) {status.textContent = error.message ?? String(error); status.dataset.error = 'true'; onError(error);}}
  }
  function number(parent,label,name,max,change,{min = 0, step = 1, cell = false} = {}) {
    const node = make('input'); node.type = 'number'; node.min = String(min); if (max !== undefined) node.max = String(max); node.step = String(step); node.dataset.chipControl = `opl-${name}`;
    if (cell) {node.setAttribute('aria-label',label); parent.appendChild(node);} else field(parent,label).appendChild(node);
    listen(node,'change',() => {const n = Number(node.value); if (!node.value.trim() || !Number.isFinite(n) || n < min || max !== undefined && n > max || step === 1 && !Number.isInteger(n)) {node.setCustomValidity('Enter a value within the displayed range.'); node.reportValidity?.(); return;} node.setCustomValidity(''); change?.(n);}); return node;
  }
  function checkbox(parent,label,name,change,cell = false) {
    const node = make('input'); node.type = 'checkbox'; node.dataset.chipControl = `opl-${name}`;
    if (cell) {node.setAttribute('aria-label',label); parent.appendChild(node);} else field(parent,label).appendChild(node);
    listen(node,'change',() => change(node.checked)); return node;
  }
  function select(parent,label,name,choices,change) {
    const node = make('select'); node.dataset.chipControl = `opl-${name}`;
    for (const [key,text] of choices) {const option = make('option','',text); option.value = String(key); node.appendChild(option);}
    field(parent,label).appendChild(node); listen(node,'change',() => change(node.value)); return node;
  }
  const current = () => state?.channels?.[channel] ?? {};
  const available = () => current().available !== false;
  const body = make('fieldset','chip-editor-body'); body.disabled = true; root.appendChild(body);
  const channelList = make('div','chip-channel-list'); channelList.setAttribute('aria-label',`${label} channel`); body.appendChild(channelList);
  const channelButtons = Array.from({length:stereo ? 18 : 9},(_,index) => {const node = button(channelList,`CH${index + 1}`,() => selectChannel(index)); node.dataset.chipChannel = String(index); return node;});
  const selected = section('Selected FM voice'), common = fields(selected);
  const gate = make('output'); gate.dataset.chipOutput = 'opl-gate'; field(common,'Applied key gate').appendChild(gate);
  const frequency = number(common,'Frequency (Hz)','frequency',undefined,n => command('setFrequency',[channel,n]),{min:0.001,step:'any'});
  const note = make('input'); note.type = 'text'; note.placeholder = 'A4'; note.dataset.chipControl = 'opl-note'; field(common,'Note').appendChild(note);
  listen(note,'change',() => {if (note.value.trim()) void command('setNote',[channel,note.value.trim()]);});
  const algorithm = select(common,'Algorithm','algorithm',[[0,'0 · OP1 → OP2'],[1,'1 · OP1 + OP2'],[2,'2 · Four operators'],[3,'3 · Four operators']],n => command('setAlgo',[channel,Number(n)]));
  const feedback = number(common,'Feedback (OP1)','feedback',7,n => command('setAlgo',[channel,Number(algorithm.value),n]));
  const left = checkbox(common,'Left','pan-left',n => command('setPan',[channel,n,right.checked]));
  const right = checkbox(common,'Right','pan-right',n => command('setPan',[channel,left.checked,n]));
  left.parentNode.hidden = right.parentNode.hidden = !stereo;
  const fourOp = checkbox(common,'Four-operator pair','four-op',n => {releaseAll(); void command('setFourOp',[channel,n]);}); fourOp.parentNode.hidden = !stereo;
  const routing = make('p','subtext'); routing.dataset.chipOutput = 'opl-routing'; selected.appendChild(routing);
  const presetFields = fields(selected);
  const presets = select(presetFields,'Original preset','preset',Object.entries(OPL_PRESETS).filter(([,preset]) => stereo || !preset.fourOp).map(([key,preset]) => [key,preset.label ?? preset.name ?? key]),() => {});
  button(presetFields,'Load preset',() => {releaseAll(); void command('setPreset',[channel,OPL_PRESETS[presets.value]]);},'preset');
  const audition = fields(selected), midi = number(audition,'Audition MIDI note','audition-midi',127); midi.value = '69';
  const actions = make('div','chip-actions'); audition.appendChild(actions);
  const hold = button(actions,'Hold to play',null,'hold');
  const preview = button(actions,'Play 1 second',() => {if (!visible) return; releaseSource('preview'); const id = startNote(Number(midi.value),'preview'); if (id) timer = win.setTimeout(() => {timer = null; endNote(id);},1000);},'play');
  button(actions,'Release',releaseAll,'release');
  const keyboard = button(actions,'Use Keyboard',() => {if (!connected || !available()) return; keyboardActive = true; updateTarget(); status.textContent = `${label} CH${channel + 1} is connected to the Guitar Keyboard.`;},'keyboard');
  selected.appendChild(make('p','subtext','Audition and Keyboard use the current operator settings. Loading a preset is explicit. Channels use zero-based numbers in JavaScript; MIDI note 69 is A4 (440 Hz).'));

  const operatorsCard = section('Operators'), scroll = make('div','chip-opm-table-scroll'), table = make('table','chip-opm-table'); scroll.appendChild(table); operatorsCard.appendChild(scroll);
  const head = make('thead'), heading = make('tr'); head.appendChild(heading); table.appendChild(head);
  for (const title of ['Operator',...FIELDS.map(([,title]) => title)]) {const cell = make('th','',title); cell.setAttribute('scope','col'); heading.appendChild(cell);}
  const rows = make('tbody'); table.appendChild(rows);
  const operators = Array.from({length:4},(_,index) => {
    const row = make('tr'), name = make('th','',`OP${index + 1}`); name.setAttribute('scope','row'); row.appendChild(name); rows.appendChild(row);
    const controls = Object.fromEntries(FIELDS.map(([key,title,max]) => {
      const cell = make('td'); row.appendChild(cell); const change = n => command('setOperator',[channel,index,{[key]:n}]);
      const node = FLAGS.has(key) ? checkbox(cell,`OP${index + 1} ${title}`,`op-${index}-${key}`,change,true) : number(cell,`OP${index + 1} ${title}`,`op-${index}-${key}`,key === 'waveform' ? waveformMax : max,change,{cell:true});
      if (key === 'waveform' && waveformMax === 0) node.disabled = true; return [key,node];
    })); return {row,controls};
  });
  operatorsCard.appendChild(make('p','subtext','MUL 0 = ×½; TL 63 is quietest. AR / DR / RR are envelope rates, SL is sustain attenuation. EGT holds the sustain level while a key is down. AM / VIB use the chip-wide LFO. YM3526 and Y8950 use sine only; YM3812 has four waveforms, OPL3 has eight.'));

  const global = section('Global LFO and rhythm'), globals = fields(global);
  const amDepth = checkbox(globals,'Deep amplitude modulation','am-depth',n => command('setLFO',[{amDepth:n}]));
  const pmDepth = checkbox(globals,'Deep vibrato','pm-depth',n => command('setLFO',[{pmDepth:n}]));
  const rhythm = checkbox(globals,'Rhythm mode (reserves CH7–CH9)','rhythm',n => {releaseAll(); void command('setRhythm',[{enabled:n}]);});
  const drums = fields(global);
  const drumControls = ['bassDrum','snare','tom','cymbal','hiHat'].map(name => checkbox(drums,name,`rhythm-${name}`,n => command('setRhythm',[{[name]:n}])));
  global.appendChild(make('p','subtext','Rhythm shares the operators and pitches of physical channels 6–8. Configure those operators before enabling rhythm. Switching rhythm mode releases this panel’s held notes.'));
  const advanced = make('details','chip-advanced'); advanced.appendChild(make('summary','','Voice JavaScript and applied registers')); body.appendChild(advanced);
  const code = make('textarea','chip-voice-code'); code.readOnly = true; code.rows = 10; code.dataset.chipControl = 'opl-code'; code.setAttribute('aria-label',`${label} voice JavaScript`); advanced.appendChild(code);
  button(advanced,'Copy voice JavaScript',async () => {try {await win.navigator.clipboard.writeText(code.value);} catch {code.focus?.(); code.select?.();}},'copy');
  const registers = make('pre','chip-memory-ranges'); registers.dataset.chipOutput = 'opl-registers'; advanced.appendChild(registers);
  const status = make('p','chip-editor-status'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite'); root.appendChild(status);
  root.appendChild(make('p','subtext',`${label} applied settings. Gate indicators show key writes, not measured envelope amplitude.${kind === 'y8950' ? ' This mode provides FM and rhythm; ADPCM sample editing is separate.' : ''}`));

  function startNote(note,source,externalId,epoch) {
    if (!connected || disposed || !available() || !Number.isInteger(note) || note < 0 || note > 127) return null;
    const id = `opl-panel:${panelId}:${++pressSequence}`; held.set(id,{channel,source,externalId,epoch}); void command('auditionOn',[channel,note,id]); return id;
  }
  function endNote(id) {const entry = held.get(id); if (!entry) return; held.delete(id); void command('auditionOff',[entry.channel,id]);}
  function releaseSource(source) {for (const [id,entry] of held) if (entry.source === source) endNote(id); if (source === 'preview' && timer !== null) {win.clearTimeout(timer); timer = null;} if (source === 'hold') {holdPress = null; hold.setAttribute('aria-pressed','false');}}
  function releaseAll() {for (const id of [...held.keys()]) endNote(id); if (timer !== null) {win.clearTimeout(timer); timer = null;} holdPress = null; hold.setAttribute('aria-pressed','false');}
  function updateTarget() {
    const selectedChannel = channel, epoch = ++bindingEpoch;
    target = {owner:'opl-voice-panel',name:`${label} · CH${channel + 1}`,
      noteOn(event) {if (!keyboardActive || !connected || epoch !== bindingEpoch || typeof event?.id !== 'string') return; for (const [id,entry] of held) if (entry.source === 'keyboard' && entry.externalId === event.id && entry.epoch === epoch) endNote(id); startNote(event.midi,'keyboard',event.id,epoch);},
      noteOff(event) {for (const [id,entry] of held) if (entry.source === 'keyboard' && entry.externalId === event?.id && entry.epoch === epoch && entry.channel === selectedChannel) endNote(id);},
      allNotesOff() {for (const [id,entry] of held) if (entry.source === 'keyboard' && entry.epoch === epoch) endNote(id);},
    }; keyboard.setAttribute('aria-pressed',String(keyboardActive)); if (keyboardActive) onKeyboardTargetChange(available() ? target : null);
  }
  function selectChannel(next) {if (channel === next) return; releaseAll(); channel = next; updateTarget(); if (state) update(state);}
  function holdStart(event) {
    if (!visible || !connected || event.type === 'pointerdown' && event.button !== undefined && event.button !== 0 || event.type === 'keydown' && (event.repeat || ![' ','Enter'].includes(event.key))) return;
    event.preventDefault(); releaseSource('hold'); const id = startNote(Number(midi.value),'hold'); if (!id) return; holdPress = {id,pointerId:event.pointerId,key:event.key}; hold.setAttribute('aria-pressed','true'); if (event.pointerId !== undefined) try {hold.setPointerCapture(event.pointerId);} catch {}
  }
  function holdEnd(event) {if (!holdPress || event.pointerId !== undefined && event.pointerId !== holdPress.pointerId || event.type === 'keyup' && event.key !== holdPress.key) return; releaseSource('hold');}
  listen(hold,'pointerdown',holdStart); listen(hold,'keydown',holdStart);
  for (const event of ['pointerup','pointercancel','lostpointercapture','keyup']) listen(hold,event,holdEnd);
  listen(hold,'blur',() => releaseSource('hold')); listen(win,'blur',releaseAll); listen(doc,'visibilitychange',() => {if (doc.hidden) releaseAll();});

  function update(snapshot) {
    if (disposed || !snapshot) return;
    const wasAvailable = available(); state = snapshot;
    const selectedVoice = current();
    if (selectedVoice.pairedWith != null && !selectedVoice.fourOp && selectedVoice.available === false) {selectChannel(selectedVoice.pairedWith); return;}
    if (wasAvailable && !available()) {releaseAll(); if (keyboardActive) updateTarget();}
    channelButtons.forEach((node,index) => {const voice = snapshot.channels?.[index] ?? {}; node.setAttribute('aria-pressed',String(channel === index)); node.disabled = voice.available === false && voice.pairedWith != null && !voice.fourOp; node.textContent = `CH${index + 1}${voice.fourOp ? ' · 4op' : ''}${voice.active ? ' ▸' : ''}`; node.title = voice.available === false ? voice.pairedWith != null ? `Paired with CH${voice.pairedWith + 1}` : 'Reserved for rhythm' : frequencyNote(voice.frequency);});
    const voice = current(); gate.textContent = `${voice.active ? 'Triggered' : 'Released'}${available() ? '' : ' · Reserved for rhythm'}`;
    value(frequency,Number.isFinite(voice.frequency) ? Number(voice.frequency.toFixed(5)) : null); value(note,frequencyNote(voice.frequency)); value(algorithm,voice.algorithm); value(feedback,voice.feedback);
    [...algorithm.children].forEach((node,index) => {node.hidden = index > 1 && !voice.fourOp; node.textContent = `${index} · ${(voice.fourOp ? ROUTES_4 : ROUTES_2)[index] ?? ''}`;});
    checked(left,voice.pan?.left); checked(right,voice.pan?.right); checked(fourOp,voice.fourOp); fourOp.disabled = !PAIRS.has(channel);
    routing.textContent = `${voice.fourOp ? `CH${channel + 1} + CH${(PAIRS.get(channel) ?? channel) + 1} · ` : ''}${(voice.fourOp ? ROUTES_4 : ROUTES_2)[voice.algorithm] ?? '—'} · feedback returns to OP1`;
    operators.forEach(({row,controls},index) => {row.hidden = index >= (voice.fourOp ? 4 : 2); for (const [key] of FIELDS) FLAGS.has(key) ? checked(controls[key],voice.operators?.[index]?.[key]) : value(controls[key],voice.operators?.[index]?.[key]);});
    for (const option of presets.children) option.disabled = Boolean(OPL_PRESETS[option.value]?.fourOp && !PAIRS.has(channel));
    if (OPL_PRESETS[presets.value]?.fourOp && !PAIRS.has(channel)) value(presets,'sine');
    checked(amDepth,snapshot.lfo?.amDepth); checked(pmDepth,snapshot.lfo?.pmDepth); checked(rhythm,snapshot.rhythm?.enabled);
    drumControls.forEach((node,index) => {checked(node,snapshot.rhythm?.[['bassDrum','snare','tom','cymbal','hiHat'][index]]); node.disabled = !snapshot.rhythm?.enabled;});
    hold.disabled = preview.disabled = keyboard.disabled = !available();
    value(code,oplVoiceCode(snapshot,channel));
    registers.textContent = Array.from(snapshot.registers ?? [],(n,index) => `${index.toString(16).padStart(3,'0')}: ${Number(n).toString(16).padStart(2,'0')}`).join('  ');
  }
  function setConnected(next) {
    if (disposed) return; next = Boolean(next);
    if (!next) {releaseAll(); if (keyboardActive) {keyboardActive = false; onKeyboardTargetChange(null);} bindingEpoch++; keyboard.setAttribute('aria-pressed','false');}
    if (next !== connected) connectionEpoch++; connected = next; body.disabled = !next;
  }
  updateTarget();
  return {update,setConnected,releaseAll,getSelectedChannel:() => channel,getNoteTarget:() => target,
    setVisible(next) {visible = Boolean(next); if (!visible) {releaseSource('hold'); releaseSource('preview');}},
    setKeyboardActive(next) {if (!next && keyboardActive) {keyboardActive = false; releaseSource('keyboard'); bindingEpoch++; keyboard.setAttribute('aria-pressed','false');}},
    dispose() {if (disposed) return; setConnected(false); disposed = true; for (const remove of listeners) remove();},
  };
}
