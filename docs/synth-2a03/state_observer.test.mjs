// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createStateObserver} from './state_observer.js';

const flush = async () => {for (let turn = 0; turn < 4; turn++) await Promise.resolve();};
function fixture(options = {}) {
  const timers = new Map(), reads = [], states = [], statuses = [];
  let nextTimer = 0, outstanding = 0, maximumOutstanding = 0;
  const observer = createStateObserver({
    read(engine) {
      outstanding++; maximumOutstanding = Math.max(maximumOutstanding,outstanding);
      assert.equal(outstanding,1,'a replacement must wait for the previous engine read');
      return new Promise((resolve,reject) => reads.push({engine,
        resolve(value) {outstanding--; resolve(value);},
        reject(error = new Error('Worklet closed')) {outstanding--; reject(error);}}));
    },
    onState:(state,engine) => states.push({state,engine}), onStatus:value => statuses.push(value),
    schedule(fn,delay) {const id=++nextTimer;timers.set(id,{fn,delay});return id;},
    cancel:id => timers.delete(id), ...options,
  });
  return {observer,timers,reads,states,statuses,get maximumOutstanding(){return maximumOutstanding;},
    tick() {assert.equal(timers.size,1);const [id,timer]=timers.entries().next().value;timers.delete(id);assert.equal(timer.delay,100);timer.fn();}};
}

test('passive state observation starts only for an active engine and schedules after each reply', async () => {
  const f=fixture(),engine={};
  f.observer.update();f.observer.update({engine,active:false});f.observer.invalidate();
  assert.deepEqual(f.statuses,['idle']);assert.equal(f.reads.length,0);assert.equal(f.timers.size,0);
  f.observer.update({engine,active:true});assert.equal(f.reads.length,1);assert.equal(f.timers.size,0);
  for(let i=0;i<30;i++)f.observer.update({engine,active:true});
  assert.equal(f.reads.length,1);assert.deepEqual(f.statuses,['idle','waiting']);
  f.reads[0].resolve({volume:15});await flush();
  assert.deepEqual(f.states,[{state:{volume:15},engine}]);assert.deepEqual(f.statuses,['idle','waiting','live']);
  assert.equal(f.timers.size,1);f.tick();assert.equal(f.reads.length,2);assert.equal(f.timers.size,0);
  f.reads[1].resolve({volume:12});await flush();assert.equal(f.states[1].state.volume,12);
  assert.equal(f.timers.size,1);assert.equal(f.maximumOutstanding,1);f.observer.dispose();assert.equal(f.timers.size,0);
});

test('engine replacement coalesces to the latest target without overlapping or publishing stale state', async () => {
  const f=fixture(),first={},second={},latest={};
  f.observer.update({engine:first,active:true});
  f.observer.update({engine:second,active:true});f.observer.invalidate();f.observer.update({engine:latest,active:true});
  assert.equal(f.reads.length,1);assert.equal(f.timers.size,0);
  f.reads[0].resolve('old');await flush();
  assert.deepEqual(f.states,[]);assert.equal(f.reads.length,2);assert.equal(f.reads[1].engine,latest);
  f.reads[1].resolve('latest');await flush();assert.deepEqual(f.states,[{state:'latest',engine:latest}]);
  assert.equal(f.maximumOutstanding,1);f.observer.dispose();
});

test('stop and restart discard the previous in-flight read even when the engine identity is unchanged', async () => {
  const f=fixture(),engine={};f.observer.update({engine,active:true});
  f.observer.update({engine,active:false});f.observer.update({engine,active:true});
  assert.equal(f.reads.length,1);f.reads[0].resolve('before-stop');await flush();
  assert.equal(f.states.length,0);assert.equal(f.reads.length,2);
  f.reads[1].resolve('restarted');await flush();assert.deepEqual(f.states,[{state:'restarted',engine}]);
  f.observer.update({engine,active:false});assert.equal(f.timers.size,0);
  assert.deepEqual(f.statuses,['waiting','idle','waiting','live','idle']);f.observer.dispose();
});

