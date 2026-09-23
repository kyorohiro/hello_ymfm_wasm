import {parseMidiFile} from './midi_file.js?v=midi-shared-1';
import {MIDI_SUPPORTED_CC, validateBendRange} from './playground_midi.js?v=midi-shared-1';

/** Auto selects unused MIDI channels; explicitly selected channels may be shared. */
export function assignMidiRoutes(selections) {
  const routes=selections.filter(route=>route.destination).map(route=>({...route}));
  const used=new Map([['tetorica-ym2612',new Set()],['tetorica-sega-psg',new Set()]]);
  const parts=new Set();
  for(const route of routes) {
    const channels=used.get(route.destination);
    if(!channels)throw new Error('Unsupported MIDI output');
    if(parts.has(route.part))throw new Error('A MIDI part can only be included once');
    parts.add(route.part);
    if(route.channel===undefined)continue;
    if(!Number.isInteger(route.channel)||route.channel<0||route.channel>15)throw new Error('MIDI channel must be 0..15');
    channels.add(route.channel);
  }
  for(const route of routes)if(route.channel===undefined) {
    const channels=used.get(route.destination),preferred=route.sourceChannel;
    const available=Number.isInteger(preferred)&&preferred>=0&&preferred<16&&!channels.has(preferred)
      ?preferred:Array.from({length:16},(_,i)=>i).find(ch=>!channels.has(ch));
    if(available===undefined)throw new Error('At most 16 included parts per output; skip a part or use the other output');
    route.channel=available;channels.add(available);
  }
  return routes;
}

