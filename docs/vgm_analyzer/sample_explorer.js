import { renderDacPreview } from './dac_samples.js';
import { renderPwmPreview, pwmCaptureJson, pwmCaptureWav } from './pwm_samples.js';
import {extractSamples} from './sample_core.js';
export {extractSamples} from './sample_core.js';

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
        const captured = s.kind === 'dac' || s.kind === 'pwm';
        const row = document.createElement('details'), title = document.createElement('summary');
        const uses = result.events.filter(e => e.sampleId === s.id);
        title.textContent = `Sample ${s.id} · ${s.chip.toUpperCase()} ${s.kind.toUpperCase()} · ${captured ? `captured output · ${s.boundary}` : `0x${s.byteStart.toString(16)}–0x${(s.byteEndExclusive - 1).toString(16)}`} · ${s.size} bytes · ${uses.length} uses · ${s.chip === 'rf5c164' ? `RAM snapshot · start 0x${s.startAddress.toString(16)} · loop 0x${s.loopAddress.toString(16)} · ` : ''}${s.data ? 'available' : s.available ? 'partial data' : 'missing data'}`;
        row.append(title);
        const history = document.createElement('pre');
        history.textContent = uses.slice(0, 500).map(e => `${(e.startTime / 44100).toFixed(3)} s · ${e.kind.toUpperCase()} channel ${e.channel} · end ${e.endTime == null ? 'unknown' : (e.endTime / 44100).toFixed(3) + ' s'} · level ${e.level}${e.totalLevel == null ? "" : `, total ${e.totalLevel}`}, pan ${e.pan} · ${e.rate.toFixed(2)} Hz${e.deltaN == null ? "" : ` · Delta-N ${e.deltaN} · repeat ${e.loop} · speaker off ${e.speakerOff}`}${e.nextControl ? ` · next ${e.nextControl} ${(e.nextControlTime / 44100).toFixed(3)} s` : ''}`).join('\n');
        if (uses.length > 500) history.textContent += '\nShowing first 500 uses.';
        row.append(history);
        if (s.data) {
          const save = document.createElement('button'); save.textContent = captured ? `Save timed ${s.kind.toUpperCase()} JSON` : s.chip === 'rf5c164' ? 'Save 64 KiB RAM snapshot' : 'Save raw ADPCM';
          save.onclick = () => {
            const url = URL.createObjectURL(new Blob([s.kind === 'pwm' ? pwmCaptureJson(s,uses[0].startTime) : s.kind === 'dac' ? JSON.stringify({timebase:44100,startTime:uses[0].startTime,duration:s.duration,boundary:s.boundary,times:[...s.times],values:[...s.data]}) : s.data])); const a = document.createElement('a');
            a.href = url; a.download = `${s.chip}-${s.kind}-${s.id}.${captured ? 'json' : 'bin'}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          };
          const selection = document.createElement('select');
          selection.setAttribute('aria-label', `Sample ${s.id} preview occurrence`);
          uses.slice(0, 500).forEach((e, i) => {
            const option = document.createElement('option'); option.value = i;
            option.textContent = `${(e.startTime / 44100).toFixed(3)} s / ${e.rate.toFixed(2)} Hz`;
            selection.append(option);
          });
          const listen = document.createElement('button'); listen.textContent = 'Preview centered (up to 10 s)';
          if(s.kind==='pwm')listen.textContent='Preview stereo (up to 10 s)';
          listen.onclick = async () => {
            stop(); const serial = previewSerial; listen.disabled = true;
            let chip;
            try {
              audio ??= new AudioContext(); await audio.resume();
              if(s.kind==='pwm') {
                if(own.signal.aborted || serial!==previewSerial)return;
                const pcm=renderPwmPreview(s),buffer=audio.createBuffer(2,pcm.left.length,44100);
                buffer.copyToChannel(pcm.left,0);buffer.copyToChannel(pcm.right,1);
                playing=audio.createBufferSource();playing.buffer=buffer;playing.connect(audio.destination);playing.start();return;
              }
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
          if(s.kind==='pwm') {
            const wav=document.createElement('button');wav.textContent='Save stereo WAV';
            wav.onclick=()=>{
              const url=URL.createObjectURL(new Blob([pwmCaptureWav(s)],{type:'audio/wav'})),a=document.createElement('a');
              a.href=url;a.download=`32x-pwm-${s.id}.wav`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
            };
            row.append(wav);
          }
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
