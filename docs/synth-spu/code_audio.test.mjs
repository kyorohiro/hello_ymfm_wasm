// Fake routing/controllers only. No AudioContext or audio output is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpuCodeAudio} from './code_audio.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const near=(actual,expected,message)=>assert(Math.abs(actual-expected)<1e-12,message??`${actual} ~= ${expected}`);
function fixture({pendingFirstRack=false,pendingFirstClient=false,pendingStop=false}={}){
  const events=[],racks=[],clients=[],contexts=[],outputCalls=[];let engine,stops=0,active=0,serial=0,stopTask=null;
  function node(name,context,gain=1){return{name,context,gain:{value:gain},edges:new Set(),connect(target){this.edges.add(target);events.push(['connect',name,target.name]);},
    disconnect(target){if(target){assert(this.edges.delete(target),'existing route '+name);}else this.edges.clear();events.push(['disconnect',name,target?.name]);}};}
  function makeEngine(){
    const context={state:'running',currentTime:1,sampleRate:48000,closeCalls:0,close(){this.closeCalls++;}};contexts.push(context);
    const input=node('source',context),fade=node('fade',context),master=node('master',context,.7),destination=node('destination',context);
    input.connect(fade);fade.connect(master);master.connect(destination);
    const result={context,codeInputNode:input,codeOutputNode:fade,codeFadeNode:fade,outputNode:master,destination,
      getPs1Client(){const token=++serial;active=token;
        const call=(method,args)=>{if(active!==token)throw new DOMException('Old session','AbortError');events.push([method,...args]);return Promise.resolve();};
        const client={sampleRate:48000,nativeSampleRate:44100,channelCount:24,noteOn:(...args)=>call('noteOn',args),noteOff:(...args)=>call('noteOff',args)};
        const task=deferred();clients.push({task,client,token});if(!pendingFirstClient||clients.length>1)task.resolve(client);return task.promise;
      },command(method){assert.equal(method,'stop');events.push(['stop']);stops++;active=0;
        if(pendingStop){stopTask=deferred();return stopTask.promise;}return Promise.resolve();}};
    return result;
  }
  engine=makeEngine();
  const host=createSpuCodeAudio({ensureReady:async()=>{events.push(['ensure']);},getAudio:()=>engine,
    createFxRack:async context=>{
      const task=deferred(),names=new Map();let chain=[];
      const rack={node:node('fx'+racks.length,context),stops:0,disposals:0,
        controller:{liveFx(name,options){if(typeof options?.process!=='function')throw Error('Invalid liveFx');names.set(name,options.context?.gain??1);},
          removeLiveFx:name=>names.delete(name),updateContext(name,values){assert(names.has(name));names.set(name,values.gain);},
          gain:({gain})=>({gain}),setChain:items=>{chain=[...items];return items;},getChain:()=>[...chain],
          clear:()=>{chain=[];},dispose:()=>{chain=[];names.clear();}},
        stop(){this.stops++;events.push(['fx-stop']);},dispose(){this.disposals++;events.push(['fx-dispose']);this.node.disconnect();},
        get factor(){return [...names.values()].reduce((a,b)=>a*b,1)*chain.reduce((a,b)=>a*b.gain,1);}};
      rack.node.factor=()=>rack.factor;racks.push({task,rack});if(!pendingFirstRack||racks.length>1)task.resolve(rack);return task.promise;
    },createOutput:options=>({open(){outputCalls.push('open');options.getGain().gain.value=1;},
      fadeOut(){outputCalls.push('fade');events.push(['fade']);options.getGain().gain.value=0;return Promise.resolve(true);},
      dispose(){outputCalls.push('dispose');options.getGain().gain.value=0;}}),
  });
  const signal=()=>{
    const value=(from,level)=>from===engine.destination?level:[...from.edges].reduce((sum,next)=>sum+value(next,level*(from.factor?.()??from.gain.value)),0);
    return value(engine.codeInputNode,.2);
  };
  return{host,events,racks,clients,contexts,outputCalls,signal,get engine(){return engine;},get stops(){return stops;},
    replace(){engine=makeEngine();return engine;},releaseStop(){pendingStop=false;stopTask.resolve();}};
}

