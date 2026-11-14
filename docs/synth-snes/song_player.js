// SPDX-License-Identifier: BSD-3-Clause
import {validateSpcVoiceEdit} from '../js/spc_voice_edit.js';
import {readSnesVoices} from '../js/snes_brr.js';
import {parseSpcFile} from '../js/spc_file.js';
import {createSpcAudio} from '../js/playground_spc_audio.js?v=spc-voice-edit-1';
import {createSpcClient} from '../js/playground_spc.js?v=spc-voice-edit-1';
const display=value=>String(value??'').replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').trim().slice(0,256);
const aborted=()=>new DOMException('SPC operation superseded','AbortError');
const nativeSetTimeout=globalThis.setTimeout.bind(globalThis),nativeClearTimeout=globalThis.clearTimeout.bind(globalThis);
/** Full SPC700 playback has its own machine, borrowing the editor's context and
 * pre-Master input. Source selection is passive; no independent speaker route. */
export function createSnesSongPlayer({ensureAudio,getAudio,onChange=()=>{},createEndpoint=createSpcAudio,createClient=createSpcClient,
  schedule=nativeSetTimeout,cancel=nativeClearTimeout}={}){
  let source=null,mode='empty',position=0,muteMask=0,error='',disposed=false,operation=0,generation=0,route=null,opening=null,timer=null,inspection=null,inspectionError='',analysis=null,analysisRevision=0,sourceSequence=0,inspectionEpoch=0,editOwner=0,seekTarget=null;
  const read=()=>({mode,transportRevision:operation,loaded:Boolean(source),playing:mode==='playing',busy:['loading','seeking'].includes(mode),positionSeconds:position,seekTargetSeconds:seekTarget,muteMask,error,analysisRevision,inspection:inspection?{positionSeconds:inspection.positionSeconds,voices:inspection.voices.map(voice=>({...voice})),noiseClock:inspection.noiseClock}:null,inspectionError,
    source:source?{id:source.id,name:source.name,title:display(source.metadata.title),game:display(source.metadata.game),artist:display(source.metadata.artist),durationSeconds:source.metadata.durationSeconds??null}:null});
  const notify=()=>{if(!disposed)onChange(read());};
  const clearTimer=()=>{if(timer!==null){cancel(timer);timer=null;}};
  function retire(){generation++;analysis=null;inspection=null;inspectionError='';clearTimer();const previous=route;route=null;const pending=opening;opening=null;pending?.controller.abort(aborted());for(const owner of [previous,pending]){owner?.cleanup?.();owner?.client?.dispose();owner?.endpoint?.dispose();}}
  function check(token){if(disposed||token!==operation)throw aborted();}
  function apply(state,next){position=state.positionSeconds??position;mode=next??(state.playing?'playing':'paused');seekTarget=null;error='';notify();pollLater();}
  function pollLater(){clearTimer();if(disposed||mode!=='playing'||!route)return;timer=schedule(()=>{timer=null;void poll();},200);}
  async function inspect(owner,token){
    const epoch=inspectionEpoch;try{const snapshot=await owner.client.snapshot();
      if(disposed||token!==operation||owner!==route||epoch!==inspectionEpoch)return;
      analysis=snapshot;analysisRevision++;inspection={positionSeconds:snapshot.positionSeconds??position,voices:readSnesVoices(snapshot),noiseClock:snapshot.dsp[0x6c]&31};inspectionError='';
    }catch(cause){if(!disposed&&token===operation&&owner===route)inspectionError=cause?.message??String(cause);}
  }
  async function poll(){const current=route,token=operation;
    try{const state=await current.client.getState();await inspect(current,token);if(!disposed&&token===operation&&current===route)apply(state);}
    catch(cause){if(!disposed&&token===operation&&current===route)fail(cause);}
  }
  function fail(cause){seekTarget=null;retire();mode=source?'stopped':'empty';error=cause?.message??String(cause);notify();}
  async function ready(){
    if(route&&route.engine===getAudio()&&route.engine.context.state!=='closed')return route;
    if(opening)return opening.promise;
    retire();const version=generation,item={controller:new AbortController(),promise:null};opening=item;
    const current=()=>!disposed&&version===generation&&opening===item&&!item.controller.signal.aborted;
    item.promise=(async()=>{
      const engine=await ensureAudio();if(!current())throw aborted();
      let endpoint,client;
      try{
        if(!engine.songInputNode)throw Error('S-DSP song input is unavailable');
        endpoint=await createEndpoint(engine.context,engine.songInputNode,{signal:item.controller.signal});if(!current()||engine!==getAudio())throw aborted();
        item.endpoint=endpoint;
        const fault=()=>{if(!disposed&&version===generation){operation++;fail(Error('SPC audio processor failed. Press Play to retry.'));}};
        const message=({data})=>{if(data?.fatal||data?.type==='error')fault();};
        endpoint.node?.addEventListener?.('processorerror',fault);endpoint.node?.port?.addEventListener?.('message',message);
        item.cleanup=()=>{endpoint.node?.removeEventListener?.('processorerror',fault);endpoint.node?.port?.removeEventListener?.('message',message);};
        client=item.client=createClient(endpoint.port,{sampleRate:endpoint.sampleRate});
        await client.loadSPC(source.bytes);if(!current())throw aborted();
        await client.setMuteMask(muteMask);if(!current())throw aborted();
        return route={engine,endpoint,client,cleanup:item.cleanup};
      }catch(cause){item.cleanup?.();client?.dispose();endpoint?.dispose();throw cause;}
    })();
    try{return await item.promise;}finally{if(opening===item)opening=null;}
  }
  async function perform(action,next,target=null){
    if(!source)throw Error('Load an SPC file before playback');const token=++operation;clearTimer();seekTarget=target;mode=next;error='';notify();
    try{const owner=await ready();check(token);const result=await action(owner.client);check(token);if(owner!==route)throw aborted();await inspect(owner,token);check(token);if(owner!==route)throw aborted();apply(result);return true;}
    catch(cause){if(cause?.name==='AbortError'||disposed||token!==operation)return false;fail(cause);throw cause;}
  }
  let editQueue=Promise.resolve();
  const api={read,
    async cancelEdits(){editOwner++;if(route)await route.client.cancelVoiceEdits();},
    editVoice(channel,changes,{isCurrent=()=>true}={}){
      const edit=validateSpcVoiceEdit(channel,changes),token=operation,ownerId=editOwner;
      if(!source||disposed||['loading','seeking'].includes(mode))return Promise.reject(aborted());
      const valid=()=>{check(token);if(!isCurrent()||ownerId!==editOwner)throw aborted();};
      const task=editQueue.catch(()=>{}).then(async()=>{
        valid();const owner=await ready();valid();if(owner!==route)throw aborted();
        inspectionEpoch++;const snapshot=await owner.client.editVoice(channel,edit);valid();if(owner!==route)throw aborted();
        inspectionEpoch++;analysis=snapshot;analysisRevision++;inspectionError='';inspection={positionSeconds:snapshot.positionSeconds??position,voices:readSnesVoices(snapshot),noiseClock:snapshot.dsp[0x6c]&31};
        position=snapshot.positionSeconds??position;if(mode==='stopped')mode='paused';notify();pollLater();return true;
      });editQueue=task;return task;
    },
    analysis(){const snap=analysis??source?.initial;if(!snap)return null;return {snapshot:{ram:snap.ram.slice(),dsp:snap.dsp.slice(),positionSeconds:snap.positionSeconds??0},name:source.name,metadata:{...source.metadata}};},
    async capture(){
      if(!route||disposed||['loading','seeking'].includes(mode))throw Error('Play or seek the SPC before capturing a channel.');
      const owner=route,token=operation,currentSource=source;
      const snapshot=await owner.client.snapshot();check(token);if(owner!==route)throw aborted();
      return {snapshot,name:source.name,metadata:{...source.metadata},isCurrent:()=>!disposed&&source===currentSource&&owner===route&&token===operation};
    },
    loadSource(input,{name='SPC file',isCurrent=()=>true}={}){
      const parsed=parseSpcFile(input);if(disposed||!isCurrent())return false;
      operation++;seekTarget=null;retire();analysisRevision++;source={id:++sourceSequence,name:display(name),bytes:parsed.originalBytes.slice(),metadata:{...parsed.metadata},initial:{ram:parsed.ram,dsp:parsed.dsp,positionSeconds:0}};mode='stopped';position=0;muteMask=0;error='';notify();return true;
    },
    play:()=>perform(client=>client.play(),'loading'),
    async pause(){
      if(disposed||!source)return false;const token=++operation;clearTimer();seekTarget=null;
      if(!route){retire();mode='paused';notify();return true;}
      const owner=route;
      try{const state=await owner.client.pause();check(token);if(owner===route){await inspect(owner,token);check(token);if(owner===route)apply(state,'paused');}return true;}
      catch(cause){if(cause?.name==='AbortError'||disposed||token!==operation)return false;fail(cause);throw cause;}
    },
    async stop(){
      if(disposed||!source)return false;const token=++operation;clearTimer();seekTarget=null;
      if(!route){retire();position=0;mode='stopped';error='';notify();return true;}
      const owner=route;
      try{const state=await owner.client.stop();check(token);if(owner===route){await inspect(owner,token);check(token);if(owner===route)apply(state,'stopped');}return true;}
      catch(cause){if(cause?.name==='AbortError'||disposed||token!==operation)return false;fail(cause);throw cause;}
    },
    seek(seconds){if(!Number.isFinite(seconds)||seconds<0||seconds>3600)throw RangeError('SPC seek position must be 0–3600 seconds');return perform(client=>client.seek(seconds),'seeking',seconds);},
    async setMuteMask(value){
      if(!Number.isInteger(value)||value<0||value>255)throw RangeError('SPC mute mask must be 0..255');muteMask=value;notify();
      const owner=route;if(owner){try{await owner.client.setMuteMask(value);if(owner===route)notify();}catch(cause){if(!disposed&&owner===route)throw cause;}}
    },
    audioClosed(){if(disposed)return;seekTarget=null;operation++;retire();mode=source?'stopped':'empty';position=0;notify();},
    dispose(){if(disposed)return;disposed=true;operation++;retire();source=null;},
  };
  return api;
}
