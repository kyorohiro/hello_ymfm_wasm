import {SpcCore} from './spc.js?v=spc-events-1';
import {createSpcEventDecoder, SPC_EVENT_CLOCK_RATE} from './spc_events.js?v=spc-events-1';
import {extractBrrSamples} from './snes_brr.js?v=spc-pitch-comments-1';

export const SPC_PERFORMANCE_MAX_EVENTS = 20000;
const MAX_SAMPLE_BYTES = 65536 - 0x400;
const GLOBAL_REGISTERS = new Set([0x0c, 0x1c, 0x2d, 0x3d, 0x6c]);

/** Capture an editable approximation of SPC performance, without retaining CPU
 * RAM writes or a raw DSP log. Notes keep their key times; optional control
 * sampling keeps the last value in each interval (no interpolation). BRR is
 * observed at note/sample changes, at the end of a 128-frame native block.
 * This cannot restore an already-running envelope, echo RAM, or later BRR edits.
 * @param {ArrayBuffer|ArrayBufferView} bytes
 * @param {{durationSeconds:number,moduleFactory:import('./spc.js?v=spc-events-1').SpcCoreOptions['moduleFactory'],
 * moduleOptions?:import('./spc.js?v=spc-events-1').SpcCoreOptions['moduleOptions'],controlStepMs?:number,
 * signal?:AbortSignal,onProgress?:(progress:{stage:string,renderedSeconds:number,durationSeconds:number,ratio:number})=>void,
 * maxEvents?:number}} options
 */
