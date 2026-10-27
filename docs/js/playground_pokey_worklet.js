import {Pokey} from './pokey.js?v=pokey-mode-1';
import {PokeyAudioEngine} from './pokeyaudioengine.js?v=pokey-mode-1';
import factory from '../generated/pokey_wasm.js';
import {createProcessorPerformance,performanceNoteRelease} from './playground_performance_processor.js?v=pokey-mode-1';
import {PokeyVoiceInspector} from './playground_pokey_inspector.js?v=pokey-mode-1';
import {receiveChipInspector} from './playground_chip_inspector_state.js?v=pokey-prepare-1';
import {POKEY_TIMELINE_CHUNK_BYTES,POKEY_TIMELINE_VALIDATE_WRITES_PER_QUANTUM,createPokeyTimelineUpload,createPokeyChunkTimelineCursor} from './pokey_timeline_upload.js?v=pokey-prepare-1';

const timelineMethods=new Set(['beginTimelineUpload','appendTimelineChunk','commitTimelineUpload','abortTimelineUpload','prepareTimeline','playTimeline','stopTimeline','getTimelineState']);

class Processor extends AudioWorkletProcessor{
  constructor({processorOptions:{clock=1789790,wasmBinary}}){
    super();this.clock=clock;this.chip=null;this.speaker=null;this.dead=false;
    this.timelineData=null;this.timelineCursor=null;this.timelineCompletion=null;this.timelineUpload=null;this.timelineToken=0;this.timelinePositionSamples=0;this.timelineEnded=false;this.timelineCancelled=false;this.renderedFrame=0;this.applyTimelineWrite=this.writeRegister.bind(this);
    this.performance=createProcessorPerformance({validate:data=>{this.validateCommand(data);},chip:'pokey',getPokeyRegisters:()=>this.speaker?.registers,immediate:['stopVoices','readRegister','setChannelMuted'],
      prepare:(data,port,metadata)=>{if(timelineMethods.has(data.method)||['stopVoices','readRegister','setChannelMuted'].includes(data.method)){this.apply(data,port,undefined,metadata);return null;}if(data.id===undefined)return data;const {id,...command}=data;port.postMessage({id,value:true});return command;},
      releaseNote:key=>performanceNoteRelease('pokey',key),apply:(data,port,frame,metadata)=>this.apply(data,port,frame,metadata)});
    this.renderSegment=this.renderSegment.bind(this);
    this.port.onmessage=({data})=>{
      if(data.primaryWorker){if(this.workerRemote)this.cancelTimeline('POKEY Worker port replaced');this.workerRemote?.close();this.workerRemote=null;if(data.port){if(this.dead){data.port.close();return;}const remote=this.workerRemote=data.port;remote.onmessage=event=>{if(this.workerRemote===remote)this.receive(event.data,remote);};remote.start();}return;}
      if(data.type==='detach-chip-port'){this.cancelTimeline('POKEY port detached');this.remote?.close();this.remote=null;this.inspector?.invoke('auditionAllOff');this.performance.clear();this.stopVoices();return;}
      if(data.port){if(this.remote)this.cancelTimeline('POKEY port replaced');this.remote?.close();if(this.dead){data.port.close();return;}const remote=this.remote=data.port;remote.onmessage=event=>{if(this.remote===remote)this.receive(event.data,remote);};remote.start();}
      else this.receive(data,this.port);
    };
    Pokey.create({moduleFactory:factory,moduleOptions:{wasmBinary},clock,sampleRate}).then(chip=>{
      if(this.dead){chip.dispose();return;}this.chip=chip;chip.reserveFrames(128);this.speaker=new PokeyAudioEngine(chip,1);
      this.inspector=new PokeyVoiceInspector({clock:()=>this.clock,sampleRate,dispatch:(command,owner,metadata)=>this.performance.applyImmediate(command,this.port,{owner,...metadata}),
        beginAudition:(channel,owner)=>{if(this.timelineCursor)throw new Error('Stop the POKEY timeline before manual audition');this.performance.beginAudition(channel,owner);},endAudition:(channel,owner)=>this.performance.endAudition(channel,owner)});
      this.port.postMessage({ready:true});
    }).catch(error=>{this.dispose();this.port.postMessage({error:error.message});});
  }
  dispose(){if(this.dead)return;this.cancelTimeline('POKEY instance disposed');this.inspector?.resetAuditions();this.performance.clear();this.dead=true;this.speaker?.dispose();this.chip=null;this.speaker=null;this.remote?.close();this.workerRemote?.close();}
  publishState(){this.port.postMessage({type:'pokey-state',state:this.inspector.getState()});}
  receive(data,port=this.port){
    if(Array.isArray(data)){for(const command of data)this.receive(command,port);return;}
    if(data?.type==='chip-inspector'){receiveChipInspector(data,port,this.inspector?(action,method,args)=>{if(action!=='read'&&this.timelineCursor)throw new Error('Stop the POKEY timeline before editing its voices');const value=action==='read'?this.inspector.read():this.inspector.invoke(method,args);if(action!=='read')this.publishState();return value;}:null);return;}
    const stopping=data?.type==='performance-stop'&&Number.isSafeInteger(data.session)&&data.session>0&&data.session>=this.performance.getStats().latestSession;
    const replacing=data?.type==='performance-start'&&Number.isSafeInteger(data.session)&&data.session>this.performance.getStats().latestSession;
    const cancelling=data?.type==='performance-cancel-owner'&&data.session===this.performance.getStats().activeSession;
    if(stopping||replacing)this.cancelTimeline('POKEY performance stopped');
    if(cancelling){if(this.timelineUpload?.metadata?.session===data.session&&this.timelineUpload.metadata.owner===data.owner)this.cancelTimelineUpload('POKEY performance owner cancelled');if(this.timelineCompletion?.metadata?.session===data.session&&this.timelineCompletion.metadata.owner===data.owner)this.cancelTimeline('POKEY performance stopped');}
    if(['reset','stopTimeline','stopVoices','allNotesOff','dispose'].includes(data?.method)||data?.type==='clear-scheduled-writes')this.cancelTimelineUpload('POKEY timeline preparation cancelled');
    if(stopping||data?.method==='stopVoices')this.inspector?.invoke('auditionAllOff');
    if(this.performance.receive(data,port)){if(stopping){this.stopVoices();this.performance.clear();}return;}
    this.apply(data,port);
  }
  writeRegister(register,value){this.speaker.writePokey(register,value);this.inspector?.observeWrite(register,value);}
  forceKeyOff(channel){if(!Number.isInteger(channel)||channel<0||channel>3)throw new RangeError('POKEY channel must be 0..3');this.writeRegister(channel*2+1,this.speaker.registers[channel*2+1]&240);}
  stopVoices(){if(!this.chip)return;for(let ch=0;ch<4;ch++)this.forceKeyOff(ch);}
  nowFrame(){return Number.isSafeInteger(globalThis.currentFrame)?globalThis.currentFrame:this.renderedFrame;}
  timelineState(){const position=this.timelineCursor?Math.max(0,Math.min(this.timelineData.durationSamples,Math.floor((this.nowFrame()-this.timelineStartFrame)*44100/sampleRate))):this.timelinePositionSamples,upload=this.timelineUpload;return {loaded:!!this.timelineData,playing:!!this.timelineCursor,preparing:!!upload,bytesReceived:upload?.validation.receivedBytes??0,bytesValidated:upload?.validation.validatedBytes??0,ended:this.timelineEnded,cancelled:this.timelineCancelled,positionSamples:position,durationSamples:this.timelineData?.durationSamples??0,token:this.timelineToken,startFrame:this.timelineStartFrame??0,currentFrame:this.nowFrame(),sampleRate};}
  finishTimeline(message){
    const completion=this.timelineCompletion;this.timelineCompletion=null;
    if(completion?.id!==undefined)completion.port.postMessage(message?{id:completion.id,error:message,name:'AbortError'}:{id:completion.id,value:{...this.timelineState(),state:this.inspector.getState()}});
  }
  cancelTimelineUpload(message){const upload=this.timelineUpload;if(!upload)return;this.timelineUpload=null;const pending=upload.pending;upload.pending=null;if(pending?.id!==undefined)pending.port.postMessage({id:pending.id,error:message,name:'AbortError'});}
  cancelTimeline(message){this.cancelTimelineUpload(message);if(!this.timelineCursor&&!this.timelineCompletion)return;this.timelinePositionSamples=this.timelineState().positionSamples;this.timelineCursor=null;this.timelineCancelled=true;this.timelineEnded=false;this.stopVoices();this.finishTimeline(message);}
  assertTimelineAdmission(){if(this.timelineCursor)throw new Error('POKEY timeline is busy');if(this.inspector.auditions.size)throw new Error('POKEY is held by a manual audition');}
  uploadIdentity(data,port,metadata){const upload=this.timelineUpload,id=data.args?.[0]?.uploadId;if(!upload||upload.uploadId!==id||upload.port!==port||upload.metadata?.session!==metadata?.session||upload.metadata?.owner!==metadata?.owner)throw new Error('POKEY timeline upload identity does not match');return upload;}
  beginTimelineUpload(header,port,metadata,legacy=false){
    this.assertTimelineAdmission();if(this.timelineUpload)throw new Error('POKEY timeline preparation is busy');
    if(!legacy&&(!Number.isSafeInteger(header?.uploadId)||header.uploadId<1))throw new TypeError('POKEY timeline upload ID must be a positive safe integer');
    const validation=createPokeyTimelineUpload(header,{sampleRate});if(header.clock!==this.clock)throw new Error('POKEY timeline clock must match its instance');
    return this.timelineUpload={uploadId:header.uploadId,port,metadata:metadata?{session:metadata.session,owner:metadata.owner}:undefined,validation,pending:null,legacy};
  }
  commitTimelineUpload(upload){this.assertTimelineAdmission();const prepared=upload.validation.finish();this.timelineUpload=null;this.timelineData=prepared;this.timelinePositionSamples=0;this.timelineEnded=false;this.timelineCancelled=false;this.timelineStartFrame=0;return this.timelineState();}
  advanceTimelineUpload(){
    const upload=this.timelineUpload;if(!upload?.pending)return;
    try{
      const progress=upload.validation.step(POKEY_TIMELINE_VALIDATE_WRITES_PER_QUANTUM);if(!progress.chunkDone)return;
      const pending=upload.pending;
      const value=upload.legacy?this.commitTimelineUpload(upload):{uploadId:upload.uploadId,...progress};
      upload.pending=null;
      if(pending.id!==undefined)pending.port.postMessage({id:pending.id,value});
    }catch(error){const pending=upload.pending;upload.pending=null;if(this.timelineUpload===upload)this.timelineUpload=null;if(pending?.id!==undefined)pending.port.postMessage({id:pending.id,error:error.message,name:error.name});}
  }
  validateCommand(data){
    if((data.method==='clock'||data.type==='chip-clock')&&(data.clock??data.args?.[0])!==this.clock)throw new Error('Create a new POKEY instance to change its clock');
    if(this.timelineCursor&&!timelineMethods.has(data.method)&&!['readRegister','setChannelMuted','stopVoices','reset','allNotesOff','dispose'].includes(data.method)&&data.type!=='clear-scheduled-writes')throw new Error('Stop/reset the POKEY timeline before editing its voices');
  }
  apply(data,port=this.port,frame,metadata){
    try{
      if(data.method==='dispose'){this.dispose();return;}if(!this.chip)throw new Error('POKEY not ready');let value=true;
      if(data.method==='beginTimelineUpload'){
        const upload=this.beginTimelineUpload(data.args?.[0],port,metadata);value={uploadId:upload.uploadId};
      }else if(data.method==='appendTimelineChunk'){
        const upload=this.uploadIdentity(data,port,metadata),chunk=data.args[0];
        if(upload.pending)throw new Error('POKEY timeline chunk validation is busy');if(chunk.offset!==upload.validation.receivedBytes)throw new Error('POKEY timeline chunk offset does not match');
        try{upload.validation.append(chunk.data);}catch(error){this.timelineUpload=null;throw error;}upload.pending={id:data.id,port};return;
      }else if(data.method==='commitTimelineUpload'){
        const upload=this.uploadIdentity(data,port,metadata);if(upload.pending)throw new Error('POKEY timeline chunk validation is busy');value=this.commitTimelineUpload(upload);
      }else if(data.method==='abortTimelineUpload'){
        const upload=this.uploadIdentity(data,port,metadata);this.cancelTimelineUpload('POKEY timeline preparation aborted');value={uploadId:upload.uploadId};
      }else if(data.method==='prepareTimeline'){
        const trace=data.args?.[0];if(trace?.data?.byteLength>POKEY_TIMELINE_CHUNK_BYTES)throw new RangeError('POKEY bulk timeline preparation exceeds the 16 KiB limit; use a chunk upload');
        const upload=this.beginTimelineUpload({version:trace?.version,clock:trace?.clock,durationSamples:trace?.durationSamples,byteLength:trace?.data?.byteLength},port,metadata,true);
        try{if(!(trace.data instanceof Uint8Array))throw new TypeError('POKEY timeline: expected Uint8Array data');if(trace.data.byteLength)upload.validation.append(trace.data);upload.pending={id:data.id,port};return;}catch(error){this.timelineUpload=null;throw error;}
      }else if(data.method==='getTimelineState')value=this.timelineState();
      else if(data.method==='playTimeline'){
        this.assertTimelineAdmission();if(this.timelineUpload)throw new Error('POKEY timeline preparation is incomplete');if(!this.timelineData)throw new Error('Prepare a POKEY timeline before playback');
        const options=data.args?.[0]??{};if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>key!=='startFrame'))throw new TypeError('Invalid POKEY timeline playback options');
        const now=this.nowFrame(),startFrame=options.startFrame??(metadata?Math.round(metadata.time*sampleRate):now),cursor=createPokeyChunkTimelineCursor(this.timelineData,sampleRate);
        if(!Number.isSafeInteger(startFrame)||startFrame<now||!Number.isSafeInteger(startFrame+cursor.durationFrames))throw new RangeError('POKEY timeline start frame is invalid or late');
        this.performance.clear();this.stopVoices();this.timelineCursor=cursor;this.timelineStarted=false;this.timelineStartFrame=startFrame;this.timelineEndFrame=startFrame+cursor.durationFrames;this.timelinePositionSamples=0;this.timelineEnded=false;this.timelineCancelled=false;this.timelineToken++;this.timelineCompletion={id:data.id,port,metadata};return;
      }else if(data.method==='stopTimeline'){this.cancelTimeline('POKEY timeline stopped');value=this.timelineState();}
      else {
      this.validateCommand(data);
      if(data.method==='clock'||data.type==='chip-clock'){
        if((data.clock??data.args?.[0])!==this.clock)throw new Error('Create a new POKEY instance to change its clock');
      }else if(data.method==='stopVoices'){this.cancelTimeline('POKEY timeline stopped');this.inspector?.invoke('auditionAllOff');this.performance.clear();this.stopVoices();}
      else if(data.method==='reset'){this.cancelTimeline('POKEY timeline reset');this.timelineData=null;this.timelinePositionSamples=0;this.speaker.reset();this.inspector?.reset();}
      else if(data.method==='writeRegister')this.writeRegister(...data.args);
      else if(data.method==='forceKeyOff'||data.method==='keyOff')this.forceKeyOff(data.args[0]);
      else if(data.method==='setChannelMuted')value=this.speaker.setChannelMuted(...data.args);
      else if(data.method==='readRegister')value=this.chip.readRegister(...data.args);
      else if(data.method==='barrier'){}
      else if(data.method==='setRetainedLevel'){
        const [ch,level]=data.args;if(!Number.isInteger(ch)||ch<0||ch>3||!Number.isInteger(level)||level<0||level>15)throw new RangeError('Invalid POKEY retained level');this.inspector.levels[ch]=level;
      }else if(data.method==='allNotesOff'){this.cancelTimeline('POKEY timeline stopped');this.stopVoices();}
      else if(data.type==='clear-scheduled-writes'){this.cancelTimeline('POKEY timeline cancelled');this.performance.clear();}
      else throw new Error(`Unsupported POKEY command: ${data.method??data.type}`);
      }
      if(data.id!==undefined)port.postMessage({type:data.type==='chip-clock'?'chip-clock-result':undefined,id:data.id,value});
    }catch(error){if(data.id!==undefined)port.postMessage({type:data.type==='chip-clock'?'chip-clock-result':undefined,id:data.id,error:error.message,name:error.name});}
  }
  process(inputs,outputs){if(this.dead)return false;const [left,right]=outputs[0];this.advanceTimelineUpload();this.performance.render(left,right,this.renderSegment);return true;}
  renderSegment(left,right,frame=this.renderedFrame){
    if(!this.speaker){left.fill(0);right.fill(0);return;}let offset=0;
    while(offset<left.length){
      const cursor=this.timelineCursor,absolute=frame+offset;
      if(cursor&&absolute>=this.timelineStartFrame){
        if(!this.timelineStarted){let muteMask=0;for(let ch=0;ch<4;ch++)if(this.speaker.mutedChannels[ch])muteMask|=1<<ch;this.speaker.reset();for(let ch=0;ch<4;ch++)if(muteMask&(1<<ch))this.speaker.setChannelMuted(ch,true);this.inspector.reset();this.timelineStarted=true;}
        const relative=absolute-this.timelineStartFrame;cursor.advance(relative,this.applyTimelineWrite);
        if(relative>=cursor.durationFrames){this.timelineCursor=null;this.timelinePositionSamples=this.timelineData.durationSamples;this.timelineEnded=true;this.timelineCancelled=false;this.stopVoices();this.finishTimeline();continue;}
      }
      const next=this.timelineCursor?(absolute<this.timelineStartFrame?this.timelineStartFrame:this.timelineStartFrame+Math.min(cursor.nextFrame(),cursor.durationFrames)):Infinity;
      const count=Math.min(left.length-offset,Math.max(1,next-absolute)),pcm=this.speaker.generateStereoView(count);left.set(pcm.left,offset);right.set(pcm.right,offset);offset+=count;this.renderedFrame=frame+offset;
    }
    // Complete at the exact end boundary, without waiting for another quantum.
    if(this.timelineCursor&&frame+left.length>=this.timelineEndFrame){this.timelineCursor.advance(this.timelineCursor.durationFrames,this.applyTimelineWrite);this.timelineCursor=null;this.timelinePositionSamples=this.timelineData.durationSamples;this.timelineEnded=true;this.timelineCancelled=false;this.stopVoices();this.finishTimeline();}
  }
}
registerProcessor('tetorica-pokey',Processor);
