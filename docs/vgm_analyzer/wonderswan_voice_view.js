import {wonderswanVoiceSampleJson} from './wonderswan_voice_samples.js?v=wonderswan-voice-samples-1';

function download(bytes,type,name){
  const url=URL.createObjectURL(new Blob([bytes],{type}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

/** A timed CH2 capture; the shared explorer owns playback and cancellation. */
export function appendWonderSwanVoice(output,sample,uses,{onPreview,onStop,onWav,signal}={}){
  const row=document.createElement('details'),title=document.createElement('summary');
  row.setAttribute('data-wonderswan-voice-id',String(sample.id));
  const end=sample.sourceStartSample+sample.durationSamples;
  title.textContent=`Voice PCM capture ${sample.id} · WonderSwan CH2 · ${(sample.sourceStartSample/44100).toFixed(3)}–${(end/44100).toFixed(3)} s · ${sample.data.length.toLocaleString()} PCM writes`;
  row.append(title);
  const help=document.createElement('p');
  help.textContent='Timed unsigned 8-bit Voice PCM, with original byte times, CH2 gating and output/routing changes. Preview follows these hardware settings and the source DAC phase, before the playback Mixer. Captures split at mode/key-off, VGM end or 10-second windows; these are not detected instrument boundaries.';
  row.append(help);
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=120;canvas.style.maxWidth='100%';
  canvas.setAttribute('aria-label','WonderSwan Voice PCM input bytes over source time');
  let drawn=false;
  row.addEventListener('toggle',()=>{
    if(!row.open||drawn)return;const ctx=canvas.getContext('2d');if(!ctx)return;drawn=true;
    const low=new Float64Array(512),high=new Float64Array(512);low.fill(256);high.fill(-1);
    for(let i=0;i<sample.values.length;i++)if(sample.registers[i]===9){
      const x=Math.min(511,Math.floor(sample.times[i]*512/Math.max(1,sample.durationSamples)));
      low[x]=Math.min(low[x],sample.values[i]);high[x]=Math.max(high[x],sample.values[i]);
    }
    ctx.strokeStyle='#44aacc';ctx.beginPath();
    for(let x=0;x<512;x++)if(high[x]>=0){ctx.moveTo(x,112-high[x]*104/255);ctx.lineTo(x,112-low[x]*104/255);}
    ctx.stroke();
  });
  row.append(canvas);
  const status=document.createElement('p');status.setAttribute('role','status');
  const report=message=>{if(!signal?.aborted)status.textContent=message;};
  const preview=document.createElement('button');preview.textContent='Preview Voice PCM';preview.disabled=!onPreview;
  preview.onclick=async()=>{
    if(signal?.aborted)return;preview.disabled=true;
    try{await onPreview(sample,uses[0]);report('Playing the captured Voice PCM with its original timing and hardware routing.');}
    catch(error){report(error.name==='AbortError'?'Preview stopped.':`Preview failed: ${error.message}`);}
    finally{preview.disabled=!onPreview;}
  };
  const stop=document.createElement('button');stop.textContent='Stop preview';stop.onclick=()=>{onStop?.();report('Preview stopped.');};
  const save=document.createElement('button');save.textContent='Save timed Voice PCM JSON';
  save.onclick=()=>download(wonderswanVoiceSampleJson(sample,uses),'application/json',`wonderswan-voice-${sample.id}.json`);
  const wav=document.createElement('button');wav.textContent='Save preview WAV';wav.disabled=!onWav;
  wav.onclick=async()=>{
    if(signal?.aborted)return;wav.disabled=true;
    try{const result=await onWav(sample,uses[0]);if(!signal?.aborted)download(result.bytes,'audio/wav',`wonderswan-voice-${sample.id}.wav`);}
    catch(error){if(error.name!=='AbortError')report(`WAV export failed: ${error.message}`);}
    finally{wav.disabled=!onWav;}
  };
  row.append(preview,stop,save,wav,status);output.append(row);return row;
}
