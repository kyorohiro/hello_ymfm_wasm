/** Native Genesis noise descriptors and Main-loop leases. No audio graph or
 * PCM transfer: playback is owned by the native device callback. */
import {createNativeNoiseController} from './native_noise.js';

const ranges=[[0,8],[-1,1],[10,20000],[.0001,1000],[0,60],[0,60]];
const integer=(value,min,max,label)=>{
  if(!Number.isSafeInteger(value)||value<min||value>max)throw new RangeError(`Invalid native noise ${label}`);
  return value;
};

/** Validate a command before admitting it to the synth's ordered queue. The
 * namespace is supplied by the trusted Main/Worker transport, never the voice. */
export function nativeGenesisNoiseMessage(message,{namespace,sampleRate}) {
  if(message?.op!=='noise')throw new TypeError('Expected a native noise command');
  integer(namespace,0,Number.MAX_SAFE_INTEGER,'namespace');
  const result={op:'noise',namespace,action:message.action,
    slot:integer(message.slot,0,31,'slot'),token:integer(message.token,1,Number.MAX_SAFE_INTEGER,'token')};
  switch(message.action) {
    case 'create':return {...result,type:integer(message.type,0,4,'type'),seed:integer(message.seed,0,0xffffffff,'seed')};
    case 'parameter': {
      const param=integer(message.param,0,5,'parameter'),[min,max]=ranges[param];
      if(!Number.isFinite(message.value)||message.value<min||message.value>max||
          !Number.isFinite(message.seconds)||message.seconds<0||!Number.isFinite(sampleRate)||sampleRate<8000||
          message.seconds*sampleRate>0x7fffffff)throw new RangeError('Invalid native noise parameter or ramp');
      return {...result,param,value:message.value,seconds:message.seconds};
    }
    case 'filter':return {...result,mode:integer(message.mode,0,7,'filter')};
    case 'start':case 'stop':case 'dispose':case 'retire':return result;
    default:throw new Error(`Unsupported native noise action: ${message.action}`);
  }
}

/** @param {{send:(message:any)=>void, getSampleRate?:()=>number}} [options] */
export function createNativeGenesisNoise({send,getSampleRate=()=>48000}={}) {
  if(typeof send!=='function')throw new TypeError('Native noise requires an ordered sender');
  let resetting=false;
  const controller=createNativeNoiseController(message=>{
    if(!resetting)send(nativeGenesisNoiseMessage(message,{namespace:0,sampleRate:getSampleRate()}));
  });
  return {...controller,
    /** Global native Stop already clears the DSP. Retire local identities
     * without sending cleanup that could reach a replacement performance. */
    reset() {resetting=true;try{controller.disposeAll();}finally{resetting=false;}},
  };
}

/** A Main liveLoop may share a prepared voice with a replacement loop. Start
 * transfers its lease; old finally/stopLoop operations cannot mute the new owner. */
export function createNativeNoiseOwnership(noise,{getContext=()=>null}={}) {
  const records=new Map();
  const owner=context=>context?.keyboard?context.keyboardOwner:context;
  const retired=()=>new Error('noise voice has already been disposed');
  function guard(record,action) {
    if(record.retired)throw retired();
    const context=getContext();
    if(context?.stopped) {
      if(action==='stop'||action==='dispose')return false;
      throw new DOMException('Run stopped','AbortError');
    }
    const lease=record.activeOwner??record.lifetimeOwner;
    return action==='start'||!context||!lease||lease===owner(context);
  }
  const api={
    create(options={}) {
      const context=getContext();if(context?.stopped)throw new DOMException('Run stopped','AbortError');
      const raw=noise.create(options),lease=owner(context)??null;
      const record={raw,lifetimeOwner:lease,activeOwner:options.autoStart===false?null:lease,retired:false};
      const control=param=>({get:()=>param.get(),set(value){return guard(record,'control')?param.set(value):param.get();},
        rampTo(value,seconds){return guard(record,'control')?param.rampTo(value,seconds):param.get();}});
      const voice={type:raw.type,gain:control(raw.gain),pan:control(raw.pan),attack:control(raw.attack),release:control(raw.release),
        filter:{cutoff:control(raw.filter.cutoff),q:control(raw.filter.q),set(...args){if(guard(record,'control'))return raw.filter.set(...args);}},
        start() {
          if(!guard(record,'start'))return;
          raw.start();const next=owner(getContext())??null;
          record.activeOwner=next;if(record.lifetimeOwner!==null)record.lifetimeOwner=next;
        },
        stop() {if(guard(record,'stop')){raw.stop();record.activeOwner=null;}},
        dispose() {
          if(record.retired)return;
          if(!guard(record,'dispose'))return;
          raw.dispose();record.retired=true;records.delete(voice);
        },
      };
      records.set(voice,record);return voice;
    },
    stopAll() {
      if(getContext()?.stopped)return;
      noise.stopAll();for(const record of records.values())record.activeOwner=null;
    },
  };
  return {api,
    releaseOwner(value) {
      for(const [voice,record] of records) {
        if(record.lifetimeOwner===value&&(record.activeOwner===value||record.activeOwner===null)) {
          record.raw._retire();record.retired=true;records.delete(voice);
        } else if(record.activeOwner===value){record.raw.stop();record.activeOwner=null;}
      }
    },
    clear() {for(const record of records.values())record.retired=true;records.clear();},
  };
}
