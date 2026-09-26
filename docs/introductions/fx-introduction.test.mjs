import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {LiveFX} from '../../web/custom_fx.js';
import {createNativeFXController} from '../../web/native_fx.js';
test('all embedded FX lessons register valid APIs and complete their reference loop',async()=>{
 for(const name of ['gain','slicer']){
  const html=await readFile(new URL('./tetorica-fx-'+name+'.html',import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script type="text\/plain" id="([^"]+)">([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length,2);
  for(const [,id,source] of scripts){
   const messages=[],loops=[],keys=[],processor=new LiveFX(48000);
   const fx=createNativeFXController(d=>{messages.push(d);if(d.op==='live-fx')processor.command(d);});
   let cyclePosition=0;
   const api={
    setBpm(){},fx,
    cycle(values){return values[cyclePosition++ % values.length];},
    livePrepare:async(_name,fn)=>fn({fx}),
    liveFx(name,{process,context}){processor.command({action:'register',name,source:process.toString(),context});},
    fm:{setPreset(){},setFrequency(){},keyOn(ch){keys.push(['on',ch]);},keyOff(ch){keys.push(['off',ch]);}},
    CH1:0,FM_PRESETS:{sine:{}},hzToBlockFnum:()=>({block:3,fnum:500}),
    liveLoop(_name,fn){loops.push(fn);},async beat(){},
   };
   const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
   await new AsyncFunction(...Object.keys(api),source)(...Object.values(api));
   assert.equal(loops.length,1,id);await loops[0]();
   assert.deepEqual(keys,[['on',0],['off',0]]);
   if(id==='gain-native'){
    await loops[0]();await loops[0]();await loops[0]();
    assert.deepEqual(messages.filter(m=>m.op==='parameter'&&m.key==='gain').map(m=>m.value),[.25,.5,1,.25]);
   }
   if(id==='gain-live'){
    await loops[0]();await loops[0]();await loops[0]();
    assert.deepEqual(messages.filter(m=>m.action==='context').map(m=>m.context.gain),[.25,.5,1,.25]);
   }
   assert.ok(html.includes('data-playground-src="'+id+'"'));
   if(id.endsWith('native')){
    assert.ok(messages.some(m=>m.op==='chain'));
    assert.ok(messages.some(m=>m.op==='create'&&m.unit.type===name));
    assert.ok(processor.effects.has('none'));
    const audio=[Float32Array.of(.2,-.3,0),Float32Array.of(-.1,.4,0)];
    const original=audio.map(ch=>ch.slice());
    processor.process(audio,assert.fail);
    assert.deepEqual(audio,original,'observer preserves both channels');
   }else{
    const output=[];
    for(let block=0;block<100;block++){
     const audio=[new Float32Array(128).fill(.2),new Float32Array(128).fill(.2)];
     processor.process(audio,assert.fail);
     assert.deepEqual(audio[0],audio[1],id+' stereo synchronization');
     output.push(...audio[0]);
    }
    if(name==='gain')assert.ok(output.every(x=>Math.abs(x-.05)<1e-6));
    else {
     assert.ok(output.slice(0,6000).every(x=>Math.abs(x-.14)<1e-6));
     assert.ok(output.slice(6000,12000).every(x=>x===0));
     assert.ok(output.slice(12000).every(x=>Math.abs(x-.14)<1e-6));
    }
   }
  }
 }
});
