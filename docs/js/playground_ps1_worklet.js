import factory from '../generated/ps1_spu_wasm.js?v=ps1-deferred-release-1';
import {Ps1Spu} from './ps1_spu.js?v=ps1-deferred-release-1';
import {Ps1Synth,createPs1InitSample} from './ps1synth.js?v=ps1-deferred-release-1';
import {Ps1Resampler} from './ps1_resampler.js?v=scsp-native-1';
import {createProcessorPerformance} from './playground_performance_processor.js?v=scsp-native-1';
import {Ps1VoiceInspector} from './playground_ps1_inspector.js?v=ps1-deferred-release-1';
import {receiveChipInspector} from './playground_chip_inspector_state.js?v=pokey-prepare-1';
const METHODS=new Set(['loadADPCM','setPreset','setChannel','setEnvelope','setReverb','setPitch','setFrequency','setNote','keyOn','keyOff','noteOn','noteOff','allNotesOff','reset','getState','getPreset','snapshot','dispose']);
const RESOURCES=new Set(['loadADPCM','getState','getPreset','snapshot']);
const INSPECTOR_METHODS=new Set(['_auditionKeyOn','_auditionKeyOff','_refreshEnvelope']);
export class Ps1InstrumentProcessor extends AudioWorkletProcessor {
  constructor({processorOptions={}}={}){
    super();this.synth=null;this.dead=false;this.remote=null;this.workerRemote=null;this.resourceRevision=0;this.bankEpoch=0;this.resourceFences=new WeakMap();
    this.validation=new Ps1Synth({core:{reset(){},loadRam(){},write(){},read(){return 0;},readRam(){return new Uint8Array(0);},renderInto(){},auditionKey(){},refreshEnvelope(){},dispose(){}}});this.renderSegment=this.renderSegment.bind(this);
    this.performance=createProcessorPerformance({chip:'ps1',apply:(data,port)=>this.apply(data,port,true),prepare:(data,port)=>{
      if(data.method==='reset'||RESOURCES.has(data.method)){this.apply(data,port);return null;}
      if(data.id===undefined)return data;const{id,...command}=data;port.postMessage({id,value:true});return command;
    },validate:({method,args=[]})=>{if(!METHODS.has(method))throw new Error('Unknown PS1 SPU method');if(method==='reset'){const options=args[0]===undefined?{}:args[0];if(!options||typeof options!=='object'||Array.isArray(options)||Reflect.ownKeys(options).some(key=>key!=='clearRam'))throw new TypeError('Invalid PS1 reset options');if(options.clearRam!==undefined&&typeof options.clearRam!=='boolean')throw new TypeError('clearRam must be boolean');return;}if(!RESOURCES.has(method)&&method!=='dispose')this.validation[method](...args);}});
    this.port.onmessage=({data})=>{
      if(data?.primaryWorker){this.workerRemote?.close();this.workerRemote=null;if(data.port){if(this.dead){data.port.close();return;}const remote=this.workerRemote=data.port;remote.onmessage=event=>{if(this.workerRemote===remote)this.receive(event.data,remote);};remote.start();this.sendResources(remote);}return;}
      if(data?.method==='dispose'){this.dispose();return;}
      if(data?.port){if(this.dead){data.port.close();return;}this.remote?.close();const remote=this.remote=data.port;remote.onmessage=event=>{if(this.remote===remote)this.receive(event.data,remote);};remote.start();this.sendResources(remote);}else this.receive(data,this.port);
    };
    this.ready=Ps1Spu.create({moduleFactory:factory,moduleOptions:{wasmBinary:processorOptions.wasmBinary,locateFile:()=> 'ps1_spu_wasm.wasm'}}).then(core=>{
      if(this.dead){core.dispose();return;}this.synth=new Ps1Synth({core});
      const {adpcm,...options}=createPs1InitSample(),sample=this.synth.loadADPCM(adpcm,options);this.validation.loadADPCM(adpcm,options);
      for(let ch=0;ch<24;ch++){this.synth.setPreset(ch,{sample});this.validation.setPreset(ch,{sample});}
      this.inspector=new Ps1VoiceInspector(this.synth,{sampleRate,dispatch:(command,owner,metadata)=>this.performance.applyImmediate(command,this.port,{...metadata,owner}),beginAudition:(ch,owner)=>this.performance.beginAudition(ch,owner),endAudition:(ch,owner)=>this.performance.endAudition(ch,owner),onResourcesChanged:()=>this.resourcesChanged()});
      this.resampler=new Ps1Resampler(this.synth,sampleRate);this.port.postMessage({ready:true,sampleRate,nativeSampleRate:44100,state:this.synth.getState()});
    }).catch(error=>this.fail(error));
  }
  receive(data,port){
    if(data?.type==='chip-inspector'&&receiveChipInspector(data,port,this.inspector?(action,method,args)=>action==='read'?this.inspector.read():this.inspector.invoke(method,args):null))return;
    const stopping=data?.type==='performance-stop'&&Number.isSafeInteger(data.session)&&data.session>0&&data.session>=this.performance.getStats().latestSession;
    if(data?.method==='stopVoices'||stopping){this.stopVoices();if(stopping)this.performance.receive(data,port);if(data.id!==undefined)port.postMessage({id:data.id,value:true});return;}
    // Reset prepares the sample bank immediately, before later uploads or
    // reserved notes. A plain Main reset also retires manual audition leases.
    if(data?.method==='reset'&&!data.performance){this.apply(data,port);return;}
    if(this.performance.receive(data,port))return;this.apply(data,port);
  }
  sendResources(port){if(this.dead||!this.synth||!port)return;port.postMessage({type:'ps1-resources',revision:this.resourceRevision,bankEpoch:this.bankEpoch,resourceFence:this.resourceFences.get(port)??0,resources:this.synth._getResources()});}
  resourcesChanged(){this.validation._adoptResources(this.synth._getResources());this.resourceRevision++;for(const port of new Set([this.port,this.remote,this.workerRemote]))this.sendResources(port);}
  stopVoices(){this.inspector?.resetAuditions();this.performance.clear();this.synth?.stopVoices();this.resampler?.reset(this.synth.core.nativeFrames);}
  apply({method,args=[],id,resourceFence},port,queued=false){
    try{if(method==='dispose'){this.dispose();return;}if(this.dead||!this.synth)throw new Error('PS1 SPU instrument is not ready');if(!METHODS.has(method)&&!INSPECTOR_METHODS.has(method))throw new Error('Unknown PS1 SPU method');
      if(method==='reset'){this.inspector.resetAuditions();this.performance.clear();}
      const value=this.synth[method](...args);if(method==='loadADPCM')this.resourcesChanged();else if(!queued&&!RESOURCES.has(method))this.validation[method](...args);
      if(method==='reset'){if(Number.isSafeInteger(resourceFence)&&resourceFence>=0)this.resourceFences.set(port,resourceFence);if(args[0]?.clearRam)this.bankEpoch++;this.resourcesChanged();}
      if(method==='reset')this.resampler.reset(this.synth.core.nativeFrames);if(id!==undefined)port.postMessage({id,value});
    }catch(error){port.postMessage({id,error:String(error.message??error),name:error.name});}
  }
  fail(error){if(this.dead)return;const message={fatal:true,error:String(error.message??error)};this.port.postMessage(message);this.remote?.postMessage(message);this.workerRemote?.postMessage(message);this.dispose();}
  dispose(){if(this.dead)return;this.dead=true;this.inspector?.resetAuditions();this.performance.clear();this.synth?.dispose();this.synth=null;this.remote?.close();this.workerRemote?.close();}
  renderSegment(left,right){if(!this.synth){left.fill(0);right.fill(0);return;}this.resampler.render(left,right);}
  process(_inputs,outputs){const[left,right]=outputs[0];if(this.dead){left.fill(0);right.fill(0);return false;}try{this.performance.render(left,right,this.renderSegment);return true;}catch(error){left.fill(0);right.fill(0);this.fail(error);return false;}}
}
registerProcessor('tetorica-playground-ps1',Ps1InstrumentProcessor);
