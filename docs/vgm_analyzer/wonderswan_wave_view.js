import {wonderswanWaveCode,wonderswanWaveJson} from './wonderswan_waves.js?v=wonderswan-waves-1';
import {wonderswanPreviewPitch} from './sample_render.js?v=wonderswan-waves-1';

function download(bytes,type,name){
  const url=URL.createObjectURL(new Blob([bytes],{type}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

/** Display an observed RAM waveform. Audio belongs to the shared explorer. */
export function appendWonderSwanWave(output,sample,events,uses=events.filter(e=>e.sampleId===sample.id),{
  onPreview,onStop,onWav,signal,
}={}){
  const row=document.createElement('details'),title=document.createElement('summary');
  row.setAttribute('data-wonderswan-wave-id',String(sample.id));
  title.textContent=`Wave ${sample.id} · WonderSwan · 32 points (0–15) · ${uses.length} observations`;
  row.append(title);
  const canvas=document.createElement('canvas');
  canvas.width=512;canvas.height=120;canvas.style.maxWidth='100%';
  canvas.setAttribute('aria-label','WonderSwan wave RAM: 32 unsigned 4-bit values');
  let drawn=false;
  row.addEventListener('toggle',()=>{
    if(!row.open||drawn)return;
    const ctx=canvas.getContext('2d');if(!ctx)return;
    drawn=true;ctx.strokeStyle='#44aacc';ctx.beginPath();
    sample.waveform.forEach((value,i)=>{
      const x=i*16,y=112-value*7;
      if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      ctx.lineTo(x+16,y);
    });
    ctx.stroke();
  });
  const selection=document.createElement('select');
  selection.setAttribute('aria-label',`Wave ${sample.id} preview occurrence`);
  for(const [index,event] of uses.slice(0,500).entries()){
    const option=document.createElement('option');option.value=String(index);
    const pitch=wonderswanPreviewPitch(event);
    option.textContent=`${(event.startTime/44100).toFixed(3)} s / CH${event.channel} / ${pitch.observed?`${pitch.frequencyHz.toFixed(2)} Hz`:'A4 preview'} / ${event.mode}`;
    selection.append(option);
  }
  if(!uses.length){const option=document.createElement('option');option.value='0';option.textContent='A4 preview (no pitch observation)';selection.append(option);}
  const selected=()=>uses[Number(selection.value)||0];
  const code=document.createElement('textarea');code.readOnly=true;code.rows=4;code.style.width='100%';
  code.setAttribute('aria-label','WonderSwan setWaveform JavaScript');
  const updateCode=()=>{
    const channel=selected()?.channel;
    code.value=wonderswanWaveCode(sample,Number.isInteger(channel)&&channel>=1&&channel<=4?channel-1:0);
  };
  updateCode();
  const status=document.createElement('p');status.setAttribute('role','status');
  const report=value=>{if(!signal?.aborted)status.textContent=value;};
  selection.onchange=()=>{onStop?.();updateCode();report('');};
  const copy=document.createElement('button');copy.textContent='Copy setWaveform JavaScript';
  copy.onclick=async()=>{
    try{await navigator.clipboard.writeText(code.value);report('Copied.');}
    catch{code.focus();code.select();report('Code selected. Copy it with your keyboard.');}
  };
  const save=document.createElement('button');save.textContent='Save waveform JSON';
  save.onclick=()=>download(wonderswanWaveJson(sample,events),'application/json',`wonderswan-wave-${sample.id}.json`);
  const listen=document.createElement('button');listen.textContent='Preview wave (1 s)';listen.disabled=!onPreview;
  listen.onclick=async()=>{
    if(signal?.aborted)return;
    listen.disabled=true;
    try{await onPreview(sample,selected());report('Isolated wave preview: centered volume, base pitch; sweep and song timing are not replayed.');}
    catch(error){report(`Preview failed: ${error.message}`);}
    finally{listen.disabled=!onPreview;}
  };
  const wav=document.createElement('button');wav.textContent='Save preview WAV (1 s)';wav.disabled=!onWav;
  wav.onclick=async()=>{
    if(signal?.aborted)return;
    wav.disabled=true;
    try{
      const result=await onWav(sample,selected());
      if(!signal?.aborted)download(result.bytes,'audio/wav',`wonderswan-wave-${sample.id}.wav`);
    }catch(error){report(`WAV export failed: ${error.message}`);}
    finally{wav.disabled=!onWav;}
  };
  const help=document.createElement('p');
  help.textContent='Use with a WonderSwan chip named ws. setWaveform uses a zero-based channel and stops that voice; set its note and volume, then keyOn(). Preview isolates the 32-point wave for one second at the selected base pitch (A4 when no active pitch is known), with centered volume 9/9. Noise, sweep, Voice PCM and song timing are not replayed. Observations are RAM/register state, not detected note boundaries.';
  const history=document.createElement('pre');
  history.textContent=uses.slice(0,500).map(event=>`${(event.startTime/44100).toFixed(3)} s · CH${event.channel} · bank ${event.bank} · RAM 0x${event.address.toString(16)} · ${event.mode} · ${event.enabled?'enabled':'disabled'} · ${event.reason}`).join('\n');
  if(uses.length>500)history.textContent+='\nShowing first 500 observations.';
  row.append(canvas,selection,code,copy,save,listen,wav,status,help,history);
  output.append(row);
  return row;
}
