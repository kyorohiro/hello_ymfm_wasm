// SPDX-License-Identifier: BSD-3-Clause
import {NesApuWasm} from '../js/nesapu_wasm.js';
import {NesApuSynth} from '../js/nesapusynth.js';
import {NesInstrument} from './instrument.js';
import {readPreset} from './preset.js';
import {OutputClickGuard} from './click_guard.js';
import {nesVgmAddress} from './song_source.js';
import {createNesRegisterState,captureNesSongPreset,NES_SONG_SOURCES} from './song_state.js';

/** A native NES/FDS engine with the same physical-channel keyboard attacks as
 * the Synth. VGM writes and human writes share this APU during song playback. */
export async function createNesSongEngine(header,{createCore=NesApuWasm.create} = {}) {
  const clock = header.nesApuClock & 0x3fffffff;
  // The extra channel remains silent unless the source or a human enables it.
  const core = await createCore({clock,sampleRate:44100,fds:true});
  const shadow = createNesRegisterState(clock), dirty = Array(6).fill(true);
  let instrument = null, disposed = false, clickGuard = null, clickGuardEnabled = true;
  const engine = {
    clock,fdsEnabled:true,manualWrite:false,
    writeRegister(address,value) {
      if (disposed) throw new Error('NES reference engine is disposed');
      const modulationIndex=address===0x4088?core.getState().fdsModIndex:undefined;
      core.writeRegister(address,value); shadow.write(address,value,{modulationIndex});
      if (!engine.manualWrite && instrument) {
        instrument.observeExternalWrite(address,value);
        const channel = address<=0x400f ? (address-0x4000)>>2 : address<=0x4013 ? 4 : address>=0x4040 ? 5 : -1;
        if (channel>=0 && channel<6) dirty[channel]=true;
      }
    },
    writeNesApu(register,value) {return engine.writeRegister(nesVgmAddress(register),value);},
    loadMemory(data,address=0) {core.loadMemory(data,address); shadow.loadMemory(data,address); instrument && instrument.memoryVersion++;},
    loadNesMemory(data,address) {return engine.loadMemory(data,address);},
    readMemory:address => core.readMemory(address),
    setChannelEnabled(channel,enabled) {
      const state = core.getState(), current = channel===4 ? state.enableMask : (state.enableMask&15)|(state.dmcRemaining>0 ? state.enableMask&16 : 0);
      engine.writeRegister(0x4015,enabled ? current|1<<channel : current&~(1<<channel));
    },
    getState:() => core.getState(),getCoreState:() => core.getState(),sampleRate:() => core.sampleRate(),
    generateStereo:frames => core.generateStereo(frames),
    processFrames(frames) {
      const pcm=core.generateStereo(frames);clickGuard?.process(pcm);shadow.hardware(core.getState());return pcm;
    },
    reset() {core.reset();shadow.reset();dirty.fill(true);if(instrument){instrument.voices.clear();instrument.slots.fill(null);instrument.owners.fill(null);instrument.memoryVersion++;}},
    setChannelMuted:(channel,muted) => core.setChannelMuted(channel,muted),
    snapshot() {shadow.hardware(core.getState());return shadow.snapshot();},
    getMemory:() => shadow.getMemory(),
    dispose() {if(disposed)return;disposed=true;core.dispose();},
  };
  try {instrument = new NesInstrument(engine);}
  catch (error) {core.dispose();throw error;}
  engine.instrument = instrument;
  function adopt() {
    const hardware=core.getState(), sample=instrument.synth._getState().sample;
    instrument.synth._adoptState({clock,registers:hardware.registers,enabled:hardware.enableMask,
      fdsActive:hardware.fdsActive,fdsGain:Math.min(32,hardware.fdsGain),fdsMaster:hardware.fdsMaster,sample});
  }
  function publicWrite(address,value) {
    const previous=engine.manualWrite;engine.manualWrite=true;
    try {
      engine.writeRegister(address,value);instrument.observeExternalWrite(address,value);
      const channel=address<=0x400f?(address-0x4000)>>2:address<=0x4013?4:address>=0x4040?5:-1;
      if(channel>=0&&channel<6)dirty[channel]=true;
      // A borrowed raw-register client defines its own ownership/gates.
      // Keep that explicit low-level path audible while normal keyboard
      // commands below use the same ownership policy as the Worklet.
      clickGuard?.bypass();
      engine.onManualWrite?.();
    }finally{engine.manualWrite=previous;}
  }
  const publicClient=new NesApuSynth({clock,fds:true,initialize:false,transport:{clock,fdsEnabled:true,
    writeRegister:publicWrite,
    loadMemory(data,address) {
      const previous=engine.manualWrite;engine.manualWrite=true;
      try{engine.loadMemory(data,address);dirty[4]=true;engine.onManualWrite?.();}finally{engine.manualWrite=previous;}
    },
    setChannelEnabled(channel,enabled) {
      const state=core.getState(),current=channel===4?state.enableMask:(state.enableMask&15)|(state.dmcRemaining>0?state.enableMask&16:0);
      publicWrite(0x4015,enabled?current|1<<channel:current&~(1<<channel));
    },
  }});
  function manual(action) {
    if(disposed)throw new Error('NES reference engine is disposed');
    adopt();engine.manualWrite=true;const previous=instrument.owners.slice();
    try {
      const result=action();
      if(clickGuard) {
        const owners=instrument.owners,hasOther=owners.some((owner,channel)=>owner&&channel!==4&&channel!==5);
        if(!clickGuardEnabled||hasOther)clickGuard.bypass();
        else if((owners[4]||owners[5])&&owners.some((owner,channel)=>owner&&owner!==previous[channel]))clickGuard.attack();
        else if(!owners[4]&&!owners[5]&&(previous[4]||previous[5]))clickGuard.release();
      }
      return result;
    } finally {engine.manualWrite=false;}
  }
  engine.setAuditionClickGuard = enabled => {
    if(typeof enabled!=='boolean')throw new TypeError('Software click guard must be boolean');
    if(clickGuard&&clickGuardEnabled===enabled)return;
    clickGuard??=new OutputClickGuard({sampleRate:core.sampleRate()});clickGuardEnabled=enabled;
    const owners=instrument.owners,hasOther=owners.some((owner,channel)=>owner&&channel!==4&&channel!==5);
    if(!enabled||hasOther)clickGuard.bypass();
    else if(owners[4]||owners[5])clickGuard.attack();
    else clickGuard.release();
  };
  engine.getAuditionClickGuard = () => clickGuard?{enabled:clickGuardEnabled,...clickGuard.read()}:null;
  engine.applyPreset = (channel,preset) => manual(() => {
    if(!Number.isInteger(channel)||channel<0||channel>5)throw new RangeError('NES channel must be 0..5');
    const next=readPreset({...preset,source:NES_SONG_SOURCES[channel]});
    if(dirty[channel]) {
      const voice=engine.snapshot().channels[channel];
      if(voice?.canCapture)instrument.channelPresets[channel]=voice.preset;
      else {
        // The renderer was reset for VGM. A channel absent from that log has
        // no installed defaults even if its authored cache matches the UI.
        instrument._apply(null,next,channel);instrument.channelPresets[channel]=next;instrument.codeRaw[channel]=false;
        dirty[channel]=false;return instrument.read();
      }
    }
    const result=instrument.applyPhysicalPreset(channel,next);dirty[channel]=false;return result;
  });
  engine.noteOn = (id,note,channel) => manual(() => {
    if(dirty[channel])instrument.channelPresets[channel]=captureNesSongPreset(engine.snapshot(),{channel});
    const preset=instrument.channelPresets[channel];
    if(channel===4) {
      const length=Math.ceil((preset.dmc.data.length-1)/16)*16+1,data=new Uint8Array(length).fill(0xaa);data.set(preset.dmc.data);
      engine.loadMemory(data,0xc000);
    }
    dirty[channel]=false;return instrument.noteOn(id,note,channel);
  });
  engine.noteOff = id => manual(() => instrument.noteOff(id));
  engine.setPitch = value => manual(() => instrument.setPitch(value));
  engine.manualSnapshot = () => {
    const snapshot=engine.snapshot();
    snapshot.channels=snapshot.channels.map((voice,channel)=>voice.canCapture&&!dirty[channel]
      ? {...voice,preset:readPreset(instrument.channelPresets[channel])}:voice);
    return snapshot;
  };
  engine.getChip = () => {
    if(disposed)throw new Error('NES reference engine is disposed');
    const hardware=core.getState();
    publicClient._adoptState({clock,registers:hardware.registers,enabled:hardware.enableMask,fdsActive:hardware.fdsActive,
      fdsGain:Math.min(32,hardware.fdsGain),fdsMaster:hardware.fdsMaster,sample:publicClient._getState().sample});
    return publicClient;
  };
  engine.seed = snapshot => {
    engine.reset();
    // The paused clone needs written controls and complete tables, while its
    // hardware counters deliberately begin silent until a human attack.
    for(let channel=0;channel<6;channel++) {
      const voice=snapshot.channels[channel];
      if(voice.canCapture)manual(() => {
        instrument._apply(null,voice.preset,channel);instrument.channelPresets[channel]=voice.preset;dirty[channel]=false;
      });
    }
    for(const address of [0x4002,0x4003,0x4006,0x4007,0x400a,0x400b,0x4082,0x4083]) {
      engine.writeRegister(address,snapshot.registers[address-0x4000]);
    }
    if(snapshot.channels[4].canCapture) {
      // Portable DPCM was copied to C000 by _apply. Retain the full sample
      // length before its first trial key, including stopped Rate edits.
      engine.writeRegister(0x4012,0);engine.writeRegister(0x4013,snapshot.registers[0x13]);
    }
    engine.manualWrite=true;
    try {adopt();instrument.stop();} finally {engine.manualWrite=false;}
    // Silencing the clone changes its applied FDS gain. Preserve the frozen
    // channel's authored attack instead of capturing that silent gain again.
    snapshot.channels.forEach((voice,channel)=>{dirty[channel]=!voice.canCapture;});
  };
  return engine;
}
