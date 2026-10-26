import {createPlaygroundWonderSwanVoicePanel} from './playground_wonderswan_voice_panel.js?v=wonderswan-mode-2';
import {createPlaygroundDx7VoicePanel} from './playground_dx7_voice_panel.js?v=audio-numeric-bindings-1';
/** Dedicated sound-chip editors. Reads are visible-only; opening an editor never creates a chip. */
import {createPlaygroundGameboyVoicePanel} from './playground_gameboy_voice_panel.js?v=audio-numeric-bindings-1';
import {createPlaygroundSnesVoicePanel} from './playground_snes_voice_panel.js?v=y8950-adpcm-ui-1';
import {createPlaygroundNesVoicePanel} from './playground_nes_voice_panel.js?v=operator-tab-keyboard-1';
import {createPlaygroundHuc6280VoicePanel} from './playground_huc6280_voice_panel.js?v=audio-numeric-bindings-1';
import {createPlaygroundOki6258VoicePanel} from './playground_okim6258_voice_panel.js?v=audio-numeric-bindings-1';
import {createPlaygroundYm2151VoicePanel} from './playground_ym2151_voice_panel.js?v=audio-numeric-bindings-1';
import {createPlaygroundOplVoicePanel} from './playground_opl_voice_panel.js?v=y8950-adpcm-ui-1';
import {createPlaygroundYm2413VoicePanel} from './playground_ym2413_voice_panel.js?v=audio-numeric-bindings-1';
import {createPlaygroundAy8910VoicePanel} from './playground_ay8910_voice_panel.js?v=atari-st-mode-3';

