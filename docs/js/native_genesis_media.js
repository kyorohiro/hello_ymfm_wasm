/** Main-thread preparation for native Genesis media. PCM crosses IPC only when
 * a bank is loaded or a bounded output recording is explicitly retrieved. */
import {readSamplePCM} from './adpcm_b_sample.js';
import {copyDacPcm} from './ym2612_dac.js';

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_BANKS = 64;
const abort = () => new DOMException('Native media operation was cancelled','AbortError');
const nameOf = value => {
  if (typeof value !== 'string' || !value.length || value.length > 256) throw new TypeError('Sample name must contain 1..256 characters');
  return value;
};
const rateOf = value => {
  if (!Number.isFinite(value) || value <= 0 || value > 384000) throw new RangeError('Sample rate must be positive and at most 384000 Hz');
  return value;
};
function playbackOptions(options={}) {
  const normalized={};
  for (const [key,fallback] of Object.entries({playbackRate:1,gain:1,pan:0,offset:0,duration:-1,loopStart:0,loopEnd:0,fadeIn:0,fadeOut:0})) {
    const value=Number(options[key]??fallback);if (!Number.isFinite(value)) throw new RangeError(`Invalid sample ${key}`);normalized[key]=value;
  }
  if (!normalized.playbackRate) throw new RangeError('Native sample playbackRate must be nonzero');
  for (const key of ['offset','loopStart','loopEnd','fadeIn','fadeOut']) normalized[key]=Math.max(0,normalized[key]);
  normalized.duration=options.duration==null?-1:Math.max(0,normalized.duration);normalized.loop=options.loop===true;
  return normalized;
}

function decodedBuffer(pcm) {
  const sampleRate = rateOf(pcm?.sampleRate), source = pcm?.channels;
  if (!Array.isArray(source) || source.length < 1 || source.length > 2) throw new TypeError('Native samples require mono or stereo PCM');
  const length = source[0]?.length;
  if (!Number.isSafeInteger(length) || length < 1 || length > 10000000 || length * source.length * 4 > MAX_BYTES ||
      source.some(channel => channel?.length !== length)) throw new RangeError('Invalid or oversized native PCM');
  const channels = source.map(channel => {
    const copy = new Float32Array(length);
    for (let i=0;i<length;i++) {
      if (!Number.isFinite(channel[i])) throw new TypeError('PCM samples must be finite');
      copy[i] = channel[i];
      if (!Number.isFinite(copy[i])) throw new RangeError('PCM samples exceed Float32 range');
    }
    return copy;
  });
  return {sampleRate,length,numberOfChannels:channels.length,duration:length/sampleRate,
    getChannelData(channel) {
      if (!Number.isInteger(channel) || !channels[channel]) throw new RangeError('Invalid PCM channel');
      return channels[channel];
    }};
}

async function decodeSource(source, fetcher) {
  if (typeof source === 'string' || source instanceof URL) {
    const value = String(source);
    let url = value;
    if (typeof location !== 'undefined' && !/^(data:|blob:)/i.test(value)) {
      const resolved = new URL(value,location.href);
      if (resolved.origin !== location.origin) throw new Error('Only same-origin media URLs are allowed in MegaSynth.sample');
      url = resolved.href;
    }
    if (!fetcher) throw new Error('Sample loading requires fetch support');
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`Failed to load sample: ${response.status} ${response.statusText ?? ''}`);
    const size = Number(response.headers?.get('Content-Length'));
    if (size > MAX_BYTES) throw new RangeError('Native sample file exceeds 64 MiB');
    source = await response.arrayBuffer();
  }
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    if (source.size > MAX_BYTES) throw new RangeError('Native sample file exceeds 64 MiB');
    source = await source.arrayBuffer();
  }
  if ((source instanceof ArrayBuffer || ArrayBuffer.isView(source)) && source.byteLength > MAX_BYTES) throw new RangeError('Native sample file exceeds 64 MiB');
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    const bytes=source instanceof ArrayBuffer?new Uint8Array(source):new Uint8Array(source.buffer,source.byteOffset,source.byteLength);
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const tag=offset=>String.fromCharCode(...bytes.subarray(offset,offset+4));
    if(bytes.length>=12 && tag(0)==='RIFF' && tag(8)==='WAVE') {
      let count,block,dataBytes;
      for(let offset=12;offset+8<=bytes.length;) {
        const size=view.getUint32(offset+4,true),start=offset+8;
        if(start+size>bytes.length)throw new RangeError('Truncated WAV chunk');
        if(tag(offset)==='fmt '&&size>=16){count=view.getUint16(start+2,true);block=view.getUint16(start+12,true);}
        if(tag(offset)==='data')dataBytes=size;
        offset=start+size+(size&1);
      }
      if(count!==1&&count!==2)throw new TypeError('Native samples require mono or stereo PCM');
      if(!block||dataBytes===undefined||dataBytes/block*count*4>MAX_BYTES)throw new RangeError('Invalid or oversized native PCM');
    }
  }
  // This decoder is binary-only: it never creates an AudioContext or opens a device.
  return decodedBuffer(await readSamplePCM(source));
}

