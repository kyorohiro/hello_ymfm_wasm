import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaygroundModeKeyboard,playgroundPrimaryKeyboardChips} from './playground_mode_keyboard.js';
import {getPlaygroundMode} from './playground_mode.js';

for (const [chip,id] of [['ps1','ps1'],['pokey','pokey'],['wonderswan','wonderswan'],['gameboy','gameboy'],['nes','nes'],['snes','snes'],['x68000','ym2151'],['msx','ym2413'],['msx-audio','y8950'],['huc6280','huc6280'],['segapsg','segapsg'],['dx7','dx7'],...['ym3812','ym3526','y8950','ymf262','ym2413','ay8910'].map(chip => [chip,chip])]) {
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
test('multi-chip environments expose physical primary IDs before preparation',() => {
  const ids = (mode,capabilities) => playgroundPrimaryKeyboardChips(mode,capabilities).map(({id,kind}) => [id,kind]);
  assert.deepEqual(ids({chip:'wonderswan'}),[['wonderswan','wonderswan']]);
  assert.deepEqual(ids({chip:'msx'}),[['ym2413','ym2413'],['ay8910','ay8910']]);
  assert.deepEqual(ids({chip:'msx-audio'}),[['y8950','y8950'],['ym2413','ym2413'],['ay8910','ay8910']]);
  assert.deepEqual(ids({chip:'segapsg',ym2413:true}),[['segapsg','segapsg'],['ym2413','ym2413']]);
  assert.deepEqual(ids({chip:'segapsg'}),[['segapsg','segapsg']]);
  assert.deepEqual(playgroundPrimaryKeyboardChips({id:'atari-st',chip:'ay8910'}),[{id:'ay8910',kind:'ay8910',label:'YM2149 (primary)'}]);
  assert.deepEqual(ids({chip:'x68000'}),[['ym2151','ym2151'],['okim6258','okim6258']]);
  assert.deepEqual(ids({chip:'ym2612',full:true},{psg:true,pcm:true}),[['ym2612','ym2612'],['segapsg','segapsg'],['rf5c164','rf5c164'],['pwm','pwm']]);
});

test('Mega-CD CD-DA is an inspector source and never becomes an instrument Keyboard target', () => {
  assert.deepEqual(playgroundPrimaryKeyboardChips(getPlaygroundMode('mega-cd'), {psg:true,pcm:true})
    .map(({id})=>id), ['ym2612','segapsg','rf5c164']);
});
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


test('dual POKEY exposes two physical four-channel keyboard targets',()=>{
  const chips=playgroundPrimaryKeyboardChips({id:'pokey-dual',chip:'pokey',dualPokey:true});
  assert.deepEqual(chips,[{id:'pokey',kind:'pokey',label:'POKEY 1 (primary)'},{id:'pokey:2',kind:'pokey',label:'POKEY 2 (primary)'}]);
  assert.deepEqual(playgroundPrimaryKeyboardChips({id:'pokey',chip:'pokey'}),chips.slice(0,1));
});
