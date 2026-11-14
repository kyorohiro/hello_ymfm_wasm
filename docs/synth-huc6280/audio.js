// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {createHuc6280CodeClient,huc6280CodeCancelled} from './code_endpoint.js';
import {readPreset} from './preset.js';
import {readHuc6280CodeEdit} from './code_parameter_edit.js';

export const HUC6280_SYNTH_BALANCE = 1;
const DEADLINE_MS = 15000;
const COMMANDS = new Set(['read','observeCode','observeEditor','applyEditorEdit','setPreset','loadPreset','noteOn','noteOff','setPitch','stop','releaseKeyboard','beginCode','code','applyCodePreset','applyCodeEdit']);

function validateVolume(value) {
  if (!Number.isFinite(value) || value < 0 || value > 3.8) throw new RangeError('HuC6280 Master must be from 0 to 3.8');
}

/** A user-gesture-created, single-APU audio engine. Importing this module starts
 * no audio. outputNode carries the final, Master-scaled signal; attach meters
 * there as passive branches, without connecting them to destination again.
 * @param {{volume?:number,onError?:(error:Error)=>void}} [options]
 */
export async function createAudio({volume = .7, onError = () => {}} = {}) {
  validateVolume(volume);
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error('This browser does not support Web Audio');
  const context = new Context({latencyHint:'interactive'});
  const controller = new AbortController(), pending = new Map();
  let node = null, balance = null, codeFade=null, master = null, songInput=null, disposed = false, closing = null;
  let codeGeneration=0,codeOwner=null;
  const invalidateCode=()=>{codeGeneration++;codeOwner=null;};
  let fatalError = null, nextId = 0, startupTimer = null, rejectStartup, readyResolve;
  let acceptedDdaData = '';
  const auditions=new Set();
  const startupFailure = new Promise((_, reject) => { rejectStartup = reject; });
  // A fatal error can also occur after startup has returned to the UI.
  void startupFailure.catch(() => {});

  const report = error => { try { onError(error); } catch {} };
  function rejectPending(error) {
    for (const {reject, timer} of pending.values()) { clearTimeout(timer); reject(error); }
    pending.clear();
  }
  function assertOpen() {
    if (fatalError) throw fatalError;
    if (disposed || context.state === 'closed') throw new Error('HuC6280 audio is closed. Enable audio to restart.');
  }
  function dispose() {
    if (closing) return closing;
    disposed = true;
    invalidateCode();
    acceptedDdaData = '';
    clearTimeout(startupTimer);
    controller.abort();
    context.removeEventListener('statechange', stateChanged);
    rejectPending(fatalError ?? new Error('HuC6280 audio was disposed'));
    for(const audition of [...auditions])audition.dispose();
    if (node) {
      node.onprocessorerror = null;
      node.port.onmessage = null;
      node.port.onmessageerror = null;
      try { node.port.postMessage({method:'dispose'}); } catch {}
      try { node.disconnect(); } catch {}
      node.port.close();
    }
    balance?.disconnect();
    codeFade?.disconnect();
    songInput?.disconnect();
    master?.disconnect();
    closing = (async () => { if (context.state !== 'closed') await context.close(); })();
    return closing;
  }
  function fail(error) {
    if (disposed || fatalError) return;
    fatalError = error instanceof Error ? error : new Error(String(error));
    rejectStartup(fatalError);
    rejectPending(fatalError);
    report(fatalError);
    void dispose().catch(() => {});
  }
  function stateChanged() {
    if (context.state === 'closed' && !disposed) fail(new Error('HuC6280 AudioContext was closed. Enable audio to restart.'));
  }
  context.addEventListener('statechange', stateChanged);
  const boundedStartup = task => Promise.race([task, startupFailure]);

  try {
    if (!context.audioWorklet) throw new Error('HuC6280 Synth needs AudioWorklet. Open it over HTTPS or localhost.');
    startupTimer = setTimeout(() => fail(new Error('HuC6280 audio initialization timed out. Enable audio to retry.')), DEADLINE_MS);
    // Invoke resume before awaiting fetch/addModule so a pointer gesture can
    // authorize playback on browsers that require transient activation.
    const resumed = context.resume();
    const [wasmBinary] = await boundedStartup(Promise.all([
      fetch(new URL('../generated/huc6280_wasm.wasm', import.meta.url), {signal:controller.signal}).then(response => {
        if (!response.ok) throw new Error(`HuC6280 WASM could not load (HTTP ${response.status})`);
        return response.arrayBuffer();
      }),
      context.audioWorklet.addModule(new URL('./processor.js?v=huc-shared-ch-1', import.meta.url)),
      resumed,
    ]));
    assertOpen();
    const ready = new Promise(resolve => { readyResolve = resolve; });
    node = new AudioWorkletNode(context, 'tetorica-huc6280-synth', {
      numberOfInputs:0, numberOfOutputs:1, outputChannelCount:[2], processorOptions:{wasmBinary},
    });
    node.onprocessorerror = () => fail(new Error('HuC6280 audio processor failed. Enable audio to restart.'));
    node.port.onmessageerror = () => fail(new Error('HuC6280 audio reply could not be read. Enable audio to restart.'));
    node.port.onmessage = ({data}) => {
      if (data?.fatal) { fail(new Error(data.error ?? 'HuC6280 audio processor failed')); return; }
      if (data?.ready) { readyResolve(); return; }
      const request = pending.get(data?.id);
      if (!request) return;
      pending.delete(data.id); clearTimeout(request.timer);
      if (data.error) {
        const error = new Error(data.error); error.name = data.name ?? 'Error'; request.reject(error);
      } else {
        let value = data.value;
        // Only acknowledged presets may become the shared PCM reference.
        // A failed edit must not change the next command's data reference.
        if (typeof value?.preset?.dda?.data === 'string') acceptedDdaData = value.preset.dda.data;
        else if (request.presetData !== undefined) acceptedDdaData = request.presetData;
        if (data.ddaDataOmitted && value?.preset?.dda) {
          value = {...value, preset:{...value.preset, dda:{...value.preset.dda, data:acceptedDdaData}}};
        }
        request.resolve(value);
      }
    };
    await boundedStartup(ready);
    assertOpen();
    clearTimeout(startupTimer);
    balance = context.createGain(); balance.gain.value = HUC6280_SYNTH_BALANCE;
    codeFade=context.createGain();codeFade.gain.value=1;
    master = context.createGain(); master.gain.value = volume;
    songInput=context.createGain();songInput.gain.value=HUC6280_SYNTH_BALANCE;
    songInput.connect(master);
    node.connect(balance); balance.connect(codeFade);codeFade.connect(master); master.connect(context.destination);

    async function command(method, args = []) {
      assertOpen();
      if (!COMMANDS.has(method)) throw new Error(`Unknown HuC6280 command: ${method}`);
      if (!Array.isArray(args)) throw new TypeError('HuC6280 command arguments must be an array');
      if(method==='stop'){if(args.length)throw TypeError('HuC6280 Stop takes no arguments');invalidateCode();}
      const changesPreset = ['setPreset','loadPreset','applyCodePreset','applyCodeEdit'].includes(method);
      const candidate=method==='applyCodePreset'?args[1]?.dda?.data:method==='applyCodeEdit'?args[1]?.changes?.['dda.data']:args[0]?.dda?.data;
      const presetData = changesPreset && typeof candidate === 'string' ? candidate : undefined;
      // Concurrent preset mutations carry their own data, preserving FIFO
      // semantics when another edit may replace the remote reference first.
      const ddaDataUnchanged = ['setPreset','loadPreset'].includes(method) && presetData !== undefined && presetData !== '' && presetData === acceptedDdaData &&
        ![...pending.values()].some(request => request.changesPreset);
      if (ddaDataUnchanged) {
        const {data:_data, ...dda} = args[0].dda;
        args = [{...args[0], dda}, ...args.slice(1)];
      }
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail(new Error(`HuC6280 command timed out (${method}). Enable audio to restart.`)), DEADLINE_MS);
        pending.set(id, {resolve, reject, timer, changesPreset, presetData});
        try { node.port.postMessage({id, method, args, ...(ddaDataUnchanged ? {ddaDataUnchanged:true} : {})}); }
        catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
      }).then(value=>{if(method==='loadPreset'||method==='setPreset')invalidateCode();return value;});
    }
    function getHuc6280Client(){
      assertOpen();if(codeOwner?.closed)return codeOwner.ending.then(getHuc6280Client);if(codeOwner)return codeOwner.promise;
      const owner=codeOwner={generation:codeGeneration,promise:null,closed:false,ending:null,releasedGeneration:null};
      const current=()=>!disposed&&!fatalError&&codeOwner===owner&&owner.generation===codeGeneration&&!owner.closed;
      const check=()=>{assertOpen();if(!current())throw huc6280CodeCancelled();};
      owner.promise=command('beginCode').then(metadata=>{
        check();owner.session=metadata.session;
        return createHuc6280CodeClient({metadata,isCurrent:current,
          ownsOutput:()=>current()||!disposed&&!fatalError&&codeOwner===null&&owner.releasedGeneration===codeGeneration,
          invoke(method,args){check();return command('code',[metadata.session,method,args]);},
          dispose(){check();owner.closed=true;owner.ending=command('code',[metadata.session,'dispose',[]]).then(value=>{if(codeOwner===owner){invalidateCode();owner.releasedGeneration=codeGeneration;}return value;},error=>{if(codeOwner===owner)invalidateCode();throw error;});return owner.ending;},
        });
      }).catch(error=>{if(codeOwner===owner)codeOwner=null;throw error;});
      return owner.promise;
    }
    async function applyCodePreset(value,{isCurrent=()=>true,replace=true}={}){
      assertOpen();const next=readPreset(value),owner=codeOwner;
      if(typeof isCurrent!=='function'||typeof replace!=='boolean')throw TypeError('HuC6280 preset requires ownership and replacement options');
      const check=()=>{assertOpen();if(!owner||owner!==codeOwner||owner.closed||owner.generation!==codeGeneration||!isCurrent())throw huc6280CodeCancelled();};
      check();await owner.promise;check();const result=await command('applyCodePreset',[owner.session,next,{replace}]);check();return result;
    }
    async function applyCodeEdit(value,{isCurrent=()=>true}={}){
      assertOpen();const edit=readHuc6280CodeEdit(value),owner=codeOwner;
      if(typeof isCurrent!=='function')throw TypeError('HuC6280 edit requires an ownership callback');
      const check=()=>{assertOpen();if(!owner||owner!==codeOwner||owner.closed||owner.generation!==codeGeneration||!isCurrent())throw huc6280CodeCancelled();};
      check();await owner.promise;check();const result=await command('applyCodeEdit',[owner.session,edit]);check();return result;
    }
    async function applyEditorEdit(value,{isCurrent=()=>true}={}){
      assertOpen();const edit=readHuc6280CodeEdit(value),generation=codeGeneration;
      if(typeof isCurrent!=='function')throw TypeError('HuC6280 edit requires an ownership callback');
      const check=()=>{assertOpen();if(codeOwner||generation!==codeGeneration||!isCurrent())throw huc6280CodeCancelled();};
      check();const result=await command('applyEditorEdit',[edit]);check();return result;
    }
    async function createAuditionVoice(value,{isCurrent=()=>true,signal,onError=()=>{}}={}){
      assertOpen();const preset=readPreset(value);
      if(typeof isCurrent!=='function'||typeof onError!=='function')throw TypeError('Audition requires ownership and error callbacks');
      if(signal!==undefined&&(!signal||typeof signal.addEventListener!=='function'))throw TypeError('Audition signal must be an AbortSignal');
      const aborted=()=>new DOMException('Paused HuC6280 audition cancelled','AbortError');
      const methods=new Set(['read','loadPreset','noteOn','noteOff','setPitch','stop']);
      let trialNode=null,outputGain=null,closed=false,failure=null,timer=null,serial=0,resolveReady,rejectReady,trialDdaData=preset.dda.data;
      const requests=new Map(),ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
      // Disposal may precede the first await (including a constructor error).
      void ready.catch(()=>{});
      const current=()=>!closed&&!disposed&&!fatalError&&!signal?.aborted&&isCurrent()!==false;
      function check(){assertOpen();if(failure)throw failure;if(!current())throw aborted();}
      function close(reason=aborted()){
        if(closed)return;closed=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);
        rejectReady(reason);for(const request of requests.values()){clearTimeout(request.timer);request.reject(reason);}requests.clear();
        if(outputGain){
          const parameter=outputGain.gain,at=context.currentTime;
          try{parameter.cancelScheduledValues?.(at);parameter.setValueAtTime?.(0,at);parameter.value=0;}catch{}
          try{outputGain.disconnect();}catch{}
        }
        if(trialNode){trialNode.onprocessorerror=null;trialNode.port.onmessage=null;trialNode.port.onmessageerror=null;
          try{trialNode.port.postMessage({method:'dispose'});}catch{}try{trialNode.disconnect();}catch{}try{trialNode.port.close();}catch{}}
        auditions.delete(handle);
      }
      const cancel=()=>close(aborted());
      const failTrial=error=>{if(closed)return;failure=error instanceof Error?error:new Error(String(error));close(failure);try{onError(failure);}catch{}};
      async function trialCommand(method,args=[]){
        check();if(!methods.has(method))throw Error('Unknown HuC6280 audition command');if(!Array.isArray(args))throw TypeError('Audition command arguments must be an array');
        const id=++serial;
        const result=await new Promise((resolve,reject)=>{
          const deadline=setTimeout(()=>failTrial(new Error(`HuC6280 audition command timed out (${method})`)),DEADLINE_MS);
          requests.set(id,{resolve,reject,timer:deadline,presetData:method==='loadPreset'?args[0]?.dda?.data:undefined});
          try{trialNode.port.postMessage({id,method,args});}catch(error){requests.delete(id);clearTimeout(deadline);reject(error);}
        });check();return result;
      }
      const handle={context,get outputGain(){return outputGain;},isCurrent:current,command:trialCommand,read:()=>trialCommand('read'),
        noteOn:(id,midi)=>trialCommand('noteOn',[id,midi]),noteOff:id=>trialCommand('noteOff',[id]),setPitch:value=>trialCommand('setPitch',[value]),dispose:()=>close()};
      auditions.add(handle);signal?.addEventListener('abort',cancel,{once:true});
      try{
        check();
        outputGain=context.createGain();outputGain.gain.value=0;outputGain.connect(master);
        trialNode=new AudioWorkletNode(context,'tetorica-huc6280-synth',{
          numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{wasmBinary},
        });
        trialNode.onprocessorerror=()=>failTrial(new Error('HuC6280 audition processor failed'));
        trialNode.port.onmessageerror=()=>failTrial(new Error('HuC6280 audition reply could not be read'));
        trialNode.port.onmessage=({data})=>{
          if(closed)return;if(data?.fatal){failTrial(new Error(data.error??'HuC6280 audition processor failed'));return;}
          if(data?.ready){resolveReady();return;}
          const request=requests.get(data?.id);if(!request)return;requests.delete(data.id);clearTimeout(request.timer);
          if(data.error){const error=new Error(data.error);error.name=data.name??'Error';request.reject(error);}
          else{let result=data.value;if(typeof result?.preset?.dda?.data==='string')trialDdaData=result.preset.dda.data;else if(typeof request.presetData==='string')trialDdaData=request.presetData;
            if(data.ddaDataOmitted&&result?.preset?.dda)result={...result,preset:{...result.preset,dda:{...result.preset.dda,data:trialDdaData}}};request.resolve(result);}
        };
        trialNode.connect(outputGain);timer=setTimeout(()=>failTrial(new Error('HuC6280 audition initialization timed out')),DEADLINE_MS);
        await ready;clearTimeout(timer);check();await trialCommand('loadPreset',[preset]);check();return handle;
      }catch(error){close(error);throw error;}
    }
    return {
      context, outputNode:master,songInputNode:songInput,codeInputNode:balance,codeOutputNode:codeFade,codeFadeNode:codeFade, command, read:() => command('read'),observeEditor:()=>command('observeEditor'),getHuc6280Client,applyCodePreset,applyCodeEdit,applyEditorEdit,createAuditionVoice,
      get codeSession(){return codeOwner?.session??null;},
      async resume() {
        assertOpen();
        try { await context.resume(); assertOpen(); }
        catch (error) { fail(error); throw error; }
      },
      setVolume(value) {
        assertOpen(); validateVolume(value);
        const parameter = master.gain, now = context.currentTime;
        if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(now);
        else { const current = parameter.value; parameter.cancelScheduledValues(now); parameter.setValueAtTime(current, now); }
        parameter.linearRampToValueAtTime(value, now + .01);
      },
      dispose,
    };
  } catch (error) {
    fail(error);
    await dispose().catch(() => {});
    throw error;
  } finally { clearTimeout(startupTimer); }
}
