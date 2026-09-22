import {snapshotOpl} from './opl_notes.js';

export function mountOplMonitor(root, getState) {
  const heading=document.createElement('h3'), summary=document.createElement('p');
  const download=document.createElement('button');download.type='button';download.textContent='Export OPL voice snapshot (JSON)';
  const rows=Array.from({length:9},()=>document.createElement('pre'));
  for(const row of rows)row.style.whiteSpace='pre-wrap';
  root.append(heading,summary,download,...rows);
  function snapshot(){const {registers,kind,clock}=getState();return snapshotOpl(registers,kind,clock);}
  download.addEventListener('click',()=>{
    const data=snapshot(), url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=`${data.chip}-voice-snapshot.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  return {render(){
    const data=snapshot();heading.textContent=`${data.chip.toUpperCase()} · Voice / Operator Info`;
    summary.textContent=`Clock: ${data.clock} Hz · Rhythm: ${data.rhythm&32?'On':'Off'} · CSM: ${data.csm?'On':'Off'} · Waveform selection: ${data.waveformEnabled?'On':'Off'}. Register state only; no instrument editing.`;
    download.disabled=!!(getState().rawClock&0xc0000000);
    data.channels.forEach((ch,i)=>{rows[i].textContent=`CH${ch.channel} · Key ${ch.keyOn?'On':'Off'} · FNUM ${ch.fnum} / BLOCK ${ch.block} · ${ch.freq.toFixed(2)} Hz${ch.percussion?' · Rhythm (score omitted)':''}\nConnection: ${ch.connection?'Additive':'FM'} · Feedback: ${ch.feedback}\n`+
      ch.operators.map((op,j)=>`OP${j+1}: MUL ${op.multiplier} · TL ${op.totalLevel} · AR ${op.attack} / DR ${op.decay} / SL ${op.sustainLevel} / RR ${op.release} · KSL ${op.ksl} / KSR ${+op.ksr} · AM ${+op.am} / VIB ${+op.vibrato} / EG ${+op.sustain} · WAVE ${op.waveform}`).join('\n');});
  }};
}
