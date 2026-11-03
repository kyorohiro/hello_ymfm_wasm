import {decodeNativeGenesisPCM} from './native_genesis_media.js';
import {createOfflineAudioDecoder} from './audio_decode.js';

let nextPreview=0;
const aborted=()=>new DOMException('Native sample preview cancelled','AbortError');

/** Explicit Sample Editor preparation/preview. No live Web Audio output node. */
export function createNativeSampleEditorAudio(synth,{decodeAudio=createOfflineAudioDecoder({getSampleRate:()=>synth.clock.sampleRate})}={}){
  const previews=new Set();
  const capture=()=>({session:synth.session,generation:synth.generation});
  const current=token=>{if(token.session!==synth.session||token.generation!==synth.generation||!synth.isReady()||synth.stopping||synth.closing)throw aborted();};
  return {
    async decodeAudio(bytes){const token=capture();current(token);const pcm=await decodeNativeGenesisPCM(bytes,{decodeAudio});current(token);return pcm;},
    /** @param {import('./wav.js').ChannelPCM & {loopEnabled?:boolean,loopStartFrame:number,loopEndFrame:number}} rendered
     * @param {{signal?:AbortSignal}} [options] */
    async playPreview(rendered,{signal}={}){
      signal?.throwIfAborted();const token=capture();current(token);
      // Each attempt has a fresh bank; late cleanup cannot remove a replacement.
      for(const previous of [...previews])void previous.stop();
      const name=`__sample_editor_preview_${++nextPreview}`;let stopped=false,attempted=false,loading,playing,voice,timer,cleanup;
      const check=()=>{signal?.throwIfAborted();if(stopped)throw aborted();current(token);};
      const stop=()=>{
        if(cleanup)return cleanup;stopped=true;clearTimeout(timer);signal?.removeEventListener('abort',stop);
        cleanup=(async()=>{
          await loading?.catch(()=>{});const late=await playing?.catch(()=>{});try{(voice??late)?.stop();}catch{}
          await synth.stopping?.catch(()=>{});
          if(attempted&&token.session===synth.session&&synth.isReady()&&!synth.closing){try{await synth.sample.unload(name);}catch{}}
        })().finally(()=>previews.delete(entry));return cleanup;
      };
      const entry={stop};previews.add(entry);signal?.addEventListener('abort',stop,{once:true});
      try{
        loading=Promise.resolve().then(()=>{check();attempted=true;return synth.sample.load(name,{sampleRate:rendered.sampleRate,channels:rendered.channels});});await loading;check();
        const duration=rendered.channels[0].length/rendered.sampleRate;
        playing=Promise.resolve().then(()=>{check();return synth.sample.play(name,{loop:rendered.loopEnabled===true,loopStart:rendered.loopStartFrame/rendered.sampleRate,loopEnd:rendered.loopEndFrame/rendered.sampleRate,fadeIn:.005,fadeOut:.005});});
        voice=await playing;check();
        if(!rendered.loopEnabled)timer=setTimeout(()=>{void stop();},Math.ceil(duration*1000)+20);
        return entry;
      }catch(error){await stop();throw error;}
    },
    async stop(){await Promise.all([...previews].map(preview=>preview.stop()));},
  };
}
