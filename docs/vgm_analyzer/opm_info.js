import {extractOpmPatches} from './opm_export.js?v=info-1';
import {Ym2151} from '../js/ym2151.js';

// Preview the captured voice on CH8 so the optional noise generator also works.
export function writeOpmPreview(chip, patch, kc = 0x4a) {
  const {snapshot:s,channel} = patch, c = s.channels[channel];
  const write = (r,v) => {chip.write(0,r);chip.write(1,v);};
  chip.reset();
  write(0x18,s.lfo.rate);write(0x19,s.lfo.amd);write(0x19,128|s.lfo.pmd);write(0x1b,s.lfo.waveform);
  write(15,(channel===7 && s.noise.enabled ? 128 : 0)|s.noise.rate);
  write(0x27,(c.left?64:0)|(c.right?128:0)|(c.feedback<<3)|c.algorithm);
  write(0x3f,(c.pms<<4)|c.ams);write(0x2f,kc);write(0x37,0);
  c.operators.forEach((o,i)=>{
    const n=7+i*8;
    for(const [r,v] of [[0x40,(o.dt1<<4)|o.mul],[0x60,o.tl],[0x80,(o.ks<<6)|o.ar],[0xa0,(o.am<<7)|o.d1r],[0xc0,(o.dt2<<6)|o.d2r],[0xe0,(o.d1l<<4)|o.rr]])write(r+n,v);
  });
  write(8,7|c.operators.reduce((n,o,i)=>n|(o.key?8<<i:0),0));
}

export function mountOpmInfo({root,onStatus,createContext = () => new AudioContext(),createChip = async () => {
  const {default:moduleFactory}=await import('../generated/ym2151_wasm.js');
  return Ym2151.create({moduleFactory});
}}) {
  root.innerHTML = `<div class="tfi-info-toolbar"><label>OPM voice <select><option>Load a YM2151 VGM</option></select></label>
    <label>Preview note <select class="opm-note"><option value="74">A4</option><option value="58">A3</option><option value="90">A5</option></select></label>
    <button class="opm-play" disabled>Audition</button><button class="opm-stop">Stop audition</button><button class="opm-save" disabled>Download OPM</button>
    <label>Audition volume <input type="range" min="0" max="100" value="30"></label></div>
    <p>One-pass voice history, deduplicated per channel. Held-key writes include intermediate settings. Preview: one second key-on plus one second release; VGM playback continues. Captured pan, LFO and noise are retained.</p><p class="opm-detail"></p><pre class="opm-voice"></pre>`;
  const select=root.querySelector('select'), play=root.querySelector('.opm-play'), save=root.querySelector('.opm-save');
  let buffer=null, patches=null, chip=null, context=null, gain=null, source=null, serial=0, visible=false, disposed=false, busy=false;
  function stop(){serial++;source?.stop();source=null;}
  function refresh(){const p=patches?.[Number(select.value)];save.disabled=!p;play.disabled=!p || busy;root.querySelector('.opm-detail').textContent=p?`${p.name} · CH${p.channel+1} · First observed ${(p.sample/44100).toFixed(3)} s`:'';root.querySelector('.opm-voice').textContent=p?.text ?? '';}
  function extract(){if(patches || !buffer)return;try{patches=extractOpmPatches(buffer,{includeSnapshots:true});select.replaceChildren();patches.forEach((p,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=`${p.name} · ${(p.sample/44100).toFixed(3)} s`;select.append(o);});if(!patches.length)root.querySelector('.opm-detail').textContent='No keyed YM2151 voices found.';else refresh();}catch(e){onStatus(`OPM extraction failed: ${e.message}`);}}
  select.addEventListener('change',()=>{stop();refresh();});
  root.querySelector('.opm-stop').addEventListener('click',stop);
  root.querySelector('input').addEventListener('input',e=>{if(gain)gain.gain.value=Number(e.target.value)/100;});
  play.addEventListener('click',async()=>{
    if(busy)return;
    stop();const token=serial,p=patches?.[Number(select.value)];if(!p)return;
    busy=true;
    play.disabled=true;
    try{
      context ??= createContext();await context.resume();
      if(!chip)chip=await createChip();
      if(disposed){chip.dispose();chip=null;return;}
      if(token!==serial || !visible)return;
      writeOpmPreview(chip,p,Number(root.querySelector('.opm-note').value));
      const rate=chip.sampleRate(p.clock),frames=Math.round(rate), audio=context.createBuffer(2,frames*2,rate);
      const held=chip.generateStereo(frames);chip.write(0,8);chip.write(1,7);const release=chip.generateStereo(frames);
      for(let i=0;i<2;i++){const dest=audio.getChannelData(i),key=i?'right':'left';dest.set(held[key]);dest.set(release[key],frames);for(let j=0;j<Math.min(256,frames);j++)dest[dest.length-1-j]*=j/256;}
      gain ??= context.createGain();gain.gain.value=Number(root.querySelector('input').value)/100;gain.disconnect();gain.connect(context.destination);
      source=context.createBufferSource();source.buffer=audio;source.connect(gain);source.start();
    }catch(e){onStatus(`OPM audition failed: ${e.message}`);}finally{busy=false;if(!disposed)refresh();}
  });
  save.addEventListener('click',()=>{const p=patches?.[Number(select.value)];if(!p)return;const url=URL.createObjectURL(new Blob([p.text],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download=p.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  return {
    loadVgm(value){stop();buffer=value;patches=null;select.replaceChildren();refresh();if(visible)extract();},
    setVisible(value){visible=value;root.hidden=!value;if(value)extract();else stop();},
    async dispose(){disposed=true;stop();chip?.dispose();chip=null;await context?.close();},
  };
}
