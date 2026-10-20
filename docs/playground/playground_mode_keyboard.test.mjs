import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaygroundModeKeyboard} from './playground_mode_keyboard.js';

for (const [chip,id] of [['gameboy','gameboy'],['nes','nes'],['snes','snes'],['x68000','ym2151'],['huc6280','huc6280'],['segapsg','segapsg'],['dx7','dx7']]) {
  test(`${chip} keyboard borrows only the mode's primary instrument`, async () => {
    const calls = [], inspector = {list:() => [{id:'extra-1',kind:id},{id}],invoke:(...args) => {calls.push(args);return Promise.resolve(true);}};
    const target = createPlaygroundModeKeyboard({chip,getInspector:() => inspector});
    await target.noteOn({id:'key1',midi:69,velocity:75});
    await target.noteOn({id:'key2',midi:72,velocity:100});
    assert.equal(calls[0][0],id);assert.equal(calls[0][1],'auditionOn');
    assert.deepEqual(calls[0][2].slice(0,2),[0,69]);assert.equal(calls[0][2][3],75);
    assert.notEqual(calls[0][2][2],calls[1][2][2]);
    await target.noteOff({id:'key1'});
    assert.deepEqual(calls[2],[id,'auditionOff',[0,calls[0][2][2]]]);
    await target.allNotesOff();assert.deepEqual(calls[3],[id,'auditionOff',[0,calls[1][2][2]]]);
    await target.noteOff({id:'key2'});assert.equal(calls.length,4);
  });
}
test('release during an unacknowledged key-on still releases exactly that identity', async () => {
  const calls = [];let acknowledge;
  const inspector={list:() => [{id:'dx7'}],invoke:(...args) => {calls.push(args);return args[1]==='auditionOn'?new Promise(resolve=>{acknowledge=resolve;}):Promise.resolve(true);}};
  const target=createPlaygroundModeKeyboard({chip:'dx7',getInspector:()=>inspector});
  const pending=target.noteOn({id:'press',midi:69});
  await target.noteOff({id:'press'});acknowledge(true);await pending;
  assert.deepEqual(calls.map(call=>call[1]),['auditionOn','auditionOff']);
  assert.equal(calls[0][2][2],calls[1][2][1]);
});
test('disconnected or replaced runtime never receives stale releases', async () => {
  const calls=[];let inspector={list:()=>[{id:'dx7'}],invoke:(...args)=>{calls.push(args);return Promise.resolve();}};
  const target=createPlaygroundModeKeyboard({chip:'dx7',getInspector:()=>inspector});
  await target.noteOn({id:'old',midi:69});inspector={...inspector};await target.allNotesOff();assert.equal(calls.length,1);
  inspector={list:()=>[{id:'extra',kind:'dx7'}],invoke:()=>assert.fail('must not borrow an independent chip')};
  await assert.rejects(target.noteOn({id:'missing',midi:69}),/not ready/);
  assert.equal(createPlaygroundModeKeyboard({chip:'ym2612',getInspector:()=>inspector}),null);
});
