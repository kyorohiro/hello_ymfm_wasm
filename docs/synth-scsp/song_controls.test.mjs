// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {setupScspSongControls} from './song_controls.js';

function rig({ssfLibraries = [], ssfGate} = {}) {
  const listeners = new Map(), nodes = new Map();
  for (const id of ['scspSongSelect','scspSongPlay','scspSongPause','scspSongStop','scspSongSeek','scspSongPosition','scspSongStatus','scspSongDemo']) {
    const events = new Map();
    nodes.set(id,{value:'',textContent:'',disabled:false,events,addEventListener(type,callback) {events.set(type,callback);},removeEventListener(type) {events.delete(type);},replaceChildren(...children) {this.children = children;},blur() {}});
  }
  const document = {getElementById:id => nodes.get(id), createElement:() => ({})}, files = new Map();
  const project = {fs:{list:() => [...files.values()],get:path => files.get(path)},onDidChange(callback) {listeners.set('change',callback); return () => listeners.delete('change');}};
  let options, loaded = '', status = '', audioRequests = 0, state = {playback:'stopped',loaded:false,busy:false,warnings:[],positionSeconds:0,durationSeconds:0,kind:null,loadedFiles:[]};
  const calls = [];
  const player = {getState:() => state, clear() {loaded = ''; state = {...state,loaded:false,kind:null,loadedFiles:[]}; options.onState(state);},stop() {state = {...state,playback:'stopped'}; options.onState(state);},dispose() {},
    async load(data,name,settings = {}) {
      await Promise.resolve();
      if (settings.signal?.aborted || settings.isCurrent && !settings.isCurrent()) throw new DOMException('Cancelled','AbortError');
      if (!data[0]) throw new Error('Invalid song'); loaded = name; state = {...state,loaded:true,durationSeconds:2.4,kind:'vgm',loadedFiles:[]}; options.onState(state);
      calls.push(['vgm',data,name]);
    },
    async loadSsf(entries, entryPath, settings = {}) {
      calls.push(['ssf', entries, entryPath]);
      await ssfGate;
      const files = new Map(entries.map(file => [file.path,file.data]));
      for (const library of ssfLibraries) if (!files.has(library)) throw Error('Missing SSF library: ' + library);
      if (!files.get(entryPath)?.[0]) throw Error('Invalid SSF song');
      if (settings.signal?.aborted || settings.isCurrent && !settings.isCurrent([...ssfLibraries,entryPath])) throw new DOMException('Cancelled','AbortError');
      loaded = entryPath;
      state = {...state,loaded:true,durationSeconds:30,kind:'ssf',loadedFiles:[...ssfLibraries,entryPath]};
      options.onState(state);
    },whenIdle:async () => {},play:async () => {},pause() {},resume:async () => {},seek:async () => {}};
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

test('SSF selection supplies the folder libraries silently while failed dependencies retain the previous VGM', async () => {
  const r = rig({ssfLibraries:['/ssf/Set/lib/Driver.ssflib']});
  try {
    r.put('/vgm/first.vgm', Uint8Array.of(1));
    r.put('/ssf/Set/Track.ssf', Uint8Array.of(2));
    r.put('/ssf/Set/Second.minissf', Uint8Array.of(3));
    r.put('/ssf/Set/unused.ssflib', Uint8Array.of(4));
    assert.equal(r.nodes.get('scspSongSelect').children.length, 4);
    assert(r.nodes.get('scspSongSelect').children.every(option => !/\.ssflib$/i.test(option.value)));
    await r.controller.selectFile('/vgm/first.vgm');
    await assert.rejects(r.controller.selectFile('/ssf/Set/Track.ssf'), /Missing SSF library.*Driver.ssflib/);
    assert.equal(r.loaded, 'first.vgm');
    assert.equal(r.nodes.get('scspSongSelect').value, '/vgm/first.vgm');
    r.put('/ssf/Set/lib/Driver.ssflib', Uint8Array.of(9, 8));
    assert.equal(await r.controller.selectFile('/ssf/Set/Track.ssf'), true);
    assert.equal(r.loaded, '/ssf/Set/Track.ssf');
    assert.equal(r.controller.getState().kind, 'ssf');
    assert.deepEqual(r.controller.getState().loadedFiles, ['/ssf/Set/lib/Driver.ssflib','/ssf/Set/Track.ssf']);
    const [method, entries, entryPath] = r.calls.at(-1);
    assert.equal(method, 'ssf');
    assert.equal(entryPath, '/ssf/Set/Track.ssf');
    assert(entries.every(file => file.path.startsWith('/ssf/')));
    assert.deepEqual(entries.find(file => file.path.endsWith('/lib/Driver.ssflib')).data, Uint8Array.of(9, 8));
    assert.equal(r.audioRequests, 0);
  } finally {r.controller.dispose();}
});

test('SSF stays loaded through unrelated Files edits and invalidates when an actual loaded source changes', async () => {
  const r = rig({ssfLibraries:['/ssf/Set/lib/Driver.ssflib']});
  try {
    const path = '/ssf/Set/Track.minissf', library = '/ssf/Set/lib/Driver.ssflib';
    r.put(path, Uint8Array.of(2));
    r.put(library, Uint8Array.of(7));
    await r.controller.selectFile(path);
    r.put('/index.js', Uint8Array.of(5));
    r.put('/ssf/Set/unused.ssflib', Uint8Array.of(3));
    r.put('/ssf/Set/unused.ssflib', Uint8Array.of(4));
    r.remove('/ssf/Set/unused.ssflib');
    r.put(library, Uint8Array.of(7));
    assert.equal(r.controller.getState().loaded, true);
    assert.equal(r.nodes.get('scspSongSelect').value, path);
    r.put(library, Uint8Array.of(8));
    assert.equal(r.controller.getState().loaded, false);
    assert.equal(r.nodes.get('scspSongSelect').value, '');
    await r.controller.selectFile(path);
    r.remove(library);
    assert.equal(r.controller.getState().loaded, false);
    r.put(library, Uint8Array.of(8));
    await r.controller.selectFile(path);
    r.put(path, Uint8Array.of(3));
    assert.equal(r.controller.getState().loaded, false);
  } finally {r.controller.dispose();}
});

test('a changed SSF input during preparation cannot replace the previous recording', async () => {
  let release;
  const gate = new Promise(resolve => {release = resolve;});
  const r = rig({ssfLibraries:['/ssf/Set/Driver.ssflib'],ssfGate:gate});
  try {
    r.put('/vgm/first.vgm', Uint8Array.of(1));
    r.put('/ssf/Set/Track.ssf', Uint8Array.of(2));
    r.put('/ssf/Set/Driver.ssflib', Uint8Array.of(3));
    await r.controller.selectFile('/vgm/first.vgm');
    const pending = r.controller.selectFile('/ssf/Set/Track.ssf');
    r.put('/ssf/Set/Driver.ssflib', Uint8Array.of(4));
    release();
    await assert.rejects(pending, {name:'AbortError'});
    assert.equal(r.loaded, 'first.vgm');
    assert.equal(r.nodes.get('scspSongSelect').value, '/vgm/first.vgm');
    assert.equal(r.audioRequests, 0);
  } finally {release();r.controller.dispose();}
});

test('unrelated SSF library edits during preparation leave the selected dependency graph current', async () => {
  let release;
  const gate = new Promise(resolve => {release = resolve;});
  const r = rig({ssfLibraries:['/ssf/Set/Driver.ssflib'],ssfGate:gate});
  try {
    r.put('/ssf/Set/Track.ssf', Uint8Array.of(2));
    r.put('/ssf/Set/Driver.ssflib', Uint8Array.of(3));
    r.put('/ssf/Set/Unused.ssflib', Uint8Array.of(4));
    const pending = r.controller.selectFile('/ssf/Set/Track.ssf');
    r.put('/ssf/Set/Unused.ssflib', Uint8Array.of(5));
    release();
    assert.equal(await pending, true);
    assert.equal(r.loaded, '/ssf/Set/Track.ssf');
    assert.equal(r.nodes.get('scspSongSelect').value, '/ssf/Set/Track.ssf');
    assert.equal(r.audioRequests, 0);
  } finally {release();r.controller.dispose();}
});
