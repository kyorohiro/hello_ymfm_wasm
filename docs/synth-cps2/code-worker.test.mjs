// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';

test('Code assigns a project WAV slice on CH16 and resolves the latest file paths on Apply',async()=>{
  const messages=[];
  globalThis.postMessage=message=>messages.push(message);
  globalThis.onmessage=null;
  try{
    await import('./code-worker.js');
    const path='/samples/low.wav';
    const sample={bank:3,start:0x8200,length:600,rate:4071};
    const execute=async(source,extra={})=>{
      messages.length=0;
      await globalThis.onmessage({data:{source,path:'/index.js',captured:true,samples:[[path,sample]],...extra}});
    };
    await execute("qsound.assignSample(16,'/samples/low.wav',{offset:32,length:256,loop:64});qsound.noteOn(16,67);");
    assert.deepEqual(messages[0].writes,[[112,0x8003],[121,0x8220],[123,0],[124,64],[125,0x8320],[122,4071]]);
    assert.deepEqual(messages[1].audition,{type:'captured-note',channel:15,midi:67});
    await execute("qsound.assignSample(16,'/samples/low.wav');",{apply:true,samples:[]});
    assert.match(messages.at(-1).status,/Missing PCM sample/);
    await execute("qsound.assignSample(16,'/samples/low.wav',{offset:599,length:2});",{apply:true});
    assert.match(messages.at(-1).status,/Sample length/);
    assert.ok(messages.every(m=>!m.writes));
    globalThis.postMessage=message=>{
      messages.push(message);
      if(message.assignPad){
        const {path,voice,reply}=message.assignPad;
        assert.equal(path,'/samples/low.wav');
        reply.postMessage(voice===2?{}:{error:'Sample ROM is full'});
        reply.close();
      }
    };
    await execute("await qsound.assignPad(2,'/samples/low.wav');qsound.trigger(2);",{apply:true});
    assert.deepEqual(messages[1].writes,[[0xd7,1]]);
    await execute("await qsound.assignPad(3,'/samples/low.wav');qsound.trigger(3);",{apply:true});
    assert.match(messages.at(-1).status,/Sample ROM is full/);
    assert.ok(messages.every(m=>!m.writes));
    await execute("await qsound.assignPad(4,'/samples/low.wav');");
    assert.match(messages.at(-1).status,/ADPCM voice/);
    await execute("qsound.assignSample(1,'/samples/low.wav');",{apply:true,samples:null});
    assert.match(messages.at(-1).status,/Use synth instruments/);
  }finally{
    delete globalThis.postMessage;
    delete globalThis.onmessage;
  }
});
