import {appendGameboyVoice} from './gameboy_voice_view.js?v=gb-info-perf-1';
import {appendGameboyWave} from './gameboy_wave_view.js?v=gb-info-perf-1';
import {decodeYmf278bSample} from './ymf278b_samples.js';
import {samplePreviewWav} from './sample_render.js';
import {renderSamplePreview} from './sample_render.js';
export {configureSamplePreview} from './sample_render.js';
import { pwmCaptureWav } from './pwm_samples.js';
import {sampleFile,extractSamples} from './sample_core.js?v=gb-voice-1';
export {extractSamples} from './sample_core.js?v=gb-voice-1';

export function mountSampleExplorer(panel, getSource, getOptions = () => ({})) {
  let controller, audio, playing, previewSerial = 0, gameboyMode = false;
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
      const result = await extractSamples(source, { ...getOptions(), signal: own.signal });
      if (own.signal.aborted) return;
      output.replaceChildren();
      const note = document.createElement('p'); note.textContent = result.warnings.join(' '); output.append(note);
      const visible = gameboyMode ? result.samples.filter(s => s.chip === 'gameboy').sort((a,b)=>(a.channel ?? 3)-(b.channel ?? 3)) : result.samples;
      if (!visible.length) output.append(gameboyMode ? 'No complete Game Boy voice or waveform settings found.' : 'No supported samples found.');
      const eventsBySample = new Map();
      for (const event of result.events) {
        let uses = eventsBySample.get(event.sampleId);
        if (!uses) eventsBySample.set(event.sampleId, uses = []);
        uses.push(event);
      }
      let group;
      for (const s of visible) {
        const uses = eventsBySample.get(s.id) ?? [];
        if (gameboyMode && group !== (s.channel ?? 3)) {
          group = s.channel ?? 3;
          const heading = document.createElement('h3');
          heading.textContent = {1:'Pulse CH1',2:'Pulse CH2',3:'Wave CH3 — 32-point waveforms',4:'Noise CH4'}[group];
          output.append(heading);
        }
        if (s.chip === 'gameboy' && s.kind !== 'wave') { appendGameboyVoice(output, s, uses, uses); continue; }
        if (s.chip === 'gameboy') { appendGameboyWave(output, s, uses, uses); continue; }
        const captured = s.kind === 'dac' || s.kind === 'pwm' || s.chip === 'okim6258';
        const row = document.createElement('details'), title = document.createElement('summary');
        title.textContent = `Sample ${s.id} · ${s.chip.toUpperCase()} ${s.kind.toUpperCase()} · ${captured ? `${s.chip==='okim6258'?'timed ADPCM register capture':'captured output'} · ${s.boundary}` : `0x${s.byteStart.toString(16)}–0x${(s.byteEndExclusive - 1).toString(16)}`} · ${s.size} bytes · ${uses.length} uses · ${s.chip === 'rf5c164' ? `RAM snapshot · start 0x${s.startAddress.toString(16)} · loop 0x${s.loopAddress.toString(16)} · ` : ''}${s.data ? 'available' : s.available ? 'partial data' : 'missing data'}`;
        row.append(title);
        const history = document.createElement('pre');
        history.textContent = uses.slice(0, 500).map(e => `${(e.startTime / 44100).toFixed(3)} s · ${e.kind.toUpperCase()} channel ${e.channel} · end ${e.endTime == null ? 'unknown' : (e.endTime / 44100).toFixed(3) + ' s'} · level ${e.level}${e.totalLevel == null ? "" : `, total ${e.totalLevel}`}, pan ${e.pan} · ${e.rate.toFixed(2)} Hz${e.deltaN == null ? "" : ` · Delta-N ${e.deltaN} · repeat ${e.loop} · speaker off ${e.speakerOff}`}${e.chip==='segapcm'?` · bank 0x${e.bank.toString(16)} · start 0x${e.startAddress.toString(16)} · loop ${e.loop?'0x'+e.loopAddress.toString(16):'off'} · ${e.changes?.length??0} live changes`:''}${e.nextControl ? ` · next ${e.nextControl} ${(e.nextControlTime / 44100).toFixed(3)} s` : ''}`).join('\n');
        if (uses.length > 500) history.textContent += '\nShowing first 500 uses.';
        row.append(history);
        if(['ymf278b','segapcm'].includes(s.chip)) {
          const info=document.createElement('p');info.textContent=s.chip==='segapcm'?`Unsigned 8-bit PCM · bank 0x${s.bank.toString(16)} · enable-time ROM snapshot. One-pass stereo preview; loops and live changes are not replayed.`:`Wave ${s.waveNumber} · signed ${s.format}-bit PCM · ${s.frameCount} frames · loop ${s.loopStart}–${s.frameCount} (end exclusive). Raw one-pass preview; no envelope or pitch modulation.`;row.append(info);
          if(s.data){
            const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;canvas.style.maxWidth='100%';canvas.setAttribute('aria-label','PCM waveform');row.append(canvas);
            let drawn=false;row.addEventListener('toggle',()=>{if(!row.open||drawn)return;drawn=true;const pcm=s.chip==='segapcm'?Float32Array.from(s.data,v=>(v-128)/128):decodeYmf278bSample(s),ctx=canvas.getContext('2d');ctx.strokeStyle='#44aacc';ctx.beginPath();for(let x=0;x<512;x++){const start=Math.floor(x*pcm.length/512),end=Math.max(start+1,Math.floor((x+1)*pcm.length/512));let lo=1,hi=-1;for(let i=start;i<end;i++){lo=Math.min(lo,pcm[i]);hi=Math.max(hi,pcm[i]);}ctx.moveTo(x,48-hi*46);ctx.lineTo(x,48-lo*46);}ctx.stroke();});
          }
        }
        if(s.chip==='okim6258' && s.data) {
          const info=document.createElement('p');info.textContent='Timed ADPCM register capture. Preview includes live pan and clock/divider changes, up to 10 seconds; divider phase restarts at capture start.';row.append(info);
          const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;canvas.style.maxWidth='100%';canvas.setAttribute('aria-label','Decoded ADPCM waveform');row.append(canvas);
          const draw=document.createElement('button');draw.textContent='Show waveform (up to 10 s)';
          draw.onclick=async()=>{draw.disabled=true;try{
            const pcm=await renderSamplePreview(s,uses[0],{getFactory:async()=> (await import('../generated/okim6258_wasm.js')).default});
            if(own.signal.aborted)return;
            const ctx=canvas.getContext('2d');ctx.strokeStyle='#44aacc';ctx.beginPath();
            for(let x=0;x<512;x++){const from=Math.floor(x*pcm.left.length/512),end=Math.max(from+1,Math.floor((x+1)*pcm.left.length/512));let lo=1,hi=-1;
              for(let i=from;i<end;i++){lo=Math.min(lo,pcm.left[i],pcm.right[i]);hi=Math.max(hi,pcm.left[i],pcm.right[i]);}
              ctx.moveTo(x,48-hi*46);ctx.lineTo(x,48-lo*46);}
            ctx.stroke();
          }catch(error){note.textContent=error.message;}finally{draw.disabled=false;}};row.append(draw);
        }
        if (s.data) {
          const save = document.createElement('button'); save.textContent = captured ? `Save timed ${s.kind.toUpperCase()} JSON` : s.chip === 'rf5c164' ? 'Save 64 KiB RAM snapshot' : ['ymf278b','segapcm'].includes(s.chip) ? 'Save raw PCM' : 'Save raw ADPCM';
          save.onclick = () => {
            const url = URL.createObjectURL(new Blob([sampleFile(s,uses).bytes])); const a = document.createElement('a');
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
          if(s.kind==='pwm'||['segapcm','okim6258'].includes(s.chip))listen.textContent='Preview stereo (up to 10 s)';
          listen.onclick = async () => {
            stop(); const serial = previewSerial; listen.disabled = true;
            try {
              audio ??= new AudioContext(); await audio.resume();
              const pcm=await renderSamplePreview(s,uses[Number(selection.value)],{getFactory:async name=>{
                const module=await (name==='rf5c164'?import('../generated/rf5c164_wasm.js'):
                  name==='okim6258'?import('../generated/okim6258_wasm.js'):name==='segapcm'?import('../generated/segapcm_wasm.js'):name==='ym2608'?import('../generated/ym2608_wasm.js'):import('../generated/ym2610b_wasm.js'));
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
          if(['ymf278b','segapcm','okim6258'].includes(s.chip)) {
            const wav=document.createElement('button');wav.textContent=s.chip==='okim6258'?'Save capture WAV (up to 10 s)':'Save one-pass WAV';
            wav.onclick=async()=>{try{const result=await samplePreviewWav(s,uses[Number(selection.value)],{getFactory:async name=> (await (name==='okim6258'?import('../generated/okim6258_wasm.js'):import('../generated/segapcm_wasm.js'))).default});const url=URL.createObjectURL(new Blob([result.bytes],{type:'audio/wav'})),a=document.createElement('a');a.href=url;a.download=`${s.chip}-${s.kind}-${s.id}.wav`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){note.textContent=error.message;}};
            row.append(wav);
          }
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
  return { reset, stop, setChip(chip) {
    const next = chip === 'gameboy';
    if (next !== gameboyMode) reset();
    gameboyMode = next;
    button.textContent = gameboyMode ? 'Analyze Game Boy voices' : 'Analyze samples';
  } };
}
