// SPDX-License-Identifier: BSD-3-Clause
// Analyzer's VOPM text names slots in bus order. The inspector accepts logical order.
const slots = ['M1','M2','C1','C2'];
const fields = ['ar','d1r','d2r','rr','d1l','tl','ks','mul','dt1','dt2','am'];
const opMax = [31,31,31,15,15,127,3,15,7,3,128];
const limits = {CH:[192,7,7,3,7,120,128], LFO:[255,127,127,3,31]};

export function parseOpm(text) {
  const voices = [];
  let rows, name;
  function finish() {
    if (!rows) return;
    for (const key of ['CH','LFO',...slots]) if (!rows.has(key)) throw Error(name+' is missing '+key);
    const [pan,feedback,algorithm,ams,pms,slot,ne] = rows.get('CH');
    const [frequency,amDepth,pmDepth,waveform,noiseFrequency] = rows.get('LFO');
    const operators = slots.map(key => Object.fromEntries(fields.map((field,i) =>
      [field,field==='am' ? Boolean(rows.get(key)[i]) : rows.get(key)[i]])));
    voices.push({name,patch:{pan:{left:Boolean(pan&64),right:Boolean(pan&128)},feedback,algorithm,ams,pms,operators},
      mask:slot>>3,lfo:{frequency,amDepth,pmDepth,waveform},noise:{enabled:Boolean(ne),frequency:noiseFrequency}});
  }
  for (const [i,raw] of text.split(/\r\n?|\n/).entries()) {
    const line = raw.split('//')[0].trim();
    if (!line) continue;
    const header = /^@:\s*(\d+)(?:\s+(.*))?$/.exec(line);
    if (header) {finish(); rows=new Map(); name=header[2] || 'Voice '+header[1]; continue;}
    const match = /^(CH|LFO|M1|C1|M2|C2):\s*(.*)$/i.exec(line);
    if (!rows || !match) throw Error('Invalid OPM line '+(i+1));
    const key = match[1].toUpperCase(), tokens = match[2].split(/\s+/);
    const max = limits[key] ?? opMax;
    const values = tokens.map(Number);
    if (rows.has(key) || tokens.length!==max.length ||
        tokens.some((t,n)=>!/^\d+$/.test(t) || values[n]>max[n]) ||
        (key==='CH' && ((values[0]&63) || (values[5]&7) || ![0,128].includes(values[6]))) ||
        (slots.includes(key) && ![0,128].includes(values[10]))) throw Error('Invalid '+key+' on line '+(i+1));
    rows.set(key,values);
  }
  finish();
  if (!voices.length) throw Error('No OPM voices found.');
  return voices;
}
