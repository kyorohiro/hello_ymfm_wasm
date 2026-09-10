import { createDacSamples, renderDacPreview } from './dac_samples.js';
import { createRf5c164Samples } from './rf5c164_samples.js';
import { Ym2612VGM } from '../js/ym2612vgm.js?v=ym2610-vgm-2';

// One pass; never expands the VGM loop. Memory is resolved at each key-on.
export async function extractSamples(source, { signal } = {}) {
  const warnings = new Set();
  const parser = new Ym2612VGM(source, { logger: { warn: m => warnings.add(m) } });
  const dac = createDacSamples();
  const rf = createRf5c164Samples(parser.header.rf5c164Clock & 0x3fffffff);
  const clock = parser.header.ym2610Clock & 0x3fffffff;
  const regs = new Uint8Array(256), samples = [], events = [], definitions = new Map();
  let retainedBytes = 0;
  const memories = [0, 1, 2].map(() => ({ data: new Uint8Array(0), present: new Uint8Array(0), generation: 0 }));
  const opna = new Uint8Array(16);
  let prescale = 6, writeAddress = 0, pendingWriteStart = false;
  const opnaUnit = () => opna[1] & 3 ? 32 : 4;
  const bregs = new Uint8Array(16);
  let time = 0;
  if (parser.header.ym2610Clock & 0x40000000) warnings.add('Second YM2610 chip is not analyzed.');
  function observe(kind, channel, control, chip = 'ym2610') {
    const previous = events.findLast(x => x.chip === chip && x.kind === kind && x.channel === channel);
    if (previous && previous.nextControlTime == null) {
      previous.nextControlTime = time; previous.nextControl = control;
    }
  }
  function begin(kind, channel, rawStart, rawEnd, settings) {
    const romType = kind === 'adpcm-a' ? 0 : 1;
    const chip = settings.chip ?? 'ym2610', unit = settings.addressUnit ?? 256;
    const memory = memories[chip === 'ym2608' ? 2 : romType], byteStart = rawStart * unit;
    const size = romType === 0 ? ((((rawEnd + 1) * 256 - byteStart) & 0xfffff) || 0x100000)
      : (rawEnd + 1) * unit - byteStart;
    if (size <= 0) { warnings.add('ADPCM-B wrapped address range is not extracted.'); return; }
    const byteEndExclusive = byteStart + size;
    const key = `${chip}:${kind}:${memory.generation}:${byteStart}:${byteEndExclusive}`;
    let sample = definitions.get(key);
    if (!sample) {
      if (retainedBytes + size > 64 * 1024 * 1024) throw new Error('Sample analysis exceeds the 64 MiB limit.');
      const data = new Uint8Array(size);
      let available = 0;
      for (let i = 0; i < size; i++) {
        const a = byteStart + i;
        if (memory.present[a]) { data[i] = memory.data[a]; available++; }
      }
      sample = { id: samples.length + 1, chip, kind, romType, generation: memory.generation,
        byteStart, byteEndExclusive, size, available, data: available === size ? data : null };
      retainedBytes += sample.data ? size : 0;
      samples.push(sample); definitions.set(key, sample);
    }
    if (events.length >= 100000) throw new Error('Sample analysis exceeds 100,000 playback events.');
    events.push({ sampleId: sample.id, chip, kind, channel, startTime: time,
      endTime: null, endReason: 'unknown', rawStart, rawEnd, clock, ...settings });
  }
  function apply(e) {
    rf.apply(e, time);
    if (e.type === 'ym2610-rom-data' || e.type === 'ym2608-adpcm-b-data') {
      if (e.chipIndex) { warnings.add('Second chip sample memory is not analyzed.'); return; }
      const memory = memories[e.type === 'ym2608-adpcm-b-data' ? 2 : e.romType];
      if (!memory) return;
      if (e.memorySize > memory.data.length) {
        const capacity = Math.ceil(e.memorySize / 4096) * 4096;
        const next = new Uint8Array(capacity), coverage = new Uint8Array(capacity);
        next.set(memory.data); coverage.set(memory.present); memory.data = next; memory.present = coverage;
      }
      let changed = false;
      e.data.forEach((v, i) => { const a = e.offset + i; changed ||= !memory.present[a] || memory.data[a] !== v; memory.data[a] = v; memory.present[a] = 1; });
      if (changed) memory.generation++;
    }
    if (e.type === 'ym2608-write') {
      const { register: r, value: v } = e;
      if (e.port === 0) {
        if (r === 0x2d) prescale = 6;
        if (r === 0x2e && prescale === 6) prescale = 3;
        if (r === 0x2f) prescale = 2;
        return;
      }
      if (r > 15) return;
      opna[r] = v;
      if (r === 8 && (opna[0] & 0xe0) === 0x60) {
        // Mirror ymfm's CPU memory-write mode, including its end comparison.
        if (pendingWriteStart) {
          writeAddress = (opna[2] | opna[3] << 8) * opnaUnit(); pendingWriteStart = false;
        }
        const end = ((opna[4] | opna[5] << 8) + 1) * opnaUnit() - 1;
        if (writeAddress !== end && writeAddress < 0x200000) {
          apply({ type: 'ym2608-adpcm-b-data', chipIndex: 0, memorySize: writeAddress + 1,
            offset: writeAddress++, data: Uint8Array.of(v) });
        }
      }
      if (r !== 0) return;
      pendingWriteStart = Boolean(v & 0x20);
      if (v & 1) { writeAddress = 0; }
      observe('adpcm-b', 1, v & 1 ? 'reset' : v & 128 ? 'restart' : 'stop', 'ym2608');
      if (!(v & 128) || (v & 1)) return;
      if ((v & 0x60) !== 0x20) {
        warnings.add('YM2608 CPU-driven playback / recording is not extracted.'); return;
      }
      const unit = opnaUnit(), rawStart = opna[2] | opna[3] << 8, rawEnd = opna[4] | opna[5] << 8;
      const limit = opna[12] | opna[13] << 8;
      if (rawStart <= limit && limit < rawEnd) {
        warnings.add('YM2608 ADPCM-B limit-wrapped playback is not extracted.'); return;
      }
      const deltaN = opna[9] | opna[10] << 8, chipClock = parser.header.ym2608Clock & 0x3fffffff;
      begin('adpcm-b', 1, rawStart, rawEnd, { chip: 'ym2608', clock: chipClock,
        addressUnit: unit, memoryMode: opna[1] & 3, limit, prescale,
        level: opna[11], pan: opna[1] >> 6, deltaN,
        rate: chipClock / (24 * prescale) * deltaN / 65536,
        loop: Boolean(v & 16), speakerOff: Boolean(v & 8) });
      return;
    }
    if (e.type !== 'ym2610-write') return;
    const { register: r, value: v } = e;
    if (e.port === 0) {
      if (r < 0x10 || r > 0x1b) return;
      bregs[r - 0x10] = v;
      if (r !== 0x10) return;
      // YM2610 forces external playback and ignores the recording bit.
      observe('adpcm-b', 1, v & 1 ? 'reset' : v & 128 ? 'restart' : 'stop');
      if (!(v & 128) || (v & 1)) return;
      const deltaN = bregs[9] | bregs[10] << 8;
      begin('adpcm-b', 1, bregs[2] | bregs[3] << 8, bregs[4] | bregs[5] << 8,
        { level: bregs[11], pan: bregs[1] >> 6, deltaN,
          rate: clock / 144 * deltaN / 65536, loop: Boolean(v & 16), speakerOff: Boolean(v & 8) });
      return;
    }
    regs[r] = v;
    if (r !== 0) return;
    for (let ch = 0; ch < 6; ch++) {
      if (!(v & (1 << ch))) continue;
      // A later stop does not prove that natural EOS hadn't already occurred.
      observe('adpcm-a', ch + 1, v & 128 ? 'stop' : 'restart');
      if (v & 128) continue;
      begin('adpcm-a', ch + 1, regs[0x10 + ch] | regs[0x18 + ch] << 8,
        regs[0x20 + ch] | regs[0x28 + ch] << 8,
        { level: regs[8 + ch] & 31, totalLevel: regs[1] & 63,
          pan: regs[8 + ch] >> 6, rate: clock / 432, loop: false });
    }
  }
  const targets = {
    ym2612: { writeRegister: (r,v,p=0) => dac.write(r,v,p,time) },
    ym2610: {writeRegister() {},loadAdpcmRom() {}},
    ym2608: {writeRegister() {},loadAdpcmBMemory() {}},
    ym2203: {writeRegister() {}}, psg: {write() {}},
    rf5c164: {writeRegister() {},writeMemory() {},loadBankedMemory(data,offset) {
      rf.apply({type:'rf5c164-data',data,offset,chipIndex:0},time);
    }}
  };
  for (let count = 0; ; count++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const e = parser.playStep(targets);
    if (e.type === 'end') break;
    if (e.type === 'wait') parser.consumeWait(targets,e.samples,n=>{time+=n;dac.advance(time);});
    else if (e.type === 'rf5c164-data') {} // applied through playback target
    else apply(e);
    if (count % 4096 === 4095) await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (parser.header.ym2608Clock & 0x40000000) warnings.add('Second YM2608 chip is not analyzed.');
  dac.finish(time,'VGM end');
  const dacBase=samples.length;
  for(const sample of dac.samples)samples.push({...sample,id:sample.id+dacBase});
  for(const event of dac.events)events.push({...event,sampleId:event.sampleId+dacBase});
  if(dac.samples.length)warnings.add('DAC captures are split at disable/end or 10-second display windows, not original sample boundaries. Preview is centered, without analog filtering.');
  const baseId=samples.length;
  for(const sample of rf.samples) samples.push({...sample,id:sample.id+baseId});
  for(const event of rf.events) events.push({...event,sampleId:event.sampleId+baseId});
  for(const warning of rf.warnings)warnings.add(warning);
  warnings.add('Initial support: YM2610 / YM2610B ADPCM-A / ADPCM-B and YM2608 ADPCM-B, RF5C164 PCM. Rhythm, end times and live parameter changes are not reconstructed.');
  return { samples, events, clock, warnings: [...warnings], time };
}

export function mountSampleExplorer(panel, getSource) {
  let controller, audio, playing, previewSerial = 0;
  const button = document.createElement('button'); button.textContent = 'Analyze samples';
  const output = document.createElement('div');
  panel.append(button, output);
  const stop = () => { previewSerial++; playing?.stop(); playing = null; };
  const reset = () => { controller?.abort(); stop(); output.replaceChildren(); button.disabled = false; };
  button.onclick = async () => {
    reset(); const source = getSource();
    if (!source) { output.textContent = 'Load a VGM file first.'; return; }
    controller = new AbortController(); const own = controller;
    button.disabled = true; output.textContent = 'Analyzing…';
    try {
      const result = await extractSamples(source, { signal: own.signal });
      if (own.signal.aborted) return;
      output.replaceChildren();
      const note = document.createElement('p'); note.textContent = result.warnings.join(' '); output.append(note);
      if (!result.samples.length) output.append('No supported samples found.');
      for (const s of result.samples) {
        const row = document.createElement('details'), title = document.createElement('summary');
        const uses = result.events.filter(e => e.sampleId === s.id);
        title.textContent = `Sample ${s.id} · ${s.chip.toUpperCase()} ${s.kind.toUpperCase()} · ${s.kind === 'dac' ? `captured output · ${s.boundary}` : `0x${s.byteStart.toString(16)}–0x${(s.byteEndExclusive - 1).toString(16)}`} · ${s.size} bytes · ${uses.length} uses · ${s.chip === 'rf5c164' ? `RAM snapshot · start 0x${s.startAddress.toString(16)} · loop 0x${s.loopAddress.toString(16)} · ` : ''}${s.data ? 'available' : s.available ? 'partial data' : 'missing data'}`;
        row.append(title);
        const history = document.createElement('pre');
        history.textContent = uses.slice(0, 500).map(e => `${(e.startTime / 44100).toFixed(3)} s · ${e.kind.toUpperCase()} channel ${e.channel} · end ${e.endTime == null ? 'unknown' : (e.endTime / 44100).toFixed(3) + ' s'} · level ${e.level}${e.totalLevel == null ? "" : `, total ${e.totalLevel}`}, pan ${e.pan} · ${e.rate.toFixed(2)} Hz${e.deltaN == null ? "" : ` · Delta-N ${e.deltaN} · repeat ${e.loop} · speaker off ${e.speakerOff}`}${e.nextControl ? ` · next ${e.nextControl} ${(e.nextControlTime / 44100).toFixed(3)} s` : ''}`).join('\n');
        if (uses.length > 500) history.textContent += '\nShowing first 500 uses.';
        row.append(history);
        if (s.data) {
          const save = document.createElement('button'); save.textContent = s.kind === 'dac' ? 'Save timed DAC JSON' : s.chip === 'rf5c164' ? 'Save 64 KiB RAM snapshot' : 'Save raw ADPCM';
          save.onclick = () => {
            const url = URL.createObjectURL(new Blob([s.kind === 'dac' ? JSON.stringify({timebase:44100,startTime:uses[0].startTime,duration:s.duration,boundary:s.boundary,times:[...s.times],values:[...s.data]}) : s.data])); const a = document.createElement('a');
            a.href = url; a.download = `${s.chip}-${s.kind}-${s.id}.${s.kind === 'dac' ? 'json' : 'bin'}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          };
          const selection = document.createElement('select');
          selection.setAttribute('aria-label', `Sample ${s.id} preview occurrence`);
          uses.slice(0, 500).forEach((e, i) => {
            const option = document.createElement('option'); option.value = i;
            option.textContent = `${(e.startTime / 44100).toFixed(3)} s / ${e.rate.toFixed(2)} Hz`;
            selection.append(option);
          });
          const listen = document.createElement('button'); listen.textContent = 'Preview centered (up to 10 s)';
          listen.onclick = async () => {
            stop(); const serial = previewSerial; listen.disabled = true;
            let chip;
            try {
              audio ??= new AudioContext(); await audio.resume();
              if(s.kind==='dac') {
                if(own.signal.aborted || serial!==previewSerial)return;
                const pcm=renderDacPreview(s),buffer=audio.createBuffer(1,pcm.length,44100);
                buffer.copyToChannel(pcm,0);playing=audio.createBufferSource();playing.buffer=buffer;
                playing.connect(audio.destination);playing.start();return;
              }
              const [{ [s.chip === 'rf5c164' ? 'Rf5c164' : s.chip === 'ym2608' ? 'Ym2608' : 'Ym2610B']: Chip }, { default: factory }] = await Promise.all([
                import(s.chip === 'rf5c164' ? '../js/rf5c164.js' : s.chip === 'ym2608' ? '../js/ym2608.js' : '../js/ym2610b.js'),
                import(s.chip === 'rf5c164' ? '../generated/rf5c164_wasm.js' : s.chip === 'ym2608' ? '../generated/ym2608_wasm.js' : '../generated/ym2610b_wasm.js')]);
              if (own.signal.aborted || serial !== previewSerial) return;
              chip = await Chip.create({ moduleFactory: factory, clock: uses[Number(selection.value)].clock });
              const e = uses[Number(selection.value)];
              configureSamplePreview(chip, s, e);
              const rate = chip.sampleRate(e.clock);
              if (!(e.rate > 0)) throw new Error('Sample rate is zero.');
              const frames = Math.min(Math.ceil(rate * 10), Math.ceil(s.size * 2 / e.rate * rate) + 1024);
              const pcm = chip.generateStereo(frames), buffer = audio.createBuffer(2, frames, rate);
              buffer.copyToChannel(pcm.left, 0); buffer.copyToChannel(pcm.right, 1);
              if (own.signal.aborted || serial !== previewSerial) return;
              playing = audio.createBufferSource(); playing.buffer = buffer; playing.connect(audio.destination); playing.start();
            } catch (error) { note.textContent = `Preview failed: ${error.message}`; }
            finally { chip?.dispose(); listen.disabled = false; }
          };
          row.append(save, selection, listen);
        }
        output.append(row);
      }
      const stopButton = document.createElement('button'); stopButton.textContent = 'Stop preview'; stopButton.onclick = stop; output.append(stopButton);
    } catch (error) { if (!own.signal.aborted) output.textContent = `Analysis failed: ${error.message}`; }
    finally { if (!own.signal.aborted) button.disabled = false; }
  };
  return { reset, stop };
}

// Preview one pass of the selected occurrence, centered; repeat is not expanded.
export function configureSamplePreview(chip, sample, event) {
  if(sample.chip==='rf5c164') {
    chip.loadMemory(sample.data);
    chip.writeRegister(7,0xc0);
    event.settings.forEach((v,r)=>chip.writeRegister(r,r===1?0xff:v));
    chip.writeRegister(8,0xfe);
    return;
  }
  if (sample.chip === 'ym2608') {
    chip.loadAdpcmBMemory(sample.data, sample.byteStart, sample.byteEndExclusive);
    // Restore the observed prescaler through address writes.
    chip.write(0, 0x2d);
    if (event.prescale !== 6) chip.write(0, event.prescale === 3 ? 0x2e : 0x2f);
    const write = (r, v) => { chip.write(2, r); chip.write(3, v); };
    write(1, 0xc0 | event.memoryMode);
    write(2, event.rawStart & 255); write(3, event.rawStart >> 8);
    write(4, event.rawEnd & 255); write(5, event.rawEnd >> 8);
    write(12, event.limit & 255); write(13, event.limit >> 8);
    write(9, event.deltaN & 255); write(10, event.deltaN >> 8); write(11, event.level);
    write(0, 0xa0 | (event.speakerOff ? 8 : 0));
    return;
  }
  chip.loadAdpcmRom(sample.romType, sample.data, sample.byteStart, sample.byteEndExclusive);
  const write = (r, v) => { const port = sample.romType === 0 ? 2 : 0; chip.write(port, r); chip.write(port + 1, v); };
  if (sample.romType === 0) {
    write(1, event.totalLevel); write(8, 0xc0 | event.level);
    write(0x10, event.rawStart & 255); write(0x18, event.rawStart >> 8);
    write(0x20, event.rawEnd & 255); write(0x28, event.rawEnd >> 8); write(0, 1);
  } else {
    write(0x11, 0xc0); write(0x12, event.rawStart & 255); write(0x13, event.rawStart >> 8);
    write(0x14, event.rawEnd & 255); write(0x15, event.rawEnd >> 8);
    write(0x19, event.deltaN & 255); write(0x1a, event.deltaN >> 8); write(0x1b, event.level);
    write(0x10, 0x80 | (event.speakerOff ? 8 : 0));
  }
}
