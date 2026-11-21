// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {setupScspSongControls} from './song_controls.js';
import {prepareScspSsfSource} from './ssf_source.js';
import {createScspSsfPlaybackFixture} from '../../test/helpers/scsp_ssf_fixture.mjs';

function rig() {
  const listeners = new Map(), nodes = new Map();
  for (const id of ['scspSongSelect','scspSongPlay','scspSongPause','scspSongStop','scspSongSeek','scspSongPosition','scspSongStatus','scspSongDemo']) {
    const events = new Map();
    nodes.set(id,{value:'',textContent:'',disabled:false,events,addEventListener(type,callback) {events.set(type,callback);},removeEventListener(type) {events.delete(type);},replaceChildren(...children) {this.children = children;},blur() {}});
  }
  const document = {getElementById:id => nodes.get(id), createElement:() => ({})}, files = new Map();
  const project = {fs:{list:() => [...files.values()],get:path => files.get(path)},onDidChange(callback) {listeners.set('change',callback); return () => listeners.delete('change');}};
  let options, loaded = '', status = '', audioRequests = 0, state = {playback:'stopped',loaded:false,busy:false,warnings:[],positionSeconds:0,durationSeconds:0,kind:null};
  const calls = [];
  const player = {getState:() => state, clear() {loaded = ''; state = {...state,loaded:false,kind:null}; options.onState(state);},stop() {state = {...state,playback:'stopped'}; options.onState(state);},dispose() {},
    async load(data,name,settings = {}) {
      await Promise.resolve();
      if (settings.signal?.aborted || settings.isCurrent && !settings.isCurrent()) throw new DOMException('Cancelled','AbortError');
      if (!data[0]) throw new Error('Invalid song'); loaded = name; state = {...state,loaded:true,durationSeconds:2.4,kind:'vgm',loadedFiles:[]}; options.onState(state);
      calls.push(['vgm',data,name]);
    },
    async loadSsf(entries,path,settings) {
      const source = await prepareScspSsfSource(entries,path,settings);
      if (!settings.isCurrent(source)) throw new DOMException('Cancelled','AbortError');
      loaded = path;
      state = {...state,loaded:true,durationSeconds:source.durationSeconds,kind:'ssf',format:source.format,loadedFiles:source.loadedFiles};
      options.onState(state);
    },
    whenIdle:async () => {},play:async () => {},pause() {},resume:async () => {},seek:async () => {}};
  const controller = setupScspSongControls({project,document,ensureAudio:async () => {audioRequests++;},getAudio:() => null,
    setStatus:message => {status = message;},createPlayer:settings => {options = settings; return player;}});
  const put = (path, data) => {files.set(path,{path,type:'binary',data,revision:(files.get(path)?.revision ?? 0) + 1}); listeners.get('change')?.();};
  const remove = path => {files.delete(path);listeners.get('change')?.();};
  return {controller,nodes,files,put,remove,calls,emit(patch) {state={...state,...patch};options.onState(state);},get loaded() {return loaded;},get status() {return status;},get audioRequests() {return audioRequests;},listeners};
}

test('playback ticks keep the Pause text node stable until its label actually changes', async () => {
  const r=rig();
  try {
    r.put('/vgm/first.vgm',Uint8Array.of(1));await r.controller.selectFile('/vgm/first.vgm');
    const button=r.nodes.get('scspSongPause');let text=button.textContent,writes=0;
    Object.defineProperty(button,'textContent',{get:()=>text,set(value){text=value;writes++;}});
    for(let n=0;n<20;n++)r.emit({playback:'playing',playing:true,paused:false,canPause:true,canResume:false,positionSeconds:n*.05});
    assert.equal(text,'Pause');assert.equal(writes,0,'steady playback must not replace its text child');
    r.emit({playback:'paused',playing:false,paused:true,canPause:false,canResume:true});
    assert.equal(text,'Resume');assert.equal(writes,1);
    for(let n=0;n<10;n++)r.emit({paused:true});
    assert.equal(writes,1);
    r.emit({playback:'playing',playing:true,paused:false,canPause:true,canResume:false});
    assert.equal(text,'Pause');assert.equal(writes,2);
  } finally {r.controller.dispose();}
});

test('Files songs populate selection and a failed replacement retains its selected source', async () => {
  const r = rig();
  try {
    r.put('/vgm/first.vgm',new Uint8Array([1])); r.put('/vgm/bad.vgz',new Uint8Array([0])); r.put('/audio/reference.wav',new Uint8Array([9]));
    const retainedSsf = Uint8Array.of(5, 6, 7);
    r.put('/ssf/legacy.ssf', retainedSsf);
    assert.equal(r.nodes.get('scspSongSelect').children.length,4);
    assert.deepEqual(r.files.get('/ssf/legacy.ssf').data, retainedSsf);
    assert.equal(await r.controller.selectFile('/vgm/first.vgm'),true); assert.equal(r.loaded,'first.vgm');
    await assert.rejects(r.controller.selectFile('/ssf/legacy.ssf'),/SSF:/);
    await assert.rejects(r.controller.selectFile('/vgm/bad.vgz'),/Invalid song/);
    assert.equal(r.loaded,'first.vgm'); assert.equal(r.nodes.get('scspSongSelect').value,'/vgm/first.vgm');
    const replacement = r.controller.selectFile('/vgm/bad.vgz');
    r.put('/vgm/bad.vgz', new Uint8Array([3]));
    await assert.rejects(replacement, {name: 'AbortError'});
    assert.equal(r.loaded, 'first.vgm');
    r.put('/vgm/first.vgm',new Uint8Array([2])); assert.equal(r.controller.getState().loaded,false);
  } finally {r.controller.dispose(); assert.equal(r.listeners.size,0);}
});

test('SSF library files are hidden from the song list and edits invalidate only dependent sources', async () => {
  const r = rig(), { files } = createScspSsfPlaybackFixture();
  try {
    for (const {path,data} of files) r.put(path,data);
    const [song,library] = files;
    const select = r.nodes.get('scspSongSelect');
    assert.deepEqual(select.children.map(child => child.value),['',song.path]);
    assert(await r.controller.selectFile(song.path));
    assert.equal(r.controller.getState().format,'MiniSSF');
    assert.equal(r.audioRequests,0);
    r.put('/ssf/unrelated.ssflib',Uint8Array.of(3));
    assert.equal(r.loaded,song.path);
    r.remove(library.path);
    assert.equal(r.controller.getState().loaded,false);
    await assert.rejects(r.controller.selectFile(song.path),/missing SSFLib/);
  } finally {r.controller.dispose();}
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
