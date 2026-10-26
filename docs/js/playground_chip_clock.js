/** Chip clocks are Hz, independent of output frames, VGM samples and BPM. */
export const CHIP_CLOCKS = Object.freeze({ym2612:7670454, ym2203:4000000, ym2610:8000000, ym2610b:8000000,
  ym2608:8000000, ym2151:3579545, segapsg:3579545, gameboy:4194304,
  nes:1789773, snes:1024000, x68000:4000000, huc6280:3579545, wonderswan:3072000, okim6258:8000000,
  ay8910:1789773, msx:1789773, 'msx-audio':1789773, ym2413:3579545, ym3526:3579545, ym3812:3579545, y8950:3579545, ymf262:14318180,
  rf5c164:12500000, pwm:23011361});

/** @param {number} hz */
export function validateChipClock(hz) {
  if (!Number.isInteger(hz) || hz < 100000 || hz > 100000000) throw new RangeError('Chip clock must be an integer Hz value from 100000 to 100000000');
  return hz;
}

/** Preserve core registers, RAM and phase while changing their rate of advancement.
 * Used by fixed-rate cores; never resamples the output scheduling timeline. */
export class ChipClockResampler {
  constructor() { this.ratio = 1; this.remainder = 0; this.left = 0; this.right = 0; }
  /** @param {number} hz @param {number} baseHz */
  setClock(hz, baseHz) { this.ratio = validateChipClock(hz) / baseHz; }
  resetPhase() { this.remainder = 0; this.left = this.right = 0; }
  render(chip, left, right) {
    // Count using the same additions as the output loop. Multiplication can
    // round differently at a frame boundary and leave one source frame short.
    if (!this.counts || this.counts.length < left.length) this.counts = new Uint32Array(left.length);
    let frames = 0;
    for (let i = 0; i < left.length; i++) {
      this.remainder += this.ratio;
      const count = Math.floor(this.remainder); this.remainder -= count;
      this.counts[i] = count; frames += count;
    }
    const pcm = frames ? (chip.generateStereoView ?? chip.generateStereo).call(chip,frames) : null;
    let offset = 0;
    for (let i = 0; i < left.length; i++) {
      const count = this.counts[i];
      if (count) {
        let l = 0, r = 0;
        for (let j = 0; j < count; j++, offset++) { l += pcm.left[offset]; r += pcm.right[offset]; }
        this.left = l / count; this.right = r / count;
      }
      left[i] = this.left; right[i] = this.right;
    }
  }
}

/** Ordered, acknowledged clock controls for Main and Worker clients.
 * @template T
 * @param {T} client @param {MessagePort} port @param {number} initialClock
 * @param {{primary?:boolean, batch?:boolean, onApplied?:(hz:number)=>void}} [options]
 * @returns {T & {readonly clock:number, setClock(hz:number):Promise<void>, _requestControl(method:string,args?:any[]):Promise<any>}}
 */
export function attachChipClock(client, port, initialClock, {primary = false, batch = false, onApplied = () => {}} = {}) {
  let clock = initialClock, sequence = 0, disposed = false;
  const pending = new Map();
  const previous = port.onmessage;
  const listener = event => {
    const data = event.data;
    const entry = pending.get(data?.id);
    if (!entry) { if (!port.addEventListener) previous?.call(port, event); return; }
    pending.delete(data.id);
    if (data.error) entry.reject(new Error(data.error));
    else { try { if(entry.hz!==undefined){clock = entry.hz; onApplied(clock);}entry.resolve(data.value); } catch (error) { entry.reject(error); } }
  };
  if (port.addEventListener) port.addEventListener('message', listener);
  else port.onmessage = listener;
  port.start?.();
  Object.defineProperty(client, 'clock', {configurable:true, enumerable:true, get:() => clock});
  Object.defineProperty(client, '_adoptClock', {value: hz => { clock = validateChipClock(hz); onApplied(clock); }});
  client.setClock = hz => new Promise((resolve, reject) => {
    try {
      if (disposed) throw new Error('Chip disposed');
      validateChipClock(hz);
      const id = `chip-clock:${++sequence}`;
      pending.set(id, {resolve, reject, hz});
      try { const command = primary ? {type:'chip-clock', id, clock:hz} : {method:'clock', id, args:[hz]}; port.postMessage(batch ? [command] : command); }
      catch (error) { pending.delete(id); throw error; }
    } catch (error) { reject(error); }
  });
  Object.defineProperty(client,'_requestControl',{value:(method,args=[])=>new Promise((resolve,reject)=>{
    try{
      if(disposed)throw new Error('Chip disposed');
      const id=`chip-control:${++sequence}`;pending.set(id,{resolve,reject});
      try{port.postMessage({method,args,id});}catch(error){pending.delete(id);throw error;}
    }catch(error){reject(error);}
  })});
  Object.defineProperty(client, '_cancelClockRequests', {value: reason => {
    // Stop/control acknowledgements fence another port; retiring a script's
    // pending clock edits must not make that fence resolve before physical Stop.
    for (const [id,entry] of pending) if(entry.hz!==undefined){entry.reject(new Error(reason));pending.delete(id);}
  }});
  const dispose = client.dispose;
  if (dispose) client.dispose = () => {
    if (disposed) return; disposed = true;
    for (const entry of pending.values()) entry.reject(new Error('Chip disposed'));
    pending.clear(); port.removeEventListener?.('message', listener);
    dispose.call(client);
  };
  return client;
}