export function frequencyNote(frequency) {
  if (!Number.isFinite(frequency) || frequency <= 0) return '—';
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return names[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

/** RAM start is page-aligned; loop is an exact byte/sample position in the known material. */
export function rfSamplePosition(sample, offset, {start = false} = {}) {
  if (!sample?.valid || !Number.isInteger(sample.address) || !Number.isInteger(sample.frames) || sample.frames < 1) {
    throw new Error('Sample layout is unknown. Load an audio file first.');
  }
  if (!Number.isFinite(offset)) throw new RangeError('Sample position must be finite');
  let address = sample.address + Math.round(Math.max(0, Math.min(sample.frames - 1, offset)));
  if (start) address = Math.max(sample.address, Math.floor(address / 256) * 256);
  return address;
}

export function pwmRoutingControl(control, side, route) {
  if (!['left', 'right'].includes(side) || !Number.isInteger(route) || route < 0 || route > 3) throw new RangeError('Invalid PWM routing');
  const shift = side === 'left' ? 0 : 2;
  return ((control & 0xffff) & ~(3 << shift)) | (route << shift);
}

const AUDIO_FILE = /\.(?:wav|wave|aif|aiff|mp3|ogg|flac|m4a|aac|webm)$/i;
const OPL_KINDS = ['ym3812', 'ym3526', 'y8950', 'ymf262'];
const KINDS = ['segapsg', 'rf5c164', 'pwm', 'gameboy', 'nes', 'snes', 'ym2151', 'okim6258', 'huc6280', 'wonderswan', 'dx7', 'ym2413', 'ay8910', ...OPL_KINDS];
const nativePanels = {wonderswan:createPlaygroundWonderSwanVoicePanel,gameboy:createPlaygroundGameboyVoicePanel,nes:createPlaygroundNesVoicePanel,snes:createPlaygroundSnesVoicePanel,ym2151:createPlaygroundYm2151VoicePanel,okim6258:createPlaygroundOki6258VoicePanel,huc6280:createPlaygroundHuc6280VoicePanel,dx7:createPlaygroundDx7VoicePanel,ym2413:createPlaygroundYm2413VoicePanel,ay8910:createPlaygroundAy8910VoicePanel};
for (const kind of OPL_KINDS) nativePanels[kind] = options => createPlaygroundOplVoicePanel({...options,kind});
const finiteText = (value, digits = 0) => Number.isFinite(value) ? Number(value.toFixed(digits)).toString() : '—';
const hex = value => Number.isInteger(value) ? `0x${value.toString(16).toUpperCase().padStart(4, '0')}` : '—';

/** Reveal extra chip tabs from connection metadata; never read or create audio. */
export function createPlaygroundAdditionalChipTabAvailability({getInspector,kinds,primaryKinds=[],onAvailability}) {
  let disposed=false,source=null,unsubscribe=null;const previous=new Map(),primary=new Set(primaryKinds);
  function refresh(){
    if(disposed)return;const next=getInspector?.();
    if(next!==source){unsubscribe?.();source=next;unsubscribe=source?.subscribe?.(refresh);}
    const entries=source?.list?.()??[];
    for(const kind of kinds){const available=primary.has(kind)||entries.some(entry=>entry.kind===kind&&entry.additional===true&&entry.connected!==false);
      if(previous.get(kind)!==available){previous.set(kind,available);onAvailability(kind,available);}}
  }
  refresh();return {refresh,dispose(){disposed=true;unsubscribe?.();unsubscribe=null;source=null;}};
}

export function createPlaygroundChipTabs({roots, getInspector, listFiles = () => [], readFile, openSampleEditor,
  ensureAudioReady, onKeyboardTargetChange = () => {}, onAuditionTargetChange = () => {}, onError = () => {}, pollMs = 300, eventDrivenAdditionalKinds = []}) {
  let visible = null, generation = 0, disposed = false, timer = null, inspector = null, unsubscribe = null;
  const editors = new Map(), eventDriven = new Set(eventDrivenAdditionalKinds);
  let keyboardEditor = null;
  let auditionSelection = '';
  const doc = Object.values(roots).find(Boolean)?.ownerDocument ?? globalThis.document;
  const make = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text, handler) => {
    const node = make('button', '', text); node.type = 'button';
    node.addEventListener('click', handler); return node;
  };
  const option = (value, text) => { const node = make('option', '', text); node.value = String(value); return node; };

  const connectionFor=(source,id)=>id?source?.getConnectionToken?.(id)??null:null;
  function currentConnection(source,id,connection){try{return getInspector?.()===source&&connectionFor(source,id)===connection;}catch{return false;}}

  function publishAuditionTarget() {
    const editor = editors.get(visible);
    const selection = editor && editor.kind !== 'pwm'
      ? {kind:editor.kind, id:editor.id, channel:editor.voicePanel?.getSelectedChannel?.() ?? editor.channel}
      : null;
    const signature = JSON.stringify(selection);
    if (signature === auditionSelection) return;
    auditionSelection = signature;
    onAuditionTargetChange(selection);
  }

  function setValue(input, value) {
    if (doc.activeElement === input) return;
    input.value = value === undefined || value === null || (typeof value === 'number' && !Number.isFinite(value)) ? '' : String(value);
  }
  function syncOptions(select, values, selected = select.value) {
    const signature = JSON.stringify(values);
    if (select._chipOptions !== signature) {
      select.replaceChildren(...values.map(([value, label]) => option(value, label)));
      select._chipOptions = signature;
    }
    setValue(select, values.some(([value]) => String(value) === String(selected)) ? selected : values[0]?.[0] ?? '');
  }
  function row(parent, label) {
    const field = make('label', 'chip-field');
    field.appendChild(make('span', 'chip-field-label', label)); parent.appendChild(field); return field;
  }
  function number(parent, label, name, {min, max, step = 1, type = 'number', change} = {}) {
    const field = row(parent, label), input = make('input'); input.type = type; input.dataset.chipControl = name;
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    input.step = String(step); field.appendChild(input);
    input.addEventListener(type === 'range' ? 'input' : 'change', () => {
      const value = Number(input.value);
      if (!input.value.trim() || !Number.isFinite(value) || (min !== undefined && value < min) || (max !== undefined && value > max) || (step === 1 && !Number.isInteger(value))) {
        input.setCustomValidity('Enter a value within the displayed range.'); input.reportValidity?.(); return;
      }
      input.setCustomValidity(''); change?.(value);
    });
    return input;
  }
  function select(parent, label, name, values, change) {
    const field = row(parent, label), input = make('select'); input.dataset.chipControl = name;
    field.appendChild(input); syncOptions(input, values);
    input.addEventListener('change', () => change(input.value)); return input;
  }
  function output(parent, label) { const field = row(parent, label), out = make('output'); field.appendChild(out); return out; }
  function section(parent, title) { const node = make('section', 'chip-section'); node.appendChild(make('h3', '', title)); parent.appendChild(node); return node; }
  function details(parent, title) { const node = make('details', 'chip-advanced'); node.appendChild(make('summary', '', title)); parent.appendChild(node); return node; }
  function error(editor, error) {
    const message = error?.message ?? String(error);
    const changed = editor.status.textContent !== message || !editor.status.dataset.error;
    editor.status.textContent = message;
    editor.status.dataset.error = 'true'; if (changed) onError(error);
  }
  async function run(editor, method, args = []) {
    if (disposed) return;
    const target = editor.id, source = getInspector?.();
    if (!target || !source) return;
    generation += 1;
    try {
      await source.invoke(target, method, args);
      if (!disposed && editor.id === target) { editor.status.textContent = ''; delete editor.status.dataset.error; }
    } catch (e) { if (!disposed && editor.id === target) error(editor, e); }
    if (!disposed && visible === editor.kind && editor.id === target) refresh();
  }

  function buildBase(kind, root) {
    root.classList.add('chip-editor');
    const toolbar = make('div', 'chip-editor-toolbar'); root.appendChild(toolbar);
    const editor = {kind, root, id: '', connection: null, additional: false, snapshot: null, channel: 0, selectionVersion: 0};
    editor.instances = select(toolbar, 'Sound chip', 'instance', [], value => {
      detachNative(editor);
      editor.id = value; editor.snapshot = null; editor.selectionVersion += 1; delete editor.status.dataset.error; editor.status.textContent = ''; generation += 1; publishAuditionTarget(); refresh();
    });
    const refreshButton = button('Refresh', () => refresh()); toolbar.appendChild(refreshButton);
    if (kind !== 'pwm' && ensureAudioReady) {
      const prepare = button('Prepare audio', async () => {
        prepare.disabled = true;
        try {await ensureAudioReady(); if (!disposed) await refresh();}
        catch (e) {if (!disposed) error(editor,e);}
        finally {if (!disposed) prepare.disabled = false;}
      });
      prepare.dataset.chipAction = 'prepare'; toolbar.appendChild(prepare);
    }
    editor.status = make('p', 'chip-editor-status'); editor.status.setAttribute('role', 'status'); editor.status.setAttribute('aria-live', 'polite'); root.appendChild(editor.status);
    editor.body = make('fieldset', 'chip-editor-body'); editor.body.disabled = true; root.appendChild(editor.body);
    // Channel buttons update synchronously in their own panel. Read selection
    // after that UI event without sending audio commands or starting a poll.
    editor.body.addEventListener('click', publishAuditionTarget);
    editor.body.addEventListener('change', publishAuditionTarget);
    editor.note = make('p', 'subtext'); root.appendChild(editor.note);
    editors.set(kind, editor); return editor;
  }

  function detachNative(editor) {
    if (!editor.voicePanel) return;
    if (keyboardEditor === editor) {keyboardEditor = null; onKeyboardTargetChange(null);}
    editor.voicePanel.dispose(); editor.voicePanel = null; editor.voiceSource = null; editor.voiceId = null;
    editor.body.replaceChildren();
  }
  function buildNative(editor) {
    editor.update = snapshot => {
      const source = getInspector?.(), id = editor.id, connection=editor.connection, version=editor.selectionVersion;
      if (editor.voiceSource !== source || editor.voiceId !== id || editor.voiceConnection !== connection) detachNative(editor);
      if (!editor.voicePanel) {
        editor.voiceSource = source; editor.voiceId = id; editor.voiceConnection = connection;
        const live=()=>!disposed&&editor.voiceSource===source&&editor.voiceId===id&&editor.selectionVersion===version&&currentConnection(source,id,connection);
        const invoke = async (method,args = []) => {
          if (!live()) throw new DOMException('Sound chip changed','AbortError');
          const value = await source.invoke(id,method,args);
          if (live()) {editor.status.textContent = ''; delete editor.status.dataset.error;}
          if (live() && visible === editor.kind) void refresh();
          return value;
        };
        const loadSample = async (input, options = {}) => {
          if (!live()) throw new DOMException('Sound chip changed','AbortError');
          options.signal?.throwIfAborted();
          const result = await source.loadSample(id,input,options);
          if (live() && visible === editor.kind) void refresh();
          return result;
        };
        const factory = nativePanels[editor.kind];
        const editSample = openSampleEditor && (async (options = {}, context = {}) => {
          if (!live()) throw new DOMException('Sound chip changed','AbortError');
          context.signal?.throwIfAborted();
          const value = await openSampleEditor(options,context);
          context.signal?.throwIfAborted();
          if (!live()) throw new DOMException('Sound chip changed','AbortError');
          return value;
        });
        editor.voicePanel = factory({root:editor.body,invoke,listFiles,readFile,loadSample,openSampleEditor:editSample,onError:e=>error(editor,e),onKeyboardTargetChange:target=>{
          if (target) {
            if (keyboardEditor && keyboardEditor !== editor) keyboardEditor.voicePanel?.setKeyboardActive?.(false);
            keyboardEditor = editor; onKeyboardTargetChange(target);
          } else if (keyboardEditor === editor) {keyboardEditor = null; onKeyboardTargetChange(null);}
        }});
        editor.voicePanel.setVisible(visible === editor.kind);
      }
      editor.voicePanel.setConnected(true); editor.voicePanel.update(snapshot);
      editor.note.textContent = 'Readback shows applied chip settings. Hold a preview button or connect the selected channel to Keyboard to audition the current sound.';
    };
  }

  function buildPsg(editor) {
    const channels = make('div', 'chip-channel-list'); channels.setAttribute('aria-label', 'Sega PSG Keyboard channel'); editor.body.appendChild(channels);
    const channelButtons = ['Tone CH1', 'Tone CH2', 'Tone CH3', 'Noise'].map((label, channel) => {
      const node = button(label, () => {
        editor.channel = channel;
        channelButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === channel)));
        publishAuditionTarget();
      });
      node.dataset.chipKeyboardChannel = String(channel); node.setAttribute('aria-pressed', String(channel === editor.channel)); channels.appendChild(node); return node;
    });
    const tones = [];
    for (let ch = 0; ch < 3; ch++) {
      const card = section(editor.body, `Tone CH${ch + 1}`), fields = make('div', 'chip-fields'); card.appendChild(fields);
      const frequency = number(fields, 'Frequency (Hz)', `tone-${ch}-frequency`, {min: 0.001, step: 'any', change: value => run(editor, 'setFrequency', [ch, value])});
      const noteField = row(fields, 'Note'), note = make('input'); note.type = 'text'; note.placeholder = 'A4'; note.dataset.chipControl = `tone-${ch}-note`; noteField.appendChild(note);
      note.addEventListener('change', () => { if (note.value.trim()) run(editor, 'setNote', [ch, note.value.trim()]); });
      const volume = number(fields, 'Volume', `tone-${ch}-volume`, {min: 0, max: 15, type: 'range', change: value => run(editor, 'setAttenuation', [ch, 15 - value])});
      const volumeLabel = make('output'); volume.parentNode.appendChild(volumeLabel);
      const state = output(fields, 'Output'), actions = make('div', 'chip-actions');
      actions.append(button('On', () => run(editor, 'keyOn', [ch])), button('Off', () => run(editor, 'keyOff', [ch]))); fields.appendChild(actions);
      const advanced = details(card, 'Raw tone settings'), raw = make('div', 'chip-fields'); advanced.appendChild(raw);
      const period = number(raw, 'Period (10-bit)', `tone-${ch}-period`, {min: 0, max: 1023, change: value => run(editor, 'setPeriod', [ch, value])});
      const attenuation = number(raw, 'Attenuation (0 loud / 15 silent)', `tone-${ch}-attenuation`, {min: 0, max: 15, change: value => run(editor, 'setAttenuation', [ch, value])});
      tones.push({frequency, note, volume, volumeLabel, state, period, attenuation});
    }
    const noiseCard = section(editor.body, 'Noise'), fields = make('div', 'chip-fields'); noiseCard.appendChild(fields);
    const noiseChange = () => run(editor, 'setNoise', [{type: type.value, rate: rate.value}]);
    const type = select(fields, 'Type', 'noise-type', [['white', 'White'], ['periodic', 'Periodic']], noiseChange);
    const rate = select(fields, 'Rate / source', 'noise-rate', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['tone3', 'Tone CH3']], noiseChange);
    const noiseVolume = number(fields, 'Volume', 'noise-volume', {min: 0, max: 15, type: 'range', change: value => run(editor, 'setAttenuation', [3, 15 - value])});
    const noiseVolumeLabel = make('output'); noiseVolume.parentNode.appendChild(noiseVolumeLabel);
    const noiseState = output(fields, 'Output'), actions = make('div', 'chip-actions');
    actions.append(button('On', () => run(editor, 'noise', [{type: type.value, rate: rate.value, attenuation: 15 - Number(noiseVolume.value)}])), button('Off', () => run(editor, 'noiseOff'))); fields.appendChild(actions);
    const dependency = make('p', 'subtext'); noiseCard.appendChild(dependency);
    editor.update = state => {
      tones.forEach((ui, ch) => {
        const channel = state.channels?.[ch] ?? {};
        setValue(ui.frequency, Number.isFinite(channel.frequency) ? Number(channel.frequency.toFixed(3)) : null);
        setValue(ui.note, frequencyNote(channel.frequency) === '—' ? '' : frequencyNote(channel.frequency));
        setValue(ui.volume, 15 - channel.attenuation); ui.volumeLabel.textContent = `${finiteText((15 - channel.attenuation) / 15 * 100)}%`;
        ui.state.textContent = channel.active === undefined ? 'Unknown' : channel.active ? channel.constantOutput ? 'Constant output' : 'On' : 'Silent';
        setValue(ui.period, channel.period); setValue(ui.attenuation, channel.attenuation);
      });
      const noise = state.noise ?? {};
      setValue(type, noise.type); setValue(rate, noise.rate); setValue(noiseVolume, 15 - noise.attenuation);
      noiseVolumeLabel.textContent = `${finiteText((15 - noise.attenuation) / 15 * 100)}%`;
      noiseState.textContent = noise.active === undefined ? 'Unknown' : noise.active ? 'On' : 'Silent';
      dependency.textContent = noise.rate === 'tone3' ? 'Noise rate follows Tone CH3. Changing CH3 also changes the noise rate.' : 'Changing the noise type or rate restarts the hardware noise sequence.';
      editor.note.textContent = `Clock: ${finiteText(state.clock)} Hz · No hardware ADSR or duty control. Values are applied chip state; scheduled writes may still be pending.`;
    };
  }

  function buildRf(editor) {
    const channelButtons = make('div', 'chip-channel-list'); channelButtons.setAttribute('aria-label', 'RF5C164 channel'); editor.body.appendChild(channelButtons);
    const buttons = Array.from({length: 8}, (_, ch) => {
      const node = button(`CH${ch + 1}`, () => { if (editor.channel !== ch) editor.selectionVersion += 1; editor.channel = ch; if (editor.snapshot) editor.update(editor.snapshot); publishAuditionTarget(); });
      node.dataset.chipChannel = String(ch); channelButtons.appendChild(node); return node;
    });
    const material = section(editor.body, 'Sample RAM'), chooser = make('div', 'chip-fields'); material.appendChild(chooser);
    const files = select(chooser, 'Virtual Files audio', 'rf-file', [], () => {});
    let loading = false;
    const load = button('Load audio file', async () => {
      const path = files.value, target = editor.id, source = getInspector?.();
      const selectedChannel = editor.channel, selectionVersion = editor.selectionVersion;
      if (disposed || loading || !path || !target || !source || !readFile) return;
      loading = true; load.disabled = true; editor.status.textContent = `Loading ${path}…`;
      try {
        let bytes = await readFile(path); if (bytes?.data !== undefined) bytes = bytes.data;
        if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) throw new TypeError('The selected file has no audio bytes.');
        const loaded = await source.loadSample(target, bytes, {name: path});
        if (!disposed && editor.id === target && getInspector?.() === source) {
          delete editor.status.dataset.error;
          if (editor.selectionVersion === selectionVersion && editor.channel === selectedChannel) {
            generation += 1;
            await source.invoke(target, 'setChannel', [selectedChannel, sampleOptions(loaded, channel())]);
            if (!disposed && editor.id === target && editor.selectionVersion === selectionVersion) editor.status.textContent = `Sample loaded and assigned to CH${selectedChannel + 1}. Press On to preview.`;
          } else editor.status.textContent = 'Sample loaded into a free RAM region. Selection changed; choose the sample below to assign it.';
        }
      } catch (e) { if (!disposed && editor.id === target) error(editor, e); }
      finally { loading = false; if (!disposed) { load.disabled = false; if (visible === editor.kind && editor.id === target) refresh(); } }
    }); chooser.appendChild(load);
    const sample = select(chooser, 'Channel sample', 'rf-sample', [], value => {
      const known = editor.snapshot?.samples?.find(entry => String(entry.address) === value && entry.valid);
      if (known) {
        run(editor, 'setChannel', [editor.channel, sampleOptions(known, channel())]);
      }
    });
    const memory = make('p', 'subtext'); material.appendChild(memory);
    const waveform = make('canvas', 'chip-sample-waveform'); waveform.width = 720; waveform.height = 150; waveform.setAttribute('role', 'img'); waveform.setAttribute('aria-label', 'Sample waveform and start/loop markers'); material.appendChild(waveform);
    const markerFields = make('div', 'chip-fields'); material.appendChild(markerFields);
    const marker = select(markerFields, 'Drag marker', 'rf-marker', [['start', 'Start'], ['loop', 'Loop']], () => {});
    const startOffset = number(markerFields, 'Start offset (samples, 256-byte pages)', 'rf-start-offset', {min: 0, change: value => editPosition('start', value)});
    const loopOffset = number(markerFields, 'Loop offset (samples)', 'rf-loop-offset', {min: 0, change: value => editPosition('loop', value)});
    const loopMode = select(markerFields, 'At sample end', 'rf-loop-mode', [['silence', 'Silence'], ['loop', 'Loop']], value => {
      const known = currentSample(); if (!known) return;
      run(editor, 'setChannel', [editor.channel, {loopStart: value === 'silence' ? known.address + known.frames + 1 : known.address}]);
    });
    const info = make('p', 'subtext', 'Choose Start or Loop, then click or drag the waveform. Start is aligned to 256-byte RAM pages.'); material.appendChild(info);
    const card = section(editor.body, 'Selected channel'), fields = make('div', 'chip-fields'); card.appendChild(fields);
    const speed = number(fields, 'Playback speed (× original)', 'rf-speed', {min: 0.001, step: 'any', change: value => {
      const known = currentSample(); if (!known?.step) return;
      const step = Math.round(known.step * value);
      if (step < 1 || step > 65535) return error(editor, new RangeError('Playback step must be 1..65535.'));
      run(editor, 'setChannel', [editor.channel, {step}]);
    }});
    const volume = number(fields, 'Volume', 'rf-volume', {min: 0, max: 255, type: 'range', change: value => run(editor, 'setChannel', [editor.channel, {volume: value}])});
    const volumeLabel = make('output'); volume.parentNode.appendChild(volumeLabel);
    const left = number(fields, 'Left gain', 'rf-left', {min: 0, max: 15, change: value => setGain('left', value)});
    const right = number(fields, 'Right gain', 'rf-right', {min: 0, max: 15, change: value => setGain('right', value)});
    const active = output(fields, 'Output'), actions = make('div', 'chip-actions');
    actions.append(button('On', () => run(editor, 'keyOn', [editor.channel])), button('Off', () => run(editor, 'keyOff', [editor.channel]))); fields.appendChild(actions);
    const advanced = details(card, 'RAM addresses and raw playback step'), raw = make('div', 'chip-fields'); advanced.appendChild(raw);
    const rawStart = number(raw, 'Start address (256-byte aligned)', 'rf-start-address', {min: 0, max: 65280, step: 256, change: value => {
      if (value % 256) return error(editor, new RangeError('Start must be 256-byte aligned.'));
      run(editor, 'setChannel', [editor.channel, {start: value}]);
    }});
    const rawLoop = number(raw, 'Loop address', 'rf-loop-address', {min: 0, max: 65535, change: value => run(editor, 'setChannel', [editor.channel, {loopStart: value}])});
    const rawStep = number(raw, 'Raw step', 'rf-step', {min: 0, max: 65535, change: value => run(editor, 'setChannel', [editor.channel, {step: value}])});
    const memoryRanges = make('pre', 'chip-memory-ranges'); advanced.appendChild(memoryRanges);
    function channel() { return editor.snapshot?.channels?.[editor.channel] ?? {}; }
    function unconfigured(ch) { return ch.step === 0 && ch.volume === 0 && ch.pan?.left === 0 && ch.pan?.right === 0; }
    function sampleOptions(known, ch) {
      const address = known?.address ?? known?.start;
      if (!Number.isInteger(address) || !Number.isInteger(known?.step)) throw new Error('Loaded sample position or playback step is unavailable.');
      const defaults = unconfigured(ch) ? {volume: 255, pan: {left: 15, right: 15}} : {};
      return {start: address, loopStart: known.loopStart ?? address + known.frames + 1, step: known.step, ...defaults};
    }
    function currentSample() {
      const ch = channel(); if (unconfigured(ch)) return null;
      const start = ch.start;
      return editor.snapshot?.samples?.find(entry => entry.valid && start >= entry.address && start < entry.address + entry.frames) ?? null;
    }
    function setGain(side, value) {
      const pan = channel().pan;
      if (!pan || !Number.isFinite(pan.left) || !Number.isFinite(pan.right)) return;
      run(editor, 'setChannel', [editor.channel, {pan: {...pan, [side]: value}}]);
    }
    function editPosition(kind, offset) {
      const known = currentSample();
      try { run(editor, 'setChannel', [editor.channel, {[kind === 'start' ? 'start' : 'loopStart']: rfSamplePosition(known, offset, {start: kind === 'start'})}]); }
      catch (e) { error(editor, e); }
    }
    let drag = null;
    function dragTo(event) {
      if (!drag || !currentSample()) return;
      const rect = waveform.getBoundingClientRect();
      if (!rect.width) return;
      drag.offset = Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * (currentSample().frames - 1));
      drawWaveform(currentSample(), {...channel(), [drag.kind === 'start' ? 'start' : 'loopStart']: rfSamplePosition(currentSample(), drag.offset, {start: drag.kind === 'start'})});
    }
    waveform.addEventListener('pointerdown', event => {
      if (!currentSample() || editor.body.disabled) return;
      drag = {kind: marker.value, offset: 0, id: editor.id, channel: editor.channel};
      waveform.setPointerCapture?.(event.pointerId); dragTo(event);
    });
    waveform.addEventListener('pointermove', dragTo);
    waveform.addEventListener('pointerup', event => {
      if (!drag) return; dragTo(event); const done = drag; drag = null;
      if (done.id === editor.id && done.channel === editor.channel) editPosition(done.kind, done.offset);
    });
    waveform.addEventListener('pointercancel', () => { drag = null; if (editor.snapshot) editor.update(editor.snapshot); });
    function drawWaveform(known, state) {
      const ctx = waveform.getContext('2d'); if (!ctx) return;
      const w = waveform.width, h = waveform.height; ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#57616e'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
      if (!known?.waveform?.length) { ctx.fillStyle = '#aab5c5'; ctx.font = '14px sans-serif'; ctx.fillText('Waveform unavailable for raw RAM data', 12, 24); return; }
      const points = known.waveform; ctx.strokeStyle = '#7bbcf7'; ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const value = Number.isFinite(points[i]) ? Math.max(-1, Math.min(1, points[i])) : 0;
        const x = i / Math.max(1, points.length - 1) * w, y = h / 2 - value * (h / 2 - 18);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      } ctx.stroke();
      for (const [name, address, color] of [['Start', state.start, '#85db99'], ['Loop', state.loopStart, '#f7bd69']]) {
        const offset = address - known.address; if (!Number.isFinite(offset) || offset < 0 || offset >= known.frames) continue;
        const x = offset / Math.max(1, known.frames - 1) * w;
        ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); ctx.fillStyle = color; ctx.fillText(name, Math.min(w - 45, x + 4), name === 'Start' ? 13 : h - 7);
      }
    }
    editor.update = state => {
      const ch = channel(), known = currentSample();
      buttons.forEach((node, index) => {
        node.setAttribute('aria-pressed', String(editor.channel === index));
        node.dataset.sounding = String(state.channels?.[index]?.active === true);
        node.textContent = `CH${index + 1}${state.channels?.[index]?.active ? ' ▸' : ''}`;
      });
      const paths = Array.from(listFiles?.() ?? []).map(file => typeof file === 'string' ? file : file.path).filter(path => AUDIO_FILE.test(path ?? '') && !path.startsWith('/.tet.'));
      syncOptions(files, paths.length ? paths.map(path => [path, path]) : [['', 'No audio files in this Cassette']]);
      load.disabled = loading || !files.value || !readFile;
      const samples = (state.samples ?? []).filter(entry => entry.valid);
      syncOptions(sample, [['', 'Unknown / no known sample'], ...samples.map(entry => [String(entry.address), `${entry.name || 'Sample'} · ${hex(entry.address)}`])], known ? String(known.address) : '');
      const occupied = state.memoryRanges ?? samples;
      const used = occupied.reduce((sum, entry) => sum + Math.max(0, entry.end - entry.address), 0);
      memory.textContent = `${samples.length} known sample${samples.length === 1 ? '' : 's'} · ${used.toLocaleString()} / 65,536 bytes reserved. Raw memory writes can invalidate sample information.`;
      memoryRanges.textContent = occupied.length ? occupied.map(entry => `${hex(entry.address)}–${hex(entry.end - 1)}  occupied`).join('\n') + (samples.length ? '\n' + samples.map(entry => `${hex(entry.address)}  ${entry.name || 'Sample'} (${entry.frames} samples)`).join('\n') : '\nRaw RAM contents: sample information unknown.') : 'No tracked sample allocations.';
      setValue(startOffset, known ? ch.start - known.address : null); startOffset.disabled = !known; startOffset.max = known ? String(known.frames - 1) : '';
      const looping = known && ch.loopStart >= known.address && ch.loopStart < known.address + known.frames;
      setValue(loopOffset, looping ? ch.loopStart - known.address : null); loopOffset.disabled = !known; loopOffset.max = known ? String(known.frames - 1) : '';
      setValue(loopMode, looping ? 'loop' : 'silence'); loopMode.disabled = !known;
      marker.disabled = !known; setValue(speed, known?.step ? Number((ch.step / known.step).toFixed(4)) : null); speed.disabled = !known?.step;
      setValue(volume, ch.volume); volumeLabel.textContent = `${finiteText(ch.volume / 255 * 100)}%`; setValue(left, ch.pan?.left); setValue(right, ch.pan?.right);
      active.textContent = ch.active === undefined ? 'Unknown' : ch.active ? 'On' : 'Off';
      setValue(rawStart, ch.start); setValue(rawLoop, ch.loopStart); setValue(rawStep, ch.step);
      if (!drag) drawWaveform(known, ch);
      editor.note.textContent = `Clock: ${finiteText(state.clock)} Hz · 8 PCM channels share 64 KiB RAM. Left/right gains are independent (0–15). Raw step is not Hz. Values are applied chip state.`;
    };
  }

  function buildPwm(editor) {
    const card = section(editor.body, 'PWM output'), fields = make('div', 'chip-fields'); card.appendChild(fields);
    const routing = [['0', 'Off'], ['1', 'Normal'], ['2', 'Swap'], ['3', 'Off (reserved mode)']];
    const left = select(fields, 'Left FIFO routing', 'pwm-left-route', routing, value => setRouting('left', value));
    const right = select(fields, 'Right FIFO routing', 'pwm-right-route', routing, value => setRouting('right', value));
    const cycle = number(fields, 'PWM cycle register', 'pwm-cycle', {min: 0, max: 4095, change: value => run(editor, 'writeRegister', [1, value])});
    const frequency = output(fields, 'Update rate'), fifoLeft = output(fields, 'Left FIFO'), fifoRight = output(fields, 'Right FIFO');
    const queued = output(fields, 'Queued writes'), frame = output(fields, 'Output frame');
    const advanced = details(editor.body, 'Clock and raw registers'), raw = make('div', 'chip-fields'); advanced.appendChild(raw);
    const clock = output(raw, 'Chip clock (Hz)'), sampleRate = output(raw, 'Output sample rate (Hz)'), mode = output(raw, 'Output model');
    const control = number(raw, 'Control register', 'pwm-control', {min: 0, max: 65535, change: value => run(editor, 'writeRegister', [0, value])});
    const registers = make('pre', 'chip-memory-ranges'); advanced.appendChild(registers);
    function setRouting(side, value) {
      if (!Number.isInteger(editor.snapshot?.control)) return;
      run(editor, 'writeRegister', [0, pwmRoutingControl(editor.snapshot.control, side, Number(value))]);
    }
    function fifo(value) { return !value ? 'Unknown' : value.full ? 'Full' : value.empty ? 'Empty' : 'Contains data'; }
    editor.update = state => {
      const word = state.control;
      setValue(left, Number.isInteger(word) ? word & 3 : null); setValue(right, Number.isInteger(word) ? (word >> 2) & 3 : null);
      setValue(cycle, state.cycle); setValue(control, word);
      const actualCycle = state.cycle === 0 ? 4095 : state.cycle;
      frequency.textContent = actualCycle > 1 && (word & 15) ? `${finiteText(state.clock / (actualCycle - 1), 2)} Hz` : 'Inactive';
      fifoLeft.textContent = fifo(state.fifo?.left); fifoRight.textContent = fifo(state.fifo?.right);
      queued.textContent = finiteText(state.queuedWrites); frame.textContent = finiteText(state.currentFrame);
      clock.textContent = finiteText(state.clock); sampleRate.textContent = finiteText(state.sampleRate); mode.textContent = `${state.model ?? '—'} / ${state.outputMode ?? '—'}`;
      registers.textContent = (state.registers ?? []).map((value, index) => `R${index}: ${hex(value)}`).join('  ');
      editor.note.textContent = 'PCM streaming output, not an oscillator or an 8-channel sampler. FIFO reads show status flags without consuming samples. This editor does not submit PCM data.';
    };
  }

  for (const kind of KINDS) {
    if (!roots[kind]) continue;
    const editor = buildBase(kind, roots[kind]);
    (nativePanels[kind] ? buildNative : {segapsg:buildPsg,rf5c164:buildRf,pwm:buildPwm}[kind])(editor);
    editor.status.textContent = 'No connected instance. Run code that uses this sound chip first.';
  }
  function connectInspector() {
    const next = getInspector?.() ?? null;
    if (inspector === next) return;
    unsubscribe?.(); unsubscribe = null; inspector = next;
    if (inspector?.subscribe) unsubscribe = inspector.subscribe(() => { if (visible) refresh(); });
  }
  function cancelTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
  function schedule() {
    cancelTimer();
    const editor=editors.get(visible);
    if(editor?.additional&&eventDriven.has(visible))return;
    if (!disposed && visible && !doc.hidden) timer = setTimeout(() => { timer = null; refresh(); }, pollMs);
  }
  async function refresh() {
    if (disposed || !visible || doc.hidden) return;
    cancelTimer(); connectInspector();
    const editor = editors.get(visible); if (!editor) return;
    const token = ++generation, source = inspector;
    const list = source?.list?.() ?? [];
    const matches = list.filter(entry => entry.kind === visible && entry.connected !== false);
    if (!matches.some(entry => entry.id === editor.id)) { detachNative(editor); editor.id = matches[0]?.id ?? ''; editor.snapshot = null; editor.selectionVersion += 1; delete editor.status.dataset.error; editor.status.textContent = ''; }
    let resolvedConnection;try{resolvedConnection=connectionFor(source,editor.id);}catch{resolvedConnection=undefined;}
    if(editor.connection!==resolvedConnection){detachNative(editor);editor.connection=resolvedConnection;editor.snapshot=null;editor.selectionVersion+=1;}
    editor.additional=matches.find(entry=>entry.id===editor.id)?.additional===true;
    publishAuditionTarget();
    syncOptions(editor.instances, matches.length ? matches.map(entry => [entry.id, entry.label || entry.id]) : [['', 'No connected instance']], editor.id);
    editor.instances.disabled = !matches.length; editor.body.disabled = !editor.id || !editor.snapshot;
    if (!editor.id || !source) {
      editor.status.textContent = nativePanels[editor.kind] ? 'Prepare audio to inspect and play this mode’s sound chip, or Run your code.' : 'No connected instance. Run code that uses this sound chip first.';
      schedule(); return;
    }
    const id = editor.id, connection=editor.connection;
    try {
      const snapshot = await source.read(id);
      if (disposed || doc.hidden || token !== generation || visible !== editor.kind || editor.id !== id || !currentConnection(source,id,connection)) return;
      editor.snapshot = snapshot; editor.body.disabled = false;
      if (!editor.status.dataset.error && /^(No connected|Prepare audio)/.test(editor.status.textContent)) editor.status.textContent = '';
      editor.update(snapshot);
      publishAuditionTarget();
    } catch (e) {
      if (!disposed && !doc.hidden && token === generation && visible === editor.kind && editor.id === id && currentConnection(source,id,connection)) { editor.body.disabled = true; editor.voicePanel?.setConnected(false); error(editor, e); }
    } finally { if (!disposed && token === generation && visible === editor.kind) schedule(); }
  }
  function visibilityChanged() {
    if (disposed) return;
    if (doc.hidden) {
      for (const editor of editors.values()) editor.voicePanel?.releaseAll();
      generation += 1; cancelTimer(); unsubscribe?.(); unsubscribe = null; inspector = null;
    } else if (visible) refresh();
  }
  doc.addEventListener?.('visibilitychange', visibilityChanged);
  return {
    setVisible(kind) {
      const next = editors.has(kind) ? kind : null;
      if (next === visible) return;
      generation += 1; cancelTimer(); visible = next;
      for (const editor of editors.values()) editor.voicePanel?.setVisible(next === editor.kind);
      publishAuditionTarget();
      if (visible) refresh(); else { unsubscribe?.(); unsubscribe = null; inspector = null; }
    },
    refresh,
    clearKeyboardTarget() {
      keyboardEditor = null;
      for (const editor of editors.values()) editor.voicePanel?.setKeyboardActive?.(false);
    },
    releaseAll() {for (const editor of editors.values()) editor.voicePanel?.releaseAll();},
    dispose() { for (const editor of editors.values()) detachNative(editor); visible = null; publishAuditionTarget(); disposed = true; generation += 1; cancelTimer(); unsubscribe?.(); unsubscribe = null; inspector = null; doc.removeEventListener?.('visibilitychange', visibilityChanged); },
  };
}
