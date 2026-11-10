import {createSegaPsgAudio} from '../js/playground_segapsg_audio.js';
import {createSegaPsgApi} from '../js/segapsg_api.js';
import {SEGAPSG_CLOCK} from '../js/segapsg.js';
import {SYNTH_SONG_MIX_DEFAULTS} from './synth_song_mix_defaults.js?v=mix-source-1';
import {normalizeSynthPsgEnvelope} from './synth_psg_envelope.js?v=psg-envelope-1';

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
        workletUrl:new URL('./synth_psg_worklet.js?v=psg-envelope-1',import.meta.url),
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
        const post=(method,args=[],extra={})=>{if(!owner.closed)port.postMessage({method,args,...extra});};
        let envelopesUsed=false,latched=0;
        const channel=value=>{if(!Number.isInteger(value)||value<0||value>3)throw new RangeError('PSG envelope channel must be 0..3');};
        const attenuation=value=>{if(!Number.isInteger(value)||value<0||value>15)throw new RangeError('PSG attenuation must be 0..15');};
        const write=value=>{
          if(value&128)latched=(value>>4)&7;
          post('write',[value],envelopesUsed&&!(value&128)?{psgRegister:latched}:{});
        };
        const api=createSegaPsgApi({clock:SEGAPSG_CLOCK,write,
          reset:()=>post('reset'),resetAll:()=>post('reset')});
        api.stopEnvelopes=()=>{if(envelopesUsed){post('stopEnvelopes');envelopesUsed=false;}};
        api.envelopeNoteOn=(ch,value,baseAttenuation)=>{
          channel(ch);attenuation(baseAttenuation);const envelope=normalizeSynthPsgEnvelope(value);
          if(owner.closed)return;
          envelopesUsed=true;post('envelopeNoteOn',[ch,envelope,baseAttenuation]);
        };
        api.envelopeNoteOff=ch=>{channel(ch);if(envelopesUsed)post('envelopeNoteOff',[ch]);};
        api.setEnvelopeAttenuation=value=>{attenuation(value);if(envelopesUsed)post('setEnvelopeAttenuation',[value]);};
        const allNotesOff=api.allNotesOff;
        api.allNotesOff=()=>{api.stopEnvelopes();allNotesOff();};
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
