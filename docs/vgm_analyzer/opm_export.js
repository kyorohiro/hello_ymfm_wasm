// VOPM text bank. Fields checked against Furnace DivEngine::loadOPM:
// https://github.com/tildearrow/furnace/blob/master/src/engine/fileOpsIns.cpp
export function exportOpm(snapshot, channel, name = 'YM2151') {
  if (!Number.isInteger(channel) || channel < 0 || channel >= 8) throw new RangeError('Invalid YM2151 channel');
  const ch = snapshot.channels[channel];
  const title = String(name).replace(/[\r\n\x00-\x1f\x7f]/g, ' ').trim().slice(0, 120) || 'YM2151';
  const slots = ch.operators.reduce((mask, op, i) => mask | (op.key ? 8 << i : 0), 0) || 120;
  const {lfo, noise} = snapshot;
  const lines = [
    '// YM2151 voice snapshot exported by VGM Analyzer',
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
