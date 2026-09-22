import {extractHuc6280Notes} from './huc6280_notes.js';
import {analyzeLilyPondSource} from './vgm_lilypond.js';
import {groupScoreChannels} from './score_groups.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {packTimeline,timelineWindow} from './note_timeline.js';
let channels=[];
self.onmessage=({data})=>{
  try{
    if(data.type==='load'){
      const header=new Ym2612VGM(data.buffer).header;
      const score=header.huc6280Clock ? extractHuc6280Notes(data.buffer) : analyzeLilyPondSource(data.buffer);
      const raw=groupScoreChannels(score.channels,data.groups);
      channels=raw.map(ch=>{
        const keys=new Map(),sources={};
        const notes=ch.sourceChannels?ch.notes.map(n=>{
          if(!keys.has(n.key))keys.set(n.key,keys.size+1);
          const key=keys.get(n.key);sources[key]={channel:n.sourceChannel,key:n.sourceKey};return {...n,key};
        }):ch.notes;
        const name=data.groups?.length?ch.name:ch.name.replace(/^(YMF262|YM2612|YM2151|YM2203|YM2608|YM2610) CH/,'CH');
        return {name,data:packTimeline(notes),sources};
      }).filter(ch=>ch.data.length);
      self.postMessage({type:'ready',duration:score.time,loopSamples:header.loopSamples,names:channels.map(ch=>ch.name)});
    }else if(data.type==='view'){
      self.postMessage({type:'view',id:data.id,channels:channels.map(ch=>({name:ch.name,sources:ch.sources,...timelineWindow(ch.data,data.start,data.end,data.limit)}))});
    }
  }catch(error){self.postMessage({type:'error',message:error.message});}
};
