import {noteToHz} from '../js/soundchip_pitch.js';
import {buildSnesNoteAnalysis,describeSnesAt} from './snes_notes.js?v=snes-noteish-1';

const HISTORY_SECONDS = 8, MAX_HISTORY_POINTS = 2048;
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const rangeCache = new WeakMap();
const viewCache = new WeakMap();
const emptyView = {key:null,channels:Array.from({length:8},() => ({}))};
function upperBound(states, clock) {
  let low = 0, high = states.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (states[mid].clock <= clock) low = mid + 1; else high = mid;
  }
  return low;
}
function prefixRanges(analysis) {
  if (rangeCache.has(analysis)) return rangeCache.get(analysis);
  const result = analysis.channels.map(channel => {
    const low = new Float64Array(channel.states.length), high = new Float64Array(channel.states.length);
    let min = Infinity, max = -Infinity;
    channel.states.forEach((state,index) => {
      if (state.keyOn && Number.isFinite(state.midi)) {min = Math.min(min,state.midi); max = Math.max(max,state.midi);}
      low[index] = min; high[index] = max;
    });
    return {low,high};
  });
  rangeCache.set(analysis,result); return result;
}
function emptyChannels(reason = 'No SPC note analysis for this position.') {
  return Array.from({length:8},(_,channel) => ({snes:true,channel,label:`SNES Voice ${channel + 1}`,
    keyOn:false,toneMidi:null,noteMinMidi:null,noteMaxMidi:null,noteHistory:[],reason,muted:false}));
}

/** Adapt the immutable offline observation to the existing Note-ish displays.
 * Query by audible song position: paused time freezes, and seek/Stop/loop never
 * depend on an append-only UI history. Dense regions keep the newest bounded
 * history and leave earlier space blank rather than drawing invented segments.
 */
export function channelsForSnesNoteAnalysis(analysis, seconds, {muteMask = 0, stopped = false} = {}) {
  let view = analysis ? viewCache.get(analysis) : emptyView;
  if (!view) {view = {key:null,channels:Array.from({length:8},() => ({}))};viewCache.set(analysis,view);}
  const key = `${seconds}:${muteMask}:${stopped}`;
  if (view.key === key) return view.channels;
  const commit = channels => {
    channels.forEach((channel,index) => {
      const target = view.channels[index];
      for (const field of Object.keys(target)) delete target[field];
      Object.assign(target,channel);
    });
    view.key = key; return view.channels;
  };
  if (!analysis || !Number.isFinite(seconds) || seconds < 0 || seconds >= analysis.durationSeconds) {
    return commit(emptyChannels().map((channel,index) => ({...channel,muted:!!(muteMask & (1 << index))})));
  }
  const now = seconds * analysis.clockRate, cutoff = Math.max(0,seconds - HISTORY_SECONDS) * analysis.clockRate;
  const ranges = prefixRanges(analysis), descriptions = describeSnesAt(analysis,seconds);
  return commit(descriptions.map((descriptor,channel) => {
    const states = analysis.channels[channel].states, end = upperBound(states,now);
    const firstInWindow = upperBound(states,cutoff), first = Math.max(firstInWindow,end - MAX_HISTORY_POINTS);
    const history = [];
    const truncated = first > firstInWindow;
    let previous = first > 0 ? states[first - 1] : null;
    if (!truncated && previous) history.push({time:cutoff / analysis.clockRate * 1000,
      midiFloat:previous.keyOn && Number.isFinite(previous.midi) ? previous.midi : null});
    for (let index = first; index < end; index++) {
      const state = states[index], midi = state.keyOn && Number.isFinite(state.midi) ? state.midi : null;
      if (previous && midi !== null && previous.keyOn && state.key !== previous.key) {
        history.push({time:state.clock / analysis.clockRate * 1000,midiFloat:null});
      }
      history.push({time:state.clock / analysis.clockRate * 1000,midiFloat:midi});
      previous = state;
    }
    if (descriptor.keyOn && Number.isFinite(descriptor.midi)) {
      history.push({time:seconds * 1000,midiFloat:descriptor.midi});
    }
    const min = end ? ranges[channel].low[end - 1] : Infinity, max = end ? ranges[channel].high[end - 1] : -Infinity;
    return {...descriptor,snes:true,channel,label:descriptor.name ?? `SNES Voice ${channel + 1}`,
      keyOn:!stopped && descriptor.keyOn,toneMidi:stopped ? null : descriptor.midi,
      noteMinMidi:!stopped && Number.isFinite(min) ? min : null,
      noteMaxMidi:!stopped && Number.isFinite(max) ? max : null,
      noteHistory:stopped ? [] : history,historyTruncated:truncated,muted:!!(muteMask & (1 << channel))};
  }));
}

