import {parseMidiFile} from './midi_file.js?v=midi-module-1';
import {MIDI_SUPPORTED_CC, validateBendRange} from './playground_midi.js?v=midi-module-1';

/** Compile selected SMF parts into editable, standalone Playground JavaScript. */
export function midiToSource(bytes, routes, {name='MIDI', presets={}, module=false}={}) {
  const song=parseMidiFile(bytes), parts=new Map(song.parts.map(p=>[p.key,p]));
  const targets=new Set(), mapping=new Map(), controls=new Map();
  const channels=new Map(),initializers=[];
  const lines=[];let length=0;
  const add=line=>{length+=line.length+1;if(length>16*1024*1024)throw new Error('Generated MIDI code exceeds 16 Mi characters; select fewer parts');lines.push(line);};
  const quote=value=>JSON.stringify(String(value)).replace(/[\u2028\u2029]/g,c=>`\\u${c.charCodeAt(0).toString(16)}`);
  add(`// Imported MIDI: ${quote(name)}`);
  add('// Editable performance. No source MIDI file is needed. Times are seconds from the timeline origin.');
  for(const warning of song.warnings)add(`// ${warning}`);
  if(!routes.length)throw new Error('Select at least one MIDI part');
  if(module)add('let api;\nlet running = false;');
  routes.forEach((route,i)=>{
    const part=parts.get(route.part),key=JSON.stringify([route.destination,route.channel]);
    if(!part||!['tetorica-ym2612','tetorica-sega-psg'].includes(route.destination)||!Number.isInteger(route.channel)||route.channel<0||route.channel>15)throw new Error('Invalid MIDI route');
    if(mapping.has(route.part)||targets.has(key))throw new Error('Assign each part to a separate output / MIDI channel');
    validateBendRange(route.bendRange??2);targets.add(key);
    const variable=`${route.destination==='tetorica-ym2612'?'ym2612':'segapsg'}_${i+1}`;
    mapping.set(route.part,variable);channels.set(variable,route.channel+1);
    const sourceKey=JSON.stringify([part.port,part.device,part.channel]);
    const group=controls.get(sourceKey)??[];group.push(variable);controls.set(sourceKey,group);
    add(`\n// Track ${part.track+1}, source CH${part.channel}: ${quote(part.name)}`);
    const setup=line=>module?initializers.push(line):add(line);
    if(module)add(`let ${variable};`);
    setup(`${module?'':'const '}${variable} = ${module?'api.':''}midi.output(${quote(route.destination)}, {channel: ${module?'api.':''}CH${route.channel+1}});`);
    if(route.destination==='tetorica-ym2612') {
      if(!Object.hasOwn(presets,route.preset))throw new Error(`Unknown preset: ${route.preset}`);
      setup(`await ${variable}.setVoice(${module?'api.':''}FM_PRESETS[${quote(route.preset)}]);`);
    }
    setup(`await ${variable}.setPitchBendRange(${route.bendRange??2});`);
  });
  if(module) {
    add('\nexport async function initCh(playground) {');
    add('  if (running) throw new Error("Cannot initialize while playing");');
    add('  api = undefined;');
    add('  if (!playground?.midi) throw new Error("Call initCh(pg) first");');
    add('  api = playground; running = true;');
    add('  try {');
    for(const line of initializers)add(`    ${line}`);
    add('  } catch (error) { api = undefined; throw error; } finally { running = false; }');
    add('}');
    add('\nexport async function runChannels(channelNumbers) {');
    add(`  if (!Array.isArray(channelNumbers) || channelNumbers.some(ch => !${JSON.stringify([...new Set(channels.values())])}.includes(ch))) throw new Error("Unknown channel selection");`);
    add('  if (!api) throw new Error("Call initCh(pg) first");');
    add('  if (running) throw new Error("This song is already playing");');
    add('  running = true;');
    add('  const selected = new Set(channelNumbers);');
    add('  try {');
    add('  const timeline = api.midi.createTimeline();');
    add('  let previous = -1;\n  async function at(seconds) {\n    if (seconds !== previous) { previous = seconds; await timeline.waitUntil(seconds); }\n  }');
  } else add('\nconst timeline = midi.createTimeline();');
  let lastTime=-1;
  const wait=seconds=>{if(seconds!==lastTime){add(`await timeline.waitUntil(${seconds});`);lastTime=seconds;}};
  for(const event of song.events) {
    if(event.type==='meta'&&event.tempo){add(`// Tempo: ${60000000/event.tempo} BPM at ${event.seconds} seconds (included in event times).`);continue;}
    if(event.type!=='channel')continue;
    const variable=mapping.get(event.part),statements=[];
    const emit=(v,line)=>statements.push({channel:channels.get(v),line});
    if(variable&&event.kind===9&&event.b>0)emit(variable,`await ${variable}.noteOn(${event.a}, {velocity: ${event.b}});`);
    else if(variable&&(event.kind===8||event.kind===9))emit(variable,`await ${variable}.noteOff(${event.a});`);
    else if(event.kind===14||event.kind===11&&MIDI_SUPPORTED_CC.includes(event.a)) {
      const group=controls.get(JSON.stringify([event.port,event.device,event.channel]))??[];
      for(const v of group) {
        if(event.kind===11)emit(v,`await ${v}.cc(${event.a}, ${event.b});`);
        else {const raw=event.a+(event.b<<7);emit(v,`await ${v}.pitchBend(${(raw-8192)/(raw<8192?8192:8191)});`);}
      }
    } else if(variable) add(`// Not applied at ${event.seconds}s: MIDI status ${event.kind}, data ${event.a}${event.b===undefined?'':`, ${event.b}`}.`);
    if(statements.length){
      if(module) {
        add(`  if (${[...new Set(statements.map(s=>s.channel))].map(ch=>`selected.has(${ch})`).join(' || ')}) {`);
        add(`    await at(${event.seconds});`);
        for(const {channel,line} of statements)add(`    if (selected.has(${channel})) ${line}`);
        add('  }');
      } else {wait(event.seconds);statements.forEach(s=>add(s.line));}
    }
  }
  if(module)add(`  await at(${song.seconds});`);else wait(song.seconds);
  add('// End of file: silence any held or sustained notes.');
  if(module)add('  } finally {\n    try {');
  for(const variable of mapping.values())add(`${module?`if (selected.has(${channels.get(variable)})) `:''}await ${variable}.cc(120, 0);`);
  if(module) {
    add('    } finally { running = false; }\n  }\n}');
    const numbers=[...new Set(channels.values())].sort((a,b)=>a-b);
    for(const ch of numbers)add(`export async function runCh${ch}() { return runChannels([${ch}]); }`);
    add(`export async function runAllCh() { return runChannels([${numbers.join(', ')}]); }`);
  }
  return lines.join('\n')+'\n';
}
