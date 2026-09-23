import {YM2612Synth} from './ym2612synth.js';
import {createSegaPsgApi} from './segapsg_api.js';
import {createPitchFromMidi} from './pitch.js';
import {parseTfi} from './tfi.js';
import {parseVgi} from './vgi.js';

const destinations = ['tetorica-ym2612', 'tetorica-sega-psg'];
let nextVoiceId = 0; // Never reuse IDs across Stop / Run rack replacement.
const carriers = [8,8,8,8,10,14,14,15];
function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`);
  return value;
}
export function midiNote(note) {
  if (typeof note === 'string') {
    const m = /^([A-G])([#b]?)(-?\d+)$/.exec(note);
    if (!m) throw new Error('Invalid MIDI note');
    note = (Number(m[3])+1)*12 + {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1]] + (m[2]==='#'?1:m[2]==='b'?-1:0);
  }
  return integer(note,0,127,'note');
}

/** One shared chip rack. Handles describe MIDI channels, not physical voices. */
export function createMidiRack({write, writePsg, preset, fmChannels = 6}) {
  let at;
  const pending = new Map();
  function normalize(data) {
    const validator=new YM2612Synth({transport:{write(){}}});validator.setPreset(0,data);
    const state=validator.channels[0];
    if(data.b4!==undefined) {integer(data.b4,0,255,'b4');state.left=!!(data.b4&128);state.right=!!(data.b4&64);state.ams=(data.b4>>4)&3;state.pms=data.b4&7;}
    return {algorithm:state.algorithm,feedback:state.feedback,ams:state.ams,pms:state.pms,pan:{left:state.left,right:state.right},operators:structuredClone(state.operators)};
  }
  const patches = Array.from({length:16},()=>normalize(preset));
  const voices = { 'tetorica-ym2612': Array(fmChannels).fill(null), 'tetorica-sega-psg': Array(3).fill(null) };
  // A register encoder, not another emulated chip. Never reset the real transport.
  const fm = new YM2612Synth({transport:{write:(port,register,value)=>write({port,register,value,time:at})}});
  const psg = createSegaPsgApi({write:value=>writePsg({value,time:at})});
  function target(destination, channel) {
    if (!destinations.includes(destination)) throw new Error(`Unsupported MIDI output: ${destination}`);
    integer(channel,1,16,'channel');
    return voices[destination];
  }
  function release(destination, slot) {
    if (destination === destinations[0]) fm.noteOff(slot); else psg.off(slot);
    voices[destination][slot] = null;
  }
  return {
    setVoice(channel, data, options = {}) {
      let patch = data instanceof Uint8Array || data instanceof ArrayBuffer
        ? options.format === 'tfi' ? parseTfi(data) : options.format === 'vgi' ? parseVgi(data) : (()=>{throw new Error('Voice format must be tfi or vgi');})()
        : structuredClone(data);
      // Validate with the existing encoder without writing to the audio device.
      patch=normalize(patch);
      if (channel === undefined) patches.fill(patch); else patches[integer(channel,1,16,'channel')-1]=patch;
    },
    noteOn(destination, channel, note, velocity = 100, time) {
      const pool = target(destination,channel); note=midiNote(note);integer(velocity,1,127,'velocity');at=time;
      let slot=pool.findIndex(v=>!v);
      if(slot<0)slot=pool.reduce((old,v,i)=>v.id<pool[old].id?i:old,0);
      if(pool[slot])release(destination,slot);
      const id=++nextVoiceId;
      if(destination===destinations[0]) {
        const patch=structuredClone(patches[channel-1]);
        const mask=carriers[patch.algorithm ?? 0];
        const attenuation=Math.round(-20*Math.log10(velocity/127)/.75);
        // YM2612 presets accept either logical OP arrays or one-based maps.
        for(let op=0;op<4;op++)if(mask & (1<<op)) {
          const key=Array.isArray(patch.operators)?op:op+1;
          patch.operators ??= {};
          patch.operators[key]={...patch.operators[key],tl:Math.min(127,(patch.operators[key]?.tl??127)+attenuation)};
        }
        fm.setPreset(slot,patch);
        const pitch=createPitchFromMidi(note,{referenceMidi:62,referenceBlock:4,referenceFnum:553});fm.noteOn(slot,pitch.block,pitch.fnum);
      } else psg.tone(slot,{frequency:440*2**((note-69)/12),volume:velocity/127});
      pool[slot]={channel,note,id};
      const key=JSON.stringify([destination,channel,note]);const queue=pending.get(key)??[];queue.push(id);pending.set(key,queue);
      return id;
    },
    noteOff(destination,channel,note,time,id) {
      const pool=target(destination,channel);note=midiNote(note);at=time;
      // A duration-bound play releases only its own voice after stealing/retrigger.
      const key=JSON.stringify([destination,channel,note]),queue=pending.get(key)??[];
      if(id===undefined)id=queue.shift();else {const index=queue.indexOf(id);if(index>=0)queue.splice(index,1);}
      if(!queue.length)pending.delete(key);
      const slot=pool.findIndex(v=>v && v.channel===channel && v.note===note && v.id===id);
      if(slot>=0)release(destination,slot);
    },
    stop(time) {pending.clear();at=time;for(const destination of destinations)voices[destination].forEach((v,i)=>{if(v)release(destination,i);});},
  };
}

/** Shared API surface for main-thread and Worker execution. */
export function createMidiApi(invoke, {sleep, bpm, check = ()=>{}, owner = ()=>null}) {
  let readFile;
  const held=new Map();
  const call=(method,args)=>{check();return invoke(method,args);};
  return {
    cancelOwner(target) {
      for(const [id,entry] of held)if(target===undefined || entry.owner===target){held.delete(id);Promise.resolve(invoke('release',entry.args)).catch(()=>{});}
    },
    setFileReader(reader){readFile=reader;},
    async playFile(data,routes){if(owner()!==null)throw new Error('Call midi.playFile at the top level, outside liveLoop');return call('playFile',[data,routes]);},
    output(destination,{channel}={}) {
      if(!destinations.includes(destination))throw new Error(`Unsupported MIDI output: ${destination}`);
      if(channel!==undefined)integer(channel,1,16,'channel');
      const ch=channel??1;
      return {
        async setVoice(data,options) {
          if(destination!==destinations[0])throw new Error('setVoice is only available for YM2612');
          return call('setVoice',[channel,data,options]);
        },
        async loadVoice(path) {
          if(!readFile)throw new Error('loadVoice requires a project FILES reader');
          const format=String(path).split('.').pop().toLowerCase();
          if(!['tfi','vgi'].includes(format))throw new Error('Voice file must be .tfi or .vgi');
          return this.setVoice(await readFile(path,{type:'arrayBuffer'}),{format});
        },
        async noteOn(note,{velocity=100}={}) {
          const n=midiNote(note),origin=owner();
          const id=await call('noteOn',[destination,ch,n,integer(velocity,1,127,'velocity')]);
          try {check();} catch(error) {await invoke('release',[destination,ch,n,id]);throw error;}
          held.set(id,{owner:origin,args:[destination,ch,n,id]});return id;
        },
        noteOff(note) {
          const n=midiNote(note);
          for(const [id,e] of held)if(e.args[0]===destination&&e.args[1]===ch&&e.args[2]===n){held.delete(id);return call('release',e.args);}
          return call('noteOff',[destination,ch,n]);
        },
        async play(note,{velocity=100,duration=1}={}) {
          if(!Number.isFinite(duration)||duration<0)throw new Error('duration must be nonnegative beats');
          const n=midiNote(note),id=await this.noteOn(n,{velocity});
          try {await sleep(duration*60/bpm());} finally {held.delete(id);try{await invoke('release',[destination,ch,n,id]);}catch(error){if(error.name!=='AbortError')throw error;}}
        },
      };
    },
  };
}