export async function captureSpcPerformance(bytes, {durationSeconds, moduleFactory, moduleOptions,
  controlStepMs = 20, signal, onProgress, maxEvents = SPC_PERFORMANCE_MAX_EVENTS} = {}) {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0.1 || durationSeconds > 600) throw new RangeError('Conversion seconds must be between 0.1 and 600');
  if (!Number.isFinite(controlStepMs) || controlStepMs < 0 || controlStepMs > 1000) throw new RangeError('Control step must be between 0 and 1000 milliseconds');
  if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > SPC_PERFORMANCE_MAX_EVENTS) throw new RangeError(`maxEvents must be between 1 and ${SPC_PERFORMANCE_MAX_EVENTS}`);
  signal?.throwIfAborted();
  const core = await SpcCore.create({moduleFactory, moduleOptions});
  try {
    signal?.throwIfAborted(); core.load(bytes);
    const initial = core.snapshot(), initialDsp = initial.dsp.slice();
    const decoder = createSpcEventDecoder({dsp:initialDsp});
    const frames = Math.round(durationSeconds * 32000), durationClocks = frames * 32;
    const events = [], samples = [], warnings = new Set([
      'Approximate re-performance, not identical SPC playback. Original note names, loops and tempo are not inferred.',
      'Initially active voices restart their envelopes and BRR phase. Echo and its RAM are omitted.',
      'BRR versions are captured at note/sample changes at 128-frame boundaries (up to 4 ms); subsequent CPU edits to playing sample RAM are not replayed.',
      'Timeline waits use elapsed seconds and catch up after JavaScript delays; event dispatch is not sample-accurate audio reservation.',
    ]);
    const sampleCache = new Map(), pending = new Map();
    const held = new Uint8Array(8), sourceNumbers = Array.from({length:8}, (_, ch) => initialDsp[(ch << 4) + 4]);
    const globals = initialDsp.slice();
    let rawWrites = 0, interpretedEvents = 0, sampleBytes = 0, bucket = -1, directory = initialDsp[0x5d];
    const stepClocks = controlStepMs * SPC_EVENT_CLOCK_RATE / 1000;
    const append = event => {
      if (events.length >= maxEvents) throw new RangeError('Readable song event limit exceeded. Increase Control step, choose a shorter interval, or use Song playback.');
      events.push(event);
    };
    const flush = () => {
      for (const event of [...pending.values()].sort((a,b) => a.clock - b.clock)) append(event);
      pending.clear();
    };
    function sampleFor(snapshot, sourceNumber) {
      const address = ((directory << 8) + sourceNumber * 4) & 65535, ram = snapshot.ram;
      const word = at => ram[at & 65535] | ram[(at + 1) & 65535] << 8;
      const start = word(address), loopAddress = word(address + 2), key = `${directory}:${sourceNumber}:${start}:${loopAddress}`;
      const cached = sampleCache.get(key);
      if (cached && cached.brr.every((value,index) => value === ram[(start + index) & 65535])) return cached.id;
      const result = extractBrrSamples(snapshot, {directory, sourceNumbers:[sourceNumber]});
      const sample = result.samples[0];
      if (!sample || (sample.loop && !sample.loopResolved)) throw new RangeError(`Cannot relocate BRR SRCN ${sourceNumber}: ${result.rejected[0]?.reason ?? 'unresolved loop'}. Use Song playback or Event trace.`);
      const existing = samples.find(value => value.loop === sample.loop && value.loopStartSamples === sample.loopStartSamples
        && value.brr.length === sample.brr.length && value.brr.every((byte,index) => byte === sample.brr[index]));
      if (existing) {sampleCache.set(key, existing); return existing.id;}
      if (samples.length >= 256 || sampleBytes + sample.brr.length > MAX_SAMPLE_BYTES) throw new RangeError('Readable song BRR versions exceed one SNES instrument RAM (64,512 bytes / 256 samples). Choose a shorter interval or use Song playback / Event trace.');
      const saved = {id:samples.length, sourceNumber, directory, startAddress:sample.startAddress,
        loopAddress:sample.loopAddress, loop:sample.loop, loopStartSamples:sample.loopStartSamples,
        brr:sample.brr, hash:sample.hash, capturedClock:snapshot.nativeFrames * 32, warnings:sample.warnings};
      samples.push(saved); sampleBytes += saved.brr.length; sampleCache.set(key,saved);
      for (const warning of sample.warnings) warnings.add(warning);
      return saved.id;
    }
    function accept(input, getSnapshot) {
      let snapshot;
      for (const original of input) {
        if (original.clock > durationClocks) continue;
        let event = original;
        if (event.type === 'dsp') {
          if (event.register === 0x5d) directory = event.value;
          if (!GLOBAL_REGISTERS.has(event.register)) continue;
          if (globals[event.register] === event.value) continue;
          globals[event.register] = event.value;
        }
        const newBucket = stepClocks ? Math.floor(event.clock / stepClocks) : event.clock;
        if (bucket !== newBucket) {flush(); bucket = newBucket;}
        const sourceChanged = event.type === 'instrument' && sourceNumbers[event.channel] !== event.sourceNumber;
        if (event.type === 'instrument') sourceNumbers[event.channel] = event.sourceNumber;
        if ((event.type === 'noteOn' && !event.keyOffHeld) || (sourceChanged && held[event.channel])) {
          snapshot ??= getSnapshot();
          event = {...event, sampleId:sampleFor(snapshot,event.sourceNumber)};
        }
        if (event.type === 'noteOn') held[event.channel] = event.keyOffHeld ? 0 : 1;
        else if (event.type === 'noteOff') held[event.channel] = 0;
        interpretedEvents++;
        if (stepClocks && ['pitch','volume','instrument'].includes(event.type) && !sourceChanged) pending.set(`${event.type}:${event.channel}`,event);
        else {flush(); append(event);}
      }
    }
    accept(decoder.flush(0), () => initial);
    const capacity = 2048, raw = new Float64Array(capacity * 3);
    const left = new Float32Array(128), right = new Float32Array(128);
    core.startDspObservation({capacity});
    for (let rendered = 0, blocks = 0; rendered < frames;) {
      signal?.throwIfAborted();
      core.renderInto(left,right,128); rendered += 128;
      const count = core.drainDspEventsInto(raw); rawWrites += count;
      if (core.takeDspEventOverflow()) throw new Error('SPC DSP observation overflowed; readable conversion was cancelled without truncation. Use Song playback or Event trace.');
      accept(decoder.pushWrites(raw.subarray(0,count * 3),rendered * 32), () => core.snapshot());
      if (++blocks % 128 === 0 || rendered >= frames) {
        onProgress?.({stage:'interpret',renderedSeconds:Math.min(rendered,frames) / 32000,
          durationSeconds:frames / 32000,ratio:Math.min(rendered / frames,1)});
        await new Promise(resolve => setTimeout(resolve,0));
      }
    }
    accept(decoder.flush(), () => core.snapshot()); flush(); signal?.throwIfAborted();
    return {version:1,clockRate:SPC_EVENT_CLOCK_RATE,durationClocks,controlStepMs,initialDsp,events,samples,
      warnings:[...warnings],statistics:{rawWrites,interpretedEvents,eventCount:events.length,
        controlsOmitted:interpretedEvents - events.length,sampleCount:samples.length,sampleBytes,controlStepMs}};
  } finally {core.dispose();}
}
