import {gameboyVoiceCode,gameboyVoiceJson} from './gameboy_voices.js';
export function appendGameboyVoice(output,sample,events,uses=events.filter(e=>e.sampleId===sample.id)) {
  const row=document.createElement('details'),title=document.createElement('summary');
  title.textContent=`Voice ${sample.id} · Game Boy CH${sample.channel} ${sample.kind.toUpperCase()} · ${uses.length} trigger writes`;
  row.append(title); output.append(row);
  let built = false;
  row.addEventListener('toggle', () => {
    if (!row.open || built) return;
    built = true;
    build();
  });
  function build() {
    const code=document.createElement('textarea');code.readOnly=true;code.rows=14;code.style.width='100%';
    code.setAttribute('aria-label','Game Boy initial voice JavaScript');code.value=gameboyVoiceCode(sample);
    const status=document.createElement('p');status.setAttribute('role','status');
    const copy=document.createElement('button');copy.textContent='Copy initial voice JavaScript';
    copy.onclick=async()=>{try{await navigator.clipboard.writeText(code.value);status.textContent='Copied.';}
      catch{code.focus();code.select();status.textContent='Code selected. Copy it with your keyboard.';}};
    const save=document.createElement('button');save.textContent='Save voice and changes JSON';
    save.onclick=()=>{const url=URL.createObjectURL(new Blob([gameboyVoiceJson(sample,events)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download=`gameboy-${sample.kind}-${sample.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    const help=document.createElement('p');help.textContent='Initial register settings, not a complete instrument. Envelope, sweep and length evolve inside the chip without register writes. Intervals end at the next trigger, DAC disable, power off or file end; they are not measured audible durations. Unknown fields are null. keyOn() disables hardware length in the current high-level API.';
    const selection=document.createElement('select');selection.setAttribute('aria-label','Game Boy voice trigger occurrence');
    let page = 0;
    const pageSize = 100;
    const previous = document.createElement('button'); previous.textContent = 'Previous occurrences';
    const next = document.createElement('button'); next.textContent = 'Next occurrences';
    const pageLabel = document.createElement('span');
    function fillPage() {
      selection.replaceChildren();
      const from = page * pageSize, to = Math.min(uses.length, from + pageSize);
      for (let i = from; i < to; i++) {
        const e = uses[i], option = document.createElement('option');
        option.value = String(i); option.textContent = `${(e.startTime/44100).toFixed(3)} s · ${e.changes.length} later writes`;
        selection.append(option);
      }
      selection.value = String(from);
      previous.disabled = page === 0; next.disabled = to >= uses.length;
      pageLabel.textContent = `${uses.length ? from + 1 : 0}–${to} / ${uses.length}`;
      show();
    }
    previous.onclick = () => { if (page > 0) { page--; fillPage(); } };
    next.onclick = () => { if ((page+1)*pageSize < uses.length) { page++; fillPage(); } };
    const initial=document.createElement('pre'),changes=document.createElement('pre');
    const initialLabel=document.createElement('h4');initialLabel.textContent='Trigger-time settings';
    const changeLabel=document.createElement('h4');changeLabel.textContent='Writes after this trigger (not included in copied settings)';
    function show(){const e=uses[Number(selection.value)||0];if(!e)return;
      initial.textContent=JSON.stringify({timeSeconds:e.startTime/44100,frequencyRegister:e.frequencyRegister,length:e.length,dacEnabled:e.dacEnabled,powerEnabled:e.powerEnabled,initialRegisters:e.initialRegisters},null,2);
      const hex=v=>'0x'+v.toString(16).padStart(2,'0');
      changes.textContent=e.changes.slice(0,500).map(c=>`+${(c.offsetSamples/44100).toFixed(6)} s · gb.writeRegister(${hex(c.register)}, ${hex(c.value)});`).join('\n')||'No later register writes observed in this interval.';
      if(e.changes.length>500)changes.textContent+='\nShowing first 500 writes. JSON includes all writes.';
    }
    selection.onchange=show;fillPage();
    row.append(code,copy,save,status,help,previous,pageLabel,next,selection,initialLabel,initial,changeLabel,changes);
  }
}
