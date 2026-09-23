import {Ym2612VGM} from '../js/ym2612vgm.js';
import {createSccMonitor, applySccWrite, describeSccNotes} from './scc_notes.js';
import {createPsgMonitor, applySsgWrite} from './psg_monitor.js';
import {describeToneNotes} from './tone_notes.js';
import {createOplMonitor, applyOplWrite, describeOplNotes} from './opl_notes.js';
import {describeYm2413} from './ym2413_monitor.js';

export const msxNoteKinds = ['ay8910','ym2413','y8950','k051649'];
export function createMsxNoteMonitor(header) {
  return msxNoteKinds.filter(kind => header[`${kind}Clock`] & 0x3fffffff).map(kind => ({
    kind, clock:header[`${kind}Clock`] & 0x3fffffff, triggers:[0,0,0],
    state:kind === 'ay8910' ? createPsgMonitor(kind) : kind === 'ym2413' ? new Uint8Array(64)
      : kind === 'y8950' ? createOplMonitor() : createSccMonitor(!!(header.k051649Clock & 0x80000000)),
  }));
}
export function applyMsxNoteWrite(groups, kind, ...args) {
  const group = groups.find(g => g.kind === kind);
  if (!group) return;
  const [r,v] = args;
  if (kind === 'k051649') applySccWrite(group.state, ...args);
  else if (kind === 'y8950') applyOplWrite(group.state,r,v);
  else if (kind === 'ym2413') { if (r >= 0 && r < 64) group.state[r] = v; }
  else {
    applySsgWrite(group.state,0,r,v,0);
    if (r === 13) describeToneNotes(group.state,group.clock).forEach((n,i) => { if (n.envelope) group.triggers[i]++; });
  }
}
export function describeMsxNotes(groups) {
  return groups.flatMap(g => {
    if (g.kind === 'k051649') return describeSccNotes(g.state,g.clock);
    if (g.kind === 'ay8910') return describeToneNotes(g.state,g.clock).map((n,i) => ({...n,
      name:`AY8910 ${n.name}`, freq:n.midi === null ? 0 : 440 * 2**((n.midi-69)/12), type:'SSG', trigger:g.triggers[i]}));
    if (g.kind === 'y8950') return describeOplNotes(g.state,g.clock).map((n,i) => ({...n,name:`Y8950 CH${i+1}`,type:n.csm?'CSM (omitted)':n.percussion?'Rhythm (omitted)':'2op'}));
    return describeYm2413(g.state,g.clock).channels.map((n,i) => ({...n,name:`OPLL CH${i+1}`,freq:n.frequency,type:'OPLL',
      keyOn:n.keyOn && (!n.isRhythmChannel || i === 6) && n.midi !== null}));
  });
}
// Hook the targets used by VgmPlayer, including stream writes and seek replay.
// Read the current monitor on each call because engine.reset replaces it.
export function observeMsxNotes(engine, getMonitor, onWrite, onReset) {
  for (const kind of msxNoteKinds) {
    const target = engine.entries.get(`${kind}:0`)?.target;
    if (!target) continue;
    const write = target.writeRegister.bind(target);
    target.writeRegister = (...args) => { write(...args); applyMsxNoteWrite(getMonitor(),kind,...args); onWrite(); };
  }
  const reset = engine.reset.bind(engine);
  engine.reset = () => { reset(); onReset(); };
}
export function extractMsxNotes(source) {
  const warnings = new Map();
  const warn = message => warnings.set(message,{count:(warnings.get(message)?.count ?? 0)+1});
  const parser = new Ym2612VGM(source,{logger:{warn}}), header = parser.header;
  for (const kind of msxNoteKinds) {
    if (header[`${kind}Clock`] & (kind === 'k051649' ? 0x40000000 : 0xc0000000))
      throw new Error(`MSX ${kind}: dual/variant note extraction is not supported`);
  }
  for (const [key,value] of Object.entries(header)) {
    if (key.endsWith('Clock') && value && !msxNoteKinds.some(kind => key === `${kind}Clock`))
      throw new Error(`MSX notes with ${key} are not supported`);
  }
  const groups = createMsxNoteMonitor(header);
  if (!groups.length) throw new Error('MSX note extraction requires an AY, OPLL, Y8950 or SCC clock');
  for (const {kind} of groups) {
    if (kind === 'k051649') warn('SCC / SCC+: 32-step waveform base period only; waveform harmonics, waveform rewriting and test-register phase resets are not transcribed. Constant waves, periods below 9 and test frequency modes are omitted.');
    if (kind === 'ay8910') warn('AY: tone pitch only; noise and envelope phase/volume are not synthesized. Shape writes retrigger envelope tones.');
    if (kind === 'ym2413') warn('OPLL: FNUM/BLOCK base pitch only; rhythm other than Bass Drum, timbre, modulation and release are omitted.');
    if (kind === 'y8950') warn('Y8950: FM base pitch only; ADPCM, rhythm, CSM, timbre, modulation and release are omitted.');
  }
  let time = 0;
  const channels = describeMsxNotes(groups).map(n => ({name:n.name,notes:[],active:null,serial:0,trigger:0}));
  const close = ch => { if (ch.active && time > ch.active.start) ch.notes.push({...ch.active,end:time}); ch.active = null; };
  function update() {
    describeMsxNotes(groups).forEach((n,i) => {
      const ch = channels[i], on = n.keyOn && Number.isFinite(n.midi), trigger = n.trigger ?? 0;
      if (ch.active && on && ch.active.midi === n.midi && trigger === ch.trigger) return;
      const wasOn = !!ch.active;
      close(ch);
      if (on) { if (!wasOn || trigger !== ch.trigger) ch.serial++; ch.active = {start:time,midi:n.midi,key:ch.serial}; }
      ch.trigger = trigger;
    });
  }
  const targets = Object.fromEntries(groups.map(({kind}) => [kind,{
    writeRegister(...args) { applyMsxNoteWrite(groups,kind,...args); update(); },
    // ADPCM is deliberately excluded from pitched notes.
    ...(kind === 'y8950' ? {loadSampleMemory(){}} : {}),
  }]));
  while (true) {
    const event = parser.playStep(targets);
    if (event.type === 'wait') parser.consumeWait(targets,event.samples,n => { time += n; });
    else if (event.type === 'end') break;
  }
  channels.forEach(close);
  return {channels:channels.map(({name,notes}) => ({name,notes})),time,warnings,parserHeader:header};
}
