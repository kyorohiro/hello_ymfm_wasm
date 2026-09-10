import { Ym2612VGM } from '../js/ym2612vgm.js?v=ym2610-vgm-2';

// One pass; never expands the VGM loop. Memory is resolved at each key-on.
export async function extractSamples(source, { signal } = {}) {
  const warnings = new Set();
  const parser = new Ym2612VGM(source, { logger: { warn: m => warnings.add(m) } });
  const clock = parser.header.ym2610Clock & 0x3fffffff;
  const regs = new Uint8Array(256), samples = [], events = [], definitions = new Map();
  let retainedBytes = 0;
  let memory = new Uint8Array(0), present = new Uint8Array(0), generation = 0, time = 0;
  if (parser.header.ym2610Clock & 0x40000000) warnings.add('Second YM2610 chip is not analyzed.');
  function apply(e) {
    if (e.type === 'ym2610-rom-data' && e.romType === 0 && !e.chipIndex) {
      if (e.memorySize > memory.length) {
        const next = new Uint8Array(e.memorySize), coverage = new Uint8Array(e.memorySize);
        next.set(memory); coverage.set(present); memory = next; present = coverage;
      }
      let changed = false;
      e.data.forEach((v, i) => { const a = e.offset + i; changed ||= !present[a] || memory[a] !== v; memory[a] = v; present[a] = 1; });
      if (changed) generation++;
    }
    if (e.type !== 'ym2610-write' || e.port !== 1) return;
    const { register: r, value: v } = e;
    regs[r] = v;
    if (r !== 0) return;
    for (let ch = 0; ch < 6; ch++) {
      if (!(v & (1 << ch))) continue;
      // Do not invent an exact ending: an earlier natural EOS may already
      // have occurred. Record the control observation separately.
      const previous = events.findLast(x => x.channel === ch + 1);
      if (previous && previous.nextControlTime == null) {
        previous.nextControlTime = time;
        previous.nextControl = v & 128 ? 'stop' : 'restart';
      }
      if (v & 128) continue;
      const rawStart = regs[0x10 + ch] | regs[0x18 + ch] << 8;
      const rawEnd = regs[0x20 + ch] | regs[0x28 + ch] << 8;
      const byteStart = rawStart * 256;
      // ymfm ADPCM-A compares only the low 20 bits at its inclusive end.
      const size = (((rawEnd + 1) * 256 - byteStart) & 0xfffff) || 0x100000;
      const byteEndExclusive = byteStart + size;
      const key = `${generation}:${byteStart}:${byteEndExclusive}`;
      let sample = definitions.get(key);
      if (!sample) {
        if (retainedBytes + size > 64 * 1024 * 1024) throw new Error('Sample analysis exceeds the 64 MiB limit.');
        const data = new Uint8Array(size);
        let available = 0;
        for (let i = 0; i < size; i++) {
          const a = byteStart + i;
          if (present[a]) { data[i] = memory[a]; available++; }
        }
        sample = { id: samples.length + 1, generation, byteStart, byteEndExclusive,
          size, available, data: available === size ? data : null };
        retainedBytes += sample.data ? size : 0;
        samples.push(sample); definitions.set(key, sample);
      }
      if (events.length >= 100000) throw new Error('Sample analysis exceeds 100,000 playback events.');
      events.push({ sampleId: sample.id, channel: ch + 1, startTime: time,
        endTime: null, endReason: 'unknown', rawStart, rawEnd,
        level: regs[8 + ch] & 31, totalLevel: regs[1] & 63,
        pan: regs[8 + ch] >> 6, clock });
    }
  }
  for (let count = 0; ; count++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const e = parser.step();
    if (e.type === 'end') break;
    if (e.type === 'wait') time += e.samples;
    else if (e.type.startsWith('stream')) warnings.add('Stream commands are not reconstructed by Sample Explorer.');
    else apply(e);
    if (count % 4096 === 4095) await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (parser.header.ym2608Clock || parser.header.rf5c164Clock) warnings.add('YM2608 and RF5C164 sample analysis is not implemented yet.');
  warnings.add('Initial support: YM2610 / YM2610B ADPCM-A only. End times and live parameter changes are not reconstructed.');
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
      if (!result.samples.length) output.append('No YM2610 ADPCM-A samples found.');
      for (const s of result.samples) {
        const row = document.createElement('details'), title = document.createElement('summary');
        const uses = result.events.filter(e => e.sampleId === s.id);
        title.textContent = `Sample ${s.id} · YM2610 ADPCM-A · 0x${s.byteStart.toString(16)}–0x${(s.byteEndExclusive - 1).toString(16)} · ${s.size} bytes · ${uses.length} uses · ${s.data ? 'embedded' : s.available ? 'partial data' : 'missing data'}`;
        row.append(title);
        const history = document.createElement('pre');
        history.textContent = uses.slice(0, 500).map(e => `${(e.startTime / 44100).toFixed(3)} s · ADPCM-A channel ${e.channel} · end unknown · level ${e.level}, total ${e.totalLevel}, pan ${e.pan}${e.nextControl ? ` · next ${e.nextControl} ${(e.nextControlTime / 44100).toFixed(3)} s` : ''}`).join('\n');
        if (uses.length > 500) history.textContent += '\nShowing first 500 uses.';
        row.append(history);
        if (s.data) {
          const save = document.createElement('button'); save.textContent = 'Save raw ADPCM';
          save.onclick = () => {
            const url = URL.createObjectURL(new Blob([s.data])); const a = document.createElement('a');
            a.href = url; a.download = `ym2610-adpcm-a-${s.id}.bin`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          };
          const listen = document.createElement('button'); listen.textContent = 'Preview centered (up to 10 s)';
          listen.onclick = async () => {
            stop(); const serial = previewSerial; listen.disabled = true;
            let chip;
            try {
              audio ??= new AudioContext(); await audio.resume();
              const [{ Ym2610B }, { default: factory }] = await Promise.all([
                import('../js/ym2610b.js'), import('../generated/ym2610b_wasm.js')]);
              if (own.signal.aborted || serial !== previewSerial) return;
              chip = await Ym2610B.create({ moduleFactory: factory });
              chip.loadAdpcmRom(0, s.data, s.byteStart, s.byteEndExclusive);
              const write = (r, v) => { chip.write(2, r); chip.write(3, v); };
              const e = uses[0];
              write(1, e.totalLevel); write(8, 0xc0 | e.level);
              write(0x10, e.rawStart & 255); write(0x18, e.rawStart >> 8);
              write(0x20, e.rawEnd & 255); write(0x28, e.rawEnd >> 8); write(0, 1);
              const rate = chip.sampleRate(result.clock);
              const frames = Math.min(Math.ceil(rate * 10), Math.ceil(s.size * 2 * 432 / result.clock * rate) + 1024);
              const pcm = chip.generateStereo(frames), buffer = audio.createBuffer(2, frames, rate);
              buffer.copyToChannel(pcm.left, 0); buffer.copyToChannel(pcm.right, 1);
              if (own.signal.aborted || serial !== previewSerial) return;
              playing = audio.createBufferSource(); playing.buffer = buffer; playing.connect(audio.destination); playing.start();
            } catch (error) { note.textContent = `Preview failed: ${error.message}`; }
            finally { chip?.dispose(); listen.disabled = false; }
          };
          row.append(save, listen);
        }
        output.append(row);
      }
      const stopButton = document.createElement('button'); stopButton.textContent = 'Stop preview'; stopButton.onclick = stop; output.append(stopButton);
    } catch (error) { if (!own.signal.aborted) output.textContent = `Analysis failed: ${error.message}`; }
    finally { if (!own.signal.aborted) button.disabled = false; }
  };
  return { reset, stop };
}
