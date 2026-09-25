/** Worker/Node: performance state and FM/PSG register generation.
 * No DOM, AudioNode or main-thread RPC. Observers are fire-and-forget.
 */
import {YM2612Synth} from './ym2612synth.js';
import {OPNFMSynth} from './opn_fm_synth.js';
import {createSegaPsgApi} from './segapsg_api.js';
export function createWorkerChip({port,capabilities,state,observe=()=>{}}){
 let enabled=false,batch=null;
 const mutedChannels=new Set();
 const send=command=>{if(enabled){if(batch)batch.push(command);else port.postMessage([command]);}};
 const transport={write(port,register,value){send({type:'write',port,register,value});},reset(){send({type:'reset'});}};
 const name=capabilities.chip??'ym2612';
 const raw=name==='ym2612'?new YM2612Synth({transport}):new OPNFMSynth({transport,chipName:name,channelCount:name==='ym2203'?3:6,portCount:name==='ym2203'?1:2,supportsPan:name!=='ym2203',supportsLfo:name!=='ym2203'});
 function adoptState(state){if(!state)return;raw.channels=structuredClone(state.channels);raw.lfo=structuredClone(state.lfo);raw._modeRegister=state.modeRegister??0;if(state.dac)raw.dac=structuredClone(state.dac);}
 adoptState(state);
 enabled=true;
 const channelMethods=new Set(['setPreset','setOperator','setOperators','setAlgo','setPan','setModulation','setFrequency','keyOn','keyOff','noteOn','noteOff']);
 function invoke(method,args){
  if(typeof raw[method]!=='function'||method.startsWith('_')||['setHooks'].includes(method))throw new Error(`Unsupported fm method: ${method}`);
  const physical=args.slice();
  if(name==='ym2610'&&channelMethods.has(method)){physical[0]=[1,2,4,5][args[0]];if(physical[0]===undefined)throw new Error('Neo Geo FM channel must be 0..3');}
  batch=[];
  let result;
  try{
   if((method==='noteOn'||method==='keyOn') && mutedChannels.delete(physical[0])) {
    // Stop mutes the device immediately without destroying the saved patch.
    raw.channels[physical[0]].operators.forEach((operator,index)=>raw.setOperator(physical[0],index,{tl:operator.tl}));
   }
   result=raw[method](...physical);
  }finally{const commands=batch;batch=null;if(commands.length)port.postMessage(commands);}
  observe({method,args:structuredClone(args)});
  return result;
 }
 const fm=new Proxy({}, {get:(_t,method)=> (...args)=>invoke(String(method),args)});
 const psg=capabilities.psg?createSegaPsgApi({write:value=>send({type:'psg-write',value}),reset:()=>send({type:'psg-reset'}),resetAll:()=>fm.reset()}):null;
 return {fm,psg,raw,send,adoptState,
  write(...args){if(args.length===2)return fm.write(0,...args);if(args.length===3)return fm.write(...args);throw new Error('write expects register,value or port,register,value');},
  stop(){
   send({type:'clear-scheduled-writes'});send({type:'clear-dac-playback'});
   for(let ch=0;ch<(capabilities.fmChannels??6);ch++){
    fm.noteOff(ch);
    const physical=name==='ym2610'?[1,2,4,5][ch]:ch;
    mutedChannels.add(physical);
    for(let op=0;op<4;op++)send({type:'write',port:Math.floor(physical/3),register:0x40+op*4+physical%3,value:127});
   }
   if(capabilities.dac)fm.setDacEnabled(false);
   psg?.reset();
  },
 };
}