function element(tag,text,parent) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  parent?.append(node); return node;
}
function noteLabel(hz) {
  const midi = 69 + 12 * Math.log2(hz / 440), nearest = Math.round(midi);
  if (!Number.isFinite(midi) || nearest < 0 || nearest > 127) return null;
  return {note:NOTE_NAMES[nearest % 12] + (Math.floor(nearest / 12) - 1),
    cents:Number(((midi - nearest) * 100).toFixed(2))};
}

/** Lazy, display-only SPC analysis. Resource loading/analysis/reference edits
 * never send commands to the audible player or access its RAM/DSP snapshots.
 */
export function mountSpcNoteish({root,onChange = () => {}}) {
  let bytes = null, visible = false, analysis = null, captured = null, estimates = [], rows = [];
  let worker = null, epoch = 0, timeout = null, debounce = null, autoPending = false;
  root.hidden = true; root.dataset.spcNotesState = 'idle';
  const controls = element('div',undefined,root); controls.className = 'actions spc-note-options';
  const durationLabel = element('label','Analyze first ',controls);
  const seconds = element('input',undefined,durationLabel);
  seconds.type = 'number'; seconds.min = '.1'; seconds.max = '600'; seconds.step = 'any'; seconds.value = '120'; seconds.required = true;
  seconds.dataset.spcNotesSeconds = ''; seconds.setAttribute('aria-label','SPC note analysis seconds');
  durationLabel.append(document.createTextNode(' seconds'));
  const stepLabel = element('label','Control step (ms) ',controls);
  const step = element('input',undefined,stepLabel);
  step.type = 'number'; step.min = '0'; step.max = '1000'; step.step = 'any'; step.value = '20'; step.required = true;
  step.dataset.spcNotesControlStep = ''; step.setAttribute('aria-label','SPC note analysis control step in milliseconds');
  const analyze = element('button','Analyze',controls); analyze.type = 'button'; analyze.dataset.spcNotesAnalyze = '';
  const cancel = element('button','Cancel analysis',controls); cancel.type = 'button'; cancel.dataset.spcNotesCancel = ''; cancel.hidden = true;
  const status = element('p','Open an SPC file to analyze notes.',root);
  status.dataset.spcNotesStatus = ''; status.setAttribute('role','status');
  const progress = element('progress',undefined,root); progress.max = 1; progress.hidden = true;
  progress.setAttribute('aria-label','SPC note analysis progress');
  const help = element('p','Display-only approximation of key requests and base pitches. Audible EG release, echo and live BRR RAM changes are not transcribed. References describe BRR at 32,000 Hz / PITCH 4096; editing them never changes playback. Provisional C4 is an assigned reference, not a detected note.',root);
  help.className = 'noteish-help';
  const references = element('details',undefined,root);
  element('summary','BRR tuning references (display only)',references);
  const referenceHost = element('div',undefined,references); referenceHost.className = 'spc-note-samples';
  function setState(value,text) {
    root.dataset.spcNotesState = value;
    if (text !== undefined) status.textContent = text;
    const busy = value === 'loading'; analyze.disabled = busy || !bytes;
    cancel.hidden = !busy; progress.hidden = !busy;
  }
  function cancelWorker() {
    epoch++; worker?.terminate(); worker = null;
    clearTimeout(timeout); timeout = null;
  }
  function invalidate() {
    cancelWorker(); clearTimeout(debounce); debounce = null;
    captured = null; estimates = []; rows = []; analysis = null; referenceHost.replaceChildren();
    onChange(null);
  }
  function readyText() {
    return `Analyzed first ${analysis.durationSeconds.toFixed(2)} seconds · ${captured.events.length} events · ${captured.samples.length} BRR version(s). Notes outside this interval are unavailable. Approximate base pitches; no EG release transcription.`;
  }
  function rebuild() {
    if (!captured || rows.some(row => !row.valid())) return false;
    const chosen = rows.map(row => row.reference()).filter(Boolean);
    analysis = buildSnesNoteAnalysis(captured,{references:chosen});
    onChange(analysis); setState('ready',readyText()); return true;
  }
  function showReferences() {
    referenceHost.replaceChildren();
    const table = element('table',undefined,referenceHost), head = element('tr',undefined,element('thead',undefined,table));
    for (const label of ['BRR / SRCN','Reference at PITCH 4096','Note','Cents','']) element('th',label,head);
    const body = element('tbody',undefined,table);
    rows = captured.samples.map(sample => {
      const estimate = estimates.find(item => item.sampleId === sample.id);
      const estimated = estimate?.confidence === 'high' && noteLabel(estimate.referenceHz);
      const initial = estimated || {note:'C4',cents:0};
      const initialLabel = estimated ? `Estimated · ${estimate.referenceHz.toFixed(2)} Hz` : 'Provisional C4';
      const tr = element('tr',undefined,body); tr.dataset.spcNoteSample = String(sample.id);
      element('td',`#${sample.id} · SRCN ${sample.sourceNumber}${sample.loop ? ' · loop' : ''}`,tr);
      const result = element('td',undefined,tr), label = element('span',initialLabel,result);
      element('small',`${estimate?.referenceHz && !estimated ? `Possible ${estimate.referenceHz.toFixed(2)} Hz; not applied. ` : ''}${estimate?.reason ?? 'No reliable pitch estimate.'}`,result);
      const note = element('input',undefined,element('td',undefined,tr));
      note.type = 'text'; note.value = initial.note; note.required = true; note.dataset.spcNoteReference = '';
      note.setAttribute('aria-label',`Display reference note for BRR ${sample.id}`);
      const cents = element('input',undefined,element('td',undefined,tr));
      cents.type = 'number'; cents.value = String(initial.cents); cents.min = '-100'; cents.max = '100'; cents.step = 'any'; cents.required = true;
      cents.dataset.spcNoteCents = ''; cents.setAttribute('aria-label',`Display reference cents for BRR ${sample.id}`);
      const reset = element('button','Reset',element('td',undefined,tr)); reset.type = 'button';
      let manual = false;
      const valid = () => {
        note.setCustomValidity('');
        try {noteToHz(note.value.trim());} catch {note.setCustomValidity('Enter a note name from C-1 to G9, for example C4.');}
        return note.checkValidity() && cents.checkValidity();
      };
      const edit = () => {
        manual = true; label.textContent = 'Manual reference';
        if (!valid()) {status.textContent = 'Enter a valid note and cents. The display keeps its last valid reference.'; return;}
        rebuild();
      };
      note.addEventListener('input',edit); cents.addEventListener('input',edit);
      reset.addEventListener('click',() => {
        manual = false; note.value = initial.note; cents.value = String(initial.cents); label.textContent = initialLabel;
        valid(); rebuild();
      });
      return {valid,reference:() => manual
        ? {sampleId:sample.id,kind:'manual',referenceHz:noteToHz(note.value.trim()) * 2 ** (Number(cents.value) / 1200)}
        : estimated ? {sampleId:sample.id,kind:'estimated',confidence:'high',referenceHz:estimate.referenceHz} : null};
    });
  }
  function start() {
    if (!bytes || !visible) return;
    if (!seconds.reportValidity() || !step.reportValidity()) {setState('idle','Enter a duration from 0.1 to 600 seconds and a control step from 0 to 1000 ms.'); return;}
    invalidate(); autoPending = false;
    const current = epoch;
    setState('loading','Analyzing the chosen interval in a separate worker…'); progress.value = 0;
    try {
      const next = new Worker(new URL('./spc_noteish_worker.js?v=snes-noteish-1',import.meta.url),{type:'module'});
      worker = next;
      const fail = message => {
        if (current !== epoch) return;
        cancelWorker(); setState('error',`SPC note analysis: ${message} Try a shorter interval or a larger control step. Playback is unaffected.`);
      };
      timeout = setTimeout(() => fail('Analysis timed out.'),180000);
      next.onmessage = ({data}) => {
        if (current !== epoch || !visible || !bytes) return;
        if (data.type === 'progress') {
          progress.value = data.stage === 'pitch' ? .9 + .1 * data.completed / Math.max(1,data.total) : .9 * Math.max(0,Math.min(1,data.ratio ?? 0));
          status.textContent = data.stage === 'pitch' ? `Estimating BRR references ${data.completed} / ${data.total}…`
            : `Analyzing ${Number(data.renderedSeconds ?? 0).toFixed(1)} / ${Number(data.durationSeconds ?? seconds.value).toFixed(1)} seconds…`;
        } else if (data.type === 'error') fail(data.message);
        else if (data.type === 'result') {
          try {
            captured = data.result.performance; estimates = data.result.estimates;
            showReferences(); rebuild(); cancelWorker();
          } catch (error) {fail(error.message);}
        }
      };
      next.onerror = event => {event.preventDefault(); fail(event.message || 'Analysis worker failed.');};
      next.onmessageerror = () => fail('Invalid analysis worker result.');
      const copy = bytes.slice();
      next.postMessage({action:'analyze',bytes:copy,durationSeconds:Number(seconds.value),controlStepMs:Number(step.value)},[copy.buffer]);
    } catch (error) {
      cancelWorker(); setState('error',`SPC note analysis: ${error.message}`);
    }
  }
  for (const input of [seconds,step]) input.addEventListener('input',() => {
    invalidate(); autoPending = true; setState('idle','Analysis settings changed.');
    if (visible && seconds.checkValidity() && step.checkValidity()) debounce = setTimeout(start,250);
  });
  analyze.addEventListener('click',start);
  cancel.addEventListener('click',() => {cancelWorker(); autoPending = false; setState('idle','Analysis canceled. Select Analyze to retry.');});
  return {
    get analysis() {return analysis;},
    load(input,{durationSeconds = 120} = {}) {
      this.clear();
      if (!(input instanceof ArrayBuffer) && !ArrayBuffer.isView(input)) throw new TypeError('SPC note analysis requires binary bytes');
      bytes = input instanceof ArrayBuffer ? new Uint8Array(input.slice(0)) : new Uint8Array(input.buffer,input.byteOffset,input.byteLength).slice();
      seconds.value = String(Math.max(.1,Math.min(120,Number(durationSeconds) || 120)));
      autoPending = true; root.hidden = !visible; setState('idle','Open Note-ish to analyze this SPC in the background.');
      if (visible) start();
    },
    clear() {
      invalidate(); bytes = null; autoPending = false; root.hidden = true;
      setState('idle','Open an SPC file to analyze notes.');
    },
    setVisible(value) {
      visible = !!value; root.hidden = !visible || !bytes;
      if (!visible) {
        clearTimeout(debounce); debounce = null;
        if (worker) {cancelWorker(); autoPending = true; setState('idle','Analysis paused while Note-ish is hidden.');}
      } else if (bytes && autoPending && !analysis && !worker) start();
    },
    channelsAt: (position,options) => channelsForSnesNoteAnalysis(analysis,position,options),
  };
}
