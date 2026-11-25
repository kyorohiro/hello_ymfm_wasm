// SPDX-License-Identifier: BSD-3-Clause

// Keep file order within a tick, including pedal and pitch changes between notes.
export function partScore(song,key){
  const part=song.parts.find(p=>p.key===key && p.notes);
  if(!part)throw new Error('Select a MIDI part with notes.');
  const score=[];
  for(const e of song.events){
    if(e.track===part.track && e.meta===47)score.push([e.seconds,'finish']);
    if(e.part!==key)continue;
    if(e.kind===9 && e.b)score.push([e.seconds,'noteOn',e.a,e.b]);
    else if(e.kind===8 || e.kind===9)score.push([e.seconds,'noteOff',e.a]);
    else if(e.kind===11 && e.a===64)score.push([e.seconds,'sustain',e.b]);
    else if(e.kind===14)score.push([e.seconds,'pitchBend',e.a+128*e.b]);
  }
  return score;
}

export function partSource(score){
  const lines=["const part = midi.createPart();",
    "const time = midi.createTimeline();"];
  let previous=0;
  for(const [seconds,method,...args] of score){
    if(seconds!==previous){
      lines.push('','await time.waitUntil('+Number(seconds.toFixed(9))+');');
      previous=seconds;
    }
    lines.push('part.'+method+'('+args.join(', ')+');');
  }
  return lines.join('\n')+'\n';
}
