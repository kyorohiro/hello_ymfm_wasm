import { SimplePwm } from '../js/genesisaudioengine.js?v=pwm-2';

// Output captures, not recovered instruments. Keep writes and their timing so
// Cycle/routing changes can be replayed without losing the original values.
export function createPwmSamples() {
  const samples = [], events = [], pwm = new SimplePwm();
  let active = null, count = 0;
  const state = () => ({cycle:pwm.cycle, control:pwm.control, left:pwm.left, right:pwm.right});
  function begin(time) { active = {start:time, initialState:state(), times:[], registers:[], values:[]}; }
  function finish(time, reason) {
    if (!active) return;
    if (time > active.start) {
      const id = samples.length + 1;
      samples.push({id, chip:'32x', kind:'pwm', initialState:active.initialState,
        times:Float64Array.from(active.times), registers:Uint8Array.from(active.registers),
        data:Uint16Array.from(active.values), size:active.values.length * 2,
        available:active.values.length * 2, duration:time-active.start, boundary:reason});
      events.push({sampleId:id, chip:'32x', kind:'pwm', channel:'L/R', startTime:active.start,
        endTime:time, endReason:reason, rate:44100, level:'captured', pan:'stereo'});
    }
    active = null;
  }
  function advance(time) {
    while (active && time-active.start >= 441000) {
      const end = active.start + 441000;
      finish(end,'10-second display window'); begin(end);
      if (samples.length > 4096) throw new Error('PWM capture exceeds 4096 windows.');
    }
  }
  function write(register, value, time) {
    if (register < 0 || register > 4) return;
    advance(time);
    if (++count > 4000000) throw new Error('PWM capture exceeds four million writes.');
    if (!active && register >= 2) begin(time);
    if (active) {
      active.times.push(time-active.start); active.registers.push(register); active.values.push(value & 0xfff);
    }
    pwm.writeRegister(register,value);
  }
  return {samples, events, write, advance, finish};
}

export function renderPwmPreview(sample) {
  const pwm = new SimplePwm(); Object.assign(pwm, sample.initialState);
  const frames = Math.ceil(sample.duration), left = new Float32Array(frames), right = new Float32Array(frames);
  let cursor = 0;
  const fill = end => {
    const [l,r] = pwm.output();
    left.fill(l,cursor,end); right.fill(r,cursor,end); cursor = end;
  };
  for (let i=0;i<sample.data.length;i++) {
    fill(Math.min(frames,Math.ceil(sample.times[i])));
    pwm.writeRegister(sample.registers[i],sample.data[i]);
  }
  fill(frames); return {left,right};
}

export function pwmCaptureJson(sample, startTime) {
  return JSON.stringify({format:'tetorica-pwm-capture-v1',timebase:44100,startTime,
    duration:sample.duration,boundary:sample.boundary,initialState:sample.initialState,
    times:[...sample.times],registers:[...sample.registers],values:[...sample.data]});
}

// Stereo PCM16 WAV of the approximate renderer; timed JSON retains raw values.
export function pwmCaptureWav(sample) {
  const {left,right} = renderPwmPreview(sample), bytes = new Uint8Array(44+left.length*4), v = new DataView(bytes.buffer);
  const tag = (offset,text) => { for(let i=0;i<text.length;i++)bytes[offset+i]=text.charCodeAt(i); };
  tag(0,'RIFF');v.setUint32(4,bytes.length-8,true);tag(8,'WAVE');tag(12,'fmt ');
  v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);
  v.setUint32(24,44100,true);v.setUint32(28,44100*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);
  tag(36,'data');v.setUint32(40,left.length*4,true);
  for(let i=0;i<left.length;i++)for(let ch=0;ch<2;ch++) {
    const x=Math.max(-1,Math.min(1,ch?right[i]:left[i]));
    v.setInt16(44+i*4+ch*2,Math.round(x*(x<0?32768:32767)),true);
  }
  return bytes;
}
