import test from 'node:test';
import assert from 'node:assert/strict';
import {createFm2608FmSsgMonitor} from './fm_ssg_monitor.js';
import {installMonitorMutes} from './audio.js';
import {YM2608Synth} from '../js/ym2608synth.js';
const fixture=()=>{const writes=[];return {writes,monitor:createFm2608FmSsgMonitor({writePhysical:(port,register,value)=>writes.push([port,register,value])})};};
for(const channel of [0,2,3,5])test(`FM ${channel+1}: muted edits and Stop preserve latest authored TL until the next Gate`,()=>{
 const {writes,monitor}=fixture(),port=channel>=3?1:0,reg=0x40+channel%3,key=channel<3?channel:channel+1;
 monitor.write(port,reg,25);monitor.setMute('fm',channel,true);monitor.write(port,reg,17);assert.deepEqual(writes.at(-1),[port,reg,127]);
 monitor.setMute('fm',channel,false);assert.deepEqual(writes.slice(-4)[0],[port,reg,17]);
 monitor.stopFm();monitor.write(port,reg,12);assert.deepEqual(writes.at(-1),[port,reg,127]);
 writes.length=0;monitor.write(0,0x28,0xf0|key);
 assert.deepEqual(writes[0],[port,reg,12]);assert.deepEqual(writes.at(-1),[0,0x28,0xf0|key]);
 assert.equal(monitor.getState().stopped[channel],false);
 monitor.setMute('fm',channel,true);monitor.stopFm();writes.length=0;monitor.write(0,0x28,0xf0|key);
 assert.equal(writes[0][2],127,'Gate cannot override a UI mute');
});
test('SSG mute does not change Gate/level intent and unmute cannot resurrect an already released voice',()=>{
 const {monitor,writes}=fixture();monitor.write(0,8,12);monitor.setMute('ssg',0,true);
 monitor.write(0,8,16);assert.deepEqual(writes.at(-1),[0,8,0]);assert.equal(monitor.getState().registers[0][8],16);
 monitor.setMute('ssg',0,false);assert.deepEqual(writes.at(-1),[0,8,16]);
 monitor.setMute('ssg',0,true);monitor.write(0,8,0);monitor.setMute('ssg',0,false);assert.deepEqual(writes.at(-1),[0,8,0]);
});
test('reset clears levels/Stop while keeping chosen mutes; unsupported messages reject atomically',()=>{
 const {monitor,writes}=fixture();monitor.setMute('fm',4,true);monitor.stopFm();monitor.reset();assert.deepEqual(monitor.getState().stopped,Array(6).fill(false));
 monitor.write(1,0x41,20);assert.equal(writes.at(-1)[2],127);
 const before=monitor.getState(),n=writes.length;
 for(const change of [{section:'adpcm',channel:1,value:true},{section:'fm',channel:6,value:true},{section:'ssg',channel:0,value:1}])assert.throws(()=>monitor.receive({type:'synth-fm-ssg-monitor',action:'mute',...change}));
 assert.throws(()=>monitor.receive({type:'synth-fm-ssg-monitor',action:'unknown'}));assert.deepEqual(monitor.getState(),before);assert.equal(writes.length,n);
 assert.equal(monitor.receive({type:'write'}),false);
});
test('non-level registers and ADPCM pass through; unmuted Rhythm keeps its exact bytes',()=>{
 const {monitor,writes}=fixture();for(const row of [[0,7,0xe1],[0,13,8],[0,0x18,0xc4],[1,11,192],[1,0,0xb0]])monitor.write(...row);
 assert.deepEqual(writes,[[0,7,0xe1],[0,13,8],[0,0x18,0xc4],[1,11,192],[1,0,0xb0]]);assert.equal(monitor.getState().registers[0][0x18],0xc4);
});
test('delegated host monitor leaves FM/SSG bytes authored, without stale restores; other sections retain their guard',()=>{
 const writes=[],commands=[];const chip=new YM2608Synth({transport:{write:(p,r,v)=>writes.push([p,r,v]),reset(){}}});
 writes.length=0;
 const monitor=installMonitorMutes(chip,{fmSsgBackend:{setMute:(...args)=>commands.push(args),stopFm:()=>commands.push('stop')}});
 monitor.setMute('fm',0,true);monitor.setMute('ssg',1,true);assert.equal(writes.length,0);
 chip.setOperator(0,0,{tl:24});chip.ssg.setVolume(1,11);assert.deepEqual(writes,[[0,0x40,24],[0,9,11]]);
 monitor.stopFm();assert.equal(writes.filter(x=>x[1]>=0x40&&x[1]<=0x4e).length,1,'host does not send stale TL overrides');assert.equal(commands.at(-1),'stop');
 writes.length=0;chip.noteOn(0,'C4');assert(!writes.some(x=>x[1]>=0x40&&x[1]<=0x4e));
 monitor.setMute('rhythm',0,true);chip.rhythm.setVoice(0,{left:true,right:true,volume:7});assert.equal(writes.at(-1)[2],0xc7);
 monitor.setMute('adpcm',0,true);chip.adpcm.setVolume(100);assert.equal(writes.at(-1)[2],100);
});
