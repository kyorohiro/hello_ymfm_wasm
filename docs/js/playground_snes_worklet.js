import factory from '../generated/spc_wasm.js?v=spc-events-1';
import {SnesDspCore} from './spc.js?v=spc-events-1';
import {SnesSynth} from './snessynth.js?v=spc-song-js-1';
import {SpcResampler} from './spc_resampler.js?v=chip-tabs-2';
import {createProcessorPerformance} from './playground_performance_processor.js?v=ps1-deferred-release-1';
import {SnesVoiceInspector} from './playground_snes_inspector.js?v=y8950-adpcm-ui-1';
import {receiveChipInspector} from './playground_chip_inspector_state.js?v=pokey-prepare-1';
const METHODS=new Set(['prepareTimeline','playTimeline','stopTimeline','getTimelineState','loadBRR','setPreset','setChannel','setPitch','setFrequency','setNote','keyOn','keyOff','noteOn','noteOff','allNotesOff','reset','writeDsp','readDsp','getState','getPreset','snapshot','dispose']);
const RESOURCE_METHODS=new Set(['prepareTimeline','stopTimeline','getTimelineState','loadBRR','readDsp','getState','getPreset','snapshot']);
export class SnesInstrumentProcessor extends AudioWorkletProcessor {
  constructor({processorOptions={}}={}) {
    super();this.synth=null;this.dead=false;this.remote=null;this.timelineCompletion=null;
    this.validation=new SnesSynth({core:{reset(){},loadRam(){},writeDsp(){},dispose(){}}});
    this.renderSegment=this.renderSegment.bind(this);
    this.performance=createProcessorPerformance({chip:'snes',apply:(data,port)=>this.apply(data,port,true),
      prepare:(data,port)=>{
        if(RESOURCE_METHODS.has(data.method)){this.apply(data,port);return null;}
        if(data.method==='playTimeline'||data.id===undefined)return data;
        const {id,...command}=data;port.postMessage({id,value:true});return command;
      },validate:({method,args=[]})=>{
        if(!METHODS.has(method))throw new Error('Unknown SNES method');
        if(['prepareTimeline','playTimeline','stopTimeline','getTimelineState'].includes(method))return;
        if(method==='dispose'||['getState','snapshot','readDsp','getPreset'].includes(method))return;
        if(method!=='loadBRR')this.validation[method](...args);
      }});
    this.port.onmessage=({data})=>{
      if(data?.primaryWorker){
        this.workerRemote?.close();this.workerRemote=null;
        if(data.port){
          if(this.dead){data.port.close();return;}
          const remote=this.workerRemote=data.port;remote.onmessage=event=>{if(this.workerRemote===remote)this.receive(event.data,remote);};remote.start();
        }
        return;
      }
      if(data?.method==='dispose'){this.dispose();return;}
      if(data?.port){this.remote=data.port;const remote=this.remote;remote.onmessage=event=>this.receive(event.data,remote);remote.start();}
      else this.receive(data,this.port);
    };
    this.ready=SnesDspCore.create({moduleFactory:factory,moduleOptions:{wasmBinary:processorOptions.wasmBinary}}).then(core=>{
      if(this.dead){core.dispose();return;}
      this.synth=new SnesSynth({core});
      this.inspector=new SnesVoiceInspector(this.synth,{sampleRate,
        dispatch:(command,owner)=>this.performance.applyImmediate(command,this.port,{owner}),
        beginAudition:(channel,owner)=>this.performance.beginAudition(channel,owner),endAudition:(channel,owner)=>this.performance.endAudition(channel,owner)});
      this.instrumentResampler=new SpcResampler(this.synth,sampleRate,{sourceFrames:1});
      this.timelineResampler=new SpcResampler(this.synth,sampleRate,{sourceFrames:128});
      this.resampler=this.instrumentResampler;
      this.port.postMessage({ready:true,sampleRate,nativeSampleRate:32000});
    }).catch(error=>this.fail(error));
  }
  receive(data,port){
    if(data?.type==='chip-inspector'&&receiveChipInspector(data,port,this.inspector?(action,method,args)=>action==='read'?this.inspector.read():this.inspector.invoke(method,args):null))return;
    const stopping=data?.type==='performance-stop'&&Number.isSafeInteger(data.session)&&data.session>0&&data.session>=this.performance.getStats().latestSession;
    if(data?.method==='stopVoices'||stopping){this.stopVoices();if(stopping)this.performance.receive(data,port);if(data.id!==undefined)port.postMessage({id:data.id,value:true});return;}
    if(data?.type==='performance-stop'&&this.performance.getStats().activeSession===data.session){
      this.synth?.stopTimeline();
      if(this.synth?.timeline)this.resampler.reset(this.synth.core.nativeFrames);
      this.finishTimeline('SNES performance stopped');
    }
    if(this.performance.receive(data,port))return;this.apply(data,port);
  }
  stopVoices(){
    this.inspector?.resetAuditions();this.performance.clear();if(!this.synth)return;
    this.finishTimeline('SNES performance stopped');
    if(this.synth.timeline){this.synth.stopTimeline();this.resampler.reset(this.synth.core.nativeFrames);return;}
    // KOFF leaves a hardware release tail. Stop resets DSP execution, then
    // restores applied RAM/register settings without retriggering any channel.
    const {ram,dsp}=this.synth.snapshot();this.synth.core.reset();this.synth.core.loadRam(ram);
    for(let register=0;register<128;register++)if(![0x4c,0x5c].includes(register)&&(register&15)!==8&&(register&15)!==9)this.synth.core.writeDsp(register,dsp[register]);
    this.synth.pendingKon=0;this.synth.koff=255;this.synth.konFrame=-1;this.inspector.gates=0;this.synth.core.writeDsp(0x4c,0);this.synth.core.writeDsp(0x5c,255);this.resampler.reset(this.synth.core.nativeFrames);
  }
  apply({method,args=[],id},port,queued=false) {
    try {
      if(method==='dispose'){this.dispose();return;}
      if(this.dead||!this.synth)throw new Error('SNES instrument is not ready');
      if(!METHODS.has(method))throw new Error('Unknown SNES method');
      if(['prepareTimeline','playTimeline','stopTimeline','reset'].includes(method)){
        this.synth.stopTimeline();this.finishTimeline('SNES timeline stopped or replaced');
      }
      const value=this.synth[method](...args);
      if(method==='stopTimeline'&&this.synth.timeline)this.resampler.reset(this.synth.core.nativeFrames);
      if(method==='prepareTimeline'){
        this.performance.clear();this.resampler=this.timelineResampler;this.resampler.reset();
      }
      if(method==='playTimeline'){
        this.resampler.reset();
        if(id!==undefined)this.timelineCompletion={id,port};
        return;
      }
      if(method==='loadBRR')this.validation.loadBRR(...args);
      else if(!queued&&!RESOURCE_METHODS.has(method))this.validation[method](...args);
      if(method==='reset'){this.resampler=this.instrumentResampler;this.resampler.reset();}
      if(id!==undefined)port.postMessage({id,value});
    }catch(error){port.postMessage({id,error:String(error.message??error),name:error.name});}
  }
  finishTimeline(message){
    const pending=this.timelineCompletion;if(!pending)return;this.timelineCompletion=null;
    if(message)pending.port.postMessage({id:pending.id,error:message,name:'AbortError'});
    else pending.port.postMessage({id:pending.id,value:this.synth.getTimelineState()});
  }
  fail(error){if(this.dead)return;const message={fatal:true,error:String(error.message??error)};this.port.postMessage(message);this.remote?.postMessage(message);this.workerRemote?.postMessage(message);this.dispose();}
  dispose(){if(this.dead)return;this.dead=true;this.inspector?.resetAuditions();this.finishTimeline('SNES instance disposed');this.performance.clear();this.synth?.dispose();this.synth=null;this.remote?.close();this.workerRemote?.close();}
  renderSegment(left,right){
    if(!this.synth){left.fill(0);right.fill(0);return;}this.resampler.render(left,right);
    if(this.timelineCompletion){
      const timeline=this.synth.timeline;
      if(timeline&&!timeline.playing&&this.resampler.playbackNativeFrames>=timeline.totalFrames)this.finishTimeline();
    }
  }
  process(_inputs,outputs){const[left,right]=outputs[0];if(this.dead){left.fill(0);right.fill(0);return false;}try{this.performance.render(left,right,this.renderSegment);return true;}catch(error){left.fill(0);right.fill(0);this.fail(error);return false;}}
}
registerProcessor('tetorica-playground-snes',SnesInstrumentProcessor);
