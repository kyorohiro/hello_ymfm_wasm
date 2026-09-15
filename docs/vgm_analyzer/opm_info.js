import {createPlaygroundOperatorKeyboard} from '../playground/playground_operator_keyboard.js?v=midi-1';
import {extractOpmPatches} from './opm_export.js?v=clock-1';
import {Ym2151} from '../js/ym2151.js';

// Preview the captured voice on CH8 so the optional noise generator also works.
export function writeOpmPreview(chip, patch, kc = 0x4a, kf = 0) {
  const {snapshot:s,channel} = patch, c = s.channels[channel];
  const write = (r,v) => {chip.write(0,r);chip.write(1,v);};
  chip.reset();
  write(0x18,s.lfo.rate);write(0x19,s.lfo.amd);write(0x19,128|s.lfo.pmd);write(0x1b,s.lfo.waveform);
  write(15,(channel===7 && s.noise.enabled ? 128 : 0)|s.noise.rate);
  write(0x27,(c.left?64:0)|(c.right?128:0)|(c.feedback<<3)|c.algorithm);
  write(0x3f,(c.pms<<4)|c.ams);write(0x2f,kc);write(0x37,kf<<2);
  c.operators.forEach((o,i)=>{
    const n=7+i*8;
    for(const [r,v] of [[0x40,(o.dt1<<4)|o.mul],[0x60,o.tl],[0x80,(o.ks<<6)|o.ar],[0xa0,(o.am<<7)|o.d1r],[0xc0,(o.dt2<<6)|o.d2r],[0xe0,(o.d1l<<4)|o.rr]])write(r+n,v);
  });
  write(8,7|c.operators.reduce((n,o,i)=>n|(o.key?8<<i:0),0));
}

// KC uses gapped semitone codes; KF supplies 1/64-semitone steps.
export function midiToOpmPitch(midi, clock = 3579545) {
  const units = Math.round((midi - 13 - 12 * Math.log2(clock / 3579545)) * 64);
  if (!Number.isFinite(units) || units < 0 || units > 6143) throw new RangeError('Note outside YM2151 pitch range');
  const semitone = Math.floor(units / 64);
  return {kc:(Math.floor(semitone / 12) << 4) | [0,1,2,4,5,6,8,9,10,12,13,14][semitone % 12],kf:units % 64};
}

export function createOpmKeyboardAudio(chip, context, getPatch, getVolume) {
  const gain = context.createGain();gain.connect(context.destination);
  const sources = new Set();
  let timer = null, next = 0, releaseUntil = Infinity;
  function stop() {
    clearTimeout(timer);timer=null;
    for(const source of sources)source.stop();
    sources.clear();
  }
  function pump() {
    if(context.currentTime >= releaseUntil){stop();return;}
    const rate=chip.sampleRate(getPatch().clock), frames=Math.round(rate*0.02);
    next=Math.max(next,context.currentTime);
    gain.gain.value=getVolume();
    while(next<context.currentTime+0.06){
      const pcm=chip.generateStereo(frames),buffer=context.createBuffer(2,frames,rate);
      buffer.getChannelData(0).set(pcm.left);buffer.getChannelData(1).set(pcm.right);
      const source=context.createBufferSource();source.buffer=buffer;source.connect(gain);
      sources.add(source);source.onended=()=>{sources.delete(source);source.disconnect();};
      source.start(next);next+=frames/rate;
    }
    timer=setTimeout(pump,20);
  }
  return {
    noteOnMidi(_channel,midi) {
      stop();const patch=getPatch(),pitch=midiToOpmPitch(midi,patch.clock);writeOpmPreview(chip,patch,pitch.kc,pitch.kf);
      releaseUntil=Infinity;next=context.currentTime;pump();
    },
    noteOff(){chip.write(0,8);chip.write(1,7);releaseUntil=context.currentTime+2;},
    stop,
    dispose(){stop();gain.disconnect();},
  };
}

export function mountOpmInfo({root,onStatus,createKeyboard=createPlaygroundOperatorKeyboard,createContext = () => new AudioContext(),createChip = async () => {
  const {default:moduleFactory}=await import('../generated/ym2151_wasm.js');
  return Ym2151.create({moduleFactory});
}}) {
  root.innerHTML = `<div class="tfi-info-toolbar"><label>OPM voice <select><option>Load a YM2151 VGM</option></select></label>
    <button class="opm-stop">Stop audition</button><button class="opm-save" disabled>Download OPM</button>
    <label>Audition volume <input type="range" min="0" max="100" value="30"></label></div>
    <p>One-pass voice history, deduplicated per channel. Held-key writes include intermediate settings. Hold a keyboard key to audition; release to key off (up to two seconds of release). VGM playback continues. Captured pan, LFO and noise are retained. Preview is monophonic.</p>
    <section class="tfi-info-editor">
      <p class="opm-detail"></p><pre class="opm-voice"></pre>
      <h3>Keyboard</h3>
      <div class="tfi-info-keyboard" aria-label="Audition keyboard" hidden></div>
    </section>`;
  const select=root.querySelector('select'),save=root.querySelector('.opm-save');
  let buffer=null,patches=null,chip=null,context=null,audio=null,ready=null,visible=false,disposed=false;
  const selected=()=>patches?.[Number(select.value)];
  const keyboard=createKeyboard({root:root.querySelector('.tfi-info-keyboard'),channelCount:1,getSelectedChannel:()=>0,idPrefix:'opm-',onStatus,
    async ensureAudioReady(){
      if(!ready)ready=(async()=>{
        context ??= createContext();await context.resume();chip=await createChip();
        if(disposed){chip.dispose();chip=null;return;}
        audio=createOpmKeyboardAudio(chip,context,selected,()=>Number(root.querySelector('input').value)/100);
        keyboard.attachSynth(audio);
      })().catch(e=>{ready=null;throw e;});
      await ready;
    },
  });
  function stop(){keyboard.setView('code');audio?.stop();}
  function showKeyboard(){keyboard.setView(visible && selected() ? 'operator' : 'code');}
  function refresh(){const p=selected();save.disabled=!p;root.querySelector('.opm-detail').textContent=p?`${p.name} · CH${p.channel+1} · First observed ${(p.sample/44100).toFixed(3)} s`:'';root.querySelector('.opm-voice').textContent=p?.text ?? '';showKeyboard();}
  function extract(){if(patches || !buffer)return;try{patches=extractOpmPatches(buffer,{includeSnapshots:true});select.replaceChildren();patches.forEach((p,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=`${p.name} · ${(p.sample/44100).toFixed(3)} s`;select.append(o);});refresh();if(!patches.length)root.querySelector('.opm-detail').textContent='No keyed YM2151 voices found.';}catch(e){onStatus(`OPM extraction failed: ${e.message}`);}}
  select.addEventListener('change',()=>{stop();refresh();select.blur();});
  root.querySelector('.opm-stop').addEventListener('click',()=>{stop();showKeyboard();});
  save.addEventListener('click',()=>{const p=selected();if(!p)return;const url=URL.createObjectURL(new Blob([p.text],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download=p.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  return {
    loadVgm(value){stop();buffer=value;patches=null;select.replaceChildren();refresh();if(visible)extract();},
    setVisible(value){if(visible===value)return;visible=value;root.hidden=!value;if(value){extract();showKeyboard();}else stop();},
    async dispose(){disposed=true;keyboard.dispose();audio?.dispose();chip?.dispose();chip=null;await context?.close();},
  };
}
