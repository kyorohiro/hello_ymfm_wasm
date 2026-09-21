import {extractOpl3Notes} from './ymf262_notes.js';
import {extractOpmNotes} from './opm_notes.js';
import {extractOpnNotes,midiChipKind} from './vgm_notes.js?v=midi-onset-1';
import {extractToneNotes} from './tone_notes.js?v=ym2610-vgm-2';
import {extractOpllNotes} from './ym2413_notes.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {packTimeline,timelineWindow} from './note_timeline.js';
let channels=[];
self.onmessage=({data})=>{
  try{
    if(data.type==='load'){
      const header=new Ym2612VGM(data.buffer).header;
      const kind=header.ymf262Clock ? 'ymf262' : header.ym2151Clock ? 'ym2151' : midiChipKind(header);
      const fm=kind==='ymf262'?extractOpl3Notes(data.buffer):kind==='ym2151'?extractOpmNotes(data.buffer):kind && kind!=='psg' && kind!=='ay8910' && kind!=='ym2413'?extractOpnNotes(data.buffer):{channels:[],time:0};
      const tones=extractToneNotes(data.buffer,kind);
      const opll=(header.ym2413Clock & 0x3fffffff)?extractOpllNotes(data.buffer):{channels:[],time:0};
      channels=[...fm.channels.map((ch,i)=>({name:`CH${i+1}`,notes:ch.notes})),...tones.channels,...opll.channels]
        .map(ch=>({name:ch.name,data:packTimeline(ch.notes)})).filter(ch=>ch.data.length);
      self.postMessage({type:'ready',duration:Math.max(fm.time,tones.time,opll.time),loopSamples:header.loopSamples,names:channels.map(ch=>ch.name)});
    }else if(data.type==='view'){
      self.postMessage({type:'view',id:data.id,channels:channels.map(ch=>({name:ch.name,...timelineWindow(ch.data,data.start,data.end,data.limit)}))});
    }
  }catch(error){self.postMessage({type:'error',message:error.message});}
};
