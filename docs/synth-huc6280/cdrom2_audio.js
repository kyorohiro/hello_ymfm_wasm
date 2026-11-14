// SPDX-License-Identifier: BSD-3-Clause
// Code-owned CD-ROM² media endpoints. The Synth owns the clock and final mix.
import {createMsm5205Audio} from '../js/msm5205_audio.js';
import {createMsm5205Player} from '../js/msm5205_player.js';
import {createCddaAudio} from '../js/cdda_audio.js';
import {createCddaPlayer} from '../js/cdda_player.js';

const cancelled=()=>new DOMException('CD-ROM² Code audio stopped','AbortError');
const methods={msm5205:['loadMemory','loadSample','play','stop','reset','writeRegister','getState'],
  cdda:['load','play','pause','resume','stop','seek','getState','list']};

/** Lazily borrow media on this Code session's existing AudioContext. Adapters
 * connect only to the host's per-chip input; FX/fade/Master remain host-owned.
 * @param {{engine:object,isCurrent?:()=>boolean,readFile?:(path:string)=>Promise<ArrayBuffer|Uint8Array>,onError?:(error:Error)=>void,
 * createMsmAudio?:typeof createMsm5205Audio,createCddaAdapter?:typeof createCddaAudio,
 * createMsmPlayer?:typeof createMsm5205Player,createCdPlayer?:typeof createCddaPlayer}} options
 */
export function createHuc6280Cdrom2Audio({engine,isCurrent=()=>true,readFile,onError=()=>{},
  createMsmAudio=createMsm5205Audio,createCddaAdapter=createCddaAudio,
  createMsmPlayer=createMsm5205Player,createCdPlayer=createCddaPlayer}={}){
  if(!engine?.context||typeof engine.getChipInputNode!=='function'||
    [isCurrent,onError,createMsmAudio,createCddaAdapter,createMsmPlayer,createCdPlayer].some(fn=>typeof fn!=='function')||
    readFile!==undefined&&typeof readFile!=='function')throw TypeError('CD-ROM² Code needs the Synth clock, chip inputs and host callbacks');
  const sources=new Map();let disposed=false,serial=0;
  const valid=item=>!disposed&&isCurrent()&&engine.context.state!=='closed'&&sources.get(item.name)===item&&!item.closed&&!item.controller.signal.aborted;
  const check=item=>{if(!valid(item))throw cancelled();};
  function retire(item){
    if(!item||item.closed)return;
    item.closed=true;item.controller.abort(cancelled());
    if(sources.get(item.name)===item)sources.delete(item.name);
    try{item.adapter?.node?.disconnect();}catch{}
    if(item.player)item.player.dispose();else item.adapter?.dispose();
  }
  async function useSoundChip(name){
    if(!Object.hasOwn(methods,name))throw Error('CD-ROM² media supports msm5205 and cdda');
    if(disposed||!isCurrent()||engine.context.state==='closed')throw cancelled();
    if(sources.has(name))return sources.get(name).promise;
    const item={name,controller:new AbortController(),closed:false,adapter:null,player:null,facade:null,promise:null};
    sources.set(name,item);
    item.promise=(async()=>{
      const create=name==='msm5205'?createMsmAudio:createCddaAdapter;
      const adapter=await create(engine.context,{signal:item.controller.signal,onError(error){
        if(valid(item)){retire(item);onError(error);}
      }});
      if(!valid(item)){adapter.dispose();throw cancelled();}
      item.adapter=adapter;
      const input=engine.getChipInputNode(name);
      if(!adapter.node||adapter.node.context!==engine.context||!input||input.context!==engine.context)throw Error('CD-ROM² media must use the Synth AudioContext and chip input');
      adapter.node.connect(input);
      const createPlayer=name==='msm5205'?createMsmPlayer:createCdPlayer;
      item.player=createPlayer(adapter,{signal:item.controller.signal,readFile,getMix:()=>engine.getChipMix?.(name)});
      const facade={id:`huc6280-synth:${name}:${++serial}`,chip:name};
      for(const method of methods[name])facade[method]=async(...args)=>{
        check(item);const value=await item.player[method](...args);check(item);return value;
      };
      facade.dispose=async()=>{check(item);retire(item);};
      // The shared Code runtime wraps methods in a session-checking Proxy.
      // Sealing retains the fixed API shape while writable method properties
      // let that Proxy return its guarded wrappers without violating invariants.
      Object.defineProperties(facade,{id:{writable:false},chip:{writable:false}});
      item.facade=Object.seal(facade);return item.facade;
    })().catch(error=>{retire(item);throw error;});
    return item.promise;
  }
  return{useSoundChip,dispose(){if(disposed)return;disposed=true;for(const item of [...sources.values()])retire(item);}};
}
