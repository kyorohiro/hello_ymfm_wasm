import {encodeRf5c164} from './rf5c164_pcm.js';

/** UI-only admin port access. Audio creation and Worker-owned ports are deliberately untouched. */
export function createChipInspector({endpoints, decode}) {
  const listeners=new Set(),ports=new Map();let sequence=0;
  const list=()=>endpoints().map(({id,kind,label})=>({id,kind,name:kind,label,connected:true}));
  const synchronize=()=>{
    const active=new Set(endpoints().map(endpoint=>endpoint.port));
    for(const [port,entry] of ports)if(!active.has(port)){
      port.removeEventListener('message',entry.listener);
      for(const request of entry.pending.values()){clearTimeout(request.timer);request.reject(new Error('Sound chip disconnected'));}
      ports.delete(port);
    }
  };
  const notify=()=>{
    synchronize();
    // An editor observer must never prevent a chip from being released or another editor updating.
    for(const listener of listeners)try{listener(list());}catch(error){globalThis.console?.error?.('[chip inspector listener]',error);}
  };
  function endpointFor(id) {
    synchronize();const endpoint=endpoints().find(endpoint=>endpoint.id===id);
    if(!endpoint)throw new Error('Sound chip is not connected');
    return endpoint;
  }
  function request(endpoint, action, method, args=[]) {
    const {port}=endpoint;
    let entry=ports.get(port);
    if(!entry){
      entry={pending:new Map(),listener:null};
      entry.listener=({data})=>{
        if(data?.type!=='chip-inspector-result')return;
        const request=entry.pending.get(data.id);if(!request)return;
        entry.pending.delete(data.id);clearTimeout(request.timer);
        data.error?request.reject(new Error(data.error)):request.resolve(data.value);
      };
      ports.set(port,entry);port.addEventListener('message',entry.listener);port.start?.();
    }
    return new Promise((resolve,reject)=>{
      const id=`chip-inspector:${++sequence}`;
      const timer=setTimeout(()=>{entry.pending.delete(id);reject(new Error('Sound chip did not respond'));},5000);
      entry.pending.set(id,{resolve,reject,timer});
      try{port.postMessage({type:'chip-inspector',id,action,method,args});}
      catch(error){clearTimeout(timer);entry.pending.delete(id);reject(error);}
    });
  }
  return {
    list,notify,
    subscribe(listener){if(typeof listener!=='function')throw new TypeError('Inspector listener must be a function');listeners.add(listener);return()=>listeners.delete(listener);},
    async read(id){return request(endpointFor(id),'read');},
    async invoke(id,method,args=[]){return request(endpointFor(id),'invoke',method,args);},
    async loadSample(id,source,options={}){
      if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('Sample options must be an object');
      const selected={name:options.name??'Sample',address:options.address,loopStart:options.loopStart};
      if(selected.address!==undefined&&(!Number.isInteger(selected.address)||selected.address<0||selected.address>65535||selected.address%256))throw new RangeError('Start must be a 256-byte aligned RAM address');
      if(selected.loopStart!==undefined&&(!Number.isInteger(selected.loopStart)||selected.loopStart<0||selected.loopStart>65535))throw new RangeError('Invalid sample loop position');
      const endpoint=endpointFor(id);if(endpoint.kind!=='rf5c164')throw new Error('Sample loading requires RF5C164');
      const {bytes,frames,step}=encodeRf5c164(await decode(source));
      // A selection/Stop can dispose the original node while decoding. Never load into its replacement.
      if(endpointFor(id).port!==endpoint.port)throw new Error('Sound chip changed while decoding');
      return request(endpoint,'loadSample',undefined,[bytes,{frames,step,name:selected.name},selected]);
    },
    dispose(){for(const [port,entry]of ports){port.removeEventListener('message',entry.listener);for(const request of entry.pending.values()){clearTimeout(request.timer);request.reject(new Error('Sound chip inspector disposed'));}}ports.clear();listeners.clear();},
  };
}
