// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {setupScspSongControls} from './song_controls.js';

function rig() {
  const listeners = new Map(), nodes = new Map();
  for (const id of ['scspSongSelect','scspSongPlay','scspSongPause','scspSongStop','scspSongSeek','scspSongPosition','scspSongStatus','scspSongDemo']) {
    const events = new Map();
    nodes.set(id,{value:'',textContent:'',disabled:false,events,addEventListener(type,callback) {events.set(type,callback);},removeEventListener(type) {events.delete(type);},replaceChildren(...children) {this.children = children;},blur() {}});
  }
  const document = {getElementById:id => nodes.get(id), createElement:() => ({})}, files = new Map();
  const project = {fs:{list:() => [...files.values()],get:path => files.get(path)},onDidChange(callback) {listeners.set('change',callback); return () => listeners.delete('change');}};
  let options, loaded = '', status = '', state = {playback:'stopped',loaded:false,busy:false,warnings:[],positionSeconds:0,durationSeconds:0};
  const player = {getState:() => state, clear() {loaded = ''; state = {...state,loaded:false}; options.onState(state);},stop() {state = {...state,playback:'stopped'}; options.onState(state);},dispose() {},
    async load(data,name,settings = {}) {
      await Promise.resolve();
      if (settings.signal?.aborted || settings.isCurrent && !settings.isCurrent()) throw new DOMException('Cancelled','AbortError');
      if (!data[0]) throw new Error('Invalid song'); loaded = name; state = {...state,loaded:true,durationSeconds:2.4}; options.onState(state);
    },whenIdle:async () => {},play:async () => {},pause() {},resume:async () => {},seek:async () => {}};
  const controller = setupScspSongControls({project,document,ensureAudio:async () => {},getAudio:() => null,
    setStatus:message => {status = message;},createPlayer:settings => {options = settings; return player;}});
  const put = (path, data) => {files.set(path,{path,type:'binary',data,revision:(files.get(path)?.revision ?? 0) + 1}); listeners.get('change')?.();};
  return {controller,nodes,files,put,get loaded() {return loaded;},get status() {return status;},listeners};
}

test('Files songs populate selection and a failed replacement retains its selected source', async () => {
  const r = rig();
  try {
    r.put('/vgm/first.vgm',new Uint8Array([1])); r.put('/vgm/bad.vgz',new Uint8Array([0])); r.put('/audio/reference.wav',new Uint8Array([9]));
    assert.equal(r.nodes.get('scspSongSelect').children.length,3);
    assert.equal(await r.controller.selectFile('/vgm/first.vgm'),true); assert.equal(r.loaded,'first.vgm');
    await assert.rejects(r.controller.selectFile('/vgm/bad.vgz'),/Invalid song/);
    assert.equal(r.loaded,'first.vgm'); assert.equal(r.nodes.get('scspSongSelect').value,'/vgm/first.vgm');
    r.put('/vgm/first.vgm',new Uint8Array([2])); assert.equal(r.controller.getState().loaded,false);
  } finally {r.controller.dispose(); assert.equal(r.listeners.size,0);}
});

test('stale Files callbacks cannot commit a song and the original demo needs no import', async () => {
  const r = rig();
  try {
    r.put('/vgm/first.vgm',new Uint8Array([1]));
    await assert.rejects(r.controller.selectFile(r.files.get('/vgm/first.vgm'),{path:'/vgm/first.vgm',isCurrent:() => false}),{name:'AbortError'});
    assert.equal(r.loaded,'');
    assert.equal(await r.controller.loadDemo(),true); assert.equal(r.loaded,'Original SCSP demo'); assert.match(r.status,/demo/);
    r.put('/vgm/another.vgm',new Uint8Array([2])); assert.equal(r.controller.getState().loaded,true);
  } finally {r.controller.dispose();}
});
