import {readPreset,createDefaultPreset} from './preset.js';
// SPDX-License-Identifier: BSD-3-Clause
// Passive, bounded observation of the Code-owned DMG. This module never
// acquires a Code client, creates audio, or changes the authored instrument.
const nativeSchedule=globalThis.setTimeout.bind(globalThis);
const nativeCancel=globalThis.clearTimeout.bind(globalThis);
const copy=value=>value===null?null:structuredClone(value);

export function createGameboyCodeLive({getAudio,isRunning,onUpdate=()=>{},schedule=nativeSchedule,cancel=nativeCancel,intervalMs=50}={}) {
  for(const fn of [getAudio,isRunning,onUpdate,schedule,cancel])if(typeof fn!=='function')throw new TypeError('DMG Code Live needs host callbacks');
  if(!Number.isFinite(intervalMs)||intervalMs<50)throw new RangeError('DMG Code Live interval must be at least 50 ms');
  let disposed=false,enabled=true,voice=0,epoch=0,owner=null,running=false,timer=null,inFlight=null;
  let snapshot=null,error='',waiting=false;
  const read=()=>({liveKind:'code',liveEnabled:enabled,liveVoice:voice,liveActive:Boolean(running&&enabled&&snapshot&&!error),
    liveWaiting:Boolean(running&&enabled&&waiting),liveState:copy(snapshot),liveError:Boolean(error),liveMessage:error,
    liveSource:{name:'Code'},playing:running,paused:false});
  const notify=()=>{if(!disposed)onUpdate(read());};
  const clearTimer=()=>{if(timer!==null){cancel(timer);timer=null;}};
  const current=(token,engine)=>!disposed&&running&&enabled&&token===epoch&&engine===owner&&engine===getAudio()&&isRunning();
  function queue(delay=intervalMs){
    if(disposed||!running||!enabled||!owner||timer!==null||inFlight)return;
    timer=schedule(()=>{timer=null;void poll();},delay);
  }
  async function poll(){
    if(disposed||!running||!enabled||!owner||inFlight)return;
    const engine=owner,token=epoch,request={engine,token};inFlight=request;
    try{
      const value=await engine.command('observeCode');
      if(!current(token,engine))return;
      if(value!==null&&(!value||typeof value!=='object'))throw new TypeError('DMG Code observation did not return a state');
      snapshot=copy(value);waiting=value===null;error='';notify();
    }catch(cause){
      if(!current(token,engine))return;
      if(cause?.name==='AbortError'){snapshot=null;waiting=true;error='';}
      else{waiting=false;error=`Code Live observation failed: ${cause?.message??String(cause)}`;}
      notify();
    }finally{
      if(inFlight===request)inFlight=null;
      // An old request may finish after Off/Stop or a later Run. Do not let its
      // result repaint that run; only allow its now-current poll to resume.
      if(!disposed){sync(false,false);queue();}
    }
  }
  function sync(emit=true,immediate=true){
    if(disposed)return read();
    const nextRunning=Boolean(isRunning()),nextOwner=nextRunning?getAudio():null;
    if(nextRunning!==running||nextOwner!==owner){
      epoch++;clearTimer();running=nextRunning;owner=nextOwner;snapshot=null;error='';waiting=Boolean(running&&enabled);
      if(emit)notify();
    }
    if(immediate&&running&&enabled&&owner&&!inFlight)queue(0);
    return read();
  }
  function setEnabled(value){
    if(typeof value!=='boolean')throw new TypeError('DMG Code Live enabled must be boolean');
    if(disposed||enabled===value)return read();
    enabled=value;epoch++;clearTimer();snapshot=null;error='';waiting=Boolean(running&&enabled);notify();sync(false);return read();
  }
  function setVoice(value){
    if(!Number.isInteger(value)||value<0||value>3)throw new RangeError('DMG Code Live channel must be an integer 0..3');
    if(disposed||voice===value)return read();
    voice=value;notify();return read();
  }
  return {read,sync,setEnabled,setVoice,dispose(){if(disposed)return;disposed=true;epoch++;clearTimer();running=false;owner=null;snapshot=null;error='';}};
}

/** Present sent/configured APU registers in the existing sound editor. This is
 * not hardware envelope readback, Sweep phase or the currently audible level. */
export function gameboyCodeLiveView(snapshot, channel, original = createDefaultPreset()) {
  if (!Number.isInteger(channel) || channel < 0 || channel > 3) throw new RangeError('DMG channel must be 0..3');
  const registers = snapshot?.registers, voice = snapshot?.voice;
  for (const values of [registers, voice]) {
    if (!Array.isArray(values) || values.length !== 48 || values.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
      throw new TypeError('DMG observation needs 48 sent and configured register bytes');
    }
  }
  const preset = readPreset(original), base = channel * 5;
  preset.source = channel < 2 ? 'pulse' : channel === 2 ? 'wave' : 'noise';
  preset.pan = {left:Boolean(registers[21] & (16 << channel)), right:Boolean(registers[21] & (1 << channel))};
  const env = voice[base + 2];
  const envelope = {direction:env & 8 ? 'up' : 'down', period:env & 7};
  if (channel < 2) {
    const sweep = voice[0];
    preset.pulse = {duty:[.125,.25,.5,.75][voice[base + 1] >> 6], volume:env >> 4, envelope,
      sweep:{enabled:channel === 0 && Boolean(sweep & 0x77), direction:sweep & 8 ? 'down' : 'up', period:(sweep >> 4) & 7, shift:sweep & 7}};
  } else if (channel === 2) {
    preset.wave = {samples:Array.from({length:32}, (_, index) => (registers[32 + (index >> 1)] >> (index % 2 ? 0 : 4)) & 15),
      level:[0,1,.5,.25][(voice[12] >> 5) & 3]};
  } else {
    preset.noise = {volume:env >> 4, envelope, divisor:voice[18] & 7, shift:voice[18] >> 4, width:voice[18] & 8 ? 7 : 15};
  }
  const period = channel === 3 ? null : registers[base + 3] | ((registers[base + 4] & 7) << 8);
  const clock = Number.isFinite(snapshot.clock) && snapshot.clock > 0 ? snapshot.clock : 4194304;
  const frequency = period === null ? null : clock / ((channel === 2 ? 64 : 32) * (2048 - period));
  const level = channel === 2 ? `Level ${Math.round(preset.wave.level * 100)}%` : `Initial volume ${env >> 4}`;
  const pitch = frequency === null ? `Noise clock: divisor ${preset.noise.divisor} / shift ${preset.noise.shift}`
    : `Sent period ${period} · base pitch ${frequency.toFixed(1)} Hz`;
  return {preset:readPreset(preset), channel, period, frequency,
    readout:`CH ${channel + 1} · ${preset.source === 'pulse' ? 'Pulse' : preset.source === 'wave' ? 'Wave' : 'Noise'} · ${pitch} · ${level} · L ${preset.pan.left ? 'On' : 'Off'} / R ${preset.pan.right ? 'On' : 'Off'}`};
}
