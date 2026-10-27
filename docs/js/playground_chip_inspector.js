import {encodeRf5c164} from './rf5c164_pcm.js';
import {encodeOki6258,summarizeOki6258,oki6258Rate} from './okim6258synth.js?v=pokey-prepare-1';
import {prepareY8950AdpcmSample,snapshotY8950AdpcmSource} from './y8950_adpcm_preview.js?v=y8950-adpcm-ui-1';

/** UI-only admin port access. Audio creation and Worker-owned ports are deliberately untouched. */
export function createChipInspector({endpoints, decode}) {
  const listeners=new Set(),ports=new Map();let sequence=0,disposed=false;
  // Layout is applied audio-thread metadata, independent of the authoring
  // shadows used by Main/Worker lookahead. Observing ports sends no requests.
  const layouts=new WeakMap();
  const list=()=>{if(disposed)return [];synchronize();return endpoints().map(({id,kind,label,engine,fdsEnabled,port,rhythmEnabled,additional})=>({id,kind,name:kind,label,connected:true,...(engine===undefined?{}:{engine}),...(fdsEnabled===undefined?{}:{fdsEnabled}),...(additional===undefined?{}:{additional}),...(kind==='ym2413'?{rhythmEnabled:layouts.get(port)??rhythmEnabled??false}:{})}));};
  const connections=new WeakMap();let connectionSequence=0;
  function getConnectionToken(id){const {port}=endpointFor(id);if(!connections.has(port))connections.set(port,++connectionSequence);return connections.get(port);}
  const synchronize=()=>{
    if(disposed)return;
    const current=endpoints(),active=new Set(current.map(endpoint=>endpoint.port));
    for(const [port,entry] of ports)if(!active.has(port)){
      port.removeEventListener('message',entry.listener);
      for(const request of entry.pending.values()){clearTimeout(request.timer);request.reject(new DOMException('Sound chip disconnected','AbortError'));}
      ports.delete(port);layouts.delete(port);
    }
    for(const {kind,port}of current)if(kind==='ym2413'&&typeof port?.addEventListener==='function')observePort(port);
  };
  const notify=()=>{
    if(disposed)return;
    synchronize();
    // An editor observer must never prevent a chip from being released or another editor updating.
    for(const listener of listeners)try{listener(list());}catch(error){globalThis.console?.error?.('[chip inspector listener]',error);}
  };
  function endpointFor(id) {
    if(disposed)throw new DOMException('Sound chip inspector disposed','AbortError');
    synchronize();const endpoint=endpoints().find(endpoint=>endpoint.id===id);
    if(!endpoint)throw new Error('Sound chip is not connected');
    return endpoint;
  }
  function adoptLayout(port,rhythmEnabled){
    if(disposed||typeof rhythmEnabled!=='boolean')return;
    const before=layouts.get(port)??endpoints().find(endpoint=>endpoint.port===port&&endpoint.kind==='ym2413')?.rhythmEnabled??false;
    layouts.set(port,rhythmEnabled);if(before!==rhythmEnabled)notify();
  }
  function observePort(port){
    if(disposed)throw new DOMException('Sound chip inspector disposed','AbortError');
    if(ports.has(port))return ports.get(port);
    const entry={pending:new Map(),listener:null};
    entry.listener=({data})=>{
      if(ports.get(port)!==entry)return;
      if(data?.type==='chip-layout'&&data.kind==='ym2413'){
        if(endpoints().some(endpoint=>endpoint.port===port&&endpoint.kind==='ym2413'))adoptLayout(port,data.rhythmEnabled);
        return;
      }
      if(data?.type!=='chip-inspector-result')return;
      const request=entry.pending.get(data.id);if(!request)return;
      entry.pending.delete(data.id);clearTimeout(request.timer);
      if(data.error){request.reject(new Error(data.error));return;}
      if(request.kind==='ym2413'&&request.action==='read')adoptLayout(port,data.value?.rhythm?.enabled);
      request.resolve(data.value);
    };
    ports.set(port,entry);port.addEventListener('message',entry.listener);port.start?.();
    return entry;
  }
  function request(endpoint, action, method, args=[]) {
    const {port}=endpoint,entry=observePort(port);
    return new Promise((resolve,reject)=>{
      const id=`chip-inspector:${++sequence}`;
      const timer=setTimeout(()=>{entry.pending.delete(id);reject(new Error('Sound chip did not respond'));},5000);
      entry.pending.set(id,{resolve,reject,timer,kind:endpoint.kind,action});
      try{port.postMessage({type:'chip-inspector',id,inspectorKind:endpoint.kind,action,method,args});}
      catch(error){clearTimeout(timer);entry.pending.delete(id);reject(error);}
    });
  }
  return {
    list,notify,getConnectionToken,
    subscribe(listener){if(typeof listener!=='function')throw new TypeError('Inspector listener must be a function');if(disposed)return()=>{};listeners.add(listener);synchronize();return()=>listeners.delete(listener);},
    async read(id){return request(endpointFor(id),'read');},
    async invoke(id,method,args=[]){return request(endpointFor(id),'invoke',method,args);},
    async loadSample(id,source,options={}){
      if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('Sample options must be an object');
      const endpoint=endpointFor(id);
      if(endpoint.kind==='y8950'){
        const selected={...options},captured=snapshotY8950AdpcmSource(source),signal=selected.signal;
        if(signal!==undefined&&typeof signal?.throwIfAborted!=='function')throw new TypeError('Expected an AbortSignal');
        signal?.throwIfAborted();const state=await request(endpoint,'read');signal?.throwIfAborted();
        if(endpointFor(id).port!==endpoint.port)throw new Error('Sound chip changed while decoding');
        const prepared=await prepareY8950AdpcmSample(captured,selected,state.clock,decode);signal?.throwIfAborted();
        if(endpointFor(id).port!==endpoint.port)throw new Error('Sound chip changed while decoding');
        return request(endpoint,'loadSample',undefined,[prepared.bytes,{...prepared.metadata,sampleEpoch:state.adpcm.sampleEpoch}]);
      }
      if(endpoint.kind==='okim6258'){
        const {name='Sample',sampleRate,signal}=options;
        if(typeof name!=='string'||!name.length||name.length>256)throw new TypeError('Sample name must contain 1..256 characters');
        if(sampleRate!==undefined&&(!Number.isFinite(sampleRate)||sampleRate<=0))throw new RangeError('Invalid OKIM6258 sample rate');
        if(options.address!==undefined||options.loopStart!==undefined)throw new TypeError('OKIM6258 loads one complete sample; memory addresses and loop points are unavailable');
        if(signal!==undefined&&typeof signal?.throwIfAborted!=='function')throw new TypeError('Expected an AbortSignal');
        signal?.throwIfAborted();
        const pcm=await decode(source);
        signal?.throwIfAborted();
        if(endpointFor(id).port!==endpoint.port)throw new Error('Sound chip changed while decoding');
        // Encode at the currently applied rate after decoding, without changing
        // the divider or routing the user may have edited during that wait.
        const state=await request(endpoint,'read');
        signal?.throwIfAborted();
        if(endpointFor(id).port!==endpoint.port)throw new Error('Sound chip changed while decoding');
        const rate=oki6258Rate(state.clock,sampleRate??state.playbackRate);
        const encoded=encodeOki6258(pcm,rate.sampleRate);
        const metadata={...summarizeOki6258(encoded.bytes),name,sampleRate:rate.sampleRate,source:'sample'};
        signal?.throwIfAborted();
        return request(endpoint,'loadSample',undefined,[encoded.bytes,metadata]);
      }
      const selected={name:options.name??'Sample',address:options.address,loopStart:options.loopStart};
      if(selected.address!==undefined&&(!Number.isInteger(selected.address)||selected.address<0||selected.address>65535||selected.address%256))throw new RangeError('Start must be a 256-byte aligned RAM address');
      if(selected.loopStart!==undefined&&(!Number.isInteger(selected.loopStart)||selected.loopStart<0||selected.loopStart>65535))throw new RangeError('Invalid sample loop position');
      if(endpoint.kind!=='rf5c164')throw new Error('Sample loading requires RF5C164, OKIM6258 or Y8950');
      const {bytes,frames,step}=encodeRf5c164(await decode(source));
      // A selection/Stop can dispose the original node while decoding. Never load into its replacement.
      if(endpointFor(id).port!==endpoint.port)throw new Error('Sound chip changed while decoding');
      return request(endpoint,'loadSample',undefined,[bytes,{frames,step,name:selected.name},selected]);
    },
    dispose(){disposed=true;for(const [port,entry]of ports){port.removeEventListener('message',entry.listener);for(const request of entry.pending.values()){clearTimeout(request.timer);request.reject(new DOMException('Sound chip inspector disposed','AbortError'));}}ports.clear();listeners.clear();},
  };
}
