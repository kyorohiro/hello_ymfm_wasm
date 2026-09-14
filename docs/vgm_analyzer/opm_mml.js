import {extractOpmNotes} from './opm_notes.js?v=voices-1';
import {quantizeSixteenthNotes} from './vgm_mml_music.js';
// MXDRV/MAC voice: four register-order rows of 11 values, then CON, FL, OP.
export function exportMxdrvMml(source, {bpm=120,fileName='VGM'} = {}) {
  if (!Number.isFinite(bpm) || bpm<34 || bpm>999) throw new RangeError('MXDRV BPM must be 34–999');
  const {channels,time,voices}=extractOpmNotes(source,{includeVoices:true});
  const timer=Math.max(0,Math.min(255,Math.round(256-78125/(16*bpm))));
  const actualBpm=78125/(16*(256-timer));
  const parts=channels.map(ch=>quantizeSixteenthNotes(ch.notes,time,actualBpm));
  const playable=e=>e.type==='note' && Number.isInteger(e.midi) && e.midi>=15 && e.midi<=110;
  const used=[...new Set(parts.flat().filter(playable).map(e=>e.preset))];
  if(!used.length)throw new Error('No convertible YM2151 notes for MXDRV');
  if(used.length>256)throw new Error('MXDRV supports at most 256 voices');
  const ids=new Map(used.map((id,i)=>[id,i]));
  const title=String(fileName).replace(/["\r\n\x00-\x1f\x7f]/g,' ').slice(0,120);
  const lines=[`#title "${title}"`,
    '; YM2151 FM transcription for MXDRV / mml2mdr (MDX). FM A-H only.',
    '; 1/16 grid, rounded semitone pitch, key intervals without audible release.',
    '; PCM/PSG, CH8 noise, partial keys and CSM omitted. Loop is not expanded.',
    '; Voice parameters sampled at note/pitch boundaries. Live writes, pan and LFO are not replayed.',
    '; Envelope/DT timing can differ at the target 4 MHz clock; source base pitch is transposed to nominal MDX tuning.',
    `; Manual BPM ${bpm}; @t${timer} gives approximately ${actualBpm.toFixed(4)} BPM.`];
  for(const id of used){const p=voices[id];lines.push(`@${ids.get(id)} = {`);
    for(const op of p.operators)lines.push('  '+[op.ar,op.d1r,op.d2r,op.rr,op.d1l,op.tl,op.ks,op.mul,op.dt1,op.dt2,op.am].join(', ')+',');
    lines.push(`  ${p.algorithm}, ${p.feedback}, 15`,'}');
  }
  let omitted=0;
  parts.forEach((events,ch)=>{
    let tokens=[`@t${timer}`,'q8','v15','p3'],preset=null,previous=null;
    for(const e of events){
      const active=playable(e);if(e.type==='note'&&!active)omitted++;
      if(active && e.preset!==preset){tokens.push(`@${ids.get(e.preset)}`);preset=e.preset;}
      // Link only contiguous intervals belonging to the same key and voice.
      if(active && previous && playable(previous) && previous.end===e.start && previous.sources.at(-1).key===e.sources[0].key && previous.preset===e.preset)tokens.push('&');
      let remaining=(e.end-e.start)/120;
      if(active)tokens.push(`o${Math.floor(e.midi/12)-1}`);
      const pitch=active?['c','c+','d','d+','e','f','f+','g','g+','a','a+','b'][e.midi%12]:'r';
      const chunks=[];
      for(const [units,length] of [[16,'1'],[8,'2'],[4,'4'],[2,'8'],[1,'16']])while(remaining>=units){chunks.push(pitch+length);remaining-=units;}
      tokens.push(chunks.join(active?' & ':' '));previous=e;
    }
    // Each continuation is explicitly prefixed with its track letter.
    let line='';for(const token of tokens){if(line.length+token.length>100){lines.push(`${'ABCDEFGH'[ch]} ${line}`);line='';}line+=(line?' ':'')+token;}if(line)lines.push(`${'ABCDEFGH'[ch]} ${line}`);
  });
  lines.splice(7,0,`; ${omitted} out-of-range intervals replaced by rests.`);
  return lines.join('\n')+'\n';
}
