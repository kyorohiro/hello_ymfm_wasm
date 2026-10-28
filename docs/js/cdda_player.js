// Original Tetorica code. BSD-3-Clause; see LICENSE.
import {createCddaTrackSource,createCddaWavTrackSource} from './cdda_source.js?v=cdda-pcm-1';

const cancelled=()=>new DOMException('CD-DA operation was cancelled','AbortError');
/** Track management shared by realtime Browser/Native and offline renderers.
 * Position arguments are seconds; adapters use integer 44,100 Hz source frames.
 * Reading/preparation completes before a play command enters the audio clock.
 * @param {{prepare:(pcm:Uint8Array,track:string)=>Promise<unknown>,command:(action:object,timing?:object)=>Promise<any>,dispose:()=>unknown}} adapter
 * @param {{readFile?:(path:string)=>Promise<ArrayBuffer|Uint8Array>,signal?:AbortSignal,getMix?:()=>{volume:number,pan:number,muted:boolean,effectiveMuted?:boolean}|undefined}} [options]
 */
export function createCddaPlayer(adapter,{readFile,signal,getMix}={}) {
  let source=null,selected=null,generation=0,disposed=false,tail=Promise.resolve(),operations=new AbortController();
  const check=token=>{signal?.throwIfAborted();if(disposed||token!==generation)throw cancelled();};
  const serial=operation=>{const token=generation;const pending=tail.then(()=>{check(token);return operation(token);});tail=pending.catch(()=>{});return pending;};
  const api={
    async load(input){
      const token=++generation;operations.abort(cancelled());operations=new AbortController();signal?.throwIfAborted();if(disposed)throw cancelled();
      let next;
      if(input instanceof ArrayBuffer||ArrayBuffer.isView(input)) next=createCddaWavTrackSource(input);
      else {
        if(typeof input==='string'&&!input.trimStart().startsWith('{')){
          if(!readFile)throw new Error('CD-DA file loading requires readFile');
          const bytes=await readFile(input);check(token);
          if(/\.json$/i.test(input))input=new TextDecoder().decode(bytes);
          else next=createCddaWavTrackSource(bytes);
        }
        if(!next)next=createCddaTrackSource(input,{readFile,signal});
      }
      check(token);
      // Retire old transport commands before replacing metadata. A failed read
      // above leaves the previous source available; successful load is silent.
      await adapter.command({type:'stop'});check(token);await tail;check(token);
      source=next;selected=null;return next.tracks;
    },
    /** @param {number} [number] @param {{offset?:number,at?:number}} [options] */
    play(number,options={}){return serial(async token=>{
      if(!source)throw new Error('Load CD-DA tracks before playback');
      const sourceFrame=secondsFrame(options.offset??0);
      const trackNumber=number??selected?.number??source.tracks[0].number;
      if(!selected||selected.number!==trackNumber){
        const operationSignal=signal?AbortSignal.any([signal,operations.signal]):operations.signal;
        const track=await source.getTrack(trackNumber,{signal:operationSignal});check(token);
        if(sourceFrame>track.frames)throw new RangeError('CD-DA position is outside the track');
        selected=null;
        await adapter.prepare(track.pcm,String(track.number),{signal:operationSignal});check(token);selected=track;
      }
      if(sourceFrame>selected.frames)throw new RangeError('CD-DA position is outside the track');
      return adapter.command({type:'play',sourceFrame},options);
    });},
    /** @param {{at?:number}} [options] */
    pause:options=>serial(()=>adapter.command({type:'pause'},options)),
    /** @param {{at?:number}} [options] */
    resume:options=>serial(()=>adapter.command({type:'resume'},options)),
    /** @param {{at?:number}} [options] */
    stop(options){
      const token=++generation;operations.abort(cancelled());operations=new AbortController();tail=Promise.resolve();
      check(token);return adapter.command({type:'stop'},options);
    },
    /** @param {number} seconds @param {{at?:number}} [options] */
    seek(seconds,options){return serial(()=>{
      if(!selected)throw new Error('Select a CD-DA track before seeking');
      const sourceFrame=secondsFrame(seconds);if(sourceFrame>selected.frames)throw new RangeError('CD-DA position is outside the track');
      return adapter.command({type:'seek',sourceFrame},options);
    });},
    getState(){return serial(async()=>{
      const state=await adapter.command({type:'state'}),mix=getMix?.();
      return {...state,...(mix?{volume:mix.volume,pan:mix.pan,mute:mix.effectiveMuted??mix.muted}:{}),track:selected?.number??null,title:selected?.title??'',tracks:source?.tracks??[]};
    });},
    list:()=>source?.tracks??[],
    dispose(){if(disposed)return;disposed=true;generation++;operations.abort(cancelled());source=null;selected=null;adapter.dispose();},
  };
  return api;
}
function secondsFrame(seconds){if(!Number.isFinite(seconds)||seconds<0||!Number.isSafeInteger(Math.round(seconds*44100)))throw new RangeError('CD-DA position must be finite nonnegative seconds');return Math.round(seconds*44100);}