/** Compile selected SMF parts into editable, standalone Playground JavaScript. */
export function midiToSource(bytes, routes, {name='MIDI', presets={}, module=false}={}) {
  const song=parseMidiFile(bytes), parts=new Map(song.parts.map(p=>[p.key,p]));
  const targets=new Map(), mapping=new Map(), controls=new Map();
  const channels=new Map(),initializers=[];
  const lines=[];let length=0;
  const add=line=>{length+=line.length+1;if(length>16*1024*1024)throw new Error('Generated MIDI code exceeds 16 Mi characters; select fewer parts');lines.push(line);};
  const quote=value=>JSON.stringify(String(value)).replace(/[\u2028\u2029]/g,c=>`\\u${c.charCodeAt(0).toString(16)}`);
  add(`// Imported MIDI: ${quote(name)}`);
  add('// Editable standard MIDI API calls. sleepSamples uses 44100 samples/second, independent of device rate.');
  add('// MIDI tempo changes are included in wait lengths. C4 is MIDI note 60.');
  for(const warning of song.warnings)add(`// ${warning}`);
  if(!routes.length)throw new Error('Select at least one MIDI part');
  if(module)add('let api;\nlet running = false;');
  routes.forEach((route,i)=>{
    const part=parts.get(route.part),key=JSON.stringify([route.destination,route.channel]);
    if(!part||!['tetorica-ym2612','tetorica-sega-psg'].includes(route.destination)||!Number.isInteger(route.channel)||route.channel<0||route.channel>15)throw new Error('Invalid MIDI route');
    if(mapping.has(route.part))throw new Error('A MIDI part can only be included once');
    validateBendRange(route.bendRange??2);
    if(route.destination==='tetorica-ym2612'&&!Object.hasOwn(presets,route.preset))throw new Error(`Unknown preset: ${route.preset}`);
    const existing=targets.get(key);
    if(existing) {
      mapping.set(route.part,existing.variable);
      const sourceKey=JSON.stringify([part.port,part.device,part.channel]);
      const group=controls.get(sourceKey)??[];
      if(!group.includes(existing.variable))group.push(existing.variable);
      controls.set(sourceKey,group);
      add(`// Track ${part.track+1}, source CH${part.channel} shares ${existing.variable}: ${quote(part.name)}`);
      if(existing.preset!==route.preset||existing.bendRange!==(route.bendRange??2))add('// Shared channel: voice and bend range use the first selected part settings.');
      return;
    }
    const variable=`${route.destination==='tetorica-ym2612'?'ym2612':'segapsg'}_${i+1}`;
    targets.set(key,{variable,preset:route.preset,bendRange:route.bendRange??2});
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
    add('  if (!playground?.midi || typeof playground.sleepSamples !== "function") throw new Error("Call initCh(pg) with MIDI and sleepSamples support");');
    add('  running = true;');
    add('  try {');
    add('    api = playground;');
    for(const line of initializers)add(`    ${line}`);
    add('  } catch (error) { api = undefined; throw error; } finally { running = false; }');
    add('}');
    add('\n// Edit the performance here. All channels share this one sequence of waits.');
    add('// Omitted outputs are skipped; their timing is retained.');
    add('export async function performance(outputs, sleepSamples) {');
    for(const [variable,ch] of channels) {
      const index=[...channels].filter(([,number])=>number===ch).findIndex(([v])=>v===variable);
      add(`  const ${variable} = outputs[${ch}]?.[${index}];`);
    }
    add('  const active = [...new Set(Object.values(outputs).flat())];');
    add('  try {');
  } else {
    add('\ntry {');
  }
  let lastSample=0;
  const wait=seconds=>{
    const sample=Math.round(seconds*44100);
    if(sample>lastSample)add(`${module?'    ':'  '}await sleepSamples(${sample-lastSample});`);
    lastSample=sample;
  };
  const noteName=n=>`${['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][n%12]}${Math.floor(n/12)-1}`;
  for(const event of song.events) {
    if(event.type==='meta'&&event.tempo){add(`  // Tempo: ${60000000/event.tempo} BPM at ${event.seconds}s; included in sample waits.`);continue;}
    if(event.type!=='channel')continue;
    const variable=mapping.get(event.part),statements=[];
    const emit=(v,line)=>statements.push({variable:v,line});
    if(variable&&event.kind===9&&event.b>0)emit(variable,`${variable}.noteOn(${quote(noteName(event.a))}, {velocity: ${event.b}})`);
    else if(variable&&(event.kind===8||event.kind===9))emit(variable,`${variable}.noteOff(${quote(noteName(event.a))})`);
    else if(event.kind===14||event.kind===11&&MIDI_SUPPORTED_CC.includes(event.a)) {
      const group=controls.get(JSON.stringify([event.port,event.device,event.channel]))??[];
      for(const v of group) {
        if(event.kind===11)emit(v,`${v}.cc(${event.a}, ${event.b})`);
        else {const raw=event.a+(event.b<<7);emit(v,`${v}.pitchBend(${(raw-8192)/(raw<8192?8192:8191)})`);}
      }
    } else if(variable)add(`  // Not applied at ${event.seconds}s: MIDI status ${event.kind}, data ${event.a}${event.b===undefined?'':`, ${event.b}`}.`);
    if(statements.length) {
      wait(event.seconds);
      for(const {variable,line} of statements)add(module?`    if (${variable}) await ${line};`:`  await ${line};`);
    }
  }
  wait(song.seconds);
  if(module) {
    add('  } finally {');
    add('    await Promise.allSettled(active.map(output => Promise.resolve().then(() => output.cc(120, 0))));');
    add('  }');
    add('}');
    const numbers=[...new Set(channels.values())].sort((a,b)=>a-b);
    add('\nconst defaultOutputs = {');
    for(const ch of numbers) {
      const variables=[...channels].filter(([,channel])=>channel===ch).map(([v])=>v);
      add(`  ${ch}: () => [${variables.join(', ')}],`);
    }
    add('};');
    add(`
export async function runChannels(channelNumbers, outputs = {}) {
  if (!Array.isArray(channelNumbers) || channelNumbers.some(ch => !Number.isInteger(ch) || !Object.prototype.hasOwnProperty.call(defaultOutputs, ch))) throw new Error("Unknown channel selection");
  if (!api) throw new Error("Call initCh(pg) first");
  if (running) throw new Error("This song is already playing");
  const selected = [...new Set(channelNumbers)];
  if (!selected.length) return;
  const resolved = {};
  for (const ch of selected) {
    const defaults = defaultOutputs[ch]();
    const supplied = outputs[ch];
    const values = supplied === undefined ? defaults : Array.isArray(supplied) ? supplied : [supplied];
    if (values.length !== defaults.length || values.some(output => !output ||
        ["noteOn", "noteOff", "cc"].some(method => typeof output[method] !== "function")))
      throw new Error("Supply one output per generated channel destination");
    resolved[ch] = values;
  }
  running = true;
  try { await performance(resolved, api.sleepSamples); }
  finally { running = false; }
}`);
    for(const ch of numbers) {
      const variables=[...channels].filter(([,channel])=>channel===ch).map(([v])=>v);
      const arguments_=variables.map((_,i)=>i===0?'output':`output${i+1}`);
      add(`export async function ch${ch}Events(${arguments_.join(', ')}, sleepSamples) {`);
      add(`  return performance({${ch}: [${arguments_.join(', ')}]}, sleepSamples);`);
      add('}');
      add(`export async function runCh${ch}(...outputs) { return runChannels([${ch}], outputs.length ? {${ch}: outputs} : {}); }`);
    }
    add(`export async function runAllCh(outputs = {}) { return runChannels([${numbers.join(', ')}], outputs); }`);
  } else {
    add('} finally {');
    add(`  await Promise.allSettled([${[...new Set(mapping.values())].join(', ')}].map(output => Promise.resolve().then(() => output.cc(120, 0))));`);
    add('}');
  }
  return lines.join('\n')+'\n';
}
