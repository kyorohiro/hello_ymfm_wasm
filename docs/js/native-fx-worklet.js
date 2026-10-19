import {NativeFXEngine} from './native_fx_engine.js?v=audio-stability-2';
/** Browser AudioWorklet: one WASM graph for all Playground FX. */
import {setChain} from './native_fx_graph.js';
import {createPerformanceQueue} from './playground_performance_queue.js';
export class NativeFXProcessor extends AudioWorkletProcessor {
 constructor(options){
  super();this.engine=new NativeFXEngine(options.processorOptions.module,sampleRate);this.active=true;
  this.emptySource=[];this.reportError=error=>this.port.postMessage({error});
  this.renderFrame=0;this.segmentCapacity=0;this.segmentViews=new Map();this.noiseOwners=new Map();
  this.replyMain=message=>this.port.postMessage(message);
  this.performanceQueue=createPerformanceQueue({sampleRate,
   nowFrame:()=>typeof currentFrame==='number'?currentFrame:this.renderFrame,
   apply:(command,reply,_frame,performance)=>this.applyCommand(command,reply,performance),
   prepare:(command,reply,performance)=>this.preparePerformanceCommand(command,reply,performance),
   onDiscard:command=>{if(command.op==='sample'&&command.action==='startReserved')this.samples.cancelReservation(command.voice);},
   onCancelOwner:(owner,session)=>{
    this.samples.stopOwner(owner,session);
    for(const [slot,voice] of this.noiseOwners)if(voice.owner===owner&&voice.session===session){
     this.engine.command({op:'noise',action:'stop',slot,token:voice.token});this.noiseOwners.delete(slot);
    }
   },
  });
  this.port.onmessage=({data})=>{
   if(data.type==='performance-stats'){this.port.postMessage({type:'performance-stats',id:data.id,...this.performanceQueue.getStats()});return;}
   if(['performance-start','performance-stop','performance-cancel-owner'].includes(data.type)){this.receive(data,this.replyMain);return;}
   if(data.op==='fx-monitor'){
    this.monitor=null;
    if(data.enabled){
     const names=[...this.liveFX.effects.keys()];
     const name=names.includes(data.name)?data.name:names[0];
     if(!name)this.port.postMessage({op:'fx-monitor',id:data.id,names});
     else this.monitor={id:data.id,name,names,channel:data.channel===1?1:0,input:new Float32Array(2048),output:new Float32Array(2048),offset:0};
    }
   }else if(data.op==='attach'){
    this.invalidatePerformance();
    this.controlPort?.close();this.controlPort=data.port;this.active=false;
    this.samples.reset();this.resetNoise();this.reset();const port=this.controlPort;const reply=message=>port.postMessage(message);
    port.onmessage=({data})=>{if(this.controlPort===port)this.receive(data,reply);};port.start();
   }else if(data.op==='main'){this.invalidatePerformance();this.controlPort?.close();this.controlPort=null;this.active=true;this.samples.reset();this.resetNoise();this.reset();}
   else if(data.op==='emergency'){this.invalidatePerformance();this.liveFX.clear();this.cancelMonitor();this.samples.clear();this.resetNoise();setChain(this.api,[]);this.api.graph_clear();this.ramps.clear();}
   else if(this.active)this.receive(data,this.replyMain);
  };
  // Offline rendering can finish before port messages arrive. Seed its graph
  // synchronously when constructing the processor; live controls still use ports.
  for(const command of options.processorOptions.initialCommands??[])this.command(command);
 }
 // One requested window at a time: no unsolicited stream or unbounded queue.
 observeFX=(name,input,output)=>{
  const m=this.monitor;if(!m||m.name!==name)return;
  const ch=Math.min(m.channel,input.length-1);
  const count=Math.min(input[ch].length,m.input.length-m.offset);
  m.input.set(input[ch].subarray(0,count),m.offset);
  m.output.set(output[ch].subarray(0,count),m.offset);m.offset+=count;
  if(m.offset===m.input.length){
   this.monitor=null;
   this.port.postMessage({op:'fx-monitor',id:m.id,name:m.name,names:m.names,rate:sampleRate,input:m.input,output:m.output},[m.input.buffer,m.output.buffer]);
  }
 };
 cancelMonitor(){
  if(this.monitor)this.port.postMessage({op:'fx-monitor',id:this.monitor.id,names:[...this.liveFX.effects.keys()]});
  this.monitor=null;
 }
 get api(){return this.engine.api;}
 get liveFX(){return this.engine.liveFX;}
 get samples(){return this.engine.samples;}
 get ramps(){return this.engine.ramps;}
 get beatSeconds(){return this.engine.beatSeconds;}
 resetNoise(){this.noiseOwners.clear();this.engine.resetNoise();}
 reset(){this.cancelMonitor();this.engine.reset();}

