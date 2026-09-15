import {Ym2612VGM} from '../js/ym2612vgm.js';
import {createOpmState} from './opm_monitor.js';
// VOPM text bank. Fields checked against Furnace DivEngine::loadOPM:
// https://github.com/tildearrow/furnace/blob/master/src/engine/fileOpsIns.cpp
export function exportOpm(snapshot, channel, name = 'YM2151', {clock} = {}) {
  if (!Number.isInteger(channel) || channel < 0 || channel >= 8) throw new RangeError('Invalid YM2151 channel');
  const ch = snapshot.channels[channel];
  const title = String(name).replace(/[\r\n\x00-\x1f\x7f]/g, ' ').trim().slice(0, 120) || 'YM2151';
  const slots = ch.operators.reduce((mask, op, i) => mask | (op.key ? 8 << i : 0), 0) || 120;
  const {lfo, noise} = snapshot;
  const lines = [
    '// YM2151 voice snapshot exported by VGM Analyzer',
    ...(Number.isInteger(clock) && clock > 0 && clock <= 0x3fffffff ? ['// Tetorica-Metadata-Version: 1','// Tetorica-Source-Chip: YM2151',`// Tetorica-Source-Clock-Hz: ${clock}`] : []),
    '// Static settings only; performance, pitch and envelope phase are not saved.',
    '// SLOT uses active key bits, or all four operators when keys are off.',
    '// LFO is chip-global. Importers may ignore LFO, PAN, SLOT or noise settings.',
    `@:0 ${title}`,
    '// LFO: LFRQ AMD PMD WF NFRQ',
    `LFO: ${lfo.rate} ${lfo.amd} ${lfo.pmd} ${lfo.waveform} ${noise.rate}`,
    '// CH: PAN FL CON AMS PMS SLOT NE',
    `CH: ${(ch.left ? 64 : 0) | (ch.right ? 128 : 0)} ${ch.feedback} ${ch.algorithm} ${ch.ams} ${ch.pms} ${slots} ${channel === 7 && noise.enabled ? 128 : 0}`,
    '// OP: AR D1R D2R RR D1L TL KS MUL DT1 DT2 AME',
  ];
  // Register slot order: +00 M1, +08 C1, +10 M2, +18 C2.
  ch.operators.forEach((op, i) => lines.push(`${['M1','C1','M2','C2'][i]}: ${[op.ar,op.d1r,op.d2r,op.rr,op.d1l,op.tl,op.ks,op.mul,op.dt1,op.dt2,op.am ? 128 : 0].join(' ')}`));
  return lines.join('\r\n') + '\r\n';
}

// One pass, independent of the live engine. Deduplicate each channel by the
// exported voice data (KC/KF and timestamps are deliberately not part of it).
export function extractOpmPatches(buffer, {includeSnapshots = false} = {}) {
  const parser = new Ym2612VGM(buffer, {logger:null});
  if (!(parser.header.ym2151Clock & 0x3fffffff) || (parser.header.ym2151Clock & 0xc0000000)) throw new Error('OPM extraction requires a single YM2151');
  const state = createOpmState(() => 0), keys = new Uint8Array(8);
  const seen = Array.from({length:8}, () => new Set()), patches = [];
  let sample = 0;
  function capture(channel) {
    const snapshot = state.snapshot();
    const signature = exportOpm(snapshot, channel, 'voice');
    if (seen[channel].has(signature)) return;
    seen[channel].add(signature);
    const id = `CH${channel+1}_${String(seen[channel].size).padStart(3,'0')}`;
    patches.push({name:`${id}.opm`, text:`// First observed at VGM sample ${sample} (44100 Hz)\r\n` + exportOpm(snapshot,channel,id,{clock:parser.header.ym2151Clock & 0x3fffffff}),channel,sample,...(includeSnapshots ? {snapshot,clock:parser.header.ym2151Clock & 0x3fffffff} : {})});
  }
  while (true) {
    const event = parser.step();
    if (event.type === 'end') break;
    if (event.type === 'wait') { sample += event.samples; continue; }
    if (event.type !== 'ym2151-write') continue;
    const {register:r,value:v} = event;
    state.write(r,v);
    if (r === 8) { keys[v&7] = (v>>3)&15; if (keys[v&7]) capture(v&7); }
    else if (r >= 0x40 || (r >= 0x20 && r <= 0x27) || (r >= 0x38 && r <= 0x3f)) { if (keys[r&7]) capture(r&7); }
    else if ([15,0x18,0x19,0x1b].includes(r)) { for(let ch=0;ch<8;ch++)if(keys[ch])capture(ch); }
  }
  return patches;
}
