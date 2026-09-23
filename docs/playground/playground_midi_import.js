import {midiToSource, assignMidiRoutes} from '../js/midi_source.js?v=standard-midi-1';
import {parseMidiFile} from '../js/midi_file.js?v=standard-midi-1';

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
      const help=document.createElement('p');help.textContent='Choose parts, output and MIDI channels. MIDI channels keep voice and controller settings separate. The sound engine automatically shares 6 FM voices or 3 PSG tone voices; a MIDI channel does not pin a physical voice. Parts assigned to the same output / MIDI CH are merged and share controllers; voice and bend range use the first selected part settings.';
      dialog.append(title,help);
      for(const warning of song.warnings){const p=document.createElement('p');p.textContent=warning;dialog.append(p);}
      const table=document.createElement('table'),header=document.createElement('tr');
      for(const name of ['Part / source','Output','Include','MIDI CH','FM voice','Bend ± semitones']){const th=document.createElement('th');th.textContent=name;header.append(th);}table.append(header);
      const rows=[];
      for(const part of song.parts.filter(p=>p.notes>0)) {
        const tr=document.createElement('tr'),label=document.createElement('td');label.textContent=`Track ${part.track+1} ${part.name} / ${part.device||`port ${part.port}`} / CH${part.channel} (${part.notes} notes)`;tr.append(label);
        const select=values=>{const td=document.createElement('td'),el=document.createElement('select');for(const [value,text] of values){const o=document.createElement('option');o.value=value;o.textContent=text;el.append(o);}td.append(el);tr.append(td);return el;};
        const output=select([['tetorica-ym2612','FM'],['tetorica-sega-psg','PSG']]);
        output.setAttribute('aria-label', `Output for track ${part.track+1} CH${part.channel}`);
        const include=select([['','Skip'],['select','Select']]);
        include.setAttribute('aria-label', `Include track ${part.track+1} CH${part.channel}`);
        const channel=select([['auto','Auto'],...Array.from({length:16},(_,i)=>[String(i),`CH${i+1}`])]);
        channel.disabled=true;
        const voice=select(Object.keys(presets).map(k=>[k,k]));
        voice.disabled=true;
        channel.setAttribute("aria-label", `MIDI channel for track ${part.track+1}`);
        voice.setAttribute("aria-label", `FM voice for track ${part.track+1}`);
        const cell=document.createElement('td'),bendRange=document.createElement('input');
        bendRange.type='number';bendRange.min='0';bendRange.max='96';bendRange.step='0.01';bendRange.value='2';bendRange.style.width='5em';
        bendRange.setAttribute('aria-label',`Pitch bend range for track ${part.track+1}`);
        bendRange.disabled=true;
        const updateEnabled=()=>{const skipped=include.value==='';channel.disabled=skipped;voice.disabled=skipped||output.value!=='tetorica-ym2612';bendRange.disabled=skipped;};
        include.addEventListener('change',updateEnabled);
        output.addEventListener('change',updateEnabled);
        cell.append(bendRange);tr.append(cell);
        rows.push({part,output,include,channel,voice,bendRange});table.append(tr);
      }
      dialog.append(table);
      const error=document.createElement('p');error.setAttribute('role','alert');dialog.append(error);
      const cancel=document.createElement('button');cancel.textContent='Cancel';cancel.type='button';cancel.onclick=()=>dialog.close();
      const confirm=document.createElement('button');confirm.textContent='Import';confirm.type='button';
      confirm.onclick=()=>{
        try {
          const routes=assignMidiRoutes(rows.map(r=>({part:r.part.key,destination:r.include.value===''?'':r.output.value,channel:r.channel.value==='auto'?undefined:Number(r.channel.value),sourceChannel:r.part.channel-1,preset:r.voice.value,bendRange:Number(r.bendRange.value)})));
          if(routes.some(r=>!Number.isFinite(r.bendRange)||r.bendRange<0||r.bendRange>96))throw new Error('Bend range must be 0..96 semitones');
          if(!routes.length)throw new Error('Select at least one part');
          const source=midiToSource(bytes,routes,{name:file.name,presets,module:true});
          importFiles(file.name,source);dialog.close();
        }catch(e){error.textContent=e.message;}
      };
      dialog.append(cancel,confirm);dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
    }catch(error){dialog?.remove();onError(error);}
  });
}