 invalidatePerformance(){
  const session=this.performanceQueue.getStats().latestSession;
  if(session)this.performanceQueue.receive({type:'performance-stop',session});else this.performanceQueue.clear();
 }
 preparePerformanceCommand(command,reply,performance){
  if(command.op!=='sample')return command;
  if(command.action==='load'){
   try{this.applyCommand(command,reply);}catch(error){if(command.id)reply?.({op:'sample-response',id:command.id,error:error.message});else throw error;}
   return null;
  }
  if(command.action!=='play')return command;
  try{
   const voice=this.samples.reserve(command,performance);
   if(command.id)reply?.({op:'sample-response',id:command.id,value:voice});
   return {op:'sample',action:'startReserved',voice};
  }catch(error){
   if(command.id)reply?.({op:'sample-response',id:command.id,error:error.message});
   else throw error;
   return null;
  }
 }
 receive(data,reply=message=>(this.controlPort??this.port).postMessage(message)){
  try{
   if(data?.performance&&data.commands?.some(command=>command.op==='sample'&&command.id!==undefined)){
    const pending=new Set(data.commands.filter(command=>command.op==='sample'&&command.id!==undefined).map(command=>command.id));
    const respond=reply;
    reply=message=>{
     if(message.op==='sample-response')pending.delete(message.id);
     respond?.(message);
     if(message.type==='performance-error'){
      for(const id of pending)respond?.({op:'sample-response',id,error:message.error});
      pending.clear();
     }
    };
   }
   if(this.performanceQueue.receive(data,reply))return;
   if(data.op==='reset')this.invalidatePerformance();
   this.applyCommand(data,reply);
  }catch(error){if(data.op==='sample'&&data.id)reply?.({op:'sample-response',id:data.id,error:error.message});else this.port.postMessage({error:error.message});}
 }
 applyCommand(data,reply=this.replyMain,performance){
  if(data.op==='sample'){const value=this.samples.command(data);if(data.id)reply?.({op:'sample-response',id:data.id,value});return;}
  this.engine.command(data);
  if(data.op==='noise'&&this.engine.noiseTokens.get(data.slot)===data.token){
   if(data.action==='create'||data.action==='start'){
    if(performance)this.noiseOwners.set(data.slot,{token:data.token,owner:performance.owner,session:performance.session});
    else this.noiseOwners.delete(data.slot);
   }
  }else if(data.op==='noise'&&data.action==='dispose'&&this.noiseOwners.get(data.slot)?.token===data.token)this.noiseOwners.delete(data.slot);
  if(data.op==='reset'||(this.monitor&&!this.liveFX.effects.has(this.monitor.name)))this.cancelMonitor();
 }
 command(d){
  if(d.op==='reset')this.invalidatePerformance();
  this.applyCommand(d);
 }
 renderSegment(source,target,offset,count){
  const capacity=target[0].length;
  if(this.segmentCapacity<capacity){
   this.segmentCapacity=capacity;
   this.segmentInput=[new Float32Array(capacity),new Float32Array(capacity)];
   this.segmentOutput=[new Float32Array(capacity),new Float32Array(capacity)];this.segmentViews.clear();
  }
  let views=this.segmentViews.get(count);
  if(!views){views={input:[this.segmentInput[0].subarray(0,count),this.segmentInput[1].subarray(0,count)],
   output:[this.segmentOutput[0].subarray(0,count),this.segmentOutput[1].subarray(0,count)]};this.segmentViews.set(count,views);}
  for(let ch=0;ch<2;ch++){
   const input=source[ch]??source[0],segment=views.input[ch];
   if(input)for(let i=0;i<count;i++)segment[i]=input[offset+i];else segment.fill(0);
  }
  this.engine.process(views.input,views.output,this.reportError,this.monitor?this.observeFX:undefined);
  for(let ch=0;ch<2;ch++)target[ch].set(views.output[ch],offset);
 }
 process(inputs,outputs){
  const target=outputs[0];if(!target?.length)return true;
  const source=inputs[0]??this.emptySource;
  const start=typeof currentFrame==='number'?currentFrame:this.renderFrame,end=start+target[0].length;
  this.performanceQueue.advance(start);
  if(this.performanceQueue.nextFrame()>=end)this.engine.process(source,target,this.reportError,this.monitor?this.observeFX:undefined);
  else{
   let frame=start;
   while(frame<end){
    this.performanceQueue.advance(frame);
    const next=Math.min(end,this.performanceQueue.nextFrame());
    this.renderSegment(source,target,frame-start,next-frame);frame=next;
   }
  }
  this.renderFrame=end;
  return true;
 }

}
registerProcessor('tetorica-native-fx',NativeFXProcessor);
