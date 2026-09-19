import {renderSamplePreview} from './sample_render.js';
export {configureSamplePreview} from './sample_render.js';
import { pwmCaptureWav } from './pwm_samples.js';
import {sampleFile,extractSamples} from './sample_core.js';
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
            const url = URL.createObjectURL(new Blob([sampleFile(s,result.events).bytes])); const a = document.createElement('a');
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
            try {
              audio ??= new AudioContext(); await audio.resume();
              const pcm=await renderSamplePreview(s,uses[Number(selection.value)],{getFactory:async name=>{
                const module=await (name==='rf5c164'?import('../generated/rf5c164_wasm.js'):
                  name==='ym2608'?import('../generated/ym2608_wasm.js'):import('../generated/ym2610b_wasm.js'));
                return module.default;
              }});
              const buffer=audio.createBuffer(2,pcm.left.length,pcm.sampleRate);
              buffer.copyToChannel(pcm.left,0);buffer.copyToChannel(pcm.right,1);
              if (own.signal.aborted || serial !== previewSerial) return;
              playing = audio.createBufferSource(); playing.buffer = buffer; playing.connect(audio.destination); playing.start();
            } catch (error) { note.textContent = `Preview failed: ${error.message}`; }
            finally { listen.disabled = false; }
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
