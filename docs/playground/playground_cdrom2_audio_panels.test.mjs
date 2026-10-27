import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaygroundCdrom2AudioPanels} from './playground_cdrom2_audio_panels.js';

class Events {
  listeners = new Map();
  addEventListener(type, listener) {if (!this.listeners.has(type)) this.listeners.set(type, new Set());this.listeners.get(type).add(listener);}
  removeEventListener(type, listener) {this.listeners.get(type)?.delete(listener);}
  fire(type) {for (const listener of this.listeners.get(type) ?? []) listener({type});}
}
class Element extends Events {
  constructor(doc, tag) {super();this.ownerDocument=doc;this.tagName=tag;this.children=[];this.dataset={};this.style={};this.attributes={};this.disabled=false;this.ownText='';}
  set textContent(text) {this.ownText=String(text);this.children=[];}
  get textContent() {return this.ownText+this.children.map(child=>child.textContent).join('');}
  setAttribute(name, value) {this.attributes[name]=String(value);}
  appendChild(node) {node.remove();node.parent=this;this.children.push(node);return node;}
  remove() {if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}
}
class Document extends Events {
  hidden=false;
  createElement(tag) {return new Element(this,tag);}
}
const walk = node => [node,...node.children.flatMap(walk)];
const output = (root, name) => walk(root).find(node=>node.dataset.cdrom2Output===name);
const button = root => walk(root).find(node=>node.dataset.cdrom2Action==='refresh');
const status = root => walk(root).find(node=>node.className==='chip-editor-status');
const deferred = () => {let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush = async () => {for(let i=0;i<12;i++)await Promise.resolve();};
function setup(readState=()=>null) {
  const doc=new Document(),roots={msm5205:doc.createElement('section'),cdda:doc.createElement('section')},reads=[],errors=[];
  const panel=createPlaygroundCdrom2AudioPanels({roots,readState:kind=>{reads.push(kind);return readState(kind);},onError:error=>errors.push(error)});
  return {doc,roots,panel,reads,errors};
}

test('hardware identities render without initializing or reading audio; only Refresh controls exist',async()=>{
  const f=setup();await flush();assert.deepEqual(f.reads,[]);
  assert.match(f.roots.msm5205.textContent,/MSM5205.*Mono.*4-bit OKI ADPCM.*64 KiB.*1\.536 MHz/);
  assert.match(f.roots.cdda.textContent,/CD-DA.*44,100 Hz.*16-bit stereo PCM.*2 channels/);
  for(const root of Object.values(f.roots)){
    assert.equal(output(root,'state').textContent,'Not initialized');
    assert.deepEqual(walk(root).filter(node=>['button','input','select','textarea','canvas'].includes(node.tagName)).map(node=>node.tagName),['button']);
    assert.equal(button(root).type,'button');assert.equal(status(root).attributes.role,'status');
  }
  await f.panel.refresh();await f.panel.setVisible(null);assert.deepEqual(f.reads,[]);f.panel.dispose();
});

test('MSM5205 snapshot shows Native-compatible rates, bounded RAM and nibble addresses; same tab does not poll',async()=>{
  const state={state:'playing',mode:'driver',sourceBytes:4000,clock:1536000,rate:12,positionNibbles:120,
    offset:20,length:7800,volume:.35,mute:false};
  const f=setup(()=>state);await f.panel.setVisible('msm5205');
  const root=f.roots.msm5205;
  assert.equal(output(root,'state').textContent,'Playing');assert.equal(output(root,'memory').textContent,'4,000 / 65,536 bytes');
  assert.equal(output(root,'clock').textContent,'1,536,000 Hz');assert.equal(output(root,'rate').textContent,'8,000 Hz · code 12');
  assert.equal(output(root,'position').textContent,'120 nibbles');assert.equal(output(root,'range').textContent,'20–7,820 (7,800 nibbles)');
  assert.equal(output(root,'mode').textContent,'Sample RAM');assert.equal(output(root,'volume').textContent,'0.350');assert.equal(output(root,'mute').textContent,'Off');
  await f.panel.setVisible('msm5205');await flush();assert.deepEqual(f.reads,['msm5205']);
  button(root).fire('click');await flush();assert.deepEqual(f.reads,['msm5205','msm5205']);
  assert.equal(state.positionNibbles,120,'Rendering never mutates the source snapshot');f.panel.dispose();
});

test('CD-DA reports selected track, source frames, prepared PCM and stereo output rate as text',async()=>{
  const title='<img src=x onerror=alert(1)>',f=setup(()=>({state:'paused',track:2,title,tracks:[{number:2},{number:3}],
    positionFrames:11025,positionSeconds:.25,durationFrames:352800,durationSeconds:8,sampleRate:48000,volume:1,mute:true}));
  await f.panel.setVisible('cdda');const root=f.roots.cdda;
  assert.equal(output(root,'state').textContent,'Paused');assert.equal(output(root,'track').textContent,`2 · ${title}`);
  assert.equal(output(root,'tracks').textContent,'2 tracks');assert.equal(output(root,'position').textContent,'0.250 s / 8.000 s');
  assert.equal(output(root,'memory').textContent,'1,411,200 bytes');assert.equal(output(root,'frames').textContent,'11,025 / 352,800');
  assert.equal(output(root,'rate').textContent,'48,000 Hz');assert.equal(output(root,'mute').textContent,'On');
  assert.equal(walk(root).some(node=>node.tagName==='img'),false,'Metadata is assigned only as text');f.panel.dispose();
});

test('refresh coalesces in-flight reads and gives accessible busy feedback',async()=>{
  const gate=deferred(),f=setup(()=>gate.promise),first=f.panel.setVisible('msm5205'),second=f.panel.refresh();
  assert.strictEqual(first,second);assert.equal(button(f.roots.msm5205).disabled,true);
  assert.equal(f.roots.msm5205.children[0].attributes['aria-busy'],'true');await flush();assert.deepEqual(f.reads,['msm5205']);
  gate.resolve(null);await first;assert.equal(button(f.roots.msm5205).disabled,false);
  assert.equal(f.roots.msm5205.children[0].attributes['aria-busy'],'false');assert.match(status(f.roots.msm5205).textContent,/Not initialized/);f.panel.dispose();
});

test('tab changes discard late snapshots and errors without touching the newly selected panel',async()=>{
  const a=deferred(),f=setup(kind=>kind==='msm5205'?a.promise:{state:'playing',track:2,tracks:[{}]});
  const first=f.panel.setVisible('msm5205');await flush();await f.panel.setVisible('cdda');a.reject(Error('retired source'));await first;
  assert.deepEqual(f.errors,[]);assert.equal(output(f.roots.msm5205,'state').textContent,'Not initialized');
  assert.equal(output(f.roots.cdda,'state').textContent,'Playing');assert.match(status(f.roots.cdda).textContent,/Snapshot/);f.panel.dispose();
});

test('hiding the panel or document invalidates pending work; returning reads once without a timer',async()=>{
  let gate=deferred();const f=setup(()=>gate.promise),opening=f.panel.setVisible('msm5205');await flush();
  await f.panel.setVisible(null);gate.resolve({state:'playing'});await opening;
  assert.equal(output(f.roots.msm5205,'state').textContent,'Not initialized');
  gate=deferred();const second=f.panel.setVisible('msm5205');await flush();f.doc.hidden=true;f.doc.fire('visibilitychange');
  gate.reject(Error('hidden error'));await second;await f.panel.refresh();assert.deepEqual(f.errors,[]);assert.equal(f.reads.length,2);
  gate=deferred();f.doc.hidden=false;f.doc.fire('visibilitychange');await flush();assert.equal(f.reads.length,3);
  gate.resolve({state:'ready',sourceBytes:32});await flush();assert.equal(output(f.roots.msm5205,'state').textContent,'Ready');
  await f.panel.setVisible('msm5205');await flush();assert.equal(f.reads.length,3);f.panel.dispose();
});

test('current errors report once, cancellation stays quiet, and Refresh can recover',async()=>{
  let read=()=>Promise.reject(Error('snapshot unavailable'));const f=setup(()=>read());await f.panel.setVisible('cdda');
  assert.equal(f.errors.length,1);assert.equal(status(f.roots.cdda).dataset.error,'true');assert.equal(status(f.roots.cdda).textContent,'snapshot unavailable');
  read=()=>Promise.reject(new DOMException('source stopped','AbortError'));await f.panel.refresh();assert.equal(f.errors.length,1);assert.equal(status(f.roots.cdda).dataset.error,undefined);
  read=()=>({state:'ended',positionFrames:44100,durationFrames:44100});await f.panel.refresh();assert.equal(output(f.roots.cdda,'state').textContent,'Ended');f.panel.dispose();
});

test('dispose removes only owned DOM/listeners and ignores late reads or further actions',async()=>{
  const gate=deferred(),f=setup(()=>gate.promise),refreshButton=button(f.roots.msm5205),opening=f.panel.setVisible('msm5205');await flush();
  f.panel.dispose();f.panel.dispose();gate.reject(Error('disposed late error'));await opening;
  f.doc.fire('visibilitychange');refreshButton.fire('click');await f.panel.refresh();await f.panel.setVisible('cdda');
  assert.deepEqual(f.reads,['msm5205']);assert.deepEqual(f.errors,[]);
  assert.equal(f.roots.msm5205.children.length,0);assert.equal(f.roots.cdda.children.length,0);
  assert.equal([...f.doc.listeners.values()].reduce((n,set)=>n+set.size,0),0);
  assert.equal([...refreshButton.listeners.values()].reduce((n,set)=>n+set.size,0),0);
});
