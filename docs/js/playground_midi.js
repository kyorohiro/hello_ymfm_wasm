import {createMidiSongPlayer} from './midi_song.js?v=readable-midi-1';
import {YM2612Synth} from './ym2612synth.js';
import {createSegaPsgApi, psgPeriodFromFrequency} from './segapsg_api.js';
import {createPitchFromMidi} from './pitch.js';
import {parseTfi} from './tfi.js';
import {parseVgi} from './vgi.js';

const destinations = ['tetorica-ym2612', 'tetorica-sega-psg'];
let nextVoiceId = 0; // Never reuse IDs across Stop / Run rack replacement.
export const MIDI_SUPPORTED_CC = Object.freeze([7,10,11,64,120,121,123]);
const defaultControls = () => ({bend:0,range:2,volume:127,expression:127,pan:64,sustain:false});
const carriers = [8,8,8,8,10,14,14,15];
function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`);
  return value;
}
/**
 * Validate the full-scale pitch bend distance.
 * @param {number} value Semitones on either side of the unbent note (0..96).
 * @returns {number} The validated value.
 * @throws {Error} For nonfinite or out-of-range values.
 */
export function validateBendRange(value) {
  if (!Number.isFinite(value) || value < 0 || value > 96) throw new Error('Pitch bend range must be 0..96 semitones');
  return value;
}
function validateBend(value) {
  if (!Number.isFinite(value) || value < -1 || value > 1) throw new Error('Pitch bend must be -1..1');
  return value;
}
/**
 * Resolve a note name or MIDI key number; C4 is 60 and A4 is 69.
 * @param {string|number} note Uppercase note name (e.g. C#4, Bb3) or integer 0..127.
 * @returns {number} MIDI key number, independent of the output channel.
 * @throws {Error} For invalid names or notes outside 0..127.
 */
export function midiNote(note) {
  if (typeof note === 'string') {
    const m = /^([A-G])([#b]?)(-?\d+)$/.exec(note);
    if (!m) throw new Error('Invalid MIDI note');
    note = (Number(m[3])+1)*12 + {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1]] + (m[2]==='#'?1:m[2]==='b'?-1:0);
  }
  return integer(note,0,127,'note');
}

/**
 * Create the register-side MIDI adapter; handles on the same destination/channel share state.
 * Automatic voice allocation and fixed physical-channel mode are implemented here.
 * @param {Object} options Register transports and initial voice.
 * @param {Function} options.write Receives FM writes with port, register, value and optional time in seconds.
 * @param {Function} options.writePsg Receives PSG writes.
 * @param {Object} options.preset Initial FM voice, validated by YM2612Synth.
 * @param {number} [options.fmChannels=6] Number of available physical FM voices.
 * @returns {Object} Rack command handlers and voice lifecycle operations.
 */
export function createMidiRack({write, writePsg, preset, fmChannels = 6}) {
  let at;
  const pending = new Map();
  const controls = Object.fromEntries(destinations.map(d=>[d,Array.from({length:16},defaultControls)]));
  function normalize(data) {
    const validator=new YM2612Synth({transport:{write(){}}});validator.setPreset(0,data);
    const state=validator.channels[0];
    if(data.b4!==undefined) {integer(data.b4,0,255,'b4');state.left=!!(data.b4&128);state.right=!!(data.b4&64);state.ams=(data.b4>>4)&3;state.pms=data.b4&7;}
    return {algorithm:state.algorithm,feedback:state.feedback,ams:state.ams,pms:state.pms,pan:{left:state.left,right:state.right},operators:structuredClone(state.operators)};
  }
  const patches = Array.from({length:16},()=>normalize(preset));
  const voices = { 'tetorica-ym2612': Array(fmChannels).fill(null), 'tetorica-sega-psg': Array(3).fill(null) };
  let roundRobin = true;
  const tails = Array(fmChannels).fill(null); // Released FM envelopes can still be audible.
  // A register encoder, not another emulated chip. Never reset the real transport.
  const fm = new YM2612Synth({transport:{write:(port,register,value)=>write({port,register,value,time:at})}});
  const psg = createSegaPsgApi({write:value=>writePsg({value,time:at})});
  function target(destination, channel) {
    if (!destinations.includes(destination)) throw new Error(`Unsupported MIDI output: ${destination}`);
    integer(channel,0,15,'channel');
    return voices[destination];
  }
  function tune(destination, slot, voice) {
    const control=controls[destination][voice.channel];
    const note=voice.note+control.bend*control.range;
    if(destination===destinations[0]) {
      const pitch=createPitchFromMidi(note,{referenceMidi:62,referenceBlock:4,referenceFnum:553});
      fm.setFrequency(slot,pitch.block,pitch.fnum);
    } else {
      const period=psgPeriodFromFrequency(440*2**((note-69)/12));
      psg.write(0x80|(slot<<5)|(period&15));psg.write(period>>4);
    }
  }
  function retune(destination,channel) {
    voices[destination].forEach((voice,slot)=>{if(voice?.channel===channel)tune(destination,slot,voice);});
  }
  function level(destination,slot,voice) {
    const c=controls[destination][voice.channel];
    const gain=voice.velocity/127*c.volume/127*c.expression/127;
    if(destination===destinations[0]) {
      const attenuation=gain>0?Math.round(-20*Math.log10(gain)/.75):127;
      const patch=voice.patch,mask=carriers[patch.algorithm];
      for(let op=0;op<4;op++)if(mask&(1<<op)) {
        fm.setOperator(slot,op,{tl:Math.min(127,patch.operators[op].tl+attenuation)});
      }
    } else psg.write(0x90|(slot<<5)|(15-Math.round(gain*15)));
  }
  function pan(destination,slot,voice) {
    if(destination!==destinations[0])return; // Mega Drive PSG has no per-voice pan register.
    const value=controls[destination][voice.channel].pan;
    fm.setPan(slot,voice.patch.pan.left&&value<=84,voice.patch.pan.right&&value>=43);
  }
  function release(destination, slot, hard=false) {
    const voice=voices[destination][slot];
    if (destination === destinations[0]) {
      if(hard)for(let op=0;op<4;op++)fm.setOperator(slot,op,{tl:127});
      fm.noteOff(slot);tails[slot]=hard?null:voice;
    } else psg.off(slot);
    voices[destination][slot] = null;
  }
  function updateChannel(destination,channel,update) {
    voices[destination].forEach((v,i)=>{if(v?.channel===channel)update(destination,i,v);});
    if(destination===destinations[0])tails.forEach((v,i)=>{if(v?.channel===channel)update(destination,i,v);});
  }
  function releaseSustained(destination,channel) {
    voices[destination].forEach((v,i)=>{if(v?.channel===channel&&!v.keyDown)release(destination,i);});
  }
  return {
    enableSoundChip(chip, options = {}) {
      if (!['ym2612','tetorica-ym2612'].includes(chip)) throw new Error('Allocation mode is only supported for YM2612');
      const enabled=options.roundRobin===undefined?true:options.roundRobin;
      if(typeof enabled!=='boolean')throw new Error('roundRobin must be boolean');
      if(enabled===roundRobin)return;
      for(let ch=0;ch<16;ch++)this.cc(destinations[0],ch,120,0);
      roundRobin=enabled;
    },
    cc(destination,channel,controller,value,time) {
      target(destination,channel);integer(controller,0,127,'controller');integer(value,0,127,'CC value');
      if(!MIDI_SUPPORTED_CC.includes(controller))return false;
      at=time;const c=controls[destination][channel];
      if(controller===7||controller===11) {
        c[controller===7?'volume':'expression']=value;updateChannel(destination,channel,level);
      } else if(controller===10) {
        c.pan=value;updateChannel(destination,channel,pan);
      } else if(controller===64) {
        c.sustain=value>=64;if(!c.sustain)releaseSustained(destination,channel);
      } else if(controller===121) {
        // Retain channel volume, pan and configured bend range.
        c.expression=127;c.bend=0;c.sustain=false;releaseSustained(destination,channel);
        retune(destination,channel);updateChannel(destination,channel,level);
      } else if(controller===123) {
        voices[destination].forEach(v=>{if(v?.channel===channel)v.keyDown=false;});
        if(!c.sustain)releaseSustained(destination,channel);
      } else if(controller===120) {
        voices[destination].forEach((v,i)=>{if(v?.channel===channel)release(destination,i,true);});
        if(destination===destinations[0])tails.forEach((v,i)=>{
          if(v?.channel===channel){for(let op=0;op<4;op++)fm.setOperator(i,op,{tl:127});tails[i]=null;}
        });
      }
      return true;
    },
    pitchBend(destination,channel,value,time) {
      target(destination,channel);validateBend(value);at=time;
      controls[destination][channel].bend=value;retune(destination,channel);
    },
    setPitchBendRange(destination,channel,semitones,time) {
      target(destination,channel);validateBendRange(semitones);at=time;
      controls[destination][channel].range=semitones;retune(destination,channel);
    },
    setVoice(channel, data, options = {}) {
      let patch = data instanceof Uint8Array || data instanceof ArrayBuffer
        ? options.format === 'tfi' ? parseTfi(data) : options.format === 'vgi' ? parseVgi(data) : (()=>{throw new Error('Voice format must be tfi or vgi');})()
        : structuredClone(data);
      // Validate with the existing encoder without writing to the audio device.
      patch=normalize(patch);
      if (channel === undefined) patches.fill(patch); else { target(destinations[0],channel);patches[channel]=patch; }
    },
    noteOn(destination, channel, note, velocity = 100, time) {
      const pool = target(destination,channel); note=midiNote(note);integer(velocity,1,127,'velocity');at=time;
      const fixed=destination===destinations[0]&&!roundRobin;
      if(fixed&&channel>=pool.length)return ++nextVoiceId;
      let slot=fixed?channel:pool.findIndex(v=>!v);
      if(slot<0)slot=pool.reduce((old,v,i)=>v.id<pool[old].id?i:old,0);
      if(pool[slot])release(destination,slot);
      const id=++nextVoiceId;
      const voice={channel,note,id,velocity,keyDown:true};
      if(destination===destinations[0]) {
        voice.patch=structuredClone(patches[channel]);tails[slot]=null;
        fm.setPreset(slot,voice.patch);
      }
      level(destination,slot,voice);pan(destination,slot,voice);tune(destination,slot,voice);
      if(destination===destinations[0])fm.keyOn(slot);
      pool[slot]=voice;
      const key=JSON.stringify([destination,channel,note]);const queue=pending.get(key)??[];queue.push(id);pending.set(key,queue);
      return id;
    },
    noteOff(destination,channel,note,time,id,force=false) {
      const pool=target(destination,channel);note=midiNote(note);at=time;
      // A duration-bound play releases only its own voice after stealing/retrigger.
      const key=JSON.stringify([destination,channel,note]),queue=pending.get(key)??[];
      if(id===undefined)id=queue.shift();else {const index=queue.indexOf(id);if(index>=0)queue.splice(index,1);}
      if(!queue.length)pending.delete(key);
      const slot=pool.findIndex(v=>v && v.channel===channel && v.note===note && v.id===id);
      if(slot>=0) {
        pool[slot].keyDown=false;
        if(force||!controls[destination][channel].sustain)release(destination,slot,force);
      }
    },
    stop(time) {
      pending.clear();at=time;
      tails.forEach((v,i)=>{if(v){for(let op=0;op<4;op++)fm.setOperator(i,op,{tl:127});tails[i]=null;}});
      for(const destination of destinations) {
        voices[destination].forEach((v,i)=>{if(v)release(destination,i,true);});
        Object.values(controls[destination]).forEach(c=>Object.assign(c,defaultControls()));
      }
    },
  };
}

/**
 * Build the user-facing MIDI API shared by main-thread and Worker execution.
 * Output channels use 0..15 (CH1..CH16); the rack controls physical voice allocation.
 * @param {Function} invoke Dispatch a rack method and its argument array.
 * @param {Object} options Timing and execution context callbacks.
 * @param {Function} options.sleep Await a duration in seconds.
 * @param {Function} options.bpm Read the current beats-per-minute value.
 * @param {Function} [options.check] Throw when the current run is cancelled.
 * @param {Function} [options.owner] Return the current live-loop ownership token.
 * @param {Function} [options.now] Read the scheduling clock in seconds.
 * @returns {Object} MIDI API with output handles, sound-chip mode selection and cleanup helpers.
 */
export function createMidiApi(invoke, {sleep, bpm, check = ()=>{}, owner = ()=>null, now = ()=>performance.now()/1000}) {
  let readFile;
  const held=new Map(),pedals=new Map();
  const channelKey=(destination,channel)=>JSON.stringify([destination,channel]);
  const releaseHeld=(id)=>{
    const entry=held.get(id);if(!entry)return;
    if(pedals.get(channelKey(entry.args[0],entry.args[1])))entry.released=true;
    else held.delete(id);
  };
  const call=(method,args)=>{check();return invoke(method,args);};
  return {
    cancelOwner(target) {
      for(const [id,entry] of held)if(target===undefined || entry.owner===target) {
        held.delete(id);
        // Stop invalidates the run before cancelling loops. A synchronous
        // cancellation must not prevent the rack's following hard mute.
        try { Promise.resolve(invoke('release',[...entry.args,true])).catch(()=>{}); }
        catch (_) { /* The stopped run is released by rack.stop(). */ }
      }
    },
    async enableSoundChip(chip, options = {}) { return call('enableSoundChip',[chip,options]); },
    createSongPlayer(config) { return createMidiSongPlayer(this, config); },
    createTimeline() {
      check();const origin=now();let previous=0;
      return {async waitUntil(seconds) {
        check();
        if(!Number.isFinite(seconds)||seconds<previous)throw new Error('Timeline time must be finite, nonnegative and nondecreasing');
        previous=seconds;
        // Yield even when late so Stop can be processed; retain the original deadline.
        await sleep(Math.max(0,origin+seconds-now()));check();
      }};
    },
    setFileReader(reader){readFile=reader;},
    async playFile(data,routes){if(owner()!==null)throw new Error('Call midi.playFile at the top level, outside liveLoop');return call('playFile',[data,routes]);},
    output(destination,{channel}={}) {
      if(!destinations.includes(destination))throw new Error(`Unsupported MIDI output: ${destination}`);
      const ch=channel===undefined?0:channel;
      integer(ch,0,15,'channel');
      const handleCall=call;
      return {
        async cc(controller,value) {
          const result=await handleCall('cc',[destination,ch,integer(controller,0,127,'controller'),integer(value,0,127,'CC value')]);
          const key=channelKey(destination,ch);
          if(controller===64)pedals.set(key,value>=64);
          if(controller===121)pedals.set(key,false);
          for(const [id,e] of held)if(e.args[0]===destination&&e.args[1]===ch) {
            if(controller===123)releaseHeld(id);
            if(controller===120||e.released&&!pedals.get(key))held.delete(id);
          }
          return result;
        },
        async pitchBend(value) {return handleCall('pitchBend',[destination,ch,validateBend(value)]);},
        async setPitchBendRange(semitones) {return handleCall('setPitchBendRange',[destination,ch,validateBendRange(semitones)]);},
        async setVoice(data,options) {
          if(destination!==destinations[0])throw new Error('setVoice is only available for YM2612');
          return handleCall('setVoice',[channel,data,options]);
        },
        async loadVoice(path) {
          if(!readFile)throw new Error('loadVoice requires a project FILES reader');
          const format=String(path).split('.').pop().toLowerCase();
          if(!['tfi','vgi'].includes(format))throw new Error('Voice file must be .tfi or .vgi');
          return this.setVoice(await readFile(path,{type:'arrayBuffer'}),{format});
        },
        async noteOn(note,{velocity=100}={}) {
          const n=midiNote(note),origin=owner();
          const id=await handleCall('noteOn',[destination,ch,n,integer(velocity,1,127,'velocity')]);
          try {check();} catch(error) {await invoke('release',[destination,ch,n,id]);throw error;}
          held.set(id,{owner:origin,args:[destination,ch,n,id]});return id;
        },
        noteOff(note) {
          const n=midiNote(note);
          for(const [id,e] of held)if(!e.released&&e.args[0]===destination&&e.args[1]===ch&&e.args[2]===n){releaseHeld(id);return handleCall('release',e.args);}
          return handleCall('noteOff',[destination,ch,n]);
        },
        async play(note,{velocity=100,duration=1}={}) {
          if(!Number.isFinite(duration)||duration<0)throw new Error('duration must be nonnegative beats');
          const n=midiNote(note),id=await this.noteOn(n,{velocity});
          try {await sleep(duration*60/bpm());} finally {releaseHeld(id);try{await invoke('release',[destination,ch,n,id]);}catch(error){if(error.name!=='AbortError')throw error;}}
        },
      };
    },
  };
}
