import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerDac} from './playground_worker_dac.js';
import {createChipPortReceiver} from './playground_chip_port.js';

test('DAC views, validation and retained bank data', async () => {
 const commands=[], d=createWorkerDac(c=>commands.push(c));
 const bytes=new Uint8Array([9,0,0,0,0,128,9]);
 await d.api.load('sine',bytes.subarray(1,6));
 bytes.fill(0);
 assert.deepEqual([...new Uint8Array(commands[0].data)],[0,0,0,0,128]);
 await assert.rejects(d.api.load('bad',new Uint8Array(4)),/length/);
 await assert.rejects(d.api.loadBase64('bad','AA=='),/length/);
 assert.throws(()=>d.api.playStream('missing'),/Unknown DAC/);
 assert.throws(()=>d.schedule(0,[[NaN,0,42,128]]),/offset/);
 d.reset();d.api.playStream('sine');
 assert.equal(commands.at(-1).type,'sample-dac-bank');
});

test('Audio clock origin is shared, then reset for the next run', () => {
 let now=10;const commands=[];
 const receiver=createChipPortReceiver(c=>commands.push(c),()=>now);
 const port={start(){},close(){}};
 receiver({type:'attach-chip-port',port});
 const dac=createWorkerDac(c=>port.onmessage({data:[c]}),{lookaheadSeconds:.25});
 dac.begin();now=20;
 dac.schedule(44100,[[0,0,42,128]]);
 assert.equal(commands[0].entries[0].time,11.25);
 dac.reset();dac.schedule(0,[[441,0,42,128]]);
 assert.equal(commands[1].entries[0].time,20.26);
});

test('mixed FM and PSG sample tuples reach the worklet with the same origin and order',()=>{
 const received=[],receiver=createChipPortReceiver(c=>received.push(c),()=>10);
 const port={start(){},close(){}};receiver({type:'attach-chip-port',port});
 const d=createWorkerDac(c=>port.onmessage({data:[c]}),{lookaheadSeconds:.25});
 d.schedule(441,[[0,0,0x22,8],[0,'psg',0x85],[0,'psg',0x12],[441,'psg',0x9f]]);
 const e=received[0].entries;
 assert.deepEqual(e.map(x=>x.type??'fm'),['fm','psg-write','psg-write','psg-write']);
 assert.deepEqual(e.map(x=>x.time),[10.26,10.26,10.26,10.27]);
 assert.deepEqual(e.slice(1).map(x=>x.value),[0x85,0x12,0x9f]);
 const n=received.length;assert.throws(()=>d.schedule(0,[[0,'psg',256]]),/PSG/);assert.equal(received.length,n);
});
