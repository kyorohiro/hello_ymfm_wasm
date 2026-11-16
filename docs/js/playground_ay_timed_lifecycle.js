// AY-only entry transactions over the existing chip capability. This module
// owns no clock, renderer, state mirror or general asynchronous execution realm.
const moduleId=globalThis.crypto?.randomUUID?.()??`${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
let nextManager=0;
const stopped=()=>new DOMException('Run stopped','AbortError');

/** Reservation mutations require entry evaluation or an identified liveLoop.
 * Existing chip methods and detached compilation data retain their behavior.
 * Worker callers supply the established 'script' / performanceOwner identities.
 */
export function createAyTimedLifecycle({getLoop,setLoop,entryOwner,loopOwner,cancelOwner,onError=()=>{},trackAsync=()=>{}}) {
  const prefix=`ay-code:${moduleId}:${++nextManager}`,wrappers=new WeakMap(),loops=new WeakMap();
  let active=false,generation=0,sequence=0,loopSequence=0,current=null,lifetime=new AbortController();
  let entryControllers=new Set(),entryNames=new Map(),owners=new Map();
  const subscriptions=new Map();
  const owner=()=>entryOwner??`${prefix}:run:${generation}:entry`;
  function report(invoke) {
    try{Promise.resolve(invoke()).catch(error=>{if(error?.name!=='AbortError'&&error?.message!=='Run stopped')onError(error);});}
    catch(error){if(error?.name!=='AbortError'&&error?.message!=='Run stopped')onError(error);}
  }
  function control(loop,invoke) {
    const previous=getLoop();setLoop(loop);
    try{return invoke();}finally{setLoop(previous);}
  }
  function remember(controller,identity) {
    if(!owners.has(controller))owners.set(controller,new Set());owners.get(controller).add(identity);
    if(typeof controller.onError==='function'&&!subscriptions.has(controller)){
      const release=controller.onError(error=>{
        if(!active||error?.owner&&!owners.get(controller)?.has(error.owner))return;
        try{onError(error);}catch{}
      });
      subscriptions.set(controller,typeof release==='function'?release:()=>{});
    }
  }
  function loopRecord(loop) {
    let record=loops.get(loop);
    if(!record||record.generation!==generation){record={generation,owner:loopOwner?.(loop)??`${prefix}:run:${generation}:loop:${++loopSequence}`,controller:new AbortController(),controllers:new Set()};loops.set(loop,record);}
    return record;
  }
  function scope(mutation=false) {
    if(!active)throw stopped();
    const loop=getLoop();
    if(loop){
      if(loop.stopped||loop.keyboard)throw stopped();
      const record=loopRecord(loop);if(record.controller.signal.aborted)throw stopped();
      return {loop,record,signal:record.controller.signal};
    }
    if(current){check(current);return {transaction:current,signal:current.controller.signal};}
    if(mutation)throw new DOMException('Timed reservations require an active entry evaluation or liveLoop','AbortError');
    return {signal:lifetime.signal};
  }
  function check(transaction) {
    if(!active||transaction!==current||transaction.controller.signal.aborted||!transaction.isCurrent())throw stopped();
  }
  function wait(value,callScope) {
    return new Promise((resolve,reject)=>{
      const signal=callScope.signal;
      const abort=()=>{signal.removeEventListener('abort',abort);setLoop(callScope.loop??null);reject(stopped());};
      signal.addEventListener('abort',abort,{once:true});
      Promise.resolve(value).then(result=>{
        signal.removeEventListener('abort',abort);setLoop(callScope.loop??null);
        if(signal.aborted||!active||callScope.loop?.stopped){reject(stopped());return;}
        if(callScope.transaction){try{check(callScope.transaction);}catch(error){reject(error);return;}}
        resolve(result);
      },error=>{signal.removeEventListener('abort',abort);setLoop(callScope.loop??null);reject(error);});
      if(signal.aborted)abort();
    });
  }
  function mutate(controller,method,args) {
    const caller=scope(true);
    let result;
    if(caller.loop){
      caller.record.controllers.add(controller);remember(controller,caller.record.owner);
      result=control(caller.loop,()=>method==='schedule'?controller.schedule(args[0],args[1],{owner:caller.record.owner}):controller.clearSchedule(args[0],{owner:caller.record.owner}));
    }else{
      const transaction=caller.transaction;
      transaction.controllers.add(controller);remember(controller,transaction.owner);
      result=Promise.resolve(control(null,()=>controller.stage(transaction.id,transaction.owner,method,args)));
      result.catch(()=>{});transaction.pending.push(result);
      if(!transaction.names.has(controller))transaction.names.set(controller,new Map());
      transaction.names.get(controller).set(method==='schedule'?args[1]?.name:args[0],method==='schedule');
    }
    const pending=wait(result,caller);pending.catch(()=>{});
    if(caller.loop)control(caller.loop,()=>trackAsync(pending,caller.loop));
    return pending;
  }
  function abort(transaction) {
    if(!transaction||transaction.aborted)return;
    transaction.aborted=true;transaction.controller.abort(stopped());
    for(const controller of transaction.controllers)report(()=>control(null,()=>controller.abort(transaction.id,transaction.owner)));
    if(current===transaction)current=null;
  }
  return {
    wrap(client,capability=client?._timedOperations) {
      if(!capability)return client;
      if(wrappers.has(client))return wrappers.get(client);
      const facade=new Proxy(Object.create(Object.getPrototypeOf(client)),{get(_target,key){
        if(key==='_timedOperations')return undefined;
        const value=Reflect.get(client,key,client);if(typeof value!=='function')return value;
        if(key==='schedule'||key==='clearSchedule')return(...args)=>mutate(capability,key,args);
        if(['build','compile','captureState'].includes(key))return(...args)=>{
          const caller=scope(),result=value.apply(client,args);
          return result?.then?wait(result,caller):result;
        };
        return value.bind(client);
      },set:(_target,key,value)=>Reflect.set(client,key,value,client),
        has:(_target,key)=>key!=='_timedOperations'&&Reflect.has(client,key),
        ownKeys:()=>Reflect.ownKeys(client).filter(key=>key!=='_timedOperations'),
        getOwnPropertyDescriptor(_target,key){
          if(key==='_timedOperations')return undefined;
          const descriptor=Reflect.getOwnPropertyDescriptor(client,key);
          return descriptor?{configurable:true,enumerable:descriptor.enumerable,writable:'writable'in descriptor?descriptor.writable:!!descriptor.set,value:facade[key]}:undefined;
        },
      });
      wrappers.set(client,facade);return facade;
    },
    begin(isCurrent=()=>true) {
      abort(current);
      if(!active){active=true;generation++;lifetime=new AbortController();}
      const transaction={id:`${prefix}:evaluation:${++sequence}`,owner:owner(),controller:new AbortController(),controllers:new Set(),names:new Map(),pending:[],isCurrent};
      current=transaction;return transaction;
    },
    async commit(transaction) {
      check(transaction);await wait(Promise.all(transaction.pending),{transaction,signal:transaction.controller.signal});check(transaction);
      for(const controller of entryControllers)transaction.controllers.add(controller);
      for(const controller of transaction.controllers){
        await wait(control(null,()=>controller.commit(transaction.id,transaction.owner)),{transaction,signal:transaction.controller.signal});check(transaction);
      }
      for(const controller of transaction.controllers){
        entryControllers.add(controller);entryNames.set(controller,new Set([...(transaction.names.get(controller)??[])].filter(([,scheduled])=>scheduled).map(([name])=>name)));
      }
      current=null;
    },
    abort,
    abortCurrent(){abort(current);},
    cancelLoop(loop,controller) {
      const record=loops.get(loop);if(!record||record.generation!==generation)return;
      if(!controller)record.controller.abort(stopped());
      for(const target of record.controllers)if(!controller||target===controller){
        if(owners.get(target)?.delete(record.owner))report(()=>cancelOwner?cancelOwner(target,record.owner,loop):control(null,()=>{
          const release=active&&typeof target.releaseOwner==='function'?target.releaseOwner:target.cancelOwner;
          return release.call(target,record.owner);
        }));
      }
    },
    stop() {
      abort(current);active=false;lifetime.abort(stopped());
      for(const [controller,identities]of owners)for(const identity of identities)report(()=>cancelOwner?cancelOwner(controller,identity):control(null,()=>controller.cancelOwner(identity)));
      for(const release of subscriptions.values())report(release);subscriptions.clear();
      owners=new Map();entryControllers=new Set();entryNames=new Map();
    },
    get entryReservationCount(){let count=0;for(const names of entryNames.values())count+=names.size;return count;},
    get hasEntryReservations(){for(const names of entryNames.values())if(names.size)return true;return false;},
  };
}
