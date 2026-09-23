import {midiToSource} from '../js/midi_source.js?v=midi-generators-1';
import {parseMidiFile} from '../js/midi_file.js?v=midi-generators-1';

/** Import UI compiles selected parts into editable performance code. */
export function installMidiImport({button, presets, importFiles, onError, enabled}) {
  button.disabled=!enabled;
  button.title=enabled?'Convert MIDI to editable JavaScript; choose FM / PSG parts and voices':'MIDI import requires YM2612 (ymfm) mode';
  const input=document.createElement('input');input.type='file';input.accept='.mid,.midi';input.hidden=true;document.body.append(input);
  button.addEventListener('click',()=>{input.value='';input.click();});
  input.addEventListener('change',async()=>{
    const file=input.files[0];if(!file)return;
    let dialog;
    try {
      const bytes=new Uint8Array(await file.arrayBuffer()),song=parseMidiFile(bytes);
      dialog=document.createElement('dialog');dialog.style.maxWidth='90vw';dialog.style.maxHeight='85vh';dialog.style.overflow='auto';
      const title=document.createElement('h2');title.textContent=`Import MIDI: ${file.name}`;
      const help=document.createElement('p');help.textContent='Generates editable JavaScript; the source MIDI is not needed for playback. FM: 6 voices shared across MIDI channels. PSG: 3 tone voices. Oldest notes are replaced when full. Use MIDI alone while playing; Volume, Expression and Sustain are supported. FM Pan uses left/center/right; PSG Pan, drums and automatic program changes are not supported yet.';
      dialog.append(title,help);
      for(const warning of song.warnings){const p=document.createElement('p');p.textContent=warning;dialog.append(p);}
      const table=document.createElement('table'),header=document.createElement('tr');
      for(const name of ['Part / source','Output','MIDI CH','FM voice','Bend ± semitones']){const th=document.createElement('th');th.textContent=name;header.append(th);}table.append(header);
      const rows=[];
      for(const part of song.parts.filter(p=>p.notes>0)) {
        const tr=document.createElement('tr'),label=document.createElement('td');label.textContent=`Track ${part.track+1} ${part.name} / ${part.device||`port ${part.port}`} / CH${part.channel} (${part.notes} notes)`;tr.append(label);
        const select=values=>{const td=document.createElement('td'),el=document.createElement('select');for(const [value,text] of values){const o=document.createElement('option');o.value=value;o.textContent=text;el.append(o);}td.append(el);tr.append(td);return el;};
        const output=select([['','Skip'],['tetorica-ym2612','YM2612'],['tetorica-sega-psg','PSG']]);
        // Start with explicit opt-in; no silent merging or drum assignment.
        output.setAttribute('aria-label', `Output for track ${part.track+1} CH${part.channel}`);
        const channel=select(Array.from({length:16},(_,i)=>[String(i),`CH${i+1}`]));channel.value=String(part.channel-1);
        const voice=select(Object.keys(presets).map(k=>[k,k]));
        output.addEventListener('change',()=>{voice.disabled=output.value!=='tetorica-ym2612';});voice.disabled=true;
        channel.setAttribute("aria-label", `Target MIDI channel for track ${part.track+1}`);
        voice.setAttribute("aria-label", `FM voice for track ${part.track+1}`);
        const cell=document.createElement('td'),bendRange=document.createElement('input');
        bendRange.type='number';bendRange.min='0';bendRange.max='96';bendRange.step='0.01';bendRange.value='2';bendRange.style.width='5em';
        bendRange.setAttribute('aria-label',`Pitch bend range for track ${part.track+1}`);
        cell.append(bendRange);tr.append(cell);
        rows.push({part,output,channel,voice,bendRange});table.append(tr);
      }
      dialog.append(table);
      const error=document.createElement('p');error.setAttribute('role','alert');dialog.append(error);
      const cancel=document.createElement('button');cancel.textContent='Cancel';cancel.type='button';cancel.onclick=()=>dialog.close();
      const confirm=document.createElement('button');confirm.textContent='Import';confirm.type='button';
      confirm.onclick=()=>{
        try {
          const routes=rows.filter(r=>r.output.value).map(r=>({part:r.part.key,destination:r.output.value,channel:Number(r.channel.value),preset:r.voice.value,bendRange:Number(r.bendRange.value)}));
          if(routes.some(r=>!Number.isFinite(r.bendRange)||r.bendRange<0||r.bendRange>96))throw new Error('Bend range must be 0..96 semitones');
          if(!routes.length)throw new Error('Select at least one part');
          const keys=routes.map(r=>JSON.stringify([r.destination,r.channel]));
          if(new Set(keys).size!==keys.length)throw new Error('Assign separate MIDI channels to parts sharing an output');
          const source=midiToSource(bytes,routes,{name:file.name,presets,module:true});
          importFiles(file.name,source);dialog.close();
        }catch(e){error.textContent=e.message;}
      };
      dialog.append(cancel,confirm);dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
    }catch(error){dialog?.remove();onError(error);}
  });
}
