import {readPreset,createDefaultPreset} from './preset.js';
import {readGameboyCodeEdit,applyGameboyCodeEdit} from './code_parameter_edit.js';
// SPDX-License-Identifier: BSD-3-Clause
// Passive, bounded observation of the Code-owned DMG. This module never
// acquires a Code client, creates audio, or changes the authored instrument.
const nativeSchedule=globalThis.setTimeout.bind(globalThis);
const nativeCancel=globalThis.clearTimeout.bind(globalThis);
const copy=value=>value===null?null:structuredClone(value);

/** Reflect a deliberate sparse edit in a frozen display without observing
 * unrelated future writes. This function never touches an APU or transport. */
export function patchGameboySnapshotEdit(snapshot,value){
  const edit=readGameboyCodeEdit(value);
  const next=copy(snapshot),ch=edit.channel,base=ch*5;
  const preset=applyGameboyCodeEdit(gameboyCodeLiveView(next,ch).preset,edit);
  const bits=(index,mask,value)=>{for(const bytes of [next.registers,next.voice])bytes[index]=(bytes[index]&~mask)|(value&mask);};
  const env=ch<2?preset.pulse:preset.noise;
  for(const path of Object.keys(edit.changes)){
    if(path==='pulse.duty')bits(base+1,0xc0,[.125,.25,.5,.75].indexOf(preset.pulse.duty)<<6);
    else if(path.endsWith('.volume'))bits(base+2,0xf0,env.volume<<4);
    else if(path.endsWith('.envelope.direction'))bits(base+2,8,env.envelope.direction==='up'?8:0);
    else if(path.endsWith('.envelope.period'))bits(base+2,7,env.envelope.period);
    else if(path.startsWith('pulse.sweep.')){
      const sweep=preset.pulse.sweep,key=path.split('.').at(-1);
      const mask={enabled:0x77,direction:8,period:0x70,shift:7}[key];
      // Enabled is derived from NR10's pace/shift bits in a live snapshot.
      // Editing either code can enable Sweep even when the old NR10 was zero.
      const disabled=Object.hasOwn(edit.changes,'pulse.sweep.enabled')&&!edit.changes['pulse.sweep.enabled'];
      const value=(sweep.direction==='down'?8:0)|(disabled?0:(sweep.period<<4)|sweep.shift);
      bits(0,mask,value);
    }else if(path==='wave.level')bits(12,0x60,[0,1,.5,.25].indexOf(preset.wave.level)<<5);
    else if(path==='wave.samples')for(let i=0;i<16;i++)bits(32+i,255,(preset.wave.samples[i*2]<<4)|preset.wave.samples[i*2+1]);
    else if(path==='noise.divisor')bits(18,7,preset.noise.divisor);
    else if(path==='noise.shift')bits(18,0xf0,preset.noise.shift<<4);
    else if(path==='noise.width')bits(18,8,preset.noise.width===7?8:0);
    else if(path.startsWith('pan.')){const mask=path==='pan.left'?16<<ch:1<<ch;bits(21,mask,preset.pan[path.slice(4)]?mask:0);}
  }
  return next;
}

export function createGameboyCodeLive({getAudio,isRunning,onUpdate=()=>{},schedule=nativeSchedule,cancel=nativeCancel,intervalMs=50,
  method='observeCode',retainSnapshot=false}={}) {
  for(const fn of [getAudio,isRunning,onUpdate,schedule,cancel])if(typeof fn!=='function')throw new TypeError('DMG Code Live needs host callbacks');
  if(!Number.isFinite(intervalMs)||intervalMs<50)throw new RangeError('DMG Code Live interval must be at least 50 ms');
  if(!['observeCode','observeEditor'].includes(method)||typeof retainSnapshot!=='boolean')throw new TypeError('Invalid DMG observation mode');
  let disposed=false,enabled=true,voice=0,epoch=0,owner=null,running=false,timer=null,inFlight=null;
  let snapshot=null,error='',waiting=false,refreshing=null;
  const read=()=>({liveKind:method==='observeEditor'?'editor':'code',liveEnabled:enabled,liveVoice:voice,liveActive:Boolean(running&&(enabled||retainSnapshot)&&snapshot&&!error),
    liveWaiting:Boolean(running&&enabled&&waiting),liveState:copy(snapshot),liveError:Boolean(error),liveMessage:error,
    liveSource:{name:'Code'},playing:running,paused:false});
  const notify=()=>{if(!disposed)onUpdate(read());};
  const clearTimer=()=>{if(timer!==null){cancel(timer);timer=null;}};
  const current=(token,engine,force=false)=>!disposed&&running&&(enabled||force)&&token===epoch&&engine===owner&&engine===getAudio()&&isRunning();
  function queue(delay=intervalMs){
    if(disposed||!running||!enabled||!owner||timer!==null||inFlight)return;
    timer=schedule(()=>{timer=null;void poll();},delay);
  }
  async function poll(force=false){
    if(disposed||!running||!enabled&&!force||!owner||inFlight)return;
    let finish;
    const engine=owner,token=epoch,request={engine,token,done:new Promise(resolve=>finish=resolve)};inFlight=request;
    try{
      const value=await engine.command(method);
      if(!current(token,engine,force))return;
      if(value!==null&&(!value||typeof value!=='object'))throw new TypeError('DMG Code observation did not return a state');
      snapshot=copy(value);waiting=value===null;error='';notify();
    }catch(cause){
      if(!current(token,engine,force))return;
      if(cause?.name==='AbortError'){snapshot=null;waiting=true;error='';}
      else{waiting=false;error=`Code Live observation failed: ${cause?.message??String(cause)}`;}
      notify();
    }finally{
      if(inFlight===request)inFlight=null;
      finish();
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
    enabled=value;epoch++;clearTimer();if(!retainSnapshot)snapshot=null;error='';waiting=Boolean(running&&enabled&&!snapshot);notify();sync(false);return read();
  }
  function setVoice(value){
    if(!Number.isInteger(value)||value<0||value>3)throw new RangeError('DMG Code Live channel must be an integer 0..3');
    if(disposed||voice===value)return read();
    voice=value;notify();return read();
  }
  function refresh(){
    if(refreshing)return refreshing;
    refreshing=(async()=>{sync(false,false);if(inFlight)await inFlight.done;if(!disposed)await poll(true);return read();})().finally(()=>{refreshing=null;});
    return refreshing;
  }
  // A deliberate edit remains visible with Auto update Off. Only its changed
  // fields enter the frozen observation; unrelated Code writes stay frozen.
  function commitEdit(value){
    const edit=readGameboyCodeEdit(value);
    if(disposed||!snapshot)return read();
    snapshot=patchGameboySnapshotEdit(snapshot,edit);notify();return read();
  }
  return {read,sync,setEnabled,setVoice,refresh,commitEdit,dispose(){if(disposed)return;disposed=true;epoch++;clearTimer();running=false;owner=null;snapshot=null;error='';}};
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
