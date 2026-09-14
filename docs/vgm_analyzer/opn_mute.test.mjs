import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('YM2203 channel buttons use output mute without issuing key-off',()=>{
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8'),calls=[];
 const context=vm.createContext({currentChipKind:'ym2203',channelMonitor:[{muted:false,changedAt:{}}],channelMuteStates:[],
  performance,requestChannelMonitorRender(){},engine:{setChannelMuted:(...args)=>calls.push(args)},
  baseEngineWriteYm2203:()=>assert.fail('must not alter key-on'),flushPendingAudio:()=>calls.push('flush')});
 vm.runInContext(source.slice(source.indexOf('function toggleChannelMute('),source.indexOf('function flushPendingAudio(')),context);
 context.toggleChannelMute(0);context.toggleChannelMute(0);
 assert.deepEqual(calls,[[0,true],'flush',[0,false],'flush']);
 // Execute the production register wrapper itself: a muted CH must retain key-on.
 const writes=[];context.applyYm2203WriteToMonitor=()=>{};context.baseEngineWriteYm2203=(...args)=>writes.push(args);
 const start=source.indexOf('engine.writeYm2203 = (register, value) =>');
 vm.runInContext(source.slice(start,source.indexOf('};',start)+2),context);
 context.channelMonitor[0].muted=true;context.engine.writeYm2203(0x28,0xf0);
 assert.deepEqual(writes,[[0x28,0xf0]]);
});
