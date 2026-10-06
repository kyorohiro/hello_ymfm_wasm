import {NativeFXEngine} from './native_fx_engine.js';
/** Browser AudioWorklet: one WASM graph for all Playground FX. */
import {setChain} from './native_fx_graph.js';
export class NativeFXProcessor extends AudioWorkletProcessor {
 constructor(options){
  super();this.engine=new NativeFXEngine(options.processorOptions.module,sampleRate);this.active=true;
  this.port.onmessage=({data})=>{
   if(data.op==='fx-monitor'){
    this.monitor=null;
    if(data.enabled){
     const names=[...this.liveFX.effects.keys()];
     const name=names.includes(data.name)?data.name:names[0];
     if(!name)this.port.postMessage({op:'fx-monitor',id:data.id,names});
     else this.monitor={id:data.id,name,names,channel:data.channel===1?1:0,input:new Float32Array(2048),output:new Float32Array(2048),offset:0};
    }
   }else if(data.op==='attach'){
    this.controlPort?.close();this.controlPort=data.port;this.active=false;
    this.samples.reset();this.resetNoise();this.reset();const port=this.controlPort;port.onmessage=({data})=>{if(this.controlPort===port)this.receive(data);};port.start();
   }else if(data.op==='main'){this.controlPort?.close();this.controlPort=null;this.active=true;this.samples.reset();this.resetNoise();this.reset();}
   else if(data.op==='emergency'){this.liveFX.clear();this.cancelMonitor();this.samples.clear();this.resetNoise();setChain(this.api,[]);this.api.graph_clear();this.ramps.clear();}
   else if(this.active)this.receive(data);
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
 resetNoise(){this.engine.resetNoise();}
 reset(){this.cancelMonitor();this.engine.reset();}

 receive(data){try{if(data.op==='sample'){const value=this.samples.command(data);if(data.id)(this.controlPort??this.port).postMessage({op:'sample-response',id:data.id,value});return;}this.command(data);}catch(e){if(data.op==='sample'&&data.id)(this.controlPort??this.port).postMessage({op:'sample-response',id:data.id,error:e.message});else this.port.postMessage({error:e.message});}}
 command(d){
  this.engine.command(d);
  if(d.op==='reset'||(this.monitor&&!this.liveFX.effects.has(this.monitor.name)))this.cancelMonitor();
 }
 process(inputs,outputs){
  const target=outputs[0];if(!target?.length)return true;
  this.engine.process(inputs[0]??[],target,error=>this.port.postMessage({error}),this.monitor?this.observeFX:undefined);
  return true;
 }

}
registerProcessor('tetorica-native-fx',NativeFXProcessor);
