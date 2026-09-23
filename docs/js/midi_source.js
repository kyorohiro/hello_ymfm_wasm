import {parseMidiFile} from './midi_file.js?v=midi-source-1';
import {MIDI_SUPPORTED_CC, validateBendRange} from './playground_midi.js?v=midi-source-1';

/** Compile selected SMF parts into editable, standalone Playground JavaScript. */
export function midiToSource(bytes, routes, {name='MIDI', presets={}}={}) {
  const song=parseMidiFile(bytes), parts=new Map(song.parts.map(p=>[p.key,p]));
  const targets=new Set(), mapping=new Map(), controls=new Map();
  const lines=[];let length=0;
  const add=line=>{length+=line.length+1;if(length>16*1024*1024)throw new Error('Generated MIDI code exceeds 16 Mi characters; select fewer parts');lines.push(line);};
  const quote=value=>JSON.stringify(String(value)).replace(/[\u2028\u2029]/g,c=>`\\u${c.charCodeAt(0).toString(16)}`);
  add(`// Imported MIDI: ${quote(name)}`);
  add('// Editable performance. No source MIDI file is needed. Times are seconds from the timeline origin.');
  for(const warning of song.warnings)add(`// ${warning}`);
  if(!routes.length)throw new Error('Select at least one MIDI part');
  routes.forEach((route,i)=>{
    const part=parts.get(route.part),key=JSON.stringify([route.destination,route.channel]);
    if(!part||!['tetorica-ym2612','tetorica-sega-psg'].includes(route.destination)||!Number.isInteger(route.channel)||route.channel<0||route.channel>15)throw new Error('Invalid MIDI route');
    if(mapping.has(route.part)||targets.has(key))throw new Error('Assign each part to a separate output / MIDI channel');
    validateBendRange(route.bendRange??2);targets.add(key);
    const variable=`${route.destination==='tetorica-ym2612'?'ym2612':'segapsg'}_${i+1}`;
    mapping.set(route.part,variable);
    const sourceKey=JSON.stringify([part.port,part.device,part.channel]);
    const group=controls.get(sourceKey)??[];group.push(variable);controls.set(sourceKey,group);
    add(`\n// Track ${part.track+1}, source CH${part.channel}: ${quote(part.name)}`);
    add(`const ${variable} = midi.output(${quote(route.destination)}, {channel: CH${route.channel+1}});`);
    if(route.destination==='tetorica-ym2612') {
      if(!Object.hasOwn(presets,route.preset))throw new Error(`Unknown preset: ${route.preset}`);
      add(`await ${variable}.setVoice(FM_PRESETS[${quote(route.preset)}]);`);
    }
    add(`await ${variable}.setPitchBendRange(${route.bendRange??2});`);
  });
  add('\nconst timeline = midi.createTimeline();');
  let lastTime=-1;
  const wait=seconds=>{if(seconds!==lastTime){add(`await timeline.waitUntil(${seconds});`);lastTime=seconds;}};
  for(const event of song.events) {
    if(event.type==='meta'&&event.tempo){add(`// Tempo: ${60000000/event.tempo} BPM at ${event.seconds} seconds (included in event times).`);continue;}
    if(event.type!=='channel')continue;
    const variable=mapping.get(event.part),statements=[];
    if(variable&&event.kind===9&&event.b>0)statements.push(`await ${variable}.noteOn(${event.a}, {velocity: ${event.b}});`);
    else if(variable&&(event.kind===8||event.kind===9))statements.push(`await ${variable}.noteOff(${event.a});`);
    else if(event.kind===14||event.kind===11&&MIDI_SUPPORTED_CC.includes(event.a)) {
      const group=controls.get(JSON.stringify([event.port,event.device,event.channel]))??[];
      for(const v of group) {
        if(event.kind===11)statements.push(`await ${v}.cc(${event.a}, ${event.b});`);
        else {const raw=event.a+(event.b<<7);statements.push(`await ${v}.pitchBend(${(raw-8192)/(raw<8192?8192:8191)});`);}
      }
    } else if(variable) add(`// Not applied at ${event.seconds}s: MIDI status ${event.kind}, data ${event.a}${event.b===undefined?'':`, ${event.b}`}.`);
    if(statements.length){wait(event.seconds);statements.forEach(add);}
  }
  wait(song.seconds);
  add('// End of file: silence any held or sustained notes.');
  for(const variable of mapping.values())add(`await ${variable}.cc(120, 0);`);
  return lines.join('\n')+'\n';
}
