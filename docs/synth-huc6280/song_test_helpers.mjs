// Test-only fixtures and an inert Web Audio graph. No audio device is opened.
export const u32 = value => [value & 255, value >>> 8 & 255, value >>> 16 & 255, value >>> 24 & 255];
export const write = (register, value) => [0xb9, register, value];
export const wait = samples => [0x61, samples & 255, samples >>> 8 & 255];
export const block = (data, type = 5) => [0x67, 0x66, type, ...u32(data.length), ...data];
export const streamSetup = (id = 0, channel = 0, rate = 11025, step = 1, base = 0) => [
  0x90,id,0x1b,channel,6, 0x91,id,5,step,base, 0x92,id,...u32(rate)];
export const streamStart = (count, {id = 0, offset = 0, mode = 1} = {}) => [0x93,id,...u32(offset),mode,...u32(count)];
export function vgm(commands, {clock = 3579545, loop = false, end = true} = {}) {
  const bytes = new Uint8Array(256 + commands.length + (end ? 1 : 0)), view = new DataView(bytes.buffer);
  bytes.set([86,103,109,32]); view.setUint32(4,bytes.length - 4,true); view.setUint32(8,0x171,true);
  view.setUint32(0x34,0xcc,true); view.setUint32(0xa4,clock,true);
  if (loop) view.setUint32(0x1c,0xe4,true);
  bytes.set(commands,256); if (end) bytes[bytes.length - 1] = 0x66;
  return bytes;
}
export const wave = Array.from({length:32}, (_, i) => Math.round(15.5 + 15.5 * Math.sin(i * Math.PI / 16)));
export function voice(channel = 0, {dda = false, noise = false, period = 254, values = wave} = {}) {
  return [...write(0,channel), ...write(4,64), ...write(4,0), ...write(5,255),
    ...write(2,period & 255), ...write(3,period >>> 8), ...values.flatMap(value => write(6,value)),
    ...(channel >= 4 ? write(7,noise ? 0x90 : 0) : []), ...write(4,dda ? 223 : 159)];
}
export const init = [...write(1,255), ...write(9,0)];
export function fixtures() {
  const pcm = [0,31,4,26,8,22,12,18];
  return {
    wave:vgm([...init,...voice(),...wait(4096)]),
    noise:vgm([...init,...voice(4,{noise:true}),...wait(4096)]),
    lfo:vgm([...init,...voice(1,{period:16}),...voice(0),...write(8,4),...write(9,1),...wait(4096)]),
    direct:vgm([...init,...voice(0,{dda:true}),...Array.from({length:128},(_,i)=>[...write(6,pcm[i % pcm.length]),...wait(4)]).flat()]),
    stream:vgm([...init,...voice(0,{dda:true}),...block(pcm),...streamSetup(),...streamStart(pcm.length,{mode:129}),...wait(512),0x94,0]),
  };
}
export function fakeAudio() {
  const nodes = [], buffers = [], timers = new Map(); let nextTimer = 0;
  const context = {currentTime:0, sampleRate:48000, state:'running', resumes:0, closes:0,
    async resume() {this.resumes++;}, async close() {this.closes++; this.state = 'closed';},
    createGain() {
      const node = {context, gain:{value:1}, connections:[], disconnected:0,
        connect(target) {this.connections.push(target);}, disconnect() {this.disconnected++; this.connections = [];}};
      nodes.push(node); return node;
    },
    createBuffer(channels, frames, rate) {
      const data = Array.from({length:channels}, () => new Float32Array(frames));
      const buffer = {length:frames, sampleRate:rate, duration:frames / rate, data,
        copyToChannel(values, channel) {data[channel].set(values);}, getChannelData(channel) {return data[channel];}};
      buffers.push(buffer); return buffer;
    },
    createBufferSource() {
      const node = {context, connections:[], stopped:false, stopAt:null, at:null, offset:0, disconnected:0,
        connect(target) {this.connections.push(target);}, disconnect() {this.disconnected++; this.connections = [];},
        start(at, offset = 0) {this.at = at; this.offset = offset;},
        stop() {this.stopped = true; this.stopAt = context.currentTime;}};
      nodes.push(node); return node;
    },
  };
  const master = context.createGain(); master.gain.value = .7;
  const songInputNode = context.createGain(); songInputNode.connect(master);
  const audio = {context, songInputNode, master};
  const schedule = callback => {const id = ++nextTimer; timers.set(id,callback); return id;};
  const cancel = id => timers.delete(id);
  const tick = (seconds = .008) => {
    context.currentTime += seconds;
    const due = [...timers.values()]; timers.clear(); for (const callback of due) callback();
  };
  return {audio, context, nodes, buffers, timers, schedule, cancel, tick,
    sources:() => nodes.filter(node => 'at' in node)};
}
export function counterEngine() {
  return {disposals:0, resets:0, cursor:0, writes:[], sampleRate:() => 44100,
    reset() {this.cursor = 0; this.resets++;}, dispose() {this.disposals++;},
    writeHuc6280(register,value) {this.writes.push([register,value]);},
    writeHuc6280Stream(port,register,value) {this.writes.push([port,register,value]);},
    processFrames(frames) {
      const left = new Float32Array(frames), right = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {left[i] = this.cursor / 44100; right[i] = -left[i]; this.cursor++;}
      return {left,right};
    },
  };
}
export const deferred = () => {let resolve,reject; const promise = new Promise((yes,no) => {resolve=yes;reject=no;}); return {promise,resolve,reject};};
