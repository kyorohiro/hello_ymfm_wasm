import test from 'node:test';
import assert from 'node:assert/strict';
import {createChipInspector} from './playground_chip_inspector.js';

// The readiness listener and inspector observer share the native node's port.
// Exercise both listeners, rather than calling the startup callback in isolation.
function audioFixture(t,{startupFailure=false}={}){
  const previous={AudioWorkletNode:globalThis.AudioWorkletNode,fetch:globalThis.fetch},nodes=[];
  const fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)});
  class Port extends EventTarget {
    constructor(){super();this.messages=[];this.active=false;this.closed=false;this.onmessage=null;}
    emit(data){if(this.closed)return;const event=new MessageEvent('message',{data});this.onmessage?.(event);this.dispatchEvent(event);}
    postMessage(data){
      this.messages.push(data);
      if(data.type!=='chip-inspector')return;
      queueMicrotask(()=>{
        const reply={type:'chip-inspector-result',id:data.id};
        if(data.action==='invoke'&&data.method==='auditionOn'&&data.args[1]<0)reply.error='Invalid audition MIDI; instrument remains available';
        else{if(data.method==='auditionOn')this.active=true;if(data.method==='auditionOff')this.active=false;reply.value={kind:'fixture',channels:[{channel:0,active:this.active}]};}
        this.emit(reply);
      });
    }
    close(){this.closed=true;}
    start(){}
  }
  globalThis.fetch=fetch;
  globalThis.AudioWorkletNode=class {
    constructor(context,name){this.port=new Port();this.disconnected=0;this.name=name;nodes.push(this);queueMicrotask(()=>{
      if(startupFailure){this.port.emit({fatal:true,error:'native startup failed'});return;}
      this.port.emit({type:'chip-inspector-result',id:'earlier-admin-request',error:'nonfatal editor validation'});
      this.port.emit({ready:true,sampleRate:context.sampleRate,nativeSampleRate:32000});
    });}
    connect(destination){this.destination=destination;}
    disconnect(){this.disconnected++;}
  };
  const context=new EventTarget();Object.assign(context,{sampleRate:48000,state:'running',audioWorklet:{async addModule(){}}});
  t.after(()=>{globalThis.fetch=previous.fetch;globalThis.AudioWorkletNode=previous.AudioWorkletNode;for(const node of nodes){node.port.close();for(const message of node.port.messages)message.port?.close();}});
  return {context,nodes,options:{fetch}};
}

const endpoints=[
  ['gameboy','createGameboyAudio'],['nes','createNesAudio'],['snes','createSnesAudio'],
  ['ym2151','createYm2151Audio'],['huc6280','createHuc6280Audio'],['segapsg','createSegaPsgAudio'],
  ['okim6258','createOki6258Audio'],['rf5c164','createRf5c164Audio'],['pwm','createPWM32XAudio'],
  ['opn','createOpnAudio'],['ym2608','createYm2608Audio'],
];
const open=async(name,factory,fixture)=>{
  // Import after installing fetch: legacy endpoints capture it at module load.
  const module=await import(`./playground_${name}_audio.js?admin-error-regression`);
  return module[factory](fixture.context,{},name==='opn'?'ym2612':fixture.options);
};
for(const [name,factory]of endpoints){
  test(`${name}: admin errors before/after readiness preserve the endpoint and subsequent read/audition RPCs`,{timeout:1500},async t=>{
    const fixture=audioFixture(t),device=await open(name,factory,fixture),node=fixture.nodes[0];
    t.after(()=>{device.dispose();device.port.close();});
    assert.equal(node.disconnected,0,'an admin error received before ready cannot abort initialization');
    const inspector=createChipInspector({endpoints:()=>[{id:name,kind:name,port:device.node.port}],decode:async()=>{throw Error('unused');}});t.after(()=>inspector.dispose());
    const before=await inspector.read(name);await assert.rejects(inspector.invoke(name,'auditionOn',[0,-1,'bad-key']),/Invalid audition MIDI/);
    assert.equal(node.disconnected,0,'a rejected edit cannot dispose a healthy audio node');assert.equal(node.port.closed,false);assert(!node.port.messages.some(message=>message.method==='dispose'));
    assert.deepEqual(await inspector.read(name),before,'the failed caller preserves the applied state');
    assert.equal((await inspector.invoke(name,'auditionOn',[0,69,'valid-key'])).channels[0].active,true,'the same endpoint accepts a later valid audition');
    assert.equal((await inspector.invoke(name,'auditionOff',[0,'valid-key'])).channels[0].active,false);assert.equal(node.disconnected,0);
    if(['snes','huc6280','segapsg','okim6258'].includes(name)){
      node.port.emit({fatal:true,error:'native processor fault'});assert.equal(node.disconnected,1,'native fatal errors still release the endpoint');
    }
  });
  test(`${name}: a native startup error still rejects initialization and cleans its node`,{timeout:1500},async t=>{
    const fixture=audioFixture(t,{startupFailure:true});await assert.rejects(open(name,factory,fixture),/native startup failed/);assert.equal(fixture.nodes[0].disconnected,1);assert.equal(fixture.nodes[0].port.closed,true);
  });
}

test('PWM asset loading uses its captured loader while Playground user-code networking is guarded',async t=>{
  const fixture=audioFixture(t);
  const {createPWM32XAudio}=await import('./playground_pwm_audio.js?captured-fetch-regression');
  globalThis.fetch=()=>{throw new Error('Network access disabled in Playground execution');};
  const device=await createPWM32XAudio(fixture.context,{});
  t.after(()=>{device.dispose();device.port.close();});
  assert.equal(fixture.nodes.length,1);assert.equal(fixture.nodes[0].disconnected,0);
});
