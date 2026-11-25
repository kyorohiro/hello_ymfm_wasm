// SPDX-License-Identifier: BSD-3-Clause

import {integer} from './chip.js';
import {nextAutoSlot} from './instrument.js';

function pedalDown(value,chip){return value>=(chip?1:64);}

// OPS/EGS owns its pedal gates. The MSFA adapter defers note-offs by pitch.
export function createPartPlayer({noteOn,noteOff,setSustain,setBend,stop}){
  const deferred=new Set();
  let sustained=false,finished=false;
  function active(){if(finished)throw Error('MIDI part has finished');}
  return {
    noteOn(note,velocity=100){
      active();integer(note,0,127,'note');integer(velocity,1,127,'velocity');
      if(deferred.delete(note))noteOff(note);
      noteOn(note,velocity);
    },
    noteOff(note){
      if(finished)return;
      integer(note,0,127,'note');
      if(!setSustain && sustained)deferred.add(note);else noteOff(note);
    },
    sustain(value){
      active();integer(value,0,127,'CC64');
      sustained=pedalDown(value,Boolean(setSustain));
      if(setSustain)setSustain(sustained);
      else if(!sustained){for(const n of deferred)noteOff(n);deferred.clear();}
    },
    pitchBend(value){
      active();integer(value,0,16383,'pitch bend');
      setBend?.(Math.round((value-8192)/8192*2*4096/12));
    },
    finish(){
      if(finished)return;
      finished=true;deferred.clear();stop();
    },
  };
}

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

// Reconstruct sounding gates from this part in isolation. Physical slots are
// allocated by the live instrument again, so other performers keep their keys.
export function playbackRegion(score,start,end,chip){
  const duration=score.at(-1)[0];
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>duration||
      end<start||(start===end && duration!==0))throw RangeError('Choose a start before the end, within the selected track.');
  const voices=Array(chip?16:128).fill(null);
  let cursor=0,pedal=0,bend=8192,i=0;
  for(;i<score.length && score[i][0]<start;i++){
    const [,method,n,v]=score[i];
    if(method==='pitchBend')bend=n;
    if(method==='sustain'){
      pedal=n;
      if(!pedalDown(pedal,chip))voices.forEach((voice,ch)=>{if(voice?.released)voices[ch]=null;});
    }
    if(method==='noteOn'){
      const ch=chip?nextAutoSlot(cursor,k=>!voices[k]||voices[k].released):n;
      if(ch<0)continue;
      voices[ch]={note:n,velocity:v,released:false};
      if(chip)cursor=(ch+1)%16;
    }
    if(method==='noteOff'){
      const ch=voices.findIndex(voice=>voice?.note===n && !voice.released);
      if(ch<0)continue;
      if(pedalDown(pedal,chip))voices[ch].released=true;else voices[ch]=null;
    }
  }
  const events=[];
  if(pedal)events.push([0,'sustain',pedal]);
  if(bend!==8192)events.push([0,'pitchBend',bend]);
  // Restore pedal-only notes first so a same-pitch key still down stays down.
  for(const released of [true,false])for(const voice of voices){
    if(voice?.released!==released)continue;
    events.push([0,'noteOn',voice.note,voice.velocity]);
    if(released)events.push([0,'noteOff',voice.note]);
  }
  for(;i<score.length;i++){
    const [seconds,method,...args]=score[i];
    if(seconds>end || (seconds===end && end!==duration) || method==='finish')break;
    events.push([seconds-start,method,...args]);
  }
  events.push([end-start,'finish']);
  return events;
}
