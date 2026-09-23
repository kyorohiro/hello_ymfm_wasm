import {parseMidiFile} from './midi_file.js?v=midi-generators-1';
import {MIDI_SUPPORTED_CC, validateBendRange} from './playground_midi.js?v=midi-generators-1';

/** Compile selected SMF parts into editable, standalone Playground JavaScript. */
export function midiToSource(bytes, routes, {name='MIDI', presets={}, module=false}={}) {
  const song=parseMidiFile(bytes), parts=new Map(song.parts.map(p=>[p.key,p]));
  const targets=new Set(), mapping=new Map(), controls=new Map();
  const channels=new Map(),initializers=[],channelEvents=new Map();
  let eventOrder=0,bufferedLength=0;
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
        for(const {channel,line} of statements) {
          const entry=`  yield [${event.seconds}, () => ${line.slice(6,-1)}, ${eventOrder++}];`;
          bufferedLength+=entry.length+1;
          if(length+bufferedLength>16*1024*1024)throw new Error('Generated MIDI code exceeds 16 Mi characters; select fewer parts');
          const entries=channelEvents.get(channel)??[];entries.push(entry);channelEvents.set(channel,entries);
        }
      } else {wait(event.seconds);statements.forEach(s=>add(s.line));}
    }
  }
  if(module) {
    const numbers=[...new Set(channels.values())].sort((a,b)=>a-b);
    add('\n// Event tuple: [seconds, command, original order for simultaneous events].');
    for(const ch of numbers) {
      add(`function* ch${ch}Events() {`);
      for(const entry of channelEvents.get(ch)??[])add(entry);
      add('}');
    }
    add(`\nconst channelEvents = {${numbers.map(ch=>`${ch}: ch${ch}Events`).join(', ')}};`);
    add('const silenceChannel = {');
    for(const ch of numbers) {
      add(`  ${ch}: async () => {`);
      for(const [variable,channel] of channels)if(channel===ch)add(`    await ${variable}.cc(120, 0);`);
      add('  },');
    }
    add('};');
    add(`
export async function runChannels(channelNumbers) {
  if (!Array.isArray(channelNumbers) || channelNumbers.some(ch => !Number.isInteger(ch) || !Object.hasOwn(channelEvents, ch))) throw new Error("Unknown channel selection");
  if (!api) throw new Error("Call initCh(pg) first");
  if (running) throw new Error("This song is already playing");
  const selected = [...new Set(channelNumbers)];
  if (!selected.length) return;
  running = true;
  try {
    const timeline = api.midi.createTimeline();
    // Keep just one pending event per channel, rather than expanding every event.
    const streams = selected.map(ch => {
      const iterator = channelEvents[ch]();
      return {iterator, next: iterator.next()};
    });
    let previous = -1;
    while (true) {
      let first;
      for (const stream of streams) {
        if (stream.next.done) continue;
        const event = stream.next.value;
        if (!first || event[0] < first.next.value[0] ||
            (event[0] === first.next.value[0] && event[2] < first.next.value[2])) first = stream;
      }
      if (!first) break;
      const [seconds, command] = first.next.value;
      if (seconds !== previous) {
        await timeline.waitUntil(seconds);
        previous = seconds;
      }
      await command();
      first.next = first.iterator.next();
    }
    if (previous !== ${song.seconds}) await timeline.waitUntil(${song.seconds});
  } finally {
    try {
      const results = await Promise.allSettled(selected.map(ch => silenceChannel[ch]()));
      const failure = results.find(result => result.status === "rejected");
      if (failure) throw failure.reason;
    } finally { running = false; }
  }
}`);
    for(const ch of numbers)add(`export async function runCh${ch}() { return runChannels([${ch}]); }`);
    add(`export async function runAllCh() { return runChannels([${numbers.join(', ')}]); }`);
  } else {
    wait(song.seconds);
    add('// End of file: silence any held or sustained notes.');
    for(const variable of mapping.values())add(`await ${variable}.cc(120, 0);`);
  }
  return lines.join('\n')+'\n';
}