test('invalidation cancels scheduled reads and ignores a cancelled callback that was already queued', async () => {
  const f=fixture(),engine={};f.observer.update({engine,active:true});f.reads[0].resolve('first');await flush();
  const queued=[...f.timers.values()][0].fn;
  f.observer.invalidate();assert.equal(f.timers.size,0);assert.equal(f.reads.length,2);
  queued();assert.equal(f.reads.length,2);
  f.observer.invalidate();f.observer.invalidate();f.reads[1].resolve('stale');await flush();
  assert.equal(f.reads.length,3);assert.equal(f.states.length,1);
  f.reads[2].resolve('current');await flush();assert.deepEqual(f.states.map(item=>item.state),['first','current']);
  f.observer.dispose();
});

test('a read failure stops its lease and identical updates do not hot-retry it', async () => {
  const f=fixture(),engine={};f.observer.update({engine,active:true});f.reads[0].reject();await flush();
  assert.deepEqual(f.statuses,['waiting','unavailable']);assert.equal(f.timers.size,0);assert.equal(f.states.length,0);
  for(let i=0;i<20;i++)f.observer.update({engine,active:true});
  assert.equal(f.reads.length,1);
  f.observer.update({engine,active:false});f.observer.update({engine,active:true});
  assert.equal(f.reads.length,2);f.reads[1].resolve('recovered');await flush();assert.equal(f.states[0].state,'recovered');
  f.observer.dispose();
});

test('an old rejected read cannot mark its new target unavailable', async () => {
  const f=fixture(),first={},second={};f.observer.update({engine:first,active:true});
  f.observer.update({engine:second,active:true});f.reads[0].reject();await flush();
  assert.equal(f.statuses.includes('unavailable'),false);assert.equal(f.reads.length,2);
  f.reads[1].resolve('new engine');await flush();assert.deepEqual(f.states,[{state:'new engine',engine:second}]);f.observer.dispose();
});

test('synchronous reads and throwing UI callbacks remain contained without breaking later observation', async () => {
  let attempts=0;
  const f=fixture({read:() => {attempts++;throw new Error('Synchronous read failure');}}),engine={};
  assert.doesNotThrow(()=>f.observer.update({engine,active:true}));await flush();
  assert.equal(attempts,1);assert.deepEqual(f.statuses,['waiting','unavailable']);assert.equal(f.timers.size,0);
  f.observer.invalidate();await flush();assert.equal(attempts,2);f.observer.dispose();
  const g=fixture({onState:() => {throw new Error('Detached UI');},onStatus:() => Promise.reject(new Error('Detached status'))});
  g.observer.update({engine,active:true});g.reads[0].resolve('one');await flush();assert.equal(g.timers.size,1);
  g.tick();g.reads[1].resolve('two');await flush();assert.equal(g.timers.size,1);g.observer.dispose();await flush();
});

test('disposing an observer stops timers and makes late replies, updates and invalidation inert', async () => {
  const f=fixture(),engine={};f.observer.update({engine,active:true});f.observer.dispose();f.observer.dispose();
  f.observer.update({engine:{},active:true});f.observer.invalidate();f.reads[0].resolve('late');await flush();
  assert.equal(f.reads.length,1);assert.deepEqual(f.states,[]);assert.equal(f.timers.size,0);
  assert.deepEqual(f.statuses,['waiting','disposed']);
  const g=fixture();g.observer.update({engine,active:true});g.reads[0].resolve('observed');await flush();
  const queued=[...g.timers.values()][0].fn;g.observer.dispose();queued();assert.equal(g.reads.length,1);assert.equal(g.timers.size,0);
});

test('invalid observer options fail before any timer or engine is created', () => {
  for(const intervalMs of [0,-1,NaN,Infinity])assert.throws(()=>createStateObserver({intervalMs}),RangeError);
  for(const key of ['read','onState','onStatus','schedule','cancel'])assert.throws(()=>createStateObserver({[key]:null}),TypeError);
});