/** The synth owns ordering, session invalidation, and failure reporting. */
export function createNativeGenesisMedia(synth, {fetch:fetcher = globalThis.fetch?.bind(globalThis)} = {}) {
  const banks = new Map(), dacBanks = new Map(), packedBanks = new Map();
  const loadTokens=new Map();
  let pendingBytes=0, nextVoice=0, nextInline=0, version=0, recording=false,recordingTicket=0;
  const totalBytes = () => [...banks.values(),...dacBanks.values(),...packedBanks.values()].reduce((sum,bank)=>sum+bank.bytes,0);
  const check = () => {if (!synth.isReady()) throw new Error('Native Genesis audio is not ready');if (synth.stopping || synth.closing) throw abort();};
  const capture = () => {check();return {generation:synth.generation,session:synth.session,version};};
  const current = token => {
    if (token.generation !== synth.generation || token.session !== synth.session || token.version !== version) throw abort();
    check();
  };
  const discardRecording = async token => {
    await synth.stopping?.catch(()=>{});
    if(Number.isSafeInteger(token.session)&&token.session>0&&token.session===synth.session)await synth.invoke('native_genesis_record_stop',{session:token.session}).catch(()=>{});
  };
  const load = async (kind,name,sampleRate,channels,map,buffer) => {
    nameOf(name);rateOf(sampleRate);const token=capture();
    const bytes=channels.reduce((sum,channel)=>sum+channel.length*(kind==='sample'?4:1),0);
    if (!bytes || bytes > MAX_BYTES || totalBytes()-(map.get(name)?.bytes??0)+pendingBytes+bytes>MAX_BYTES) throw new RangeError('Native media storage exceeds 64 MiB');
    const pendingNames=[...loadTokens.keys()].filter(key=>key.startsWith(`${kind}:`)&&!map.has(key.slice(kind.length+1)));
    if (!map.has(name) && !loadTokens.has(`${kind}:${name}`) && map.size+pendingNames.length >= MAX_BANKS) throw new RangeError('Native media bank limit (64) reached');
    const key=`${kind}:${name}`,loadToken={};loadTokens.set(key,loadToken);
    pendingBytes+=bytes;
    try {
      await synth.nativeRequest('native_genesis_media_load',{kind,name,sampleRate,channels:channels.map(channel=>Array.from(channel))});
      current(token);if(loadTokens.get(key)!==loadToken)throw abort();map.set(name,{bytes,sampleRate,length:channels[0].length,buffer});
      return buffer;
    } finally {pendingBytes-=bytes;if(loadTokens.get(key)===loadToken)loadTokens.delete(key);}
  };
  const remove = (kind,name,map) => {
    nameOf(name);check();const present=map.delete(name)||loadTokens.has(`${kind}:${name}`);loadTokens.delete(`${kind}:${name}`);
    if(kind==='sample')send({type:'sample-stop',frame:0,name}).catch(error=>synth.reportAsyncError(error));
    synth.nativeRequest('native_genesis_media_remove',{kind,name}).catch(error=>synth.reportAsyncError(error));
    return present;
  };
  const send = (command,timing={}) => {
    check();synth.enqueue({...command,
      ...(timing.time===undefined?{}:{frame:synth.frameAt(timing.time)}),
      ...(timing.performance===undefined?{}:{performance:timing.performance}),
      ...(timing.owner===undefined?{}:{owner:timing.owner})});return synth.flush();
  };
  const playSample = async (name,options,timing={}) => {
    nameOf(name);check();if (!banks.has(name)) throw new Error(`Unknown sample: ${name}`);
    const normalized=playbackOptions(options);
    if (nextVoice>=Number.MAX_SAFE_INTEGER) throw new RangeError('Native sample voice ID limit reached');
    const voice=++nextVoice, token=capture();
    await send({type:'sample-play',frame:0,name,voice,...normalized},timing);current(token);
    return {voice,token};
  };
  const sample = {
    async load(name,source) {
      if (source === undefined && typeof name === 'string') source=name;
      nameOf(name);const token=capture(), buffer=await decodeSource(source,fetcher);current(token);
      return load('sample',name,buffer.sampleRate,Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i)),banks,buffer);
    },
    async play(name,options={}) {
      const {voice,token}=await playSample(name,options);
      return {name,stop:()=>{
        if (token.generation!==synth.generation || token.session!==synth.session) return;
        send({type:'sample-stop',frame:0,voice}).catch(error=>synth.reportAsyncError(error));
      }};
    },
    stop(name) {if (name!==undefined) nameOf(name);send({type:'sample-stop',frame:0,...(name===undefined?{}:{name})}).catch(error=>synth.reportAsyncError(error));},
    stopAll() {if (synth.isReady() && !synth.stopping && !synth.closing) this.stop();},
    unload:name=>remove('sample',name,banks),isLoaded:name=>banks.has(name),get:name=>banks.get(name)?.buffer??null,list:()=>[...banks.keys()],
  };
  async function dacCommand(command,timing={}) {
    check();
    if (command.action==='load') {
      const data=copyDacPcm(command.data);
      await load('dac',nameOf(command.name),rateOf(command.sampleRate),[data],dacBanks);return;
    }
    if (command.action==='remove') {nameOf(command.name);dacBanks.delete(command.name);loadTokens.delete(`dac:${command.name}`);await synth.nativeRequest('native_genesis_media_remove',{kind:'dac',name:command.name});return;}
    if (command.action==='stop') {await send({type:'dac-stop',frame:0},timing);return;}
    if (command.action!=='play') throw new Error('Unknown PCM DAC command');
    const token=capture();let name=command.name, temporary=false;
    if (command.data!==undefined) {
      if (nextInline>=Number.MAX_SAFE_INTEGER) throw new RangeError('Native DAC temporary ID limit reached');
      do {
        if(nextInline>=Number.MAX_SAFE_INTEGER)throw new RangeError('Native DAC temporary ID limit reached');
        name=`__native_dac_${++nextInline}`;
      }while(dacBanks.has(name)||loadTokens.has(`dac:${name}`));temporary=true;
      await load('dac',name,rateOf(command.sampleRate),[copyDacPcm(command.data)],dacBanks);current(token);
    }
    try {
      nameOf(name);const bank=dacBanks.get(name);if (!bank) throw new Error(`Unknown PCM sample: ${name}`);
      const offset=command.offset??0,size=command.size??bank.length-offset,pan=command.pan??'both';
      if (!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(size)||size<1||offset+size>bank.length) throw new RangeError('PCM range is outside sample');
      if (!['both','left','right'].includes(pan)) throw new RangeError('Invalid DAC pan');
      await send({type:'dac-play',frame:command.when===undefined?0:synth.frameAt(command.when),name,offset,size,pan},
        {...timing,...(command.when===undefined?{}:{time:command.when})});
      current(token);
    } finally {
      if (temporary && token.generation===synth.generation && token.session===synth.session && synth.isReady() && !synth.stopping && !synth.closing) {
        await synth.nativeRequest('native_genesis_media_remove',{kind:'dac',name});dacBanks.delete(name);
      }
    }
  }
  return {
    sample,dacCommand,
    async dispatchSample(message,timing={}) {
      let value;
      try {
        check();
        switch(message.action) {
          case 'load': {
            const buffer=decodedBuffer(message.pcm);
            await load('sample',nameOf(message.name),buffer.sampleRate,Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i)),banks,buffer);break;
          }
          case 'play':value=(await playSample(message.name,message.options,timing)).voice;break;
          case 'stopVoice':
            if(!Number.isSafeInteger(message.voice)||message.voice<1)throw new RangeError('Invalid native sample voice');
            await send({type:'sample-stop',frame:0,voice:message.voice},timing);break;
          case 'stop':await send({type:'sample-stop',frame:0,...(message.name==null?{}:{name:nameOf(message.name)})},timing);break;
          case 'clear':await send({type:'sample-stop',frame:0},timing);break;
          case 'unload':nameOf(message.name);banks.delete(message.name);loadTokens.delete(`sample:${message.name}`);await send({type:'sample-stop',frame:0,name:message.name},timing);await synth.nativeRequest('native_genesis_media_remove',{kind:'sample',name:message.name});break;
          default:throw new Error(`Unsupported native sample command: ${message.action}`);
        }
        return {op:'sample-response',id:message.id,value};
      } catch(error) {return {op:'sample-response',id:message.id,error:String(error.message??error)};}
    },
    loadDacBank(name,bytes) {
      check();nameOf(name);const copy=copyDacPcm(bytes);
      if (!copy.length || copy.length%5 || copy.length>MAX_BYTES) throw new RangeError('Invalid or oversized DAC stream bank');
      const view=new DataView(copy.buffer);let previous=0;
      for(let i=0;i<copy.length;i+=5){const offset=view.getUint32(i,true);if(offset<previous)throw new RangeError('DAC stream offsets must be ordered');previous=offset;}
      // Existing loadDacBank is synchronous. Queue its upload now; later plays
      // share the serialization chain, and errors stop the backend visibly.
      const pending=load('dac-stream',name,44100,[copy],packedBanks);
      pending.catch(error=>synth.reportAsyncError(error));
      return pending;
    },
    async playDacBank(name,time,timing={}) {
      check();nameOf(name);const token=capture();
      await synth.serial;current(token);
      if(!packedBanks.has(name))throw new Error(`Unknown DAC bank: ${name}`);
      await send({type:'dac-stream-play',frame:synth.frameAt(time),name},timing);
    },
    async startRecording({seconds=30}={}) {
      if (!Number.isFinite(seconds)||seconds<=0||seconds>30) throw new RangeError('Recording duration must be greater than 0 and at most 30 seconds');
      if (recording) throw new Error('Native output recording is already active');
      const token=capture(),ticket=++recordingTicket;recording=true;
      try {await synth.nativeRequest('native_genesis_record_start',{seconds});current(token);} catch(error) {
        // An accepted native start may race ordinary Stop after IPC returns.
        // Keep this controller busy until the original capture is retired;
        // otherwise a delayed cleanup could stop a replacement recording.
        if(ticket===recordingTicket)recording='cleanup';
        await discardRecording(token);
        if(ticket===recordingTicket)recording=false;throw error;
      }
    },
    async stopRecording() {
      if (recording!==true) throw new Error('Native output recording is not active');
      const token={session:synth.session},ticket=recordingTicket;recording='stopping';
      try {
        await synth.stopping?.catch(()=>{});
        if(ticket!==recordingTicket||token.session!==synth.session)throw abort();
        const ready=capture();
        const result=await synth.nativeRequest('native_genesis_record_stop');current(ready);
        const frames=result?.frames;
        if (!Number.isSafeInteger(frames)||frames<0||frames*8>32*1024*1024||!Array.isArray(result.channels)||result.channels.length!==2||
            result.channels.some(channel=>channel?.length!==frames)||!Number.isInteger(result.sampleRate)||result.sampleRate<8000||result.sampleRate>384000||
            !Number.isSafeInteger(result.firstFrame)||result.firstFrame<0) throw new Error('Invalid native recording response');
        const channels=result.channels.map(channel=>{
          for(const value of channel)if(!Number.isFinite(value))throw new Error('Invalid native recording PCM');
          const copy=Float32Array.from(channel);if (!copy.every(Number.isFinite)) throw new Error('Invalid native recording PCM');return copy;
        });
        return {...result,channels};
      } catch(error) {
        await discardRecording(token);throw error;
      } finally {if(ticket===recordingTicket)recording=false;}
    },
    stopped() {version++;},
    reset() {version++;banks.clear();dacBanks.clear();packedBanks.clear();loadTokens.clear();recording=false;recordingTicket++;},
  };
}