test('SPU Code shares one engine and routes every effect before one fade and one Master',async()=>{
  const f=fixture(),sid=await f.host.useSoundChip('ps1');assert.equal(sid,await f.host.useSoundChip('ps1'));
  assert.equal(f.clients.length,1);assert.equal(f.contexts.length,1);near(f.signal(),.14);
  await sid.noteOn(2,'A4');assert(f.events.some(e=>e[0]==='noteOn'&&e[1]===2));
  f.host.fx.liveFx('level',{context:{gain:.25},process(){}});near(f.signal(),.035);
  assert.equal(f.engine.codeInputNode.edges.has(f.engine.codeOutputNode),false,'no parallel dry route');
  f.host.fx.liveFx('level',{context:{gain:.5},process(){}});near(f.signal(),.07,'Apply updates one named effect');
  f.host.fx.updateContext('level',{gain:.75});assert(Math.abs(f.signal()-.105)<1e-12);
  f.host.fx.removeLiveFx('level');near(f.signal(),.14);
  const gain=f.host.fx.gain({gain:.5});f.host.fx.setChain([gain]);near(f.signal(),.07);
  f.host.fx.setChain([]);near(f.signal(),.14);
  assert.equal(f.engine.outputNode.gain.value,.7,'FX never rewrites Master');
  await assert.rejects(f.host.useSoundChip('ym2612'),/supports/);
  await f.host.beforeStop();await f.host.stop();
  near(f.signal(),0);assert(f.events.findIndex(e=>e[0]==='fade')<f.events.findIndex(e=>e[0]==='stop'));
  assert.equal(f.racks[0].rack.disposals,1);assert.equal(f.contexts[0].closeCalls,0);
  assert.throws(()=>sid.noteOn(2,'A4'),{name:'AbortError'});
  f.host.open();near(f.signal(),.14,'Keyboard can reopen only after physical cleanup');
  const fresh=await f.host.useSoundChip('ps1');assert.notEqual(fresh,sid);await fresh.noteOn(0,60);
  await f.host.dispose();assert.equal(f.contexts[0].closeCalls,0);
});

test('a late old FX preparation is disposed without muting or resetting a newer performance',async()=>{
  const f=fixture({pendingFirstRack:true}),old=f.host.prepare(),rejected=assert.rejects(old,{name:'AbortError'});
  await turn();assert.equal(f.racks.length,1);
  await f.host.stop();const current=await f.host.useSoundChip('ps1');f.host.open();
  await current.noteOn(1,'E4');const stops=f.stops;
  f.racks[0].task.resolve(f.racks[0].rack);await rejected;
  assert.equal(f.racks[0].rack.disposals,1);assert.equal(f.stops,stops,'late work cannot stop the new Code session');
  assert.equal(f.racks[1].rack.disposals,0);near(f.signal(),.14);
  f.host.fx.liveFx('new',{context:{gain:.25},process(){}});near(f.signal(),.035);await f.host.dispose();
});

test('late SPU startup is fenced and a new prepare waits for the previous physical Stop',async()=>{
  const f=fixture({pendingFirstClient:true,pendingStop:true});
  const old=f.host.prepare(),rejected=assert.rejects(old,{name:'AbortError'});await turn();
  const stopping=f.host.stop(),next=f.host.prepare();await turn();
  assert.equal(f.clients.length,1,'new begin does not overtake physical cleanup');
  f.releaseStop();await stopping;const current=await next;
  f.clients[0].task.resolve(f.clients[0].client);await rejected;
  assert.equal(current.client,f.clients[1].client);assert.equal(f.racks[0].rack.disposals,1);
  await current.client.noteOn(0,'C4');await f.host.dispose();
});

test('changing the editor engine retires only the old owned FX route and prepares the replacement',async()=>{
  const f=fixture();await f.host.prepare();f.host.fx.liveFx('old',{context:{gain:.5},process(){}});
  const old=f.engine;f.replace();await f.host.prepare();
  assert.equal(f.racks[0].rack.disposals,1);assert(old.codeInputNode.edges.has(old.codeOutputNode));
  assert.equal(f.engine.codeInputNode.edges.has(f.engine.codeOutputNode),true);near(f.signal(),.14);
  assert(f.contexts.every(context=>context.closeCalls===0));await f.host.dispose();
});
