import test from 'node:test';
import assert from 'node:assert/strict';
import {createSoundChipRegistry} from './playground_soundchips.js';

test('concurrent lookup shares initialization and ready instance; manual dispose evicts',async()=>{
 const registry=createSoundChipRegistry();let creates=0,disposes=0,finish;
 const create=()=>{creates++;return new Promise(resolve=>{finish=resolve;});};
 const a=registry.use('rf5c164',undefined,create),b=registry.use('rf5c164',{},create);
 assert.equal(a,b);await Promise.resolve();assert.equal(creates,1);
 const chip={dispose(){disposes++;}};finish(chip);assert.equal(await a,await b);
 assert.equal(await registry.use('rf5c164',{},create),chip);
 chip.dispose();assert.equal(disposes,1);
 const replacement={dispose(){}};assert.equal(await registry.use('rf5c164',{},()=>replacement),replacement);
});
test('failure permits retry; stale initialization cannot replace or evict a fresh generation',async()=>{
 const registry=createSoundChipRegistry();
 await assert.rejects(registry.use('gameboy',undefined,()=>{throw Error('init failed');}),/init failed/);
 let finish;const pending=registry.use('gameboy',undefined,()=>new Promise(resolve=>{finish=resolve;}));
 await Promise.resolve();registry.clear();
 const fresh={dispose(){}};assert.equal(await registry.use('gameboy',undefined,()=>fresh),fresh);
 finish({dispose(){}});await assert.rejects(pending,/Run stopped/);
 assert.equal(await registry.use('gameboy',undefined,()=>assert.fail('unexpected recreation')),fresh);
});
test('invalid names and options do not create instances',async()=>{
 const registry=createSoundChipRegistry(),create=()=>assert.fail('unexpected creation');
 await assert.rejects(registry.use('sn76489',undefined,create),/Unsupported/);
 for(const options of [{id:'fm1'},{clock:1},null,[],1])await assert.rejects(registry.use('ym2612',options,create),/options/);
});
