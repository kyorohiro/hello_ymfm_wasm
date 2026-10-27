import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {Pokey} from '../../web/pokey.js';
import {PokeyAudioEngine} from '../../web/pokeyaudioengine.js';
import factory from '../../docs/generated/pokey_wasm.js';
import {PokeyVoiceInspector} from '../../web/playground_pokey_inspector.js';
import {createProcessorPerformance,performanceNoteRelease} from '../../web/playground_performance_processor.js';
import {receiveChipInspector} from '../../web/playground_chip_inspector_state.js';
import {createPokeyClient} from '../../web/playground_pokey.js';
import {POKEY_TIMELINE_CHUNK_BYTES,POKEY_TIMELINE_VALIDATE_WRITES_PER_QUANTUM,createPokeyTimelineUpload,createPokeyChunkTimelineCursor} from '../../web/pokey_timeline_upload.js';

const wasmBinary=await readFile(new URL('../../docs/generated/pokey_wasm.wasm',import.meta.url));
export const peak=values=>values.reduce((maximum,value)=>Math.max(maximum,Math.abs(value)),0);
export async function createPokeyFixture({rate=48000,clock=1789790,initialize=true}={}){
  let Processor,frame=0,resolveReady,inspection=0;const messages=[];
  const ready=new Promise(resolve=>resolveReady=resolve),port={postMessage(message){messages.push(message);if(message.ready||message.error)resolveReady(message);}};
  const source=(await readFile(new URL('../../web/playground_pokey_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
  vm.runInNewContext(source,{Pokey,PokeyAudioEngine,factory,PokeyVoiceInspector,receiveChipInspector,performanceNoteRelease,POKEY_TIMELINE_CHUNK_BYTES,POKEY_TIMELINE_VALIDATE_WRITES_PER_QUANTUM,createPokeyTimelineUpload,createPokeyChunkTimelineCursor,Uint8Array,sampleRate:rate,
    createProcessorPerformance:options=>createProcessorPerformance({...options,rate,nowFrame:()=>frame}),AudioWorkletProcessor:class{constructor(){this.port=port;}},registerProcessor:(name,Type)=>{assert.equal(name,'tetorica-pokey');Processor=Type;}});
  const processor=new Processor({processorOptions:{clock,wasmBinary}});assert.equal((await ready).ready,true,JSON.stringify(messages));
  const commands=[],replyPort={postMessage:reply=>clientPort.onmessage?.({data:reply})},clientPort={start(){},close(){this.closed=true;},postMessage(data){commands.push(data);processor.receive(data,replyPort);}};
  const client=createPokeyClient(clientPort,{clock});if(initialize)client.initialize();
  const render=(frames=128)=>{const output=[new Float32Array(frames),new Float32Array(frames)];processor.process([],[output]);frame+=frames;return output;};
  return {processor,client,clientPort,port,messages,commands,rate,clock,
    receive(data){processor.receive(data,port);},
    read(){return processor.inspector.read();},
    invoke(method,args=[]){const id=`inspection:${++inspection}`;processor.receive({type:'chip-inspector',id,action:'invoke',method,args},port);const reply=messages.findLast(message=>message.type==='chip-inspector-result'&&message.id===id);assert(reply,`Missing inspector reply ${method}`);if(reply.error)throw new Error(reply.error);return reply.value;},
    render,
    // Preparation ACKs deliberately wait for process(). Tests opt into advancing
    // the audio clock so an ordinary await never hides an unexpected render.
    async pump(promise,{maxQuanta=10000}={}){let settled=false,result,error,count=0;Promise.resolve(promise).then(value=>{settled=true;result=value;},failure=>{settled=true;error=failure;});for(let turns=0;!settled&&turns<maxQuanta+100;turns++){await new Promise(resolve=>setImmediate(resolve));if(settled)break;if(processor.timelineUpload?.pending){assert(count++<maxQuanta,'POKEY preparation exceeded the quantum budget');render();}}assert(settled,'POKEY preparation did not settle while pumping');if(error)throw error;return result;},
    close(){client.dispose();processor.dispose();},
  };
}
