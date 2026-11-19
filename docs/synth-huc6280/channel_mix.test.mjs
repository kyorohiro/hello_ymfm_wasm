// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHuc6280ChannelMix,applyHuc6280ChannelMask,setupHuc6280ChannelMix} from './channel_mix.js';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};

test('channel listening state is passive, serial, detached and published only after renderer acknowledgement',async()=>{
  const gate=deferred(),calls=[],states=[],mix=createHuc6280ChannelMix({async applyMask(...args){calls.push(args);await gate.promise;}});
  mix.onChange(state=>states.push(state));assert.equal(calls.length,0);
  const detached=mix.read();detached.channelEnabled[0]=false;assert(mix.read().channelEnabled[0]);
  const a=mix.setChannelEnabled(0,false),b=mix.setChannelEnabled(5,false);await turn();
  assert.deepEqual(calls,[[1,0]]);assert.equal(mix.read().channelMuteMask,0);assert(mix.read().busy);
  gate.resolve();const replies=await Promise.all([a,b]);assert(replies.every(state=>!state.busy));assert.deepEqual(calls,[[1,0],[33,1]]);assert.equal(mix.read().channelMuteMask,33);assert(!mix.read().busy);
  await mix.setChannelEnabled(5,false);assert.equal(calls.length,2,'unchanged masks do not command routes');
  assert(states.some(state=>state.busy&&state.channelMuteMask===0));assert.equal(states.at(-1).channelMuteMask,33);
  for(const ch of [-1,6,.2,'0'])assert.throws(()=>mix.setChannelEnabled(ch,false),RangeError);
  assert.throws(()=>mix.setChannelEnabled(0,1),TypeError);mix.dispose();await assert.rejects(mix.setChannelEnabled(0,true),/closed/);
});

test('failed route change restores attempted routes in reverse order and retains accepted UI state',async()=>{
  const events=[],routes=Object.fromEntries(['author','audition','song'].map(name=>[name,{mask:0,async setChannelMuteMask(mask){events.push([name,mask]);this.mask=mask;if(name==='song'&&mask===4)throw Error('native rejected');}}]));
  const mix=createHuc6280ChannelMix({applyMask:(...args)=>applyHuc6280ChannelMask(...args,routes)});
  await assert.rejects(mix.setChannelEnabled(2,false),/native rejected/);
  assert.deepEqual(events,[['author',4],['audition',4],['song',4],['song',0],['audition',0],['author',0]]);
  for(const route of Object.values(routes))assert.equal(route.mask,0);
  assert.equal(mix.read().channelMuteMask,0);assert(!mix.read().busy);
  await mix.setChannelEnabled(0,false);assert.equal(mix.read().channelMuteMask,1,'a rejection does not poison later edits');
});

test('rollback failure is reported explicitly, all remaining routes still receive rollback, and invalid masks never reach audio',async()=>{
  const events=[],fatals=[],routes={author:{async setChannelMuteMask(mask){events.push(['author',mask]);}},audition:{async setChannelMuteMask(mask){events.push(['audition',mask]);if(mask===0)throw Error('trial closed');}},song:{async setChannelMuteMask(mask){events.push(['song',mask]);if(mask)throw Error('song failed');}},onRollbackError:error=>fatals.push(error)};
  await assert.rejects(applyHuc6280ChannelMask(2,0,routes),/song failed/);assert.equal(fatals.length,1);assert(fatals[0] instanceof AggregateError);assert.deepEqual(events.at(-1),['author',0]);
  const count=events.length;for(const mask of [-1,64,NaN,.5,'1'])await assert.rejects(applyHuc6280ChannelMask(mask,0,routes),RangeError);
  assert.equal(events.length,count);
});

test('shared buttons are visible before any song or AudioContext and wait for accepted mask',async()=>{
  class Node {hidden=true;disabled=false;dataset={};attributes={};listeners={};setAttribute(k,v){this.attributes[k]=v;}addEventListener(k,fn){this.listeners[k]=fn;}removeEventListener(k){delete this.listeners[k];}blur(){this.blurred=true;}}
  const nodes=Object.fromEntries(['hucSongChannels',...Array.from({length:6},(_,i)=>`hucSongChannel${i+1}Toggle`)].map(id=>[id,new Node()])),gate=deferred(),errors=[];
  const mix=createHuc6280ChannelMix({applyMask:()=>gate.promise}),ui=setupHuc6280ChannelMix({mix,document:{getElementById:id=>nodes[id]},onError:error=>errors.push(error)}),button=nodes.hucSongChannel1Toggle;
  assert(!nodes.hucSongChannels.hidden);assert.equal(button.attributes['aria-pressed'],'true');button.listeners.click();await turn();
  assert(button.blurred);assert(button.disabled);assert.equal(button.attributes['aria-pressed'],'true');gate.resolve();await turn();
  assert(!button.disabled);assert.equal(button.attributes['aria-pressed'],'false');assert.equal(nodes.hucSongChannels.dataset.channelMuteMask,'1');assert.equal(errors.length,0);
  ui.dispose();assert.equal(Object.keys(button.listeners).length,0);mix.dispose();
});
