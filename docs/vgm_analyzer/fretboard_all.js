import {renderFretboard,FRET_TRAIL_MS} from './fretboard.js';
const colors=['#c54f3a','#ad6d08','#348847','#356bba','#8b4cc2','#007c91','#be4879','#666329','#53646e'];
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const noteName=n=>['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][((n%12)+12)%12]+(Math.floor(n/12)-1);
const positionKey=p=>`${p.stringIndex}:${p.fret}`;

// Each source keeps its own position tracker. Shared locations are drawn as
// colored sectors, so unison channels do not hide one another.
export function renderAllFretboard(layers,strings=8){
 const active=new Map(),ghosts=[],outside=[];
 const x=p=>60+p.fret*29,y=p=>43+(strings-1-p.stringIndex)*27;
 layers.forEach((layer,i)=>{
   const color=colors[i%colors.length];
   for(const [note,position] of layer.activePositions){
     const key=positionKey(position);
     if(!active.has(key))active.set(key,[]);
     active.get(key).push({note,position,color,label:layer.label});
   }
   if(layer.keyOn && Number.isFinite(layer.note) && !layer.activePositions.size)
     outside.push(`${layer.label}: ${noteName(Math.round(layer.note))}`);
   const recent=new Map();
   for(const h of layer.history){
     if(!h.position||!Number.isFinite(h.note)||!Number.isFinite(h.ageMs)||h.ageMs<0||h.ageMs>=FRET_TRAIL_MS)continue;
     const key=positionKey(h.position);
     if(!recent.has(key)||h.ageMs<recent.get(key).ageMs)recent.set(key,h);
   }
   for(const h of recent.values())ghosts.push({...h,color,label:layer.label});
 });
 let marks='';
 for(const h of ghosts){
   if(active.has(positionKey(h.position)))continue;
   marks+=`<g data-all-ghost="${escape(h.label)}" opacity="${(0.5*(1-h.ageMs/FRET_TRAIL_MS)).toFixed(3)}"><circle cx="${x(h.position)}" cy="${y(h.position)}" r="12" fill="${h.color}"/><title>${escape(h.label)}: ${noteName(Math.round(h.note))}</title></g>`;
 }
 for(const entries of active.values()){
   const {position,note}=entries[0],cx=x(position),cy=y(position);
   marks+=`<g data-all-note="${note}"><title>${escape(entries.map(e=>e.label+': '+noteName(e.note)).join(', '))}</title>`;
   if(entries.length===1)marks+=`<circle cx="${cx}" cy="${cy}" r="13" fill="${entries[0].color}"/>`;
   else entries.forEach((e,i)=>{
     const a=-Math.PI/2+2*Math.PI*i/entries.length,b=-Math.PI/2+2*Math.PI*(i+1)/entries.length;
     marks+=`<path data-all-source="${escape(e.label)}" d="M ${cx} ${cy} L ${cx+13*Math.cos(a)} ${cy+13*Math.sin(a)} A 13 13 0 0 1 ${cx+13*Math.cos(b)} ${cy+13*Math.sin(b)} Z" fill="${e.color}"/>`;
   });
   marks+=`<text x="${cx}" y="${cy+4}" text-anchor="middle" font-size="9" fill="white">${noteName(note)}</text></g>`;
 }
 const board=renderFretboard([],{strings,keyOn:false}).replace('</svg>',marks+'</svg>');
 const legend=layers.map((l,i)=>`<span style="color:${colors[i%colors.length]};opacity:${l.keyOn?1:0.55}">${escape(l.label)}: ${l.keyOn&&Number.isFinite(l.note)?noteName(Math.round(l.note)):'—'}</span>`).join(' · ');
 return board+`<div class="fretboard-caption">${legend}</div>`+(outside.length?`<div class="fretboard-caption">Outside range: ${escape(outside.join(', '))}</div>`:'');
}
