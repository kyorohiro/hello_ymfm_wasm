import test from 'node:test';
import assert from 'node:assert/strict';
import {mountMusicSheet} from './music_sheet.js';

class Element {
  constructor(tag = 'div') {this.tag = tag; this.children = []; this.listeners = new Map(); this.selectors = new Map(); this.style = {}; this.open = false; this.hidden = false; this.textContent = '';}
  addEventListener(type, callback) {this.listeners.set(type, callback);}
  fire(type, event = {}) {return this.listeners.get(type)?.(event);}
  append(...children) {this.children.push(...children);}
  replaceChildren(...children) {this.children = [...children];}
  querySelector(selector) {return this.selectors.get(selector);}
  querySelectorAll(selector) {
    const descendants = this.children.flatMap(child => child instanceof Element ? [child, ...child.descendants()] : []);
    return descendants.filter(child => child.tag === 'input' && (selector !== 'input:checked' || child.checked));
  }
  descendants() {return this.children.flatMap(child => child instanceof Element ? [child, ...child.descendants()] : []);}
  showModal() {this.open = true;}
  close() {this.open = false; this.fire('close');}
}

const analysis = midi => ({chipKind:'snes', channels:[{name:'SNES Voice 1',notes:[{start:0,end:22050,midi,key:1}]}],time:44100,warnings:[],tempo:{bpm:120,estimated:false,candidates:[]}});
function fixture({deferredLoad = false, explicitSource = true} = {}) {
  const ids = new Map(), status = [], scans = [], downloads = [], renderers = [];
  for (const id of ['musicSheetExportDialog','musicSheetPreviewDialog','musicSheetBpmInput','musicSheetChannels','sheetMusicPanel','musicSheetTempoHelp','exportMusicSheetButton','showSheetMusicButton']) ids.set(id,new Element());
  const form = new Element('form'); ids.get('musicSheetExportDialog').selectors.set('form',form);
  for (const id of ['musicSheetPreviewDialog','sheetMusicPanel']) for (const name of ['status','pages','notices']) ids.get(id).selectors.set(`[data-${name}]`,new Element());
  ids.get('musicSheetBpmInput').reportValidity = () => true;
  const buffer = new Uint8Array(1), first = analysis(60), second = analysis(72);
  let track = {buffer,available:true,fileName:'Song.spc',...(explicitSource ? {source:first} : {})}, release;
  const waiting = deferredLoad ? new Promise(resolve => {release = resolve;}) : Promise.resolve();
  const savedDocument = globalThis.document, savedRenderer = globalThis.opensheetmusicdisplay;
  const savedCreateUrl = URL.createObjectURL, savedRevokeUrl = URL.revokeObjectURL, savedTimeout = globalThis.setTimeout;
  globalThis.document = {
    getElementById:id => ids.get(id), createTextNode:text => ({textContent:text}),
    createElement(tag) {const element = new Element(tag); if (tag === 'a') element.click = () => downloads.push(element); return element;},
  };
  globalThis.opensheetmusicdisplay = {OpenSheetMusicDisplay:class {
    constructor(pages) {this.pages = pages; this.renders = 0; this.clears = 0; renderers.push(this);}
    async load(text) {this.text = text; await waiting;}
    render() {this.renders++; this.pages.append(new Element('svg'));}
    clear() {this.clears++; this.pages.replaceChildren();}
  }};
  URL.createObjectURL = blob => {downloads.blob = blob; return 'blob:test';};
  URL.revokeObjectURL = () => {};
  globalThis.setTimeout = callback => {callback(); return 0;};
  const api = mountMusicSheet({getTrack:() => track, setStatus:message => status.push(message), tempoSettings:{
    getAnalysis(source) {scans.push(source); return source === buffer ? first : source;},
    prepare(source,input) {input.value = (source === buffer ? first : source).tempo.bpm;},
  }});
  return {api,ids,form,status,scans,downloads,renderers,buffer,first,second,
    get track() {return track;}, set track(value) {track = value;}, release,
    open(panel = false) {ids.get(panel ? 'showSheetMusicButton' : 'exportMusicSheetButton').fire('click');},
    submit(action) {return form.fire('submit',{submitter:{value:action},preventDefault(){}});},
    restore() {globalThis.document = savedDocument;globalThis.opensheetmusicdisplay = savedRenderer;URL.createObjectURL = savedCreateUrl;URL.revokeObjectURL = savedRevokeUrl;globalThis.setTimeout = savedTimeout;},
  };
}

