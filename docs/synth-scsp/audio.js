// SPDX-License-Identifier: BSD-3-Clause
import {createScspCodeClient,scspCodeCancelled} from './code_endpoint.js?v=scsp-dsp-code-1';
const nativeSetTimer=globalThis.setTimeout.bind(globalThis),nativeClearTimer=globalThis.clearTimeout.bind(globalThis);
const BALANCE=.125,DEADLINE=15000;
const validateVolume=value=>{if(!Number.isFinite(value)||value<0||value>3.8)throw new RangeError('SCSP Master must be 0..3.8');};

/** One SCSP / AudioContext for editor and Code. Every source traverses one
 * optional Code FX route, Stop fade and Master. outputNode is post-Master and
 * may be monitored without making another speaker connection.
 */
export async function createAudio({volume=.6,onError=()=>{},onDspChange=()=>{}}={}){
  validateVolume(volume);
  if(typeof onDspChange!=='function')throw new TypeError('SCSP DSP observer must be a function');
  const Context=globalThis.AudioContext??globalThis.webkitAudioContext;
  if(!Context)throw new Error('Web Audio is unavailable');
  const context=new Context({latencyHint:'interactive'}),controller=new AbortController(),pending=new Map();
  let node,balance,master,codeFade,songInput,closed=false,closing=null,sequence=0,startupTimer,readyResolve,rejectStartup,fatal=null;
  let codeOwner=null,codeGeneration=0,codeStopping=null;
  const startupFailure=new Promise((_,reject)=>{rejectStartup=reject;});void startupFailure.catch(()=>{});
  const assertOpen=()=>{if(fatal)throw fatal;if(closed||context.state==='closed')throw new Error('Start SCSP audio again');};
  function rejectPending(error){for(const p of pending.values()){nativeClearTimer(p.timer);p.reject(error);}pending.clear();}
  function dispose(){
    if(closing)return closing;
    closed=true;codeGeneration++;codeOwner=null;controller.abort();nativeClearTimer(startupTimer);
    rejectPending(fatal??new Error('SCSP audio closed'));context.removeEventListener('statechange',contextClosed);
    if(node){node.onprocessorerror=null;node.port.onmessage=null;node.port.onmessageerror=null;try{node.port.postMessage({method:'dispose'});}catch{}try{node.disconnect();}catch{}node.port.close();}
    balance?.disconnect();codeFade?.disconnect();songInput?.disconnect();master?.disconnect();
    return closing=(async()=>{if(context.state!=='closed')await context.close();})();
  }
  function fail(error){
    if(closed||fatal)return;fatal=error instanceof Error?error:new Error(String(error));rejectStartup(fatal);rejectPending(fatal);
    try{onError(fatal);}catch{}void dispose().catch(()=>{});
  }
  function contextClosed(){if(context.state==='closed'&&!closed)fail(new Error('SCSP AudioContext was closed; Start audio to reconnect'));}
  context.addEventListener('statechange',contextClosed);
  try{
    if(!context.audioWorklet)throw new Error('SCSP Synth needs AudioWorklet over HTTPS or localhost');
    startupTimer=nativeSetTimer(()=>fail(new Error('SCSP initialization timed out')),DEADLINE);
    const resumed=context.resume();
    const [wasmBinary]=await Promise.race([Promise.all([
      fetch(new URL('../generated/scsp_wasm.wasm',import.meta.url),{signal:controller.signal}).then(r=>{if(!r.ok)throw new Error(`SCSP WASM HTTP ${r.status}`);return r.arrayBuffer();}),
      context.audioWorklet.addModule(new URL('./processor.js?v=scsp-fm-self-1',import.meta.url)),resumed,
    ]),startupFailure]);assertOpen();
    const ready=new Promise(resolve=>{readyResolve=resolve;});
    node=new AudioWorkletNode(context,'tetorica-scsp-synth',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{wasmBinary}});
    node.onprocessorerror=()=>fail(new Error('SCSP processor failed'));
    node.port.onmessageerror=()=>fail(new Error('SCSP processor reply could not be read'));
    node.port.onmessage=({data})=>{
      if(data?.fatal){fail(new Error(data.error));return;}
      if(data?.ready){readyResolve();return;}
      const p=pending.get(data?.id);if(!p)return;pending.delete(data.id);nativeClearTimer(p.timer);
      if(!data.error&&Object.hasOwn(data,'dspRoutingState')){
        try{onDspChange({method:'routingState',value:data.dspRoutingState});}
        catch(error){console.error('SCSP DSP routing display sync failed',error);}
      }
      if(data.error){const error=new Error(data.error);error.name=data.name??'Error';p.reject(error);}else p.resolve(data.value);
    };
    await Promise.race([ready,startupFailure]);assertOpen();nativeClearTimer(startupTimer);
    balance=context.createGain();balance.gain.value=BALANCE;
    codeFade=context.createGain();codeFade.gain.value=1;
    master=context.createGain();master.gain.value=volume;
    songInput=context.createGain();songInput.gain.value=BALANCE;
    node.connect(balance);balance.connect(codeFade);codeFade.connect(master);songInput.connect(master);master.connect(context.destination);
    function request(message){
      assertOpen();const id=++sequence;
      return new Promise((resolve,reject)=>{
        const timer=nativeSetTimer(()=>fail(new Error('SCSP processor timed out')),DEADLINE);pending.set(id,{resolve,reject,timer});
        try{node.port.postMessage({...message,id});}catch(error){nativeClearTimer(timer);pending.delete(id);reject(error);}
      });
    }
    const command=(method,args=[])=>{if(!Array.isArray(args))throw new TypeError('SCSP command arguments must be an array');return request({method,args});};
    async function getScspClient(){
      assertOpen();if(codeStopping)await codeStopping;assertOpen();
      if(codeOwner)return codeOwner.promise;
      const owner={generation:++codeGeneration,client:null,begin:null,promise:null};codeOwner=owner;
      const current=()=>!closed&&!fatal&&codeOwner===owner&&owner.generation===codeGeneration;
      owner.begin=command('beginCode');
      owner.promise=owner.begin.then(metadata=>{
        if(!current())throw scspCodeCancelled();
        return owner.client=createScspCodeClient({metadata,isCurrent:current,
          invoke:async(method,args)=>{
            if(!current())throw scspCodeCancelled();
            const value=await command('code',[metadata.session,method,args]);
            // Remember owner-acknowledged setup before the borrowed call resolves.
            // Coefficient motion sends only three codes, never the MPRO image.
            // Stop retires a client but keeps already-committed shared DSP edits.
            if(!closed&&!fatal&&context.state!=='closed'&&['applyDspProgram','setDspCoefficients','setEffect','setDspSend','setDspSourceSend','setDspReturn'].includes(method)){
              try{onDspChange({method,value,...(['setDspSend','setDspSourceSend','setDspReturn'].includes(method)?{args:structuredClone(args)}:{})});}
              catch(error){console.error('SCSP Code DSP display sync failed',error);}
            }
            if(!current())throw scspCodeCancelled();
            return value;
          },
          dispose:()=>stopCode(owner.client)});
      }).catch(error=>{if(codeOwner===owner)codeOwner=null;throw error;});
      return owner.promise;
    }
    function stopCode(expectedClient){
      assertOpen();const owner=codeOwner;
      if(expectedClient&&owner?.client!==expectedClient)return Promise.resolve(false);
      if(!owner)return codeStopping??Promise.resolve(false);
      codeOwner=null;codeGeneration++;
      const task=owner.begin.then(metadata=>command('endCode',[metadata.session]));
      const result=codeStopping=task.finally(()=>{if(codeStopping===result)codeStopping=null;});return result;
    }
    return {context,outputNode:master,codeInputNode:balance,codeOutputNode:codeFade,codeFadeNode:codeFade,songInputNode:songInput,
      dispose,async resume(){assertOpen();try{await context.resume();assertOpen();}catch(error){fail(error);throw error;}},
      setVolume(value){assertOpen();validateVolume(value);master.gain.setTargetAtTime(value,context.currentTime,.01);},
      read:()=>request({type:'chip-inspector',action:'read'}),invoke:(method,args=[])=>request({type:'chip-inspector',action:'invoke',method,args}),
      command,setPitchBend:semitones=>command('setPitchBend',[semitones]),readAuthoring:(sampleKeys=[])=>command('readAuthoring',[sampleKeys]),getScspClient,prepareCode:getScspClient,stopCode};
  }catch(error){fail(error);await dispose().catch(()=>{});throw error;}finally{nativeClearTimer(startupTimer);}
}
