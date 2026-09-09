import {extractOpnNotes,midiChipKind} from './vgm_notes.js?v=midi-onset-1';
import {extractToneNotes} from './tone_notes.js?v=ym2610-vgm-2';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {packTimeline,timelineWindow} from './note_timeline.js';
let channels=[];
self.onmessage=({data})=>{
  try{
    if(data.type==='load'){
      const header=new Ym2612VGM(data.buffer).header;
      const kind=midiChipKind(header);
      const fm=kind && kind!=='psg'?extractOpnNotes(data.buffer):{channels:[],time:0};
      const tones=extractToneNotes(data.buffer,kind);
      channels=[...fm.channels.map((ch,i)=>({name:`CH${i+1}`,notes:ch.notes})),...tones.channels]
        .map(ch=>({name:ch.name,data:packTimeline(ch.notes)})).filter(ch=>ch.data.length);
      self.postMessage({type:'ready',duration:Math.max(fm.time,tones.time),loopSamples:header.loopSamples,names:channels.map(ch=>ch.name)});
    }else if(data.type==='view'){
      self.postMessage({type:'view',id:data.id,channels:channels.map(ch=>({name:ch.name,...timelineWindow(ch.data,data.start,data.end,data.limit)}))});
    }
  }catch(error){self.postMessage({type:'error',message:error.message});}
};
