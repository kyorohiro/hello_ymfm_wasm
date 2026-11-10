import {createSegaPsgAudio} from '../js/playground_segapsg_audio.js';
import {createSegaPsgApi} from '../js/segapsg_api.js';
import {SEGAPSG_CLOCK} from '../js/segapsg.js';
import {SYNTH_SONG_MIX_DEFAULTS} from './synth_song_mix_defaults.js?v=mix-source-1';
import {normalizeSynthPsgEnvelope} from './synth_psg_envelope.js?v=psg-envelope-1';
import {normalizePsgRecording} from './synth_psg_recording.js?v=psg-event-rec-1';
import {normalizeSynthPsgSettings} from './synth_psg.js?v=psg-event-rec-1';
import {normalizeSynthPsgLoopConfig,prepareSynthPsgLoopUnit,PSG_LOOP_MAX_UNITS,PSG_LOOP_MAX_PCM_BYTES} from './synth_psg_loop_player.js?v=pcm-looper-1';

/** Lazy PSG endpoint on the host's existing AudioContext/output bus. */
export function createSynthPsgAudio({onError=()=>{},createDevice=createSegaPsgAudio}={}) {
  if(typeof onError!=='function'||typeof createDevice!=='function')throw new TypeError('PSG audio callbacks must be functions');
  let current=null,enabled=false,master=1,disposed=false;
  const cancelled=()=>new DOMException('PSG audio preparation cancelled','AbortError');
  const updateGain=owner=>{if(owner)owner.gain.gain.value=enabled&&owner.api?master*SYNTH_SONG_MIX_DEFAULTS.psg:0;};
  function retire(owner,reason=cancelled()) {
    if(!owner||owner.closed)return;
    owner.closed=true;
    if(current===owner)current=null;
    owner.gain.gain.value=0;
    try {owner.api?.allNotesOff();} catch {}
    owner.abort.abort(reason);
    owner.cleanupPlayback?.();
    try {owner.device?.dispose();} finally {owner.gain.disconnect();}
  }
  function fail(owner,error) {
    if(current!==owner||owner.closed)return;
    retire(owner,error);onError(error);
  }
  function prepare(context,output) {
    if(disposed)return Promise.reject(new Error('PSG audio is disposed'));
    if(typeof context?.createGain!=='function'||context.state==='closed'||output?.context!==context) {
      return Promise.reject(new TypeError('PSG output must belong to an open AudioContext'));
    }
    if(current?.context===context&&current.output===output)return current.promise;
    retire(current);
    let gain;
    try {gain=context.createGain();gain.gain.value=0;gain.connect(output);}
    catch(error) {gain?.disconnect();return Promise.reject(error);}
    const owner=current={context,output,gain,abort:new AbortController(),device:null,api:null,closed:false,pending:true};
    const creating=Promise.resolve().then(()=>{
      owner.abort.signal.throwIfAborted();
      return createDevice(context,gain,{clock:SEGAPSG_CLOCK,stereoEnabled:false,signal:owner.abort.signal,
        workletUrl:new URL('./synth_psg_worklet.js?v=pcm-looper-1',import.meta.url),
        onError:error=>fail(owner,error)});
    });
    owner.promise=new Promise((resolve,reject)=>{
      const aborted=()=>reject(owner.abort.signal.reason??cancelled());
      owner.abort.signal.addEventListener('abort',aborted,{once:true});
      creating.then(device=>{
        owner.abort.signal.removeEventListener('abort',aborted);
        if(owner.closed||current!==owner||disposed) {device.dispose();reject(owner.abort.signal.reason??cancelled());return;}
        owner.device=device;
        const port=device.port??device.node?.port;
        if(typeof port?.postMessage!=='function')throw new TypeError('PSG endpoint needs an ordered MessagePort');
        const post=(method,args=[],extra={},transfers=[])=>{
          if(!owner.closed) {
            const message={method,args,...extra};
            if(transfers.length)port.postMessage(message,transfers);else port.postMessage(message);
          }
        };
        let envelopesUsed=false,latched=0,playbackSession=0,playbackUsed=false,activePlayback=null;
        let loopSession=0,loopUsed=false,activeLoop=null;
        const preparedLoops=new WeakMap();
        const channel=value=>{if(!Number.isInteger(value)||value<0||value>3)throw new RangeError('PSG envelope channel must be 0..3');};
        const attenuation=value=>{if(!Number.isInteger(value)||value<0||value>15)throw new RangeError('PSG attenuation must be 0..15');};
        const write=value=>{
          if(value&128)latched=(value>>4)&7;
          post('write',[value],envelopesUsed&&!(value&128)?{psgRegister:latched}:{});
        };
        const api=createSegaPsgApi({clock:SEGAPSG_CLOCK,write,
          reset:()=>{api.stopLooperPlayback();api.stopRecordingPlayback();post('reset');},resetAll:()=>{api.stopLooperPlayback();api.stopRecordingPlayback();post('reset');}});
        const validSession=value=>{if(!Number.isSafeInteger(value)||value<1)throw new RangeError('PSG loop session must be positive');};
        api.startLooper=value=>{
          const configuration=normalizeSynthPsgLoopConfig(value,{sampleRate:context.sampleRate??48000});
          if(owner.closed)throw new Error('PSG audio endpoint is retired');
          api.stopRecordingPlayback();
          const session=++loopSession;loopUsed=true;activeLoop={session,configuration,units:new Map(),bytes:0};
          post('startLooper',[session,configuration]);return session;
        };
        api.prepareLooperUnit=async(value,{loopLength,signal}={})=>{
          if(owner.closed)throw new Error('PSG audio endpoint is retired');
          const controller=new AbortController(),sources=[owner.abort.signal,signal].filter(Boolean);
          const aborted=event=>controller.abort(event.target.reason);
          for(const source of sources){if(source.aborted)controller.abort(source.reason);else source.addEventListener('abort',aborted,{once:true});}
          try {
            const prepared=await prepareSynthPsgLoopUnit(value,{sampleRate:context.sampleRate??48000,loopLength,signal:controller.signal});
            controller.signal.throwIfAborted();
            if(owner.closed)throw new Error('PSG audio endpoint is retired');
            const token=Object.freeze({id:prepared.id,frameCount:prepared.frameCount,prefixCount:prepared.prefixCount,
              byteLength:prepared.left.byteLength+prepared.right.byteLength,offsetSeconds:prepared.offsetSeconds});
            preparedLoops.set(token,{prepared,loopLength});return token;
          } finally {for(const source of sources)source.removeEventListener('abort',aborted);}
        };
        api.addPreparedLooperUnit=(session,token)=>{
          validSession(session);
          if(owner.closed||activeLoop?.session!==session)return false;
          const owned=token&&preparedLoops.get(token);
          if(!owned||owned.loopLength!==activeLoop.configuration.loopLength)throw new TypeError('PSG loop unit must be prepared for this endpoint and loop length');
          const unit=owned.prepared;
          const bytes=unit.left.byteLength+unit.right.byteLength;
          if(activeLoop.units.has(unit.id))throw new Error('PSG loop unit already exists');
          if(activeLoop.units.size>=PSG_LOOP_MAX_UNITS||activeLoop.bytes+bytes>PSG_LOOP_MAX_PCM_BYTES)throw new RangeError('PSG loop PCM storage limit reached');
          post('addPreparedLooperUnit',[session,unit],{},[unit.left.buffer,unit.right.buffer]);preparedLoops.delete(token);
          activeLoop.units.set(unit.id,bytes);activeLoop.bytes+=bytes;return true;
        };
        api.addLooperUnit=async(session,value)=>{
          validSession(session);
          if(owner.closed||activeLoop?.session!==session)return false;
          const prepared=await api.prepareLooperUnit(value,{loopLength:activeLoop.configuration.loopLength});
          return api.addPreparedLooperUnit(session,prepared);
        };
        api.removeLooperUnit=(session,id)=>{
          validSession(session);if(typeof id!=='string')throw new TypeError('Invalid PSG loop unit id');
          if(owner.closed||activeLoop?.session!==session||!activeLoop.units.has(id))return false;
          const bytes=activeLoop.units.get(id);post('removeLooperUnit',[session,id]);
          activeLoop.units.delete(id);activeLoop.bytes-=bytes;return true;
        };
        api.stopLooperPlayback=()=>{
          activeLoop=null;if(loopUsed){post('stopLooper',[++loopSession]);loopUsed=false;}
        };
        api.isLooperPlaybackActive=()=>Boolean(activeLoop);
        api.stopRecordingPlayback=()=>{
          activePlayback=null;
          if(playbackUsed){post('stopRecording',[++playbackSession]);playbackUsed=false;}
        };
        api.playRecording=(value,options={})=>{
          const recording=normalizePsgRecording(value);
          if(!recording.commands.length)throw new Error('PSG recording contains no events');
          for(const field of ['loop','ignorePatch'])if(options[field]!==undefined&&typeof options[field]!=='boolean')throw new TypeError(`PSG playback ${field} must be a boolean`);
          if(options.onEnded!==undefined&&typeof options.onEnded!=='function')throw new TypeError('PSG playback completion must be a callback');
          const ignorePatch=options.ignorePatch===true;
          const settings=ignorePatch?normalizeSynthPsgSettings(options.settings):null;
          const pitchClock=ignorePatch?options.pitchClock:recording.initialState.pitchClock;
          if(!Number.isFinite(pitchClock)||pitchClock<=0)throw new RangeError('PSG playback pitch clock must be positive');
          if(owner.closed)throw new Error('PSG audio endpoint is retired');
          api.stopLooperPlayback();
          const session=++playbackSession;
          playbackUsed=true;activePlayback={session,onEnded:options.onEnded};
          post('playRecording',[session,recording,{loop:options.loop===true,ignorePatch,settings,pitchClock}]);
          return session;
        };
        api.isRecordingPlaybackActive=()=>Boolean(activePlayback);
        const notify=({data})=>{
          if(owner.closed||data?.type!=='psg-recording-ended'||data.session!==activePlayback?.session)return;
          const callback=activePlayback.onEnded;activePlayback=null;
          callback?.();
        };
        const notifications=device.node?.port;
        notifications?.addEventListener?.('message',notify);
        owner.cleanupPlayback=()=>{activePlayback=null;activeLoop=null;notifications?.removeEventListener?.('message',notify);};
        api.stopEnvelopes=()=>{if(envelopesUsed){post('stopEnvelopes');envelopesUsed=false;}};
        api.envelopeNoteOn=(ch,value,baseAttenuation)=>{
          channel(ch);attenuation(baseAttenuation);const envelope=normalizeSynthPsgEnvelope(value);
          if(owner.closed)return;
          envelopesUsed=true;post('envelopeNoteOn',[ch,envelope,baseAttenuation]);
        };
        api.envelopeNoteOff=ch=>{channel(ch);if(envelopesUsed)post('envelopeNoteOff',[ch]);};
        api.setEnvelopeAttenuation=value=>{attenuation(value);if(envelopesUsed)post('setEnvelopeAttenuation',[value]);};
        const allNotesOff=api.allNotesOff;
        api.allNotesOff=()=>{api.stopLooperPlayback();api.stopRecordingPlayback();api.stopEnvelopes();allNotesOff();};
        api.allNotesOff();
        owner.api=api;owner.pending=false;updateGain(owner);resolve(api);
      }).catch(error=>{
        owner.abort.signal.removeEventListener('abort',aborted);
        fail(owner,error);reject(error);
      });
    });
    return owner.promise;
  }
  return {
    getPsg:()=>current?.api??null,
    isPreparing:()=>Boolean(current?.pending),
    prepare,
    setVolume(value) {
      if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>3.8)throw new RangeError('PSG Master must be 0..3.8');
      master=value;updateGain(current);
    },
    setEnabled(value) {
      if(typeof value!=='boolean')throw new TypeError('PSG enabled must be a boolean');
      if(value!==enabled||!value) {
        if(current)current.gain.gain.value=0;
        current?.api?.allNotesOff();
      }
      enabled=value;updateGain(current);
    },
    dispose() {if(disposed)return;disposed=true;enabled=false;retire(current);},
  };
}