test('same-buffer reference correction replaces cached score and invalidates old settings and preview', async () => {
  const f = fixture();
  try {
    f.open(); await f.submit('preview');
    assert.equal(f.renderers[0].renders,1);
    assert.equal(f.ids.get('musicSheetPreviewDialog').open,true);
    f.track = {...f.track,source:f.second}; f.api.updateTrack();
    assert.equal(f.ids.get('musicSheetPreviewDialog').open,false);
    f.open();
    assert.deepEqual(f.scans,[f.first,f.second]);
    await f.submit('export');
    const text = await f.downloads.blob.text();
    assert.match(text,/<step>C<\/step><octave>5/);
    assert.match(text,/SNES BRR base pitches/);
    assert.equal(f.downloads[0].download,'Song.musicxml');
  } finally {f.restore();}
});

test('submit refuses corrected or unavailable analysis even before updateTrack is called', async () => {
  const f = fixture();
  try {
    f.open(); f.track = {...f.track,source:f.second}; await f.submit('export');
    assert.equal(f.downloads.length,0); assert.match(f.status.at(-1),/current analysis/);
    f.open(); f.track = {...f.track,available:false}; await f.submit('export');
    assert.equal(f.downloads.length,0); assert.match(f.status.at(-1),/current analysis/);
    f.api.updateTrack(); assert.equal(f.ids.get('musicSheetExportDialog').open,false);
    const scans = f.scans.length; f.open(); assert.equal(f.scans.length,scans);
  } finally {f.restore();}
});

test('reference correction during async renderer load cannot render an obsolete sheet', async () => {
  const f = fixture({deferredLoad:true});
  try {
    f.open(true); const pending = f.submit('preview');
    await Promise.resolve(); // Renderer has begun loading the first analysis.
    assert.equal(f.renderers.length,1);
    f.track = {...f.track,source:f.second}; f.api.updateTrack();
    f.release(); await pending;
    assert.equal(f.renderers[0].renders,0);
    assert.equal(f.ids.get('sheetMusicPanel').querySelector('[data-pages]').children.length,0);
    assert.match(f.ids.get('sheetMusicPanel').querySelector('[data-status]').textContent,/generate the current track/);
    f.api.setVisible(true); assert.equal(f.renderers[0].renders,0);
  } finally {f.restore();}
});

test('async preview stops when current analysis becomes unavailable', async () => {
  const f = fixture({deferredLoad:true});
  try {
    f.open(); const pending = f.submit('preview'); await Promise.resolve();
    f.track = {...f.track,available:false}; f.release(); await pending;
    assert.equal(f.renderers[0].renders,0);
  } finally {f.restore();}
});

test('showing a completed panel cannot render a stale or unavailable analysis', async () => {
  const f = fixture();
  try {
    f.open(true); await f.submit('preview');
    assert.equal(f.renderers[0].renders,1);
    f.track = {...f.track,source:f.second}; f.api.setVisible(true);
    assert.equal(f.renderers[0].renders,1);
    f.track = {...f.track,source:f.first,available:false}; f.api.setVisible(true);
    assert.equal(f.renderers[0].renders,1);
  } finally {f.restore();}
});

test('legacy track objects continue to use the original buffer as score identity', async () => {
  const f = fixture({explicitSource:false});
  try {
    f.open(); f.open(); assert.deepEqual(f.scans,[f.buffer]);
    await f.submit('preview'); assert.equal(f.renderers[0].renders,1);
    f.track = {...f.track,buffer:new Uint8Array(2)}; f.api.updateTrack();
    assert.equal(f.ids.get('musicSheetPreviewDialog').open,false);
  } finally {f.restore();}
});
